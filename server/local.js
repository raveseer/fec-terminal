// Local (county and city) campaign finance.
//
// Tennessee has no statewide feed for local offices: each county election commission keeps its own
// filings. Fourteen of them publish through the same vendor portal (EasyVote "Easy Campaign
// Finance"), which exposes — without a login — (1) every filer and document, (2) the itemized
// contributions and expenditures of reports that were filed electronically, and (3) the redacted PDF
// of every document. Paper filings exist only as scanned PDFs; those are read here by OCR.
//
// Accuracy model for anything read from a PDF (server/localread.js does the checking):
//   • a row is only trusted when independent evidence agrees — the literal text layer, a second
//     reader, and the form's own running totals;
//   • everything else is stored as `pending` and stays OUT of totals until a person approves it in
//     the review queue (Tennessee → Local → Review).
// Verified against the live portal, Nov 2026.

import fs from "node:fs";
import path from "node:path";
import { rawDb, settingGet, settingSet, alertAdd } from "./db.js";
import { TN_COUNTIES } from "./tnx.js";
import { readDocument, renderPage, toolsAvailable } from "./localread.js";

const API = "https://ecf-api.easyvoteapp.com";
const UA = "fec-terminal/4.2 (personal campaign-finance research)";
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const PDF_DIR = path.join(DATA_DIR, "local-pdf");
const PDF_CACHE_MAX = Number(process.env.LOCAL_PDF_CACHE_MB || 1500) * 1024 * 1024;
const DAY = 86_400_000;

// Portal sites confirmed live. `discover()` re-sweeps all 95 counties for new ones.
export const KNOWN_SOURCES = [
  ["washingtoncountytn", "683CABF8-1501-48E7-A4DE-A68A9DF9E44F", "Washington"],
  ["sullivancountytn", "6074E035-D00A-404F-8A84-6ED696F1378D", "Sullivan"],
  ["greenecountytn", "B703BCE6-0E9C-4C19-B17C-0D6969D1E507", "Greene"],
  ["hamblencountytn", "B4520609-C0BC-43FE-ADC4-04C6C1E02872", "Hamblen"],
  ["knoxcountytn", "4BB07902-FDCA-4D3B-BF6F-EA8F3A3E99A4", "Knox"],
  ["andersoncountytn", "F3FFF032-32E1-46E6-9FE7-D27E29ED5190", "Anderson"],
  ["hamiltoncountytn", "0F5A08EE-617A-4B11-AD30-E963AE98E120", "Hamilton"],
  ["davidsoncountytn", "1A0C899A-456B-4913-BFF0-4A8B0AE932A1", "Davidson"],
  ["williamsoncountytn", "38C18856-1015-498C-9A35-D162A05FA0DF", "Williamson"],
  ["rutherfordcountytn", "09ECD306-F24C-4CDD-9580-F9815F736BD5", "Rutherford"],
  ["maurycountytn", "B5C91383-E324-410A-812E-826D6F5AF93F", "Maury"],
  ["madisoncountytn", "B97BABE0-EB4E-498E-9C15-A2274E75B1FF", "Madison"],
  ["marioncountytn", "64B80BAC-CC7E-4287-986F-E7200BA3C357", "Marion"],
  ["shelbycountytn", "EE6EBC62-7B7C-432F-869E-4DE111271E07", "Shelby"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qstr = (v, d = "") => (typeof v === "string" ? v : d);
const up = (v) => String(v || "").toUpperCase().replace(/\s+/g, " ").trim();
export const normName = (v) => up(v).replace(/[^A-Z0-9 ]/g, " ").replace(/\b(MR|MRS|MS|DR|JR|SR|II|III|IV|LLC|INC|CO|CORP|THE)\b/g, " ").replace(/\s+/g, " ").trim();
const isoFromUS = (s) => { // "05/02/24" or "5/2/2024" → 2024-05-02
  const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return /^\d{4}-\d{2}-\d{2}/.test(String(s || "")) ? String(s).slice(0, 10) : null;
  const y = m[3].length === 2 ? (Number(m[3]) > 60 ? 1900 : 2000) + Number(m[3]) : Number(m[3]);
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
export function docKind(type, name) {
  const t = `${type || ""} ${name || ""}`;
  if (/treasurer/i.test(type || "")) return "treasurer";
  if (/petition|non-?disclosure|statement of interest/i.test(type || "")) return "other";
  if (/interim/i.test(t)) return "interim";
  if (/CFD|financial|disclosure|quarter|pre-?(primary|general)|year-?end|mid-?year|supplemental|amend/i.test(t)) return "cfd";
  return "other";
}
// counted in totals: structured portal rows, PDF rows that passed every check, and anything a person approved
const COUNTED = "('ok','approved','edited')";

async function ev(sub, pathname, { binary = false, timeout = 180_000 } = {}) {
  const origin = `https://${sub}.easyvotecampaignfinance.com`;
  const r = await fetch(API + pathname, { headers: { origin, referer: origin + "/", accept: binary ? "application/pdf,*/*" : "application/json", "user-agent": UA }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${sub}: portal answered HTTP ${r.status}`);
  if (binary) return Buffer.from(await r.arrayBuffer());
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error(`${sub}: portal did not return JSON`); }
}

export function registerLocal(app) {
  const fail = (res, code, message) => res.status(code).json({ error: { message } });
  const db = rawDb();
  if (!db) { app.all("/api/tn/local*", (_q, res) => fail(res, 503, "Local filings need the SQLite store.")); return { sync: async () => ({}), state: {} }; }
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_source (
      sub TEXT PRIMARY KEY, customer_id TEXT NOT NULL, county TEXT NOT NULL, synced_at INTEGER, error TEXT,
      filers INTEGER DEFAULT 0, docs INTEGER DEFAULT 0, contribs INTEGER DEFAULT 0, dists INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS local_filer (
      filer_id TEXT PRIMARY KEY, sub TEXT NOT NULL, county TEXT, first TEXT, middle TEXT, last TEXT, committee TEXT, display TEXT,
      office TEXT, filer_type TEXT, status TEXT, norm TEXT, first_seen INTEGER NOT NULL, fetched_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_local_filer_sub ON local_filer(sub, office);
    CREATE INDEX IF NOT EXISTS idx_local_filer_norm ON local_filer(norm);
    CREATE TABLE IF NOT EXISTS local_doc (
      doc_id TEXT PRIMARY KEY, filer_id TEXT, sub TEXT NOT NULL, name TEXT, doc_type TEXT, kind TEXT, submitted TEXT,
      efiled INTEGER DEFAULT 0, extract_status TEXT DEFAULT 'none', extract_method TEXT, pages INTEGER, totals TEXT,
      period_start TEXT, period_end TEXT, flags TEXT, error TEXT, first_seen INTEGER NOT NULL, extracted_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_local_doc_filer ON local_doc(filer_id);
    CREATE INDEX IF NOT EXISTS idx_local_doc_sub ON local_doc(sub, submitted);
    CREATE INDEX IF NOT EXISTS idx_local_doc_status ON local_doc(extract_status);
    CREATE TABLE IF NOT EXISTS local_item (
      id INTEGER PRIMARY KEY, doc_id TEXT, sub TEXT NOT NULL, filer_id TEXT, kind TEXT NOT NULL, name TEXT, norm TEXT,
      recipient TEXT, office TEXT, date TEXT, amount REAL, source TEXT NOT NULL, address TEXT, city TEXT, state TEXT, zip TEXT,
      occupation TEXT, employer TEXT, purpose TEXT, page INTEGER, confidence REAL, flags TEXT, review TEXT NOT NULL DEFAULT 'ok',
      original TEXT, reviewed_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_local_item_doc ON local_item(doc_id);
    CREATE INDEX IF NOT EXISTS idx_local_item_filer ON local_item(filer_id, kind);
    CREATE INDEX IF NOT EXISTS idx_local_item_norm ON local_item(norm);
    CREATE INDEX IF NOT EXISTS idx_local_item_review ON local_item(review) WHERE review = 'pending';
  `);
  const seed = db.prepare("INSERT OR IGNORE INTO local_source (sub, customer_id, county) VALUES (?, ?, ?)");
  for (const [sub, cid, county] of KNOWN_SOURCES) seed.run(sub, cid, county);
  try { db.exec("ALTER TABLE local_doc ADD COLUMN needs_review INTEGER DEFAULT 0"); } catch { /* already there */ }
  // a crash mid-read leaves rows marked as in progress
  db.exec("UPDATE local_doc SET extract_status = 'none' WHERE extract_status IN ('queued','reading')");
  // reports read before the review flag existed
  db.exec(`UPDATE local_doc SET needs_review = 1 WHERE extract_status = 'done' AND needs_review = 0 AND (totals LIKE '%"verified":false%' OR (flags IS NOT NULL AND flags != '[]'))`);

  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { try { db.exec("ROLLBACK"); } catch { /* already closed */ } throw e; } };
  const sources = () => db.prepare("SELECT * FROM local_source ORDER BY county").all();
  const sourceOf = (sub) => db.prepare("SELECT * FROM local_source WHERE sub = ?").get(sub);

  // =====================================================================================
  //  Sync — three requests per county
  // =====================================================================================
  const state = { running: false, at: null, done: 0, total: 0, current: null, errors: [], newDocs: [] };
  async function syncSource(src) {
    const now = Date.now();
    const filers = await ev(src.sub, `/filer/documentsearch/${src.customer_id}`);
    await sleep(400);
    const contribs = await ev(src.sub, `/advancedsearch/contributions/${src.customer_id}?minAmount=1`);
    await sleep(400);
    const dists = await ev(src.sub, `/advancedsearch/distributions/${src.customer_id}?minAmount=1`);
    if (!Array.isArray(filers) || !Array.isArray(contribs) || !Array.isArray(dists)) throw new Error(`${src.sub}: unexpected portal response`);
    const efiled = new Set([...contribs, ...dists].map((x) => up(x.DocumentFilingId).replace("_REDACTED", "")));
    const known = new Set(db.prepare("SELECT doc_id FROM local_doc WHERE sub = ?").all(src.sub).map((r) => r.doc_id));
    const firstSync = known.size === 0;
    const fresh = [];
    tx(() => {
      const upF = db.prepare(`INSERT INTO local_filer (filer_id, sub, county, first, middle, last, committee, display, office, filer_type, status, norm, first_seen, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(filer_id) DO UPDATE SET first=excluded.first, middle=excluded.middle, last=excluded.last, committee=excluded.committee, display=excluded.display,
          office=excluded.office, filer_type=excluded.filer_type, status=excluded.status, norm=excluded.norm, fetched_at=excluded.fetched_at`);
      const upD = db.prepare(`INSERT INTO local_doc (doc_id, filer_id, sub, name, doc_type, kind, submitted, efiled, first_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(doc_id) DO UPDATE SET filer_id=excluded.filer_id, name=excluded.name, doc_type=excluded.doc_type, kind=excluded.kind, submitted=excluded.submitted, efiled=excluded.efiled`);
      const docFiler = new Map();
      for (const f of filers) {
        const id = up(f.filerid);
        if (!id) continue;
        const display = (f.committeename || "").trim() || f.displayname || [f.lastname, f.firstname].filter(Boolean).join(", ");
        upF.run(id, src.sub, src.county, f.firstname || null, f.middlename || null, f.lastname || null, (f.committeename || "").trim() || null, display,
          f.officename || null, f.filertype || null, f.status || null, normName(`${f.firstname || ""} ${f.lastname || ""} ${f.committeename || ""}`), now, now);
        for (const d of f.documents || []) {
          const did = up(d.documentid);
          if (!did) continue;
          docFiler.set(did, id);
          upD.run(did, id, src.sub, (d.documentname || "").trim() || null, d.documenttype || null, docKind(d.documenttype, d.documentname), isoFromUS(d.datesubmitted), efiled.has(did) ? 1 : 0, now);
          if (!known.has(did) && !firstSync) fresh.push({ docId: did, filerId: id, filer: display, office: f.officename || "", name: d.documentname, kind: docKind(d.documenttype, d.documentname) });
        }
      }
      // structured rows are replaced wholesale; address/employer learned from a PDF is carried across by (doc, name, amount, date)
      const keep = new Map(db.prepare("SELECT doc_id, norm, amount, date, address, city, state, zip, occupation, employer FROM local_item WHERE sub = ? AND source = 'portal' AND (address IS NOT NULL OR employer IS NOT NULL)").all(src.sub)
        .map((r) => [`${r.doc_id}|${r.norm}|${r.amount}|${r.date}`, r]));
      db.prepare("DELETE FROM local_item WHERE sub = ? AND source = 'portal'").run(src.sub);
      const ins = db.prepare(`INSERT INTO local_item (doc_id, sub, filer_id, kind, name, norm, recipient, office, date, amount, source, address, city, state, zip, occupation, employer, confidence, review)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'portal', ?, ?, ?, ?, ?, ?, 1, 'ok')`);
      const person = (first, mid, last, org) => {
        const o = (org || "").trim(), l = (last || "").trim(), f = (first || "").trim();
        if (f || (l && l !== o)) return [l, [f, (mid || "").trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
        return o || l;
      };
      for (const c of contribs) {
        const did = up(c.DocumentFilingId).replace("_REDACTED", "");
        const name = person(c.ContributorFirstName, c.ContributorMiddleName, c.ContributorLastName, c.ContributorOrganizationName);
        const kind = /loan/i.test(c.ItemizedListType || "") ? "loan" : /in-?kind/i.test(c.ItemizedListType || "") ? "inkind" : "contribution";
        const date = (c.ContributionDate || "").slice(0, 10) || null, amount = Number(c.ContributionAmount) || 0, norm = normName(name);
        const k = keep.get(`${did}|${norm}|${amount}|${date}`);
        ins.run(did, src.sub, docFiler.get(did) || null, kind, name, norm, (c.RecipientCommitteeName || "").trim() || [c.RecipientFirstName, c.RecipientLastName].filter(Boolean).join(" "), c.OfficeName || null,
          date, amount, k?.address ?? null, k?.city ?? null, k?.state ?? null, k?.zip ?? null, k?.occupation ?? null, k?.employer ?? null);
      }
      for (const d of dists) {
        const did = up(d.DocumentFilingId).replace("_REDACTED", "");
        const name = person(d.PayeeFirstName, null, d.PayeeLastName, d.PayeeOrganizationName);
        ins.run(did, src.sub, docFiler.get(did) || null, "expenditure", name, normName(name), (d.CandidateCommitteeName || "").trim() || [d.CandidateFirstName, d.CandidateLastName].filter(Boolean).join(" "), d.OfficeName || null,
          (d.DistributionDate || "").slice(0, 10) || null, Number(d.DistributionAmount) || 0, null, null, null, null, null, null);
      }
      db.prepare("UPDATE local_source SET synced_at = ?, error = NULL, filers = ?, docs = ?, contribs = ?, dists = ? WHERE sub = ?")
        .run(now, filers.length, docFiler.size, contribs.length, dists.length, src.sub);
    });
    return fresh;
  }
  async function sync({ subs = null } = {}) {
    if (state.running) return { error: "Already running." };
    const list = sources().filter((s) => !subs || subs.includes(s.sub));
    Object.assign(state, { running: true, at: Date.now(), done: 0, total: list.length, current: null, errors: [], newDocs: [] });
    try {
      for (const src of list) {
        state.current = src.county;
        try { state.newDocs.push(...(await syncSource(src)).map((d) => ({ ...d, sub: src.sub, county: src.county }))); }
        catch (e) { state.errors.push(e.message); db.prepare("UPDATE local_source SET error = ? WHERE sub = ?").run(e.message.slice(0, 300), src.sub); }
        state.done++;
        await sleep(800);
      }
      settingSet("localSyncAt", String(Date.now()));
      return { ok: true, synced: state.done, errors: state.errors, newDocs: state.newDocs };
    } finally { state.running = false; state.current = null; }
  }

  // sweep every county name for a portal site we don't know yet (95 small requests)
  async function discover() {
    const have = new Set(sources().map((s) => s.sub));
    const found = [];
    const names = Object.values(TN_COUNTIES);
    for (let i = 0; i < names.length; i += 4) {
      await Promise.all(names.slice(i, i + 4).map(async (county) => {
        const sub = `${county.toLowerCase().replace(/[^a-z]/g, "")}countytn`;
        if (have.has(sub)) return;
        try {
          const r = await ev(sub, `/authentication/getwebsiteuser/${sub}`, { timeout: 20_000 });
          if (r?.CustomerId) { seed.run(sub, up(r.CustomerId), county); found.push(county); }
        } catch { /* no portal for this county */ }
      }));
      await sleep(300);
    }
    settingSet("localDiscoverAt", String(Date.now()));
    return found;
  }

  // =====================================================================================
  //  PDF cache
  // =====================================================================================
  async function pdfPath(doc) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
    const file = path.join(PDF_DIR, `${doc.doc_id}.pdf`);
    if (fs.existsSync(file) && fs.statSync(file).size > 500) { const t = new Date(); try { fs.utimesSync(file, t, t); } catch { /* read-only */ } return file; }
    const buf = await ev(doc.sub, `/documents/${doc.doc_id}/viewfinalredactedpdf`, { binary: true });
    if (buf.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error("The portal did not return a PDF for this document.");
    fs.writeFileSync(file, buf);
    prunePdfs();
    return file;
  }
  function prunePdfs() {
    try {
      const files = fs.readdirSync(PDF_DIR).map((f) => { const s = fs.statSync(path.join(PDF_DIR, f)); return { f, size: s.size, at: s.mtimeMs }; }).sort((a, b) => b.at - a.at);
      let total = 0;
      for (const x of files) { total += x.size; if (total > PDF_CACHE_MAX) fs.unlinkSync(path.join(PDF_DIR, x.f)); }
    } catch { /* cache dir missing */ }
  }

  // =====================================================================================
  //  Reading PDFs (text layer or OCR) — one document at a time
  // =====================================================================================
  const models = () => {
    let saved = {};
    try { saved = JSON.parse(settingGet("localRead") || "null") || {}; } catch { /* defaults */ }
    return { vision: process.env.LOCAL_OCR_MODEL || "gemma4:31b", verify: process.env.LOCAL_OCR_VERIFY_MODEL || "mistral-small3.2:latest", text: process.env.LOCAL_TEXT_MODEL || "mistral-small3.2:latest", ...saved };
  };
  const reader = { running: false, stop: false, done: 0, total: 0, current: null, startedAt: null, errors: [], last: null };

  function storeReading(doc, out) {
    tx(() => {
      db.prepare("DELETE FROM local_item WHERE doc_id = ? AND source != 'portal' AND review NOT IN ('approved','edited','rejected')").run(doc.doc_id);
      const reviewed = new Set(db.prepare("SELECT kind, norm, amount, date FROM local_item WHERE doc_id = ? AND source != 'portal'").all(doc.doc_id).map((r) => `${r.kind}|${r.norm}|${r.amount}|${r.date}`));
      const portal = db.prepare("SELECT id, kind, norm, amount, date FROM local_item WHERE doc_id = ? AND source = 'portal'").all(doc.doc_id);
      const used = new Set();
      const enrich = db.prepare("UPDATE local_item SET address = COALESCE(?, address), city = COALESCE(?, city), state = COALESCE(?, state), zip = COALESCE(?, zip), occupation = COALESCE(?, occupation), employer = COALESCE(?, employer), purpose = COALESCE(?, purpose), page = ? WHERE id = ?");
      const fillDate = db.prepare("UPDATE local_item SET date = COALESCE(date, ?), page = COALESCE(page, ?) WHERE id = ?");
      const countAmt = (list, kind, amount) => list.filter((x) => x.kind === kind && Math.abs(x.amount - amount) < 0.005).length;
      const ins = db.prepare(`INSERT INTO local_item (doc_id, sub, filer_id, kind, name, norm, recipient, office, date, amount, source, address, city, state, zip, occupation, employer, purpose, page, confidence, flags, review)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const filer = doc.filer_id ? db.prepare("SELECT display, office FROM local_filer WHERE filer_id = ?").get(doc.filer_id) : null;
      const docFlags = [...out.flags];
      let unmatched = 0;
      for (const r of out.rows) {
        const norm = normName(r.name);
        if (portal.length) {
          // the portal already holds this report's rows: the PDF only adds address / employer / purpose
          const lastTok = norm.split(" ")[0];
          const sameAmt = (p) => !used.has(p.id) && p.kind === r.kind && Math.abs(p.amount - r.amount) < 0.005;
          const named = portal.find((p) => sameAmt(p) && (p.date === r.date || !r.date || !p.date) && (p.norm === norm || (lastTok && p.norm.includes(lastTok))));
          // same amount on the same date, or the only entry of that amount on both sides: the same entry, but the names differ
          const loose = named ? null : portal.find((p) => sameAmt(p) && ((r.date && p.date === r.date) || (countAmt(portal, r.kind, r.amount) === 1 && countAmt(out.rows, r.kind, r.amount) === 1)));
          const hit = named || loose;
          if (named && r.review === "ok") { used.add(hit.id); enrich.run(r.address, r.city, r.state, r.zip, r.occupation, r.employer, r.purpose, r.page, hit.id); fillDate.run(r.date, r.page, hit.id); continue; }
          if (loose && r.review === "ok") { used.add(hit.id); fillDate.run(r.date, r.page, hit.id); continue; } // the portal's name stands; only the missing date is taken
          if (hit) { used.add(hit.id); continue; } // a doubtful reading never overrides the filer's own structured entry
          unmatched++;
          r.flags = [...r.flags, "not_in_portal_data"]; r.review = "pending";
        }
        if (reviewed.has(`${r.kind}|${norm}|${r.amount}|${r.date}`)) continue; // a person already ruled on this row
        ins.run(doc.doc_id, doc.sub, doc.filer_id, r.kind, r.name, norm, filer?.display || null, filer?.office || null, r.date, r.amount, r.source || (out.method === "text" ? "pdf-text" : "ocr"),
          r.address, r.city, r.state, r.zip, r.occupation, r.employer, r.purpose, r.page, r.confidence, JSON.stringify(r.flags), r.review);
      }
      if (unmatched) docFlags.push(`${unmatched} row${unmatched === 1 ? "" : "s"} read from the PDF are not in the portal's data`);
      // figures a person already confirmed are kept across a re-read
      const prev = (() => { try { return JSON.parse(db.prepare("SELECT totals FROM local_doc WHERE doc_id = ?").get(doc.doc_id)?.totals || "null"); } catch { return null; } })();
      const totals = prev?.confirmedBy === "person" ? prev : out.totals;
      const flagsOut = prev?.confirmedBy === "person" ? docFlags.filter((f) => !/summary figure/.test(f)) : docFlags;
      db.prepare("UPDATE local_doc SET extract_status = 'done', extract_method = ?, pages = ?, totals = ?, period_start = ?, period_end = ?, flags = ?, needs_review = ?, error = NULL, extracted_at = ? WHERE doc_id = ?")
        .run(out.method, out.pages, totals ? JSON.stringify(totals) : null, out.periodStart, out.periodEnd, JSON.stringify(flagsOut), flagsOut.length || (totals && !totals.verified) ? 1 : 0, Date.now(), doc.doc_id);
    });
  }
  async function readOne(doc) {
    db.prepare("UPDATE local_doc SET extract_status = 'reading' WHERE doc_id = ?").run(doc.doc_id);
    try {
      const file = await pdfPath(doc);
      const out = await readDocument(file, { models: models(), isStopped: () => reader.stop });
      if (out.stopped) { db.prepare("UPDATE local_doc SET extract_status = 'none' WHERE doc_id = ?").run(doc.doc_id); return null; }
      storeReading(doc, out);
      return out;
    } catch (e) {
      db.prepare("UPDATE local_doc SET extract_status = 'failed', error = ? WHERE doc_id = ?").run(String(e.message).slice(0, 300), doc.doc_id);
      throw e;
    }
  }
  // Order: reports with no structured data first (their contents exist nowhere else), newest first;
  // then e-filed reports, where the PDF only adds addresses, employers and totals.
  function pickDocs({ subs, filerId, docIds, limit = 50, includeEfiled = true, retryFailed = false }) {
    if (docIds?.length) return db.prepare(`SELECT * FROM local_doc WHERE doc_id IN (${docIds.map(() => "?").join(",")})`).all(...docIds);
    const where = ["kind IN ('cfd','interim')", retryFailed ? "extract_status IN ('none','failed')" : "extract_status = 'none'"], args = [];
    if (filerId) { where.push("filer_id = ?"); args.push(filerId); }
    else if (subs?.length) { where.push(`sub IN (${subs.map(() => "?").join(",")})`); args.push(...subs); }
    if (!includeEfiled) where.push("efiled = 0");
    return db.prepare(`SELECT * FROM local_doc WHERE ${where.join(" AND ")} ORDER BY efiled ASC, submitted DESC LIMIT ?`).all(...args, Math.max(1, Math.min(5000, limit)));
  }
  async function runReader(opts) {
    if (reader.running) return;
    const docs = pickDocs(opts);
    Object.assign(reader, { running: true, stop: false, done: 0, total: docs.length, current: null, startedAt: Date.now(), errors: [], last: null });
    try {
      for (const doc of docs) {
        if (reader.stop) break;
        reader.current = { docId: doc.doc_id, name: doc.name, sub: doc.sub };
        try { await readOne(doc); } catch (e) { reader.errors.push(`${doc.name || doc.doc_id}: ${e.message}`.slice(0, 200)); if (reader.errors.length > 30) reader.errors.shift(); }
        reader.done++;
      }
    } finally {
      reader.last = { at: Date.now(), done: reader.done, total: reader.total, stopped: reader.stop, seconds: Math.round((Date.now() - reader.startedAt) / 1000) };
      reader.running = false; reader.current = null;
    }
  }

  // =====================================================================================
  //  Routes
  // =====================================================================================
  const reviewCounts = () => Object.fromEntries(db.prepare("SELECT sub, COUNT(*) n FROM local_item WHERE review = 'pending' GROUP BY sub").all().map((r) => [r.sub, r.n]));
  const reviewDocs = () => Object.fromEntries(db.prepare("SELECT sub, COUNT(*) n FROM local_doc d WHERE needs_review = 1 OR EXISTS (SELECT 1 FROM local_item i WHERE i.doc_id = d.doc_id AND i.review = 'pending') GROUP BY sub").all().map((r) => [r.sub, r.n]));
  app.get("/api/tn/local/sources", (_req, res) => {
    const pending = reviewCounts(), pendingDocs = reviewDocs();
    const read = Object.fromEntries(db.prepare("SELECT sub, SUM(extract_status = 'done') done, SUM(kind IN ('cfd','interim')) reports, SUM(kind IN ('cfd','interim') AND efiled = 0) paper, SUM(extract_status = 'failed') failed FROM local_doc GROUP BY sub").all().map((r) => [r.sub, r]));
    res.json({
      sources: sources().map((s) => ({ sub: s.sub, county: s.county, syncedAt: s.synced_at, error: s.error, filers: s.filers, docs: s.docs, contribs: s.contribs, dists: s.dists,
        reports: read[s.sub]?.reports || 0, paper: read[s.sub]?.paper || 0, read: read[s.sub]?.done || 0, failed: read[s.sub]?.failed || 0, pending: pending[s.sub] || 0, reviewDocs: pendingDocs[s.sub] || 0,
        url: `https://${s.sub}.easyvotecampaignfinance.com/home/publicfilings` })),
      sync: { running: state.running, done: state.done, total: state.total, current: state.current, errors: state.errors.slice(0, 5), at: Number(settingGet("localSyncAt") || 0) || null },
      reader: { ...reader, tools: toolsAvailable(), models: models() },
      home: homeSubs(),
    });
  });
  const homeSubs = () => { try { const v = JSON.parse(settingGet("localHome") || "null"); if (Array.isArray(v)) return v; } catch { /* default */ } return ["washingtoncountytn"]; };
  app.post("/api/tn/local/home", (req, res) => {
    const valid = new Set(sources().map((s) => s.sub));
    const subs = (Array.isArray(req.body?.subs) ? req.body.subs : []).filter((s) => valid.has(s)).slice(0, 20);
    settingSet("localHome", JSON.stringify(subs));
    res.json({ ok: true, home: subs });
  });
  app.post("/api/tn/local/sync", (req, res) => {
    if (state.running) return res.json({ running: true });
    const subs = Array.isArray(req.body?.subs) && req.body.subs.length ? req.body.subs.map(String) : null;
    sync({ subs }).catch((e) => console.warn("[local sync]", e.message));
    res.json({ started: true });
  });
  app.post("/api/tn/local/discover", async (_req, res) => {
    try { res.json({ found: await discover() }); } catch (e) { fail(res, 502, e.message); }
  });

  // ---- filers ----
  app.get("/api/tn/local/filers", (req, res) => {
    const sub = qstr(req.query.sub), q = normName(qstr(req.query.q)), office = qstr(req.query.office), active = req.query.active === "1";
    const where = [], args = [];
    if (sub) { where.push("f.sub = ?"); args.push(sub); }
    if (q) { for (const tok of q.split(" ").slice(0, 4)) { where.push("(f.norm LIKE ? OR UPPER(f.office) LIKE ?)"); args.push(`%${tok}%`, `%${tok}%`); } }
    if (office) { where.push("f.office = ?"); args.push(office); }
    if (active) where.push("f.status = 'Active'");
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = db.prepare(`
      SELECT f.filer_id id, f.sub, f.county, f.display name, f.office, f.filer_type type, f.status,
        (SELECT COUNT(*) FROM local_doc d WHERE d.filer_id = f.filer_id) docs,
        (SELECT MAX(submitted) FROM local_doc d WHERE d.filer_id = f.filer_id) latest,
        (SELECT COALESCE(SUM(amount), 0) FROM local_item i WHERE i.filer_id = f.filer_id AND i.kind IN ('contribution','inkind') AND i.review IN ${COUNTED}) raised,
        (SELECT COALESCE(SUM(amount), 0) FROM local_item i WHERE i.filer_id = f.filer_id AND i.kind = 'expenditure' AND i.review IN ${COUNTED}) spent,
        (SELECT COUNT(*) FROM local_item i WHERE i.filer_id = f.filer_id AND i.review = 'pending') pending
      FROM local_filer f ${w} ORDER BY ${q || sub ? "raised DESC, latest DESC" : "latest DESC"} LIMIT 400`).all(...args);
    const total = db.prepare(`SELECT COUNT(*) n FROM local_filer f ${w}`).get(...args).n;
    const offices = sub ? db.prepare("SELECT office, COUNT(*) n FROM local_filer WHERE sub = ? AND office IS NOT NULL GROUP BY office ORDER BY n DESC, office LIMIT 200").all(sub) : [];
    res.json({ filers: rows, total, offices });
  });
  app.get("/api/tn/local/filer/:id", (req, res) => {
    const id = up(req.params.id);
    const f = db.prepare("SELECT * FROM local_filer WHERE filer_id = ?").get(id);
    if (!f) return fail(res, 404, "No such local filer.");
    const docs = db.prepare(`SELECT d.doc_id id, d.name, d.doc_type type, d.kind, d.submitted, d.efiled, d.extract_status status, d.extract_method method, d.pages, d.totals, d.period_start, d.period_end, d.flags, d.error,
      (SELECT COUNT(*) FROM local_item i WHERE i.doc_id = d.doc_id) items, (SELECT COUNT(*) FROM local_item i WHERE i.doc_id = d.doc_id AND i.review = 'pending') pending
      FROM local_doc d WHERE d.filer_id = ? ORDER BY d.submitted DESC`).all(id)
      .map((d) => ({ ...d, totals: d.totals ? JSON.parse(d.totals) : null, flags: d.flags ? JSON.parse(d.flags) : [] }));
    const donors = db.prepare(`SELECT MAX(name) name, norm, SUM(amount) total, COUNT(*) n, MIN(date) first, MAX(date) last, MAX(city) city, MAX(state) state, MAX(zip) zip, MAX(employer) employer, MAX(occupation) occupation,
        SUM(kind = 'inkind') inkind, SUM(source != 'portal') machine
      FROM local_item WHERE filer_id = ? AND kind IN ('contribution','inkind') AND review IN ${COUNTED} GROUP BY norm ORDER BY total DESC LIMIT 2000`).all(id);
    const payees = db.prepare(`SELECT MAX(name) name, SUM(amount) total, COUNT(*) n, MAX(purpose) purpose FROM local_item WHERE filer_id = ? AND kind = 'expenditure' AND review IN ${COUNTED} GROUP BY norm ORDER BY total DESC LIMIT 500`).all(id);
    const loans = db.prepare(`SELECT name, date, amount, source FROM local_item WHERE filer_id = ? AND kind = 'loan' AND review IN ${COUNTED} ORDER BY date DESC LIMIT 100`).all(id);
    const sums = db.prepare(`SELECT SUM(CASE WHEN kind IN ('contribution','inkind') AND review IN ${COUNTED} THEN amount END) raised, SUM(CASE WHEN kind = 'expenditure' AND review IN ${COUNTED} THEN amount END) spent,
      SUM(CASE WHEN kind = 'loan' AND review IN ${COUNTED} THEN amount END) loans, SUM(review = 'pending') pending, SUM(CASE WHEN review = 'pending' THEN amount END) pendingAmt FROM local_item WHERE filer_id = ?`).get(id);
    const reports = docs.filter((d) => d.kind === "cfd" || d.kind === "interim");
    res.json({
      filer: { id: f.filer_id, sub: f.sub, county: f.county, name: f.display, first: f.first, last: f.last, office: f.office, type: f.filer_type, status: f.status,
        url: `https://${f.sub}.easyvotecampaignfinance.com/home/publicfilings` },
      totals: { raised: sums.raised || 0, spent: sums.spent || 0, loans: sums.loans || 0, pending: sums.pending || 0, pendingAmt: sums.pendingAmt || 0 },
      coverage: { reports: reports.length, structured: reports.filter((d) => d.efiled).length, read: reports.filter((d) => d.status === "done").length,
        unread: reports.filter((d) => !d.efiled && d.status !== "done").length },
      docs, donors, payees, loans,
    });
  });

  // ---- search every county's itemized rows by donor or payee name ----
  app.get("/api/tn/local/search", (req, res) => {
    const q = normName(qstr(req.query.q)), sub = qstr(req.query.sub), kind = qstr(req.query.kind);
    if (q.length < 2) return res.json({ rows: [], total: 0 });
    const where = [`i.review IN ${COUNTED}`], args = [];
    for (const tok of q.split(" ").slice(0, 4)) { where.push("i.norm LIKE ?"); args.push(`%${tok}%`); }
    if (sub) { where.push("i.sub = ?"); args.push(sub); }
    if (kind === "out") where.push("i.kind = 'expenditure'"); else where.push("i.kind != 'expenditure'");
    const w = where.join(" AND ");
    const rows = db.prepare(`SELECT i.id, i.name, i.kind, i.date, i.amount, i.source, i.city, i.state, i.employer, i.recipient, i.office, i.filer_id filerId, i.doc_id docId, s.county
      FROM local_item i JOIN local_source s ON s.sub = i.sub WHERE ${w} ORDER BY i.amount DESC LIMIT 500`).all(...args);
    const agg = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount), 0) total FROM local_item i WHERE ${w}`).get(...args);
    res.json({ rows, total: agg.n, amount: agg.total });
  });

  // ---- one document: its rows, flags and page images ----
  const docOut = (id) => {
    const d = db.prepare("SELECT d.*, f.display filer, f.office, s.county FROM local_doc d LEFT JOIN local_filer f ON f.filer_id = d.filer_id JOIN local_source s ON s.sub = d.sub WHERE d.doc_id = ?").get(id);
    if (!d) return null;
    const items = db.prepare("SELECT * FROM local_item WHERE doc_id = ? ORDER BY CASE kind WHEN 'expenditure' THEN 2 WHEN 'loan' THEN 1 ELSE 0 END, page, id").all(id)
      .map((i) => ({ ...i, flags: i.flags ? JSON.parse(i.flags) : [], original: i.original ? JSON.parse(i.original) : null }));
    return { doc: { id: d.doc_id, filerId: d.filer_id, filer: d.filer, office: d.office, county: d.county, sub: d.sub, name: d.name, type: d.doc_type, kind: d.kind, submitted: d.submitted, efiled: !!d.efiled,
      status: d.extract_status, method: d.extract_method, pages: d.pages, totals: d.totals ? JSON.parse(d.totals) : null, periodStart: d.period_start, periodEnd: d.period_end,
      flags: d.flags ? JSON.parse(d.flags) : [], error: d.error, extractedAt: d.extracted_at }, items };
  };
  app.get("/api/tn/local/doc/:id", (req, res) => {
    const out = docOut(up(req.params.id));
    return out ? res.json(out) : fail(res, 404, "No such document.");
  });
  app.get("/api/tn/local/doc/:id/pdf", async (req, res) => {
    const d = db.prepare("SELECT * FROM local_doc WHERE doc_id = ?").get(up(req.params.id));
    if (!d) return fail(res, 404, "No such document.");
    try { const file = await pdfPath(d); res.setHeader("Content-Type", "application/pdf"); res.setHeader("Cache-Control", "private, max-age=86400"); fs.createReadStream(file).pipe(res); }
    catch (e) { fail(res, 502, e.message); }
  });
  app.get("/api/tn/local/doc/:id/page/:n", async (req, res) => {
    const d = db.prepare("SELECT * FROM local_doc WHERE doc_id = ?").get(up(req.params.id));
    const n = Math.max(1, Math.min(500, Number(req.params.n) || 1));
    if (!d) return fail(res, 404, "No such document.");
    try { const png = await renderPage(await pdfPath(d), n, 110); res.setHeader("Content-Type", "image/png"); res.setHeader("Cache-Control", "private, max-age=86400"); res.end(png); }
    catch (e) { fail(res, 502, e.message); }
  });
  app.post("/api/tn/local/doc/:id/read", (req, res) => {
    const id = up(req.params.id);
    if (!db.prepare("SELECT 1 FROM local_doc WHERE doc_id = ?").get(id)) return fail(res, 404, "No such document.");
    if (reader.running) return res.json({ running: true, message: "The reader is busy — this document was not queued." });
    runReader({ docIds: [id] }).catch((e) => console.warn("[local read]", e.message));
    res.json({ started: true });
  });

  // ---- reader queue ----
  app.get("/api/tn/local/reader", (_req, res) => res.json({ ...reader, tools: toolsAvailable(), models: models(),
    waiting: db.prepare("SELECT sub, SUM(efiled = 0) paper, SUM(efiled = 1) efiled FROM local_doc WHERE kind IN ('cfd','interim') AND extract_status = 'none' GROUP BY sub").all() }));
  app.post("/api/tn/local/reader/start", (req, res) => {
    if (reader.running) return res.json({ running: true });
    const t = toolsAvailable();
    if (!t.pdftotext) return fail(res, 503, "PDF tools are missing from this build (poppler-utils).");
    const valid = new Set(sources().map((s) => s.sub));
    const subs = (Array.isArray(req.body?.subs) ? req.body.subs : []).filter((s) => valid.has(s));
    const opts = { subs: subs.length ? subs : homeSubs(), filerId: req.body?.filerId ? up(req.body.filerId) : null, limit: Number(req.body?.limit) || 50,
      includeEfiled: req.body?.includeEfiled !== false, retryFailed: !!req.body?.retryFailed };
    runReader(opts).catch((e) => console.warn("[local read]", e.message));
    res.json({ started: true });
  });
  app.post("/api/tn/local/reader/stop", (_req, res) => { reader.stop = true; res.json({ ok: true }); });
  app.post("/api/tn/local/reader/models", (req, res) => {
    const clean = (v) => (typeof v === "string" && /^[\w.:\-/]{1,80}$/.test(v) ? v : undefined);
    const next = { ...models(), ...Object.fromEntries(Object.entries({ vision: clean(req.body?.vision), verify: req.body?.verify === "" ? "" : clean(req.body?.verify), text: clean(req.body?.text) }).filter(([, v]) => v !== undefined)) };
    settingSet("localRead", JSON.stringify(next));
    res.json({ ok: true, models: next });
  });

  // ---- review queue ----
  app.get("/api/tn/local/review", (req, res) => {
    const sub = qstr(req.query.sub);
    const args = sub ? [sub] : [];
    const docs = db.prepare(`SELECT d.doc_id id, d.name, d.submitted, d.extract_method method, d.flags, d.totals, d.pages, f.display filer, f.office, s.county, d.filer_id filerId,
        (SELECT COUNT(*) FROM local_item i WHERE i.doc_id = d.doc_id AND i.review = 'pending') pending,
        (SELECT COALESCE(SUM(amount), 0) FROM local_item i WHERE i.doc_id = d.doc_id AND i.review = 'pending') amount
      FROM local_doc d LEFT JOIN local_filer f ON f.filer_id = d.filer_id JOIN local_source s ON s.sub = d.sub
      WHERE (d.needs_review = 1 OR EXISTS (SELECT 1 FROM local_item i WHERE i.doc_id = d.doc_id AND i.review = 'pending')) ${sub ? "AND d.sub = ?" : ""}
      ORDER BY amount DESC, d.submitted DESC LIMIT 300`).all(...args)
      .map((d) => { const t = d.totals ? JSON.parse(d.totals) : null; return { ...d, totals: undefined, flags: d.flags ? JSON.parse(d.flags) : [], figures: t ? (t.verified ? "ok" : "check") : null }; });
    const t = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount), 0) amount FROM local_item WHERE review = 'pending' ${sub ? "AND sub = ?" : ""}`).get(...args);
    const dc = db.prepare(`SELECT COUNT(*) n FROM local_doc d WHERE (d.needs_review = 1 OR EXISTS (SELECT 1 FROM local_item i WHERE i.doc_id = d.doc_id AND i.review = 'pending')) ${sub ? "AND d.sub = ?" : ""}`).get(...args);
    res.json({ docs, total: t.n, amount: t.amount, docCount: dc.n });
  });
  // a person settles the report-level figures and/or the document warnings
  app.post("/api/tn/local/doc/:id/totals", (req, res) => {
    const id = up(req.params.id);
    const d = db.prepare("SELECT totals, flags FROM local_doc WHERE doc_id = ?").get(id);
    if (!d) return fail(res, 404, "No such document.");
    let totals = d.totals ? JSON.parse(d.totals) : null, flags = d.flags ? JSON.parse(d.flags) : [];
    if (req.body?.figures) {
      const f = req.body.figures, n = (v) => (v === "" || v == null ? null : Number(v));
      const next = { balanceLast: n(f.balanceLast), receipts: n(f.receipts), disbursements: n(f.disbursements), balance: n(f.balance) };
      if (Object.values(next).some((v) => v != null && !Number.isFinite(v))) return fail(res, 400, "Figures must be numbers.");
      const adds = next.receipts != null && next.disbursements != null && next.balance != null ? Math.abs((next.balanceLast || 0) + next.receipts - next.disbursements - next.balance) < 0.005 : null;
      totals = { ...(totals || {}), ...next, adds, confirmed: true, verified: true, confirmedBy: "person", machine: totals && totals.confirmedBy !== "person" ? { balanceLast: totals.balanceLast, receipts: totals.receipts, disbursements: totals.disbursements, balance: totals.balance } : totals?.machine ?? null };
      flags = flags.filter((x) => !/summary figure/.test(x));
    }
    if (req.body?.dismissFlags) flags = [];
    db.prepare("UPDATE local_doc SET totals = ?, flags = ?, needs_review = ? WHERE doc_id = ?").run(totals ? JSON.stringify(totals) : null, JSON.stringify(flags), flags.length || (totals && !totals.verified) ? 1 : 0, id);
    res.json({ ok: true });
  });
  const EDITABLE = ["name", "date", "amount", "address", "city", "state", "zip", "occupation", "employer", "purpose", "kind"];
  app.post("/api/tn/local/item/:id", (req, res) => {
    const id = Number(req.params.id), action = qstr(req.body?.action);
    const it = db.prepare("SELECT * FROM local_item WHERE id = ?").get(id);
    if (!it) return fail(res, 404, "No such row.");
    if (it.source === "portal") return fail(res, 400, "This row came from the county's own structured data and is not editable here.");
    const now = Date.now();
    if (action === "approve") db.prepare("UPDATE local_item SET review = 'approved', reviewed_at = ? WHERE id = ?").run(now, id);
    else if (action === "reject") db.prepare("UPDATE local_item SET review = 'rejected', reviewed_at = ? WHERE id = ?").run(now, id);
    else if (action === "reopen") db.prepare("UPDATE local_item SET review = 'pending', reviewed_at = NULL WHERE id = ?").run(id);
    else if (action === "edit") {
      const f = req.body?.fields || {};
      const next = {};
      for (const k of EDITABLE) if (k in f) next[k] = k === "amount" ? Number(f[k]) : (f[k] === "" || f[k] == null ? null : String(f[k]).slice(0, 200));
      if ("amount" in next && !(next.amount > 0)) return fail(res, 400, "Amount must be a positive number.");
      if ("date" in next && next.date && !/^\d{4}-\d{2}-\d{2}$/.test(next.date)) return fail(res, 400, "Date must be YYYY-MM-DD.");
      if ("kind" in next && !["contribution", "inkind", "loan", "expenditure"].includes(next.kind)) return fail(res, 400, "Unknown row type.");
      if (!Object.keys(next).length) return fail(res, 400, "Nothing to change.");
      const original = it.original || JSON.stringify(Object.fromEntries(EDITABLE.map((k) => [k, it[k]]))); // what the machine read, kept for audit
      const merged = { ...it, ...next };
      db.prepare(`UPDATE local_item SET ${Object.keys(next).map((k) => `${k} = ?`).join(", ")}, norm = ?, original = ?, review = 'edited', reviewed_at = ? WHERE id = ?`)
        .run(...Object.values(next), normName(merged.name), original, now, id);
    } else return fail(res, 400, "action must be approve, reject, edit or reopen.");
    res.json({ ok: true, item: db.prepare("SELECT * FROM local_item WHERE id = ?").get(id) });
  });
  app.post("/api/tn/local/doc/:id/review", (req, res) => {
    const id = up(req.params.id), action = qstr(req.body?.action);
    if (!["approve", "reject"].includes(action)) return fail(res, 400, "action must be approve or reject.");
    const r = db.prepare("UPDATE local_item SET review = ?, reviewed_at = ? WHERE doc_id = ? AND review = 'pending'").run(action === "approve" ? "approved" : "rejected", Date.now(), id);
    res.json({ ok: true, changed: Number(r.changes) });
  });
  app.post("/api/tn/local/doc/:id/add", (req, res) => { // a row the reader missed entirely
    const d = db.prepare("SELECT * FROM local_doc WHERE doc_id = ?").get(up(req.params.id));
    if (!d) return fail(res, 404, "No such document.");
    const f = req.body || {}, amount = Number(f.amount), kind = ["contribution", "inkind", "loan", "expenditure"].includes(f.kind) ? f.kind : "contribution";
    const name = String(f.name || "").trim().slice(0, 200);
    if (!name || !(amount > 0)) return fail(res, 400, "A name and a positive amount are required.");
    if (f.date && !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return fail(res, 400, "Date must be YYYY-MM-DD.");
    const filer = d.filer_id ? db.prepare("SELECT display, office FROM local_filer WHERE filer_id = ?").get(d.filer_id) : null;
    const r = db.prepare(`INSERT INTO local_item (doc_id, sub, filer_id, kind, name, norm, recipient, office, date, amount, source, page, confidence, flags, review, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 1, '["entered_by_hand"]', 'edited', ?)`).run(d.doc_id, d.sub, d.filer_id, kind, name, normName(name), filer?.display || null, filer?.office || null, f.date || null, amount, Number(f.page) || null, Date.now());
    res.json({ ok: true, id: Number(r.lastInsertRowid) });
  });

  // weekly re-sync so the section is never stale when opened
  setInterval(() => {
    if (state.running || reader.running) return;
    if (Date.now() - Number(settingGet("localSyncAt") || 0) > 7 * DAY && Number(settingGet("localSyncAt") || 0) > 0) sync().catch((e) => console.warn("[local sync]", e.message));
  }, 6 * 3_600_000).unref();

  // used by the Tennessee auto-check: re-sync the home counties and describe what is new
  async function checkHome(giftThreshold = 5000) {
    const subs = homeSubs();
    if (!subs.length || state.running) return { alerts: [], notes: [] };
    const hadSync = new Set(sources().filter((s) => s.synced_at).map((s) => s.sub));
    const r = await sync({ subs });
    const alerts = [], usd = (v) => `$${Math.round(v).toLocaleString()}`;
    const fresh = (r.newDocs || []).filter((d) => hadSync.has(d.sub) && (d.kind === "cfd" || d.kind === "interim"));
    for (const d of fresh.slice(0, 15)) {
      const rows = db.prepare("SELECT name, amount FROM local_item WHERE doc_id = ? AND kind IN ('contribution','inkind') ORDER BY amount DESC").all(d.docId);
      const total = rows.reduce((a, x) => a + x.amount, 0);
      alerts.push({ kind: "local", subject: d.filer, amount: total || null, ref: `local-doc:${d.docId}`,
        detail: `New ${d.county} County filing: ${d.name || "report"}${d.office ? ` — ${d.office}` : ""}${rows.length ? ` · ${rows.length} itemized gifts, ${usd(total)}` : " · scanned or not itemized; read it from Tennessee → Local"}` });
      const big = rows.filter((x) => x.amount >= giftThreshold);
      if (big.length) alerts.push({ kind: "local", subject: d.filer, amount: big.reduce((a, x) => a + x.amount, 0), ref: `local-big:${d.docId}`,
        detail: `${big.length} gift${big.length === 1 ? "" : "s"} of ${usd(giftThreshold)}+: ${big.slice(0, 5).map((x) => `${x.name} ${usd(x.amount)}`).join(" · ")}` });
    }
    if (fresh.length > 15) alerts.push({ kind: "local", subject: "Local filings", ref: `local-more:${Date.now()}`, detail: `${fresh.length - 15} more new local filings — see Tennessee → Local` });
    return { alerts, notes: r.errors || [] };
  }

  return { sync, state, checkHome, alertAdd };
}
