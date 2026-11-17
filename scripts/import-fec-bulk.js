#!/usr/bin/env node
// FEC bulk importer — the "PAC layer": nationwide committee/candidate masters plus every
// committee→candidate contribution (pas2) and, with --oth, committee→committee transfers (oth).
//
//   node scripts/import-fec-bulk.js --cycles 2026,2024,2022 [--oth] [--fresh]
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
import { contribUpsertMany, fecCommitteeUpsertMany, fecCandidateUpsertMany,
         contribStats, fecRefStats, persistent, dbAnalyze } from "../server/db.js";

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
const fresh = flag("--fresh");
if (!cycles.length) {
  console.log("Usage: node scripts/import-fec-bulk.js --cycles auto,2024[,...] [--oth] [--fresh]");
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
  const cm = new Map(), cn = new Map();
  { // committee master: CMTE_ID|CMTE_NM|TRES|ST1|ST2|CITY|ST|ZIP|DSGN|TP|PTY|FREQ|ORG_TP|CONNECTED|CAND_ID
    const rows = [];
    for await (const line of entryLines(await fetchFile(cycle, "cm"))) {
      const c = line.split("|");
      if (c.length < 15 || !c[0]) continue;
      cm.set(c[0], { name: c[1], state: c[6], type: c[9] });
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
      cn.set(c[0], { name: c[1], pcc: c[9] });
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
      if (c[5] === "P" && !cn.get(c[0])?.pcc) { // principal designation
        const cur = cn.get(c[0]) || {};
        cn.set(c[0], { ...cur, pcc: c[3] });
        rows.push({ candId: c[0], pcc: c[3], lastCycle: cycle });
      }
    }
    if (rows.length) fecCandidateUpsertMany(rows);
  }
  return { cm, cn };
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
console.log(`FEC bulk import → ${DATA_DIR} | cycles: ${cycles.join(", ")}${withOth ? " | +oth (committee→committee)" : ""}`);
const t0 = Date.now();
for (const cycle of cycles) {
  console.log(`\ncycle ${cycle}:`);
  const { cm, cn } = await importMasters(cycle);
  await importTransactions(cycle, "pas2", cm, cn);
  if (withOth) await importTransactions(cycle, "oth", cm, cn);
}
process.stdout.write("running ANALYZE so SQLite plans queries well at this scale… ");
console.log(dbAnalyze() ? "done" : "skipped");
const s = contribStats(), r = fecRefStats();
console.log(`\ndone in ${Math.round((Date.now() - t0) / 1000)}s — ledger now: ${s.rows.toLocaleString()} rows · ${s.donors.toLocaleString()} donors · ${s.recipients.toLocaleString()} recipients | masters: ${r.committees.toLocaleString()} committees · ${r.candidates.toLocaleString()} candidates`);
