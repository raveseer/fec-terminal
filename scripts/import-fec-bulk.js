#!/usr/bin/env node
// FEC bulk importer — the "PAC layer": nationwide committee/candidate masters plus every
// committee→candidate contribution (pas2) and, with --oth, committee→committee transfers (oth).
//
//   node scripts/import-fec-bulk.js --cycles 2026,2024,2022 [--oth] [--indiv] [--fresh]
//
// --indiv adds the "people layer" for one state (default TN, --indiv-state XX): every itemized
// individual contribution (a) received by a committee based in or linked to that state and
// (b) given by a resident of that state to anyone. The nationwide indiv file is 40-70M rows per
// cycle; it is STREAMED straight from the FEC (only the first zip entry, ~half the archive) and
// filtered on the fly, so nothing multi-GB lands on disk and only the state's rows are stored.
//   docker compose exec fec-terminal node scripts/import-fec-bulk.js --cycles 2026,2024
//
// Files land in $DATA_DIR/bulk/ and are kept (re-runs skip the download; --fresh re-downloads).
// Rows upsert into the SAME permanent tables the app already reads (contributions,
// fec_committee, fec_candidate), keyed by the FEC's global SUB_ID — so bulk rows dedupe
// against rows already ingested from the live API, and every existing tool (flows, overlap,
// similarity, patterns) sees the nationwide network immediately. No new dependencies:
// the zips are single-entry deflate archives, streamed through node's built-in zlib.
//
// Direction semantics (verified against FEC data dictionaries):
//   pas2: CMTE_ID = the GIVING committee (filer), NAME/OTHER_ID/CAND_ID = the recipient.
//         Kept types: 24K (direct), 24Z (in-kind), 24C (coordinated). IE types (24A/24E) are
//         NOT contributions and are skipped.
//   oth:  giver-side (2x) types only — receipt-side (1x) rows describe the same dollars from
//         the recipient's filing and would double-count. Kept: 24K, 24Z, 24C, 24G.
// Memo rows are stored with memo=1 (every aggregation already excludes them from sums).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { Readable } from "node:stream";
import { contribUpsertMany, fecCommitteeUpsertMany, fecCandidateUpsertMany,
         contribStats, fecRefStats, persistent, dbAnalyze, settingSet } from "../server/db.js";

const BASE = "https://www.fec.gov/files/bulk-downloads";
const PAS2_TYPES = new Set(["24K", "24Z", "24C"]);
const OTH_TYPES = new Set(["24K", "24Z", "24C", "24G"]);
const BATCH = 5000;

// ---- tiny arg parser ----
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d = "") => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
// "auto" resolves to the current 2-year cycle AT RUN TIME — a saved schedule of "auto" keeps
// importing the right cycle after the 2026→2028 rollover without anyone touching it.
const CURRENT_CYCLE = (() => { const y = new Date().getFullYear(); return String(y % 2 ? y + 1 : y); })();
const cycles = [...new Set(opt("--cycles").split(",")
  .map((s) => (s.trim().toLowerCase() === "auto" ? CURRENT_CYCLE : s.trim()))
  .filter((s) => /^\d{4}$/.test(s)))];
const withOth = flag("--oth");
const withIndiv = flag("--indiv");
const INDIV_STATE = (opt("--indiv-state", "TN") || "TN").toUpperCase().slice(0, 2);
// Receipt types that are contributions from individuals (15 = contribution, 15E = earmarked,
// 15C = from the candidate, 10/11 = to super PACs / tribal, 3x = convention/recount/HQ accounts).
// Refunds (2xY) and conduit pass-through lines (24I/24T) are not gifts and are skipped.
const INDIV_TYPES = new Set(["10", "11", "15", "15C", "15E", "15I", "15T", "30", "30T", "31", "31T", "32", "32T"]);
const CONDUIT_NAME_RE = /^(ACTBLUE|WINRED|ACT BLUE|DEMOCRACY ENGINE|ANEDOT)\b/;
const fresh = flag("--fresh");
if (!cycles.length) {
  console.log("Usage: node scripts/import-fec-bulk.js --cycles auto,2024[,...] [--oth] [--indiv [--indiv-state TN]] [--fresh]");
  process.exit(1);
}
if (!persistent) {
  console.error("SQLite unavailable (node:sqlite) — bulk import needs the persistent store. Aborting.");
  process.exit(1);
}

// ---- helpers mirrored from server/index.js (importing it would start the server) ----
const normKey = (name, state) =>
  `${String(name || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim()}|${String(state || "").toUpperCase().trim()}`;
const bulkDate = (s) => { // TRANSACTION_DT is MMDDYYYY
  const m = String(s || "").trim().match(/^(\d{2})(\d{2})(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : "";
};
const cmteEntityType = (tp) => (/^[XY]$/i.test(tp || "") ? "PTY" : /^[HSP]$/i.test(tp || "") ? "CCM" : "PAC");

// ---- minimal single-entry zip → line stream (deflate via built-in zlib, low memory) ----
function zipEntrySlice(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 66000);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("zip: end-of-central-directory not found");
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(46);
    fs.readSync(fd, cd, 0, 46, cdOffset);
    if (cd.readUInt32LE(0) !== 0x02014b50) throw new Error("zip: bad central directory");
    const method = cd.readUInt16LE(10);
    const csize = cd.readUInt32LE(20);
    if (csize === 0xFFFFFFFF) throw new Error("zip64 archive — unzip manually and re-run against the .txt");
    const lho = cd.readUInt32LE(42);
    const lh = Buffer.alloc(30);
    fs.readSync(fd, lh, 0, 30, lho);
    if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error("zip: bad local header");
    const start = lho + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    return { start, size: csize, method };
  } finally { fs.closeSync(fd); }
}

function entryLines(file) {
  // .txt passthrough lets you point at a manually unzipped file too
  if (/\.(txt|csv)$/i.test(file)) {
    return readline.createInterface({ input: fs.createReadStream(file, { encoding: "latin1" }), crlfDelay: Infinity });
  }
  const { start, size, method } = zipEntrySlice(file);
  const raw = fs.createReadStream(file, { start, end: start + size - 1 });
  const stream = method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw;
  stream.setEncoding("latin1");
  return readline.createInterface({ input: stream, crlfDelay: Infinity });
}

// ---- download (resumable: existing files are reused unless --fresh) ----
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const BULK_DIR = path.join(DATA_DIR, "bulk");
fs.mkdirSync(BULK_DIR, { recursive: true });

// A cached zip is reused only while it's younger than FRESH_MS — the FEC refreshes bulk files
// daily, so a scheduled weekly run MUST re-download or it would re-import the same snapshot
// forever. --fresh forces a re-download regardless of age.
const FRESH_MS = 20 * 3600 * 1000;

async function fetchFile(cycle, kind) {
  const yy = String(cycle).slice(2);
  const file = path.join(BULK_DIR, `${kind}${yy}.zip`);
  if (!fresh && fs.existsSync(file) && fs.statSync(file).size > 0) {
    const ageMs = Date.now() - fs.statSync(file).mtimeMs;
    if (ageMs < FRESH_MS) {
      console.log(`  ${kind}${yy}.zip — cached ${(ageMs / 3600000).toFixed(1)}h ago (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
      return file;
    }
    console.log(`  ${kind}${yy}.zip — cache is ${(ageMs / 3600000).toFixed(0)}h old, re-downloading`);
  }
  const url = `${BASE}/${cycle}/${kind}${yy}.zip`;
  console.log(`  downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
  console.log(`  ${kind}${yy}.zip — ${(buf.length / 1e6).toFixed(1)} MB`);
  return file;
}

// ---- masters ----
async function importMasters(cycle) {
  const cm = new Map(), cn = new Map(), linked = new Set();
  { // committee master: CMTE_ID|CMTE_NM|TRES|ST1|ST2|CITY|ST|ZIP|DSGN|TP|PTY|FREQ|ORG_TP|CONNECTED|CAND_ID
    const rows = [];
    for await (const line of entryLines(await fetchFile(cycle, "cm"))) {
      const c = line.split("|");
      if (c.length < 15 || !c[0]) continue;
      cm.set(c[0], { name: c[1], state: c[6], type: c[9], candId: c[14] || null });
      rows.push({ cmteId: c[0], name: c[1] || null, type: c[9] || null, designation: c[8] || null,
        party: c[10] || null, state: c[6] || null, connectedOrg: c[13] || null,
        candId: c[14] || null, lastCycle: cycle });
    }
    // format-change tripwire: a master file that parses to zero rows means the download is bad
    // or the FEC changed the layout — fail LOUDLY instead of "importing" nothing as a success
    if (!rows.length) throw new Error(`cm${String(cycle).slice(2)} parsed 0 committees — bad download or format change`);
    fecCommitteeUpsertMany(rows);
    console.log(`  cm${String(cycle).slice(2)}: ${rows.length.toLocaleString()} committees`);
  }
  { // candidate master: CAND_ID|NAME|PTY|ELEC_YR|OFF_ST|OFFICE|DIST|ICI|STATUS|PCC|…
    const rows = [];
    for await (const line of entryLines(await fetchFile(cycle, "cn"))) {
      const c = line.split("|");
      if (c.length < 15 || !c[0]) continue;
      cn.set(c[0], { name: c[1], pcc: c[9], state: c[4] });
      rows.push({ candId: c[0], name: c[1] || null, party: c[2] || null, office: c[5] || null,
        state: c[4] || null, district: c[6] || null, pcc: c[9] || null,
        incumbentChallenge: c[7] || null, status: c[8] || null, lastCycle: cycle });
    }
    fecCandidateUpsertMany(rows);
    console.log(`  cn${String(cycle).slice(2)}: ${rows.length.toLocaleString()} candidates`);
  }
  { // linkage fills pccs the candidate master leaves blank: CAND_ID|…|CMTE_ID|CMTE_TP|CMTE_DSGN|…
    const rows = [];
    for await (const line of entryLines(await fetchFile(cycle, "ccl"))) {
      const c = line.split("|");
      if (c.length < 7 || !c[0] || !c[3]) continue;
      // every committee linked to one of the state's candidates (principal, authorized, joint) is in scope for --indiv
      if (cn.get(c[0])?.state === INDIV_STATE) linked.add(c[3]);
      if (c[5] === "P" && !cn.get(c[0])?.pcc) { // principal designation
        const cur = cn.get(c[0]) || {};
        cn.set(c[0], { ...cur, pcc: c[3] });
        rows.push({ candId: c[0], pcc: c[3], lastCycle: cycle });
      }
    }
    if (rows.length) fecCandidateUpsertMany(rows);
  }
  return { cm, cn, linked };
}

// ---- individual contributions (indiv), streamed and filtered to one state ----
// Layout: CMTE_ID|AMNDT_IND|RPT_TP|TRANSACTION_PGI|IMAGE_NUM|TRANSACTION_TP|ENTITY_TP|NAME|CITY|
//         STATE|ZIP_CODE|EMPLOYER|OCCUPATION|TRANSACTION_DT|TRANSACTION_AMT|OTHER_ID|TRAN_ID|
//         FILE_NUM|MEMO_CD|MEMO_TEXT|SUB_ID
// indivYY.zip holds itcont.txt first, then the same rows again split by date — so only the first
// entry is requested (HTTP Range), inflated and read line by line.
async function remoteFirstEntryLines(url) {
  const probe = await fetch(url, { headers: { Range: "bytes=0-2047" } });
  if (!probe.ok) throw new Error(`${url} → HTTP ${probe.status}`);
  const finalUrl = probe.url || url;
  const h = Buffer.from(await probe.arrayBuffer());
  if (h.length < 30 || h.readUInt32LE(0) !== 0x04034b50) throw new Error("indiv zip: bad local header");
  const flags = h.readUInt16LE(6), method = h.readUInt16LE(8);
  const fnLen = h.readUInt16LE(26), exLen = h.readUInt16LE(28);
  const name = h.subarray(30, 30 + fnLen).toString("latin1");
  if (!/itcont\.txt$/i.test(name)) throw new Error(`indiv zip: first entry is "${name}", expected itcont.txt — archive layout changed`);
  if (method !== 8) throw new Error(`indiv zip: unexpected compression method ${method}`);
  let csize = h.readUInt32LE(18);
  if (csize === 0xFFFFFFFF) { // zip64: sizes live in the extra field (id 0x0001: usize u64, csize u64)
    let o = 30 + fnLen; const end = o + exLen; csize = 0;
    while (o + 4 <= end) {
      const id = h.readUInt16LE(o), len = h.readUInt16LE(o + 2);
      if (id === 0x0001 && len >= 16) { csize = Number(h.readBigUInt64LE(o + 12)); break; }
      o += 4 + len;
    }
  }
  if (!csize || (flags & 8)) throw new Error("indiv zip: entry size not in the local header — cannot range-read it");
  const start = 30 + fnLen + exLen;
  const res = await fetch(finalUrl, { headers: { Range: `bytes=${start}-${start + csize - 1}` } });
  if (res.status !== 206) throw new Error(`${finalUrl} → HTTP ${res.status} (range request refused)`);
  const stream = Readable.fromWeb(res.body).pipe(zlib.createInflateRaw());
  stream.setEncoding("latin1");
  return { lines: readline.createInterface({ input: stream, crlfDelay: Infinity }), compressedMB: csize / 1e6 };
}

async function importIndiv(cycle, cm, linked) {
  const yy = String(cycle).slice(2);
  // in-scope committees: based in the state, or linked to one of its candidates
  const inScope = new Set(linked);
  const conduits = new Set();
  for (const [id, c] of cm) {
    if (c.state === INDIV_STATE) inScope.add(id);
    if (CONDUIT_NAME_RE.test(String(c.name || "").toUpperCase())) conduits.add(id);
  }
  const { lines, compressedMB } = await remoteFirstEntryLines(`${BASE}/${cycle}/indiv${yy}.zip`);
  console.log(`  indiv${yy}: streaming ${compressedMB.toFixed(0)} MB (compressed) · scope ${INDIV_STATE}: ${inScope.size.toLocaleString()} committees + all ${INDIV_STATE} residents`);
  let scanned = 0, kept = 0, toState = 0, malformed = 0, batch = [];
  const flush = () => { if (batch.length) { contribUpsertMany(batch); batch = []; } };
  for await (const line of lines) {
    const c = line.split("|");
    if (c.length < 21 || !c[0] || !c[20]) { if (line) malformed++; continue; }
    scanned++;
    const mine = inScope.has(c[0]);
    if (!mine && c[9] !== INDIV_STATE) continue;
    if (conduits.has(c[0]) || !INDIV_TYPES.has(c[5]) || !c[7]) continue;
    const committee = cm.get(c[0]) || {};
    batch.push({
      source: "fec", subId: c[20], kind: "contribution",
      donorKey: normKey(c[7], c[9]), donorName: c[7],
      employer: c[11] || null, occupation: c[12] || null, city: c[8] || null, state: c[9] || null, zip: c[10] || null,
      entityType: c[6] || "IND",
      recipientId: c[0], recipientName: committee.name || null, candidateId: committee.candId || null,
      cycle, date: bulkDate(c[13]), amount: Number(c[14]) || 0, memo: c[18] === "X",
    });
    kept++; if (mine) toState++;
    if (batch.length >= BATCH) flush();
    if (scanned % 500000 === 0) process.stdout.write(`\r  indiv${yy}: ${kept.toLocaleString()} kept / ${(scanned / 1e6).toFixed(1)}M scanned`);
  }
  flush();
  console.log(`\r  indiv${yy}: ${kept.toLocaleString()} kept / ${scanned.toLocaleString()} scanned (${toState.toLocaleString()} to ${INDIV_STATE} committees)`);
  if (scanned < 100000) throw new Error(`indiv${yy}: only ${scanned.toLocaleString()} rows parsed — truncated download or format change`);
  if (malformed > scanned * 0.2) throw new Error(`indiv${yy}: ${malformed.toLocaleString()} malformed rows — likely column-layout change, aborting`);
  // coverage marker: these committees' itemized individual donors are complete as of now
  settingSet(`bulkIndiv:${cycle}`, JSON.stringify({ at: Date.now(), state: INDIV_STATE, kept, scanned, committees: inScope.size }));
  settingSet(`bulkIndivCmtes:${cycle}`, JSON.stringify([...inScope]));
}

// ---- transaction files ----
async function importTransactions(cycle, kind, cm, cn) {
  const isPas2 = kind === "pas2";
  const keepTypes = isPas2 ? PAS2_TYPES : OTH_TYPES;
  const subIdx = isPas2 ? 21 : 20;
  const minCols = isPas2 ? 22 : 21;
  let scanned = 0, kept = 0, skippedType = 0, malformed = 0, batch = [];
  const TT_RE = /^\d{2}[A-Z0-9]{0,2}$/; // FEC transaction-type shape (10, 15E, 24K, …)
  const flush = () => { if (batch.length) { contribUpsertMany(batch); batch = []; } };
  for await (const line of entryLines(await fetchFile(cycle, kind))) {
    const c = line.split("|");
    if (c.length < minCols || !c[0] || !c[subIdx]) continue;
    scanned++;
    const tp = c[5];
    if (!keepTypes.has(tp)) {
      // a "type" that doesn't even look like an FEC transaction code means the column layout
      // shifted under us — count it separately so the tripwire below can fail loudly
      if (TT_RE.test(tp)) skippedType++; else malformed++;
      continue;
    }
    const donor = cm.get(c[0]) || {};
    const candId = isPas2 ? c[16] : null;
    const recipId = c[15] || (candId ? cn.get(candId)?.pcc : null);
    const recipName = c[7] || (candId ? cn.get(candId)?.name : null);
    batch.push({
      source: "fec", subId: c[subIdx], kind: "contribution",
      donorKey: normKey(donor.name || c[0], donor.state || ""),
      donorName: donor.name || c[0], state: donor.state || null,
      entityType: cmteEntityType(donor.type),
      recipientId: recipId || null, recipientName: recipName || null,
      candidateId: candId || null, cycle,
      date: bulkDate(c[13]), amount: Number(c[14]) || 0,
      memo: (isPas2 ? c[19] : c[18]) === "X",
    });
    kept++;
    if (batch.length >= BATCH) {
      flush();
      process.stdout.write(`\r  ${kind}${String(cycle).slice(2)}: ${kept.toLocaleString()} kept / ${scanned.toLocaleString()} scanned`);
    }
  }
  flush();
  console.log(`\r  ${kind}${String(cycle).slice(2)}: ${kept.toLocaleString()} kept / ${scanned.toLocaleString()} scanned (${skippedType.toLocaleString()} non-contribution types skipped)`);
  // format-change tripwires: nothing parseable, or the transaction-type column no longer holds
  // transaction types — either way, fail LOUDLY instead of reporting a silent empty "success"
  if (scanned === 0) throw new Error(`${kind}${String(cycle).slice(2)}: no parseable rows — bad download or format change`);
  if (scanned >= 1000 && malformed > scanned * 0.5) {
    throw new Error(`${kind}${String(cycle).slice(2)}: ${malformed.toLocaleString()} of ${scanned.toLocaleString()} rows have a non-transaction-type in the type column — likely column-layout change, aborting`);
  }
}

// ---- main ----
console.log(`FEC bulk import → ${DATA_DIR} | cycles: ${cycles.join(", ")}${withOth ? " | +oth (committee→committee)" : ""}${withIndiv ? ` | +indiv (${INDIV_STATE} individual donors)` : ""}`);
const t0 = Date.now();
for (const cycle of cycles) {
  console.log(`\ncycle ${cycle}:`);
  const { cm, cn, linked } = await importMasters(cycle);
  await importTransactions(cycle, "pas2", cm, cn);
  if (withOth) await importTransactions(cycle, "oth", cm, cn);
  if (withIndiv) {
    // a dropped connection mid-stream restarts the pass — upserts are idempotent (keyed on SUB_ID)
    for (let attempt = 1; ; attempt++) {
      try { await importIndiv(cycle, cm, linked); break; }
      catch (e) {
        if (attempt >= 3) throw e;
        console.log(`\n  indiv${String(cycle).slice(2)}: ${e.message} — retrying (${attempt}/3)`);
        await new Promise((r) => setTimeout(r, 15000));
      }
    }
  }
}
process.stdout.write("running ANALYZE so SQLite plans queries well at this scale… ");
console.log(dbAnalyze() ? "done" : "skipped");
const s = contribStats(), r = fecRefStats();
console.log(`\ndone in ${Math.round((Date.now() - t0) / 1000)}s — ledger now: ${s.rows.toLocaleString()} rows · ${s.donors.toLocaleString()} donors · ${s.recipients.toLocaleString()} recipients | masters: ${r.committees.toLocaleString()} committees · ${r.candidates.toLocaleString()} candidates`);
