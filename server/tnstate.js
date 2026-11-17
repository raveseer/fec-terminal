// Tennessee state money out, and the records that sit beside it:
//   • Incentives  — TNECD's FastTrack project database (contracted: a dated .xlsx; pending: an HTML table)
//   • Contracts   — the Central Procurement Office's "All Contracts" Tableau view, exported as CSV
//   • Organization— one name across incentives, contracts, lobbying, federal awards and the giving
//                   of its employees and PAC, at federal, state and local level
//   • Results     — Secretary of State precinct spreadsheets, rolled up to county
//   • Bill votes  — committee and floor votes from the General Assembly bill page
//   • Nonprofits  — IRS filings via ProPublica's Nonprofit Explorer API
// Every source was fetched and its structure checked in Nov 2026.

import { rawDb, settingGet, settingSet } from "./db.js";
import { cached, usa, currentFY, TN_COUNTIES } from "./tnx.js";
import { xlsxRows, excelDate, csvRows } from "./xlsx.js";

const DAY = 86_400_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ECD = "https://www.tn.gov/ecd/resources/openecd";
const TABLEAU = "https://data.tn.gov/t/Public/views";
const qstr = (v, d = "") => (typeof v === "string" ? v : d);
const strip = (h) => String(h || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const money = (v) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : 0; };
const isoUS = (s) => { const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };

async function get(url, { binary = false, timeout = 120_000 } = {}) {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} → HTTP ${r.status}`);
  return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
}

// "Representatives voting Aye were: A, B, C -- 3." blocks on a bill page → structured votes
export function parseBillVotes(html) {
  const out = [];
  for (const [chamber, id] of [["House", "pnlHouseVotes"], ["Senate", "pnlSenateVotes"]]) {
    const panel = (html.match(new RegExp(`ID="${id}"[^>]*>([\\s\\S]*?)</asp:Panel>`, "i")) || html.match(new RegExp(`id="[^"]*${id}"[^>]*>([\\s\\S]*?)</div>\\s*</div>`, "i")) || [])[1];
    if (!panel) continue;
    const text = panel.replace(/<br\s*\/?>|<\/h\d>|<\/?p[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
    const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim());
    let cur = null;
    const push = () => { if (cur) out.push(cur); cur = null; };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const head = l.match(/^([HS][BJR]{1,2}\d+) by (.+?) - (.+?):\s*$/);
      if (head) { push(); cur = { chamber, bill: head[1], sponsor: head[2], body: head[3], action: "", date: null, result: "", ayes: null, noes: null, pnv: null, aye: [], no: [], present: [] }; continue; }
      if (!cur || !l) continue;
      const d = l.match(/^(.*?)\s*(\d{1,2}\/\d{1,2}\/\d{4})$/);
      if (!cur.action && d) { cur.action = d[1].trim(); cur.date = isoUS(d[2]); continue; }
      if (!cur.result && /^(Passed|Failed|Adopted|Concurred|Non-?concurred|Tabled|Voice Vote|Refused)/i.test(l)) { cur.result = l; continue; }
      const cnt = l.match(/^(Ayes|Noes|Present and not voting)\.*\s*(\d+)$/i);
      if (cnt) { cur[/^Ayes/i.test(cnt[1]) ? "ayes" : /^Noes/i.test(cnt[1]) ? "noes" : "pnv"] = Number(cnt[2]); continue; }
      const who = l.match(/(voting Aye|voting No|present and not voting) were:\s*(.+?)\s*--\s*\d+\.?$/i);
      if (who) cur[/Aye/i.test(who[1]) ? "aye" : /No$/i.test(who[1]) || /voting No/i.test(who[1]) ? "no" : "present"] = who[2].split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    }
    push();
  }
  return out;
}

export function registerTnState(app, { normalizeEmployerName, lobbyIndex, fecFetch, wantsRefresh }) {
  const fail = (res, code, message) => res.status(code).json({ error: { message } });
  const db = rawDb();
  if (!db) { app.all(["/api/tn/state/*", "/api/tn/org", "/api/tn/results*"], (_q, res) => fail(res, 503, "These views need the SQLite store.")); return {}; }
  db.exec(`
    CREATE TABLE IF NOT EXISTS tn_incentive (
      id INTEGER PRIMARY KEY, company TEXT NOT NULL, norm TEXT, landed TEXT, capital REAL, jobs_incent INTEGER, jobs_new INTEGER, type TEXT,
      county TEXT, tier TEXT, fjtap REAL, fidp REAL, ed REAL, total REAL, status TEXT NOT NULL, fetched_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_incentive_norm ON tn_incentive(norm);
    CREATE TABLE IF NOT EXISTS tn_contract (
      contract TEXT NOT NULL, supplier TEXT NOT NULL, norm TEXT, type TEXT, descr TEXT, begin TEXT, expire TEXT, amount REAL, local_avail TEXT, fetched_at INTEGER NOT NULL,
      PRIMARY KEY (contract, supplier));
    CREATE INDEX IF NOT EXISTS idx_contract_norm ON tn_contract(norm);
    CREATE TABLE IF NOT EXISTS tn_result (
      election TEXT NOT NULL, etype TEXT NOT NULL, office TEXT NOT NULL, county TEXT NOT NULL, candidate TEXT NOT NULL, party TEXT, votes INTEGER NOT NULL,
      PRIMARY KEY (election, etype, office, county, candidate));
    CREATE INDEX IF NOT EXISTS idx_result_office ON tn_result(election, office);
  `);
  const tx = (fn) => { db.exec("BEGIN"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { try { db.exec("ROLLBACK"); } catch { /* closed */ } throw e; } };
  const norm = (v) => normalizeEmployerName(v);
  const busy = {};
  const once = async (key, fn) => { if (busy[key]) return busy[key]; busy[key] = fn().finally(() => { delete busy[key]; }); return busy[key]; };
  const stale = (key, days) => Date.now() - Number(settingGet(key) || 0) > days * DAY;

  // =====================================================================================
  //  Incentives
  // =====================================================================================
  const syncIncentives = (force = false) => once("inc", async () => {
    if (!force && !stale("tnIncentiveAt", 7)) return;
    const page = await get(`${ECD}/fasttrack-project-database.html`);
    const href = (page.match(/href="([^"]+OpenECD_Contracted[^"]+\.xlsx)"/i) || [])[1];
    if (!href) throw new Error("The FastTrack download link was not found on the TNECD page.");
    const rows = xlsxRows(await get(new URL(href, "https://www.tn.gov").href, { binary: true }));
    const head = (rows[0] || []).map((h) => String(h || "").toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const ix = { company: col(/company/), landed: col(/landed/), capital: col(/capital/), ji: col(/incentivized/), jn: col(/new jobs/), type: col(/project type/), county: col(/^county$/), tier: col(/tier/), fjtap: col(/fjtap/), fidp: col(/fidp/), ed: col(/^ed$/), total: col(/grants total/) };
    if (ix.company < 0 || ix.total < 0) throw new Error("The FastTrack spreadsheet layout has changed.");
    const list = rows.slice(1).filter((r) => r[ix.company]).map((r) => ({ company: String(r[ix.company]).trim(), landed: excelDate(r[ix.landed]), capital: money(r[ix.capital]), ji: money(r[ix.ji]), jn: money(r[ix.jn]), type: r[ix.type] || "", county: r[ix.county] || "", tier: r[ix.tier] || "", fjtap: money(r[ix.fjtap]), fidp: money(r[ix.fidp]), ed: money(r[ix.ed]), total: money(r[ix.total]), status: "contracted" }));
    try { // projects announced but not yet under contract
      const pend = await get(`${ECD}/fasttrack-projects-pending-contract.html`);
      const table = (pend.match(/<table[^>]*>([\s\S]*?)<\/table>/i) || [])[1] || "";
      for (const tr of [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1)) {
        const c = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((x) => strip(x[1]));
        if (c.length >= 12 && c[0]) list.push({ company: c[0], landed: isoUS(c[1]), capital: money(c[2]), ji: money(c[3]), jn: money(c[4]), type: c[5], county: c[6], tier: c[7], fjtap: money(c[8]), fidp: money(c[9]), ed: money(c[10]), total: money(c[11]), status: "pending" });
      }
    } catch (e) { console.warn("[incentives pending]", e.message); }
    if (list.length < 50) throw new Error("The FastTrack spreadsheet came back nearly empty.");
    const now = Date.now();
    tx(() => {
      db.exec("DELETE FROM tn_incentive");
      const ins = db.prepare("INSERT INTO tn_incentive (company, norm, landed, capital, jobs_incent, jobs_new, type, county, tier, fjtap, fidp, ed, total, status, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const r of list) ins.run(r.company, norm(r.company), r.landed, r.capital, r.ji, r.jn, r.type, r.county, String(r.tier), r.fjtap, r.fidp, r.ed, r.total, r.status, now);
    });
    settingSet("tnIncentiveAt", String(now)); settingSet("tnIncentiveFile", href.split("/").pop());
  });

  // =====================================================================================
  //  Contracts
  // =====================================================================================
  const syncContracts = (force = false) => once("con", async () => {
    if (!force && !stale("tnContractAt", 7)) return;
    const rows = csvRows(await get(`${TABLEAU}/CPOContractDetails/CPOContracts-ADACompliant.csv?:maxrows=0`, { timeout: 180_000 }));
    const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const ix = { contract: col(/^contract$/), descr: col(/description/), type: col(/contract type/), supplier: col(/supplier/), begin: col(/begin/), expire: col(/expire/), value: col(/measure values/), measure: col(/measure names/), local: col(/available to local/) };
    if (ix.contract < 0 || ix.supplier < 0 || ix.value < 0) throw new Error("The state contracts export layout has changed.");
    const list = rows.slice(1).filter((r) => r[ix.contract] && r[ix.supplier] && (ix.measure < 0 || /amount/i.test(r[ix.measure] || "amount")));
    if (list.length < 500) throw new Error("The state contracts export came back nearly empty.");
    const now = Date.now();
    tx(() => {
      db.exec("DELETE FROM tn_contract");
      const ins = db.prepare("INSERT OR REPLACE INTO tn_contract (contract, supplier, norm, type, descr, begin, expire, amount, local_avail, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const r of list) ins.run(r[ix.contract].trim(), r[ix.supplier].trim(), norm(r[ix.supplier]), r[ix.type] || "", r[ix.descr] || "", isoUS(r[ix.begin]), isoUS(r[ix.expire]), money(r[ix.value]), r[ix.local] || "", now);
    });
    settingSet("tnContractAt", String(now));
  });

  // names that show up elsewhere in the app, so a list can say "also lobbies", "also has contracts"…
  async function crossMaps() {
    const lob = await lobbyIndex().catch(() => ({ employers: new Map() }));
    const con = new Map(db.prepare("SELECT norm, COUNT(*) n, SUM(amount) amount FROM tn_contract GROUP BY norm").all().map((r) => [r.norm, r]));
    const inc = new Map(db.prepare("SELECT norm, COUNT(*) n, SUM(total) amount FROM tn_incentive GROUP BY norm").all().map((r) => [r.norm, r]));
    return { lob: lob.employers, con, inc };
  }

  app.get("/api/tn/state/incentives", async (req, res) => {
    try { await syncIncentives(wantsRefresh()); } catch (e) { if (!db.prepare("SELECT 1 FROM tn_incentive LIMIT 1").get()) return fail(res, 502, e.message); }
    const q = qstr(req.query.q).toUpperCase().trim(), county = qstr(req.query.county), status = qstr(req.query.status);
    const where = [], args = [];
    if (q) { where.push("UPPER(company) LIKE ?"); args.push(`%${q}%`); }
    if (county) { where.push("county = ?"); args.push(county); }
    if (status) { where.push("status = ?"); args.push(status); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT company, norm, landed, capital, jobs_incent ji, jobs_new jn, type, county, tier, fjtap, fidp, ed, total, status FROM tn_incentive ${w} ORDER BY total DESC LIMIT 1000`).all(...args);
    const x = await crossMaps();
    for (const r of rows) { r.lobbies = x.lob.has(r.norm); r.contracts = x.con.get(r.norm)?.n || 0; }
    const t = db.prepare(`SELECT COUNT(*) n, SUM(total) total, SUM(capital) capital, SUM(jobs_new) jobs FROM tn_incentive ${w}`).get(...args);
    const byCounty = db.prepare(`SELECT county name, COUNT(*) count, SUM(total) total FROM tn_incentive ${w} GROUP BY county ORDER BY total DESC LIMIT 95`).all(...args);
    res.json({ rows, totals: t, byCounty, counties: db.prepare("SELECT DISTINCT county FROM tn_incentive WHERE county != '' ORDER BY county").all().map((r) => r.county),
      syncedAt: Number(settingGet("tnIncentiveAt") || 0) || null, file: settingGet("tnIncentiveFile") || null, source: `${ECD}/fasttrack-project-database.html` });
  });

  app.get("/api/tn/state/contracts", async (req, res) => {
    try { await syncContracts(wantsRefresh()); } catch (e) { if (!db.prepare("SELECT 1 FROM tn_contract LIMIT 1").get()) return fail(res, 502, e.message); }
    const q = qstr(req.query.q).toUpperCase().trim(), type = qstr(req.query.type);
    const where = [], args = [];
    if (q) { where.push("(UPPER(supplier) LIKE ? OR UPPER(descr) LIKE ? OR contract = ?)"); args.push(`%${q}%`, `%${q}%`, q); }
    if (type) { where.push("type = ?"); args.push(type); }
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT contract, supplier, norm, type, descr, begin, expire, amount FROM tn_contract ${w} ORDER BY amount DESC LIMIT 600`).all(...args);
    const x = await crossMaps();
    for (const r of rows) { r.lobbies = x.lob.has(r.norm); r.incentives = x.inc.get(r.norm)?.n || 0; }
    const t = db.prepare(`SELECT COUNT(*) n, SUM(amount) amount, COUNT(DISTINCT norm) suppliers FROM tn_contract ${w}`).get(...args);
    const top = db.prepare(`SELECT MAX(supplier) name, norm, COUNT(*) count, SUM(amount) total FROM tn_contract ${w} GROUP BY norm ORDER BY total DESC LIMIT 40`).all(...args).map((r) => ({ ...r, lobbies: x.lob.has(r.norm) }));
    const types = db.prepare("SELECT type, COUNT(*) n, SUM(amount) amount FROM tn_contract GROUP BY type ORDER BY amount DESC").all();
    res.json({ rows, totals: t, top, types, syncedAt: Number(settingGet("tnContractAt") || 0) || null,
      source: "https://www.tn.gov/generalservices/procurement/central-procurement-office--cpo-/contract-information/all-contracts-dashboard.html" });
  });

  // =====================================================================================
  //  One organization, everywhere
  // =====================================================================================
  app.get("/api/tn/org", async (req, res) => {
    const name = qstr(req.query.name).trim();
    if (name.length < 3) return fail(res, 400, "Give an organization name.");
    const n = norm(name), first = n.split(" ")[0];
    if (!first || first.length < 2) return fail(res, 400, "That name is too short to match.");
    try { await Promise.all([syncIncentives(false).catch(() => {}), syncContracts(false).catch(() => {})]); } catch { /* use what is stored */ }
    const out = { name, norm: n };
    out.incentives = db.prepare("SELECT company, landed, capital, jobs_new jn, county, total, status, type FROM tn_incentive WHERE norm = ? ORDER BY landed DESC").all(n);
    out.contracts = db.prepare("SELECT contract, supplier, type, descr, begin, expire, amount FROM tn_contract WHERE norm = ? ORDER BY amount DESC LIMIT 200").all(n);
    const lob = await lobbyIndex().catch(() => ({ employers: new Map(), year: "" }));
    const le = lob.employers.get(n);
    out.lobbying = le ? { id: le.id, name: le.name, year: lob.year } : null;
    // people who list this employer: find the spellings through the index on the first word, then total by recipient
    const spellings = db.prepare("SELECT employer, COUNT(*) c FROM contributions WHERE employer >= ? AND employer < ? AND kind = 'contribution' GROUP BY employer").all(first, first + "￿")
      .concat(first !== first.toLowerCase() ? db.prepare("SELECT employer, COUNT(*) c FROM contributions WHERE employer >= ? AND employer < ? AND kind = 'contribution' GROUP BY employer").all(first[0] + first.slice(1).toLowerCase(), first[0] + first.slice(1).toLowerCase() + "￿") : [])
      .filter((r) => norm(r.employer) === n).map((r) => r.employer).slice(0, 60);
    if (spellings.length) {
      const ph = spellings.map(() => "?").join(",");
      out.employees = {
        spellings: spellings.length,
        totals: db.prepare(`SELECT source, COUNT(*) gifts, COUNT(DISTINCT donor_key) donors, SUM(amount) total FROM contributions WHERE employer IN (${ph}) AND kind = 'contribution' AND memo = 0 GROUP BY source`).all(...spellings),
        recipients: db.prepare(`SELECT source, recipient_id id, MAX(recipient_name) name, COUNT(*) gifts, COUNT(DISTINCT donor_key) donors, SUM(amount) total FROM contributions WHERE employer IN (${ph}) AND kind = 'contribution' AND memo = 0 GROUP BY source, recipient_id ORDER BY total DESC LIMIT 60`).all(...spellings),
        donors: db.prepare(`SELECT MAX(donor_name) name, donor_key key, MAX(occupation) occupation, COUNT(*) gifts, SUM(amount) total FROM contributions WHERE employer IN (${ph}) AND kind = 'contribution' AND memo = 0 GROUP BY donor_key ORDER BY total DESC LIMIT 40`).all(...spellings),
      };
    } else out.employees = null;
    // the organization itself, or its PAC, as a donor
    const own = db.prepare("SELECT donor_name, donor_key FROM contributions WHERE donor_name >= ? AND donor_name < ? AND kind = 'contribution' GROUP BY donor_key LIMIT 4000").all(first, first + "￿")
      .filter((r) => { const d = norm(r.donor_name); return d === n || d.startsWith(n + " "); }).slice(0, 40);
    if (own.length) {
      const ph = own.map(() => "?").join(",");
      out.own = { names: [...new Set(own.map((r) => r.donor_name))].slice(0, 8),
        recipients: db.prepare(`SELECT source, recipient_id id, MAX(recipient_name) name, COUNT(*) gifts, SUM(amount) total, MAX(date) last FROM contributions WHERE donor_key IN (${ph}) AND kind = 'contribution' GROUP BY source, recipient_id ORDER BY total DESC LIMIT 80`).all(...own.map((r) => r.donor_key)) };
    } else out.own = null;
    // county and city: as a donor, and as someone campaigns paid
    try {
      const like = `${n.replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim()}%`;
      out.local = db.prepare("SELECT i.kind, i.name, i.date, i.amount, i.recipient, i.office, s.county, i.filer_id filerId FROM local_item i JOIN local_source s ON s.sub = i.sub WHERE i.norm LIKE ? AND i.review IN ('ok','approved','edited') ORDER BY i.amount DESC LIMIT 100").all(like);
    } catch { out.local = []; }
    // federal awards performed in Tennessee, last full fiscal year
    try {
      const fy = currentFY() - 1;
      out.federal = await cached(`usa:orgsearch:v1:${fy}:${n}`, 7 * DAY, async () => {
        const d = await usa("search/spending_by_category/recipient/", { filters: { time_period: [{ start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` }], place_of_performance_locations: [{ country: "USA", state: "TN" }], recipient_search_text: [name.slice(0, 80)] }, limit: 10, page: 1 });
        return { fy, list: (d.results || []).map((r) => ({ name: r.name, amount: Number(r.amount) || 0, id: r.recipient_id || null })) };
      });
    } catch (e) { out.federal = { error: e.message, list: [] }; }
    res.json(out);
  });

  // =====================================================================================
  //  Election results (county totals from the precinct spreadsheet)
  // =====================================================================================
  const electionFiles = () => cached("tn:sos:resultfiles:v2", DAY, async () => {
    const html = await get("https://sos.tn.gov/elections/results");
    const seen = new Map();
    for (const m of html.matchAll(/href="([^"]+\/(\d{8})[A-Za-z]*by[Pp]recinct[^"]*\.xlsx)"/g)) if (!seen.has(m[2])) seen.set(m[2], m[1]);
    return { files: [...seen].map(([d, url]) => ({ id: d, date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, url })).sort((a, b) => b.id.localeCompare(a.id)) };
  }).then((x) => x.files || []);
  const loadElection = (id) => once(`el:${id}`, async () => {
    if (db.prepare("SELECT 1 FROM tn_result WHERE election = ? LIMIT 1").get(id)) return;
    const f = (await electionFiles()).find((x) => x.id === id);
    if (!f) throw new Error("No precinct spreadsheet is published for that election.");
    const rows = xlsxRows(await get(f.url, { binary: true, timeout: 240_000 }));
    const head = (rows[0] || []).map((h) => String(h || "").toUpperCase());
    const c = (name) => head.indexOf(name);
    const ix = { county: c("COUNTY"), office: c("OFFICENAME"), etype: c("ELECTTYPE") };
    if (ix.county < 0 || ix.office < 0) throw new Error("The results spreadsheet layout has changed.");
    const slots = []; for (let k = 1; k <= 20; k++) { const n = c(`RNAME${k}`); if (n < 0) break; slots.push([n, c(`PARTY${k}`), c(`PVTALLY${k}`)]); }
    const agg = new Map();
    for (const r of rows.slice(1)) {
      const county = r[ix.county], office = r[ix.office]; if (!county || !office) continue;
      for (const [n, p, v] of slots) {
        const cand = r[n]; if (!cand) continue;
        const key = `${r[ix.etype] || ""}\u0001${office}\u0001${county}\u0001${cand}`;
        const cur = agg.get(key) || { party: r[p] || "", votes: 0 };
        cur.votes += Number(r[v]) || 0; agg.set(key, cur);
      }
    }
    if (agg.size < 50) throw new Error("The results spreadsheet came back nearly empty.");
    tx(() => {
      const ins = db.prepare("INSERT OR REPLACE INTO tn_result (election, etype, office, county, candidate, party, votes) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const [key, v] of agg) { const [etype, office, county, cand] = key.split("\u0001"); ins.run(id, etype, office, county, cand, v.party, v.votes); }
    });
  });
  app.get("/api/tn/results/elections", async (_req, res) => {
    try { const files = await electionFiles(); const have = new Set(db.prepare("SELECT DISTINCT election FROM tn_result").all().map((r) => r.election)); res.json({ elections: files.map((f) => ({ id: f.id, date: f.date, loaded: have.has(f.id) })) }); }
    catch (e) { fail(res, 502, e.message); }
  });
  app.get("/api/tn/results", async (req, res) => {
    const id = qstr(req.query.election).replace(/\D/g, ""), office = qstr(req.query.office), etype = qstr(req.query.type), county = qstr(req.query.county);
    if (id.length !== 8) return fail(res, 400, "election must be YYYYMMDD.");
    try { await loadElection(id); } catch (e) { return fail(res, 502, e.message); }
    const offices = db.prepare("SELECT office, etype, SUM(votes) votes, COUNT(DISTINCT county) counties FROM tn_result WHERE election = ? GROUP BY office, etype ORDER BY votes DESC").all(id);
    if (!office) return res.json({ election: id, offices });
    const where = ["election = ?", "office = ?"], args = [id, office];
    if (etype) { where.push("etype = ?"); args.push(etype); }
    const w = where.join(" AND ");
    const cands = db.prepare(`SELECT candidate, MAX(party) party, SUM(votes) votes, COUNT(DISTINCT county) counties FROM tn_result WHERE ${w} ${county ? "AND county = ?" : ""} GROUP BY candidate ORDER BY votes DESC`).all(...args, ...(county ? [county] : []));
    const total = cands.reduce((a, c) => a + c.votes, 0);
    const byCounty = db.prepare(`SELECT county, candidate, votes FROM tn_result WHERE ${w} ORDER BY county, votes DESC`).all(...args);
    const counties = {};
    for (const r of byCounty) (counties[r.county] ||= []).push({ candidate: r.candidate, votes: r.votes });
    res.json({ election: id, office, type: etype || null, total, candidates: cands.map((c) => ({ ...c, share: total ? c.votes / total : 0 })),
      counties: Object.entries(counties).map(([name, list]) => ({ name, total: list.reduce((a, x) => a + x.votes, 0), leader: list[0]?.candidate, leaderVotes: list[0]?.votes || 0, list: list.slice(0, 6) })), offices });
  });

  // =====================================================================================
  //  Bill votes
  // =====================================================================================
  app.get("/api/tn/legislature/bill", async (req, res) => {
    const number = qstr(req.query.number).toUpperCase().replace(/\s+/g, ""), ga = qstr(req.query.ga).replace(/\D/g, "") || "114";
    const m = number.match(/^([HS][BJR]{1,2})0*(\d{1,4})$/);
    if (!m) return fail(res, 400, "Give a bill number such as HB0364 or SB650.");
    const bill = `${m[1]}${m[2].padStart(4, "0")}`;
    try {
      const d = await cached(`tn:bill:v2:${ga}:${bill}`, 2 * DAY, async () => {
        const url = `https://wapp.capitol.tn.gov/apps/BillInfo/Default.aspx?BillNumber=${bill}&GA=${ga}`;
        const html = await get(url);
        const title = strip((html.match(/class="[^"]*abstract-container[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "").slice(0, 400);
        const votes = parseBillVotes(html);
        return { bill, ga, url, title, votes, companion: [...new Set(votes.map((v) => v.bill))].filter((b) => b !== bill) };
      }, { force: wantsRefresh() });
      res.json(d);
    } catch (e) { fail(res, 502, e.message); }
  });

  // =====================================================================================
  //  Nonprofits behind outside spending (IRS filings via ProPublica)
  // =====================================================================================
  app.get("/api/tn/nonprofit", async (req, res) => {
    const q = qstr(req.query.q).trim(), ein = qstr(req.query.ein).replace(/\D/g, "");
    try {
      if (ein) {
        const d = await cached(`pp:org:v1:${ein}`, 7 * DAY, async () => JSON.parse(await get(`https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`)));
        const o = d.organization || {};
        return res.json({ org: { ein: o.ein, name: o.name, city: o.city, state: o.state, subsection: o.subsection_code, ruling: o.ruling_date, ntee: o.ntee_code },
          filings: (d.filings_with_data || []).slice(0, 12).map((f) => ({ year: f.tax_prd_yr, revenue: f.totrevenue, expenses: f.totfuncexpns, assets: f.totassetsend, contributions: f.totcntrbgfts, pdf: f.pdf_url || null })),
          url: `https://projects.propublica.org/nonprofits/organizations/${ein}` });
      }
      if (q.length < 3) return fail(res, 400, "Give a name of at least three letters.");
      const d = await cached(`pp:search:v1:${q.toLowerCase()}:${req.query.all === "1" ? "all" : "tn"}`, 7 * DAY, async () => JSON.parse(await get(`https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(q)}${req.query.all === "1" ? "" : "&state%5Bid%5D=TN"}`)));
      res.json({ total: d.total_results || 0, orgs: (d.organizations || []).slice(0, 25).map((o) => ({ ein: o.ein, name: o.name, city: o.city, state: o.state, subsection: o.subseccd, ntee: o.ntee_code })) });
    } catch (e) { fail(res, /404/.test(e.message) ? 404 : 502, /404/.test(e.message) ? "Nothing on file with the IRS under that name." : e.message); }
  });

  // =====================================================================================
  //  Statements of Disclosure of Interests (Ethics Commission): income sources, positions, investments
  // =====================================================================================
  const CONFLICT = "https://conflict.app.tn.gov/conflict";
  app.get("/api/tn/interests", async (req, res) => {
    const last = qstr(req.query.last).trim().slice(0, 20), first = qstr(req.query.first).trim().slice(0, 20), local = req.query.scope === "local", county = qstr(req.query.county).trim();
    const year = /^\d{4}$/.test(qstr(req.query.year)) ? req.query.year : String(new Date().getFullYear());
    if (last.length < 2) return fail(res, 400, "Give at least two letters of the last name.");
    try {
      const d = await cached(`tn:interests:v1:${local ? "L" : "S"}:${year}:${county.toUpperCase()}:${last.toUpperCase()}:${first.toUpperCase()}`, 2 * DAY, async () => {
        const open = await fetch(`${CONFLICT}/search.htm`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(45_000) });
        const cookie = (open.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
        await open.text();
        const form = local
          ? { localFirstName: first, localLastName: last, localPosition: "", county, localYear: year, _localCanOnly: "on", localSearch: "Search" }
          : { stateFirstName: first, stateLastName: last, position: "", stateYear: year, _stateCanOnly: "on", stateSearch: "Search" };
        const r = await fetch(`${CONFLICT}/search.htm`, { method: "POST", headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", referer: `${CONFLICT}/search.htm`, cookie }, body: new URLSearchParams(form), signal: AbortSignal.timeout(45_000) });
        if (!r.ok) throw new Error(`Ethics Commission search → HTTP ${r.status}`);
        const html = await r.text();
        const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => {
          const link = m[1].match(/href="view_form_(8004|8005)\.htm\?([^"]+)"/i);
          if (!link) return null;
          const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]));
          const p = new URLSearchParams(link[2].replace(/&amp;/g, "&"));
          return { name: cells[0] || "", position: cells[1] || "", form: link[1], q: { form: link[1], name: p.get("name") || "", id: p.get("id") || "", f: p.get("f") || "" } };
        }).filter(Boolean);
        return { year, rows, more: /d-\d+-p=2/.test(html) };
      }, { force: wantsRefresh() });
      res.json(d);
    } catch (e) { fail(res, 502, e.message); }
  });
  app.get("/api/tn/interests/view", async (req, res) => {
    const form = req.query.form === "8005" ? "8005" : "8004", id = qstr(req.query.id).replace(/\D/g, ""), f = qstr(req.query.f).replace(/\D/g, ""), name = qstr(req.query.name).replace(/[^A-Za-z' -]/g, "").slice(0, 40);
    if (!id || !f) return fail(res, 400, "Missing statement reference.");
    try {
      const d = await cached(`tn:interests:view:v2:${form}:${id}:${f}`, 30 * DAY, async () => {
        const url = `${CONFLICT}/view_form_${form}.htm?${new URLSearchParams({ name, id, f, v: "1" })}`;
        const html = await get(url, { timeout: 45_000 });
        const body = html.slice(Math.max(0, html.indexOf('id="content"')));
        const parts = body.split(/<h2[^>]*>/i).slice(1);
        const sections = [];
        const meta = {};
        for (const part of parts) {
          const title = strip(part.split(/<\/h2>/i)[0]);
          const rest = (part.split(/<\/h2>/i)[1] || "").replace(/<(?:\/p|\/li|\/div|br\s*\/?|\/legend|\/tr)>/gi, "\n");
          const raw = rest.split("\n").map((l) => strip(l).replace(/\s*View all statements\s*$/i, "")).filter((l) => l && !/^(View all statements|Back to Search Results|Help and FAQs|Search Statements)/i.test(l));
          const lines = []; // "Income received by:" / "Filer" arrive on separate lines
          for (const l of raw) { if (lines.length && /:$/.test(lines[lines.length - 1])) lines[lines.length - 1] += ` ${l}`; else lines.push(l); }
          if (/^Report Year/i.test(title)) { meta.year = lines[0]; continue; }
          if (/^Date of Filing/i.test(title)) { meta.filed = lines[0]; continue; }
          if (/^Certification/i.test(title)) break;
          if (/^Filer Contact/i.test(title)) { meta.filer = lines[0]; meta.position = lines[1] || ""; continue; }
          sections.push({ title, lines: lines.slice(0, 80), none: lines.length === 0 || lines.every((l) => /^(none|part [ab])$/i.test(l)) });
        }
        if (!sections.length) throw new Error("The statement page could not be read.");
        return { url, form, ...meta, sections };
      });
      res.json(d);
    } catch (e) { fail(res, 502, e.message); }
  });

  return { syncIncentives, syncContracts, counties: TN_COUNTIES, fecFetch };
}
