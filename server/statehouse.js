// Tennessee statehouse sources beyond campaign finance:
//   • Lobbying — the Ethics Commission's iLobby search (ilobbysearch.app.tn.gov): every employer of
//     lobbyists and every registered lobbyist, plus who lobbies for whom by year.
//   • Legislature — the General Assembly directory (wapp.capitol.tn.gov): members, party, district,
//     committee assignments and sponsored bills.
// Both are small: the rosters are 2-4 requests in total and are refreshed weekly; per-entity detail
// pages are fetched on demand and cached. Page structures verified against the live sites, Nov 2026.

import { rawDb, cacheGet, cacheSet, cacheGetStale, settingGet, settingSet } from "./db.js";
import { cached } from "./tnx.js";

const DAY = 86_400_000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const LOBBY = "https://ilobbysearch.app.tn.gov/ilobbysearch";
const CAPITOL = "https://wapp.capitol.tn.gov/apps";
const qstr = (v, d = "") => (typeof v === "string" ? v : d);
const strip = (h) => String(h || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUFFIX = new Set(["JR", "SR", "II", "III", "IV"]);

async function get(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "user-agent": UA, accept: "text/html,*/*", ...(opts.headers || {}) }, signal: AbortSignal.timeout(45_000) });
  if (!r.ok) throw new Error(`${new URL(url).hostname} → HTTP ${r.status}`);
  return { text: await r.text(), cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}

// "John Q. Farris Jr." → { last: "FARRIS", first: "JOHN" }
export function personParts(name) {
  const t = String(name || "").toUpperCase().replace(/[^A-Z' -]/g, " ").split(/\s+/).filter(Boolean).filter((x) => !SUFFIX.has(x));
  if (t.length < 2) return null;
  return { last: t[t.length - 1], first: t[0] };
}

export function registerStatehouse(app, { normalizeEmployerName }) {
  const fail = (res, code, message) => res.status(code).json({ error: { message } });
  const db = rawDb();
  const mem = { employers: [], lobbyists: [], members: [] };
  if (db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tn_lobby_employer (
        employer_id TEXT PRIMARY KEY, name TEXT NOT NULL, norm TEXT, address TEXT, city TEXT, state TEXT, zip TEXT, phone TEXT,
        year TEXT, fetched_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_lobby_emp_norm ON tn_lobby_employer(norm);
      CREATE TABLE IF NOT EXISTS tn_lobbyist (
        lobbyist_id TEXT PRIMARY KEY, name TEXT NOT NULL, last TEXT, first TEXT, city TEXT, state TEXT, zip TEXT, phone TEXT,
        fetched_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_lobbyist_name ON tn_lobbyist(last, first);
      CREATE TABLE IF NOT EXISTS tn_legislator (
        chamber TEXT NOT NULL, district TEXT NOT NULL, name TEXT NOT NULL, party TEXT, email TEXT, ga TEXT,
        member_url TEXT, bills_url TEXT, fetched_at INTEGER NOT NULL, PRIMARY KEY (chamber, district));
    `);
  }

  // =====================================================================================
  //  Lobbying
  // =====================================================================================
  const rowsOf = (html, linkRe) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => {
    const id = m[1].match(linkRe)?.[1];
    if (!id) return null;
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]));
    return { id, cells };
  }).filter(Boolean);

  let lobbySyncing = null;
  async function syncLobby(force = false) {
    const year = String(new Date().getFullYear());
    const last = Number(settingGet("lobbySyncAt") || 0);
    if (!force && Date.now() - last < 7 * DAY && settingGet("lobbySyncYear") === year) return { fresh: true };
    if (lobbySyncing) return lobbySyncing;
    lobbySyncing = (async () => {
      const form = await get(`${LOBBY}/search.htm`);
      const post = (body) => get(`${LOBBY}/search.htm`, { method: "POST", body: new URLSearchParams(body).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded", ...(form.cookie ? { cookie: form.cookie } : {}), referer: `${LOBBY}/search.htm` } });
      const e = await post({ employerName: "", employerSubjectMatter: "0", employerYear: year, request: "employerSearch" });
      const employers = rowsOf(e.text, /viewEmployerDashboard\.htm\?employerId=(\d+)/).map((r) => ({ id: r.id, name: r.cells[0], address: r.cells[1] || "", city: r.cells[2] || "", state: r.cells[3] || "", zip: r.cells[4] || "", phone: r.cells[5] || "" }));
      if (employers.length < 50) throw new Error(`iLobby employer list returned ${employers.length} rows — layout may have changed`);
      await sleep(800);
      const l = await post({ lobbyistFirstName: "", lobbyistLastName: "", lobbyistSubjectMatter: "0", lobbyistYear: year, request: "lobbyistSearch" });
      const lobbyists = rowsOf(l.text, /viewLobbyistDashboard\.htm\?lobbyistId=(\d+)/).map((r) => ({ id: r.id, name: r.cells[0], city: r.cells[2] || "", state: r.cells[3] || "", zip: r.cells[4] || "", phone: r.cells[5] || "" }));
      const now = Date.now();
      if (db) {
        db.exec("BEGIN");
        try {
          db.exec("DELETE FROM tn_lobby_employer; DELETE FROM tn_lobbyist;");
          const ie = db.prepare("INSERT OR REPLACE INTO tn_lobby_employer (employer_id, name, norm, address, city, state, zip, phone, year, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
          for (const x of employers) ie.run(x.id, x.name, normalizeEmployerName(x.name), x.address, x.city, x.state, x.zip, x.phone, year, now);
          const il = db.prepare("INSERT OR REPLACE INTO tn_lobbyist (lobbyist_id, name, last, first, city, state, zip, phone, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)");
          for (const x of lobbyists) { const p = personParts(x.name); il.run(x.id, x.name, p?.last || "", p?.first || "", x.city, x.state, x.zip, x.phone, now); }
          db.exec("COMMIT");
        } catch (err) { db.exec("ROLLBACK"); throw err; }
      } else {
        mem.employers = employers.map((x) => ({ ...x, norm: normalizeEmployerName(x.name) }));
        mem.lobbyists = lobbyists.map((x) => ({ ...x, ...(personParts(x.name) || {}) }));
      }
      settingSet("lobbySyncAt", String(now)); settingSet("lobbySyncYear", year);
      return { employers: employers.length, lobbyists: lobbyists.length, year };
    })().finally(() => { lobbySyncing = null; });
    return lobbySyncing;
  }
  const allEmployers = () => (db ? db.prepare("SELECT employer_id AS id, name, norm, city, state, zip FROM tn_lobby_employer").all() : mem.employers);
  const allLobbyists = () => (db ? db.prepare("SELECT lobbyist_id AS id, name, last, first, city, state, zip FROM tn_lobbyist").all() : mem.lobbyists);

  // Indexes used by the candidate page (employers that lobby the state; donors who are lobbyists).
  // Best-effort: if iLobby is unreachable the roster on file is used; with none, the maps are empty.
  async function lobbyIndex() {
    try { await syncLobby(false); } catch (e) { console.warn("[lobby sync]", e.message); }
    const employers = new Map(), people = new Map();
    for (const e of allEmployers()) if (e.norm && !employers.has(e.norm)) employers.set(e.norm, e);
    for (const l of allLobbyists()) if (l.last && l.first) { const k = `${l.last}|${l.first}`; (people.get(k) || people.set(k, []).get(k)).push(l); }
    return { employers, people, year: settingGet("lobbySyncYear") || "" };
  }

  // Dashboard pages list registrations per year as: a year label, then a table of counterparties.
  function parseDashboard(html, linkRe) {
    const contact = strip((html.match(/Contact Information([\s\S]*?)Registrations/i) || [])[1] || "");
    const years = [];
    const re = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let m, prevEnd = 0;
    while ((m = re.exec(html))) {
      const before = strip(html.slice(prevEnd, m.index));
      const year = (before.match(/(20\d{2})\s*$/) || before.match(/(20\d{2})(?!.*20\d{2})/))?.[1] || "";
      const items = rowsOf(m[1], linkRe).map((r) => ({ id: r.id, name: r.cells[0], address: r.cells[1] || "", registered: r.cells[2] || "" }));
      if (items.length) years.push({ year, items });
      prevEnd = re.lastIndex;
    }
    return { contact, years };
  }

  app.get("/api/tn/lobby", async (req, res) => {
    const q = qstr(req.query.q).trim().toUpperCase();
    let note;
    try { await syncLobby(req.query._refresh === "1"); } catch (e) { note = `iLobby is not answering (${e.message}) — showing the roster on file.`; }
    const toks = q.split(/\s+/).filter(Boolean);
    const hit = (s) => toks.every((t) => String(s || "").toUpperCase().includes(t));
    const employers = allEmployers().filter((e) => !toks.length || hit(`${e.name} ${e.city}`));
    const lobbyists = allLobbyists().filter((l) => !toks.length || hit(`${l.name} ${l.city}`));
    res.json({ year: settingGet("lobbySyncYear") || "", syncedAt: Number(settingGet("lobbySyncAt") || 0) || null,
      totals: { employers: employers.length, lobbyists: lobbyists.length },
      employers: employers.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200), lobbyists: lobbyists.sort((a, b) => (a.last || "").localeCompare(b.last || "")).slice(0, 200),
      ...(note ? { note } : {}) });
  });
  app.get("/api/tn/lobby/employer/:id", async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) return fail(res, 400, "Invalid employer id.");
    try {
      const out = await cached(`lobby:emp:v1:${req.params.id}`, 7 * DAY, async () => {
        const p = await get(`${LOBBY}/viewEmployerDashboard.htm?employerId=${req.params.id}`);
        return { id: req.params.id, ...parseDashboard(p.text, /viewLobbyistDashboard\.htm\?lobbyistId=(\d+)/), url: `${LOBBY}/viewEmployerDashboard.htm?employerId=${req.params.id}` };
      }, { force: req.query._refresh === "1" });
      res.json(out);
    } catch (e) { fail(res, 502, `iLobby lookup failed: ${e.message}`); }
  });
  app.get("/api/tn/lobby/lobbyist/:id", async (req, res) => {
    if (!/^\d{1,9}$/.test(req.params.id)) return fail(res, 400, "Invalid lobbyist id.");
    try {
      const out = await cached(`lobby:lob:v1:${req.params.id}`, 7 * DAY, async () => {
        const p = await get(`${LOBBY}/viewLobbyistDashboard.htm?lobbyistId=${req.params.id}`);
        return { id: req.params.id, ...parseDashboard(p.text, /viewEmployerDashboard\.htm\?employerId=(\d+)/), url: `${LOBBY}/viewLobbyistDashboard.htm?lobbyistId=${req.params.id}` };
      }, { force: req.query._refresh === "1" });
      res.json(out);
    } catch (e) { fail(res, 502, `iLobby lookup failed: ${e.message}`); }
  });

  // =====================================================================================
  //  Legislature
  // =====================================================================================
  let legSyncing = null;
  async function syncLegislature(force = false) {
    const last = Number(settingGet("legSyncAt") || 0);
    if (!force && Date.now() - last < 7 * DAY) return { fresh: true };
    if (legSyncing) return legSyncing;
    legSyncing = (async () => {
      const members = [];
      for (const chamber of ["H", "S"]) {
        const p = await get(`${CAPITOL}/LegislatorInfo/Directory?chamber=${chamber}`);
        for (const m of p.text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
          const link = m[1].match(/LegislatorInfo\/Member\?district=([HS])(\d+)&(?:amp;)?ga=(\d+)"[^>]*>([^<]+)<\/a>/i);
          if (!link) continue;
          const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]));
          const bills = m[1].match(/href="([^"]*SponsorList\?[^"]+)"/i)?.[1]?.replace(/&amp;/g, "&") || "";
          members.push({ chamber: link[1].toUpperCase(), district: String(Number(link[2])), ga: link[3], name: strip(link[4]),
            party: cells.find((c) => /^[RDI]$/.test(c)) || "", email: (m[1].match(/mailto:([^"]+)"/i) || [])[1] || "",
            memberUrl: `${CAPITOL}/LegislatorInfo/Member?district=${link[1]}${link[2]}&ga=${link[3]}`, billsUrl: bills });
        }
        await sleep(600);
      }
      if (members.length < 100) throw new Error(`Legislature directory returned ${members.length} members — layout may have changed`);
      const now = Date.now();
      if (db) {
        db.exec("BEGIN");
        try {
          db.exec("DELETE FROM tn_legislator");
          const ins = db.prepare("INSERT OR REPLACE INTO tn_legislator (chamber, district, name, party, email, ga, member_url, bills_url, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)");
          for (const x of members) ins.run(x.chamber, x.district, x.name, x.party, x.email, x.ga, x.memberUrl, x.billsUrl, now);
          db.exec("COMMIT");
        } catch (err) { db.exec("ROLLBACK"); throw err; }
      } else mem.members = members;
      settingSet("legSyncAt", String(now));
      return { members: members.length };
    })().finally(() => { legSyncing = null; });
    return legSyncing;
  }
  const allMembers = () => (db ? db.prepare("SELECT chamber, district, name, party, email, ga, member_url AS memberUrl, bills_url AS billsUrl FROM tn_legislator").all() : mem.members);

  async function memberDetail(chamber, district) {
    try { await syncLegislature(false); } catch (e) { console.warn("[legislature sync]", e.message); }
    const m = allMembers().find((x) => x.chamber === chamber && x.district === String(Number(district)));
    if (!m) return null;
    return cached(`leg:member:v1:${chamber}:${m.district}:${m.ga}`, 3 * DAY, async () => {
      const page = await get(m.memberUrl);
      const body = page.text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, "\n");
      const lines = body.split("\n").map(strip).filter(Boolean);
      const committees = [...new Set(lines.filter((l) => /^(Chair|Vice[- ]?Chair|Member|Secretary|Chairman|Vice[- ]?Chairman),\s+.+(Committee|Subcommittee|Caucus)/i.test(l) && l.length < 140))];
      const area = lines.find((l) => /^District \d+/i.test(l) && l.length < 200) || "";
      const bills = [];
      // current General Assembly, then the previous one (a newly seated GA has no bills yet)
      for (const ga of [Number(m.ga), Number(m.ga) - 1]) {
        if (!m.billsUrl || bills.length) break;
        try {
          await sleep(500);
          const p = await get(m.billsUrl.replace(/ga=\d+/, `ga=${ga}`));
          for (const r of p.text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
            const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1]));
            if (cells.length >= 4 && /^[HS][BJR]+\s*\d+/i.test(cells[0])) {
              const href = r[1].match(/href="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&") || "";
              bills.push({ ga, number: cells[0], abstract: cells[1].slice(0, 300), lastAction: cells[2], date: cells[3], url: href.startsWith("http") ? href : href ? `https://wapp.capitol.tn.gov${href}` : "" });
            }
          }
        } catch { /* bills are optional */ }
      }
      const seen = new Set();
      return { ...m, area, committees, billCount: bills.length, billsGa: bills[0]?.ga || null,
        bills: bills.filter((b) => !seen.has(b.number) && seen.add(b.number)).slice(0, 60) };
    });
  }

  app.get("/api/tn/legislature", async (req, res) => {
    let note;
    try { await syncLegislature(req.query._refresh === "1"); } catch (e) { note = `The General Assembly site is not answering (${e.message}) — showing the roster on file.`; }
    const members = allMembers().sort((a, b) => (a.chamber === b.chamber ? Number(a.district) - Number(b.district) : a.chamber === "S" ? -1 : 1));
    res.json({ members, syncedAt: Number(settingGet("legSyncAt") || 0) || null, ...(note ? { note } : {}) });
  });
  app.get("/api/tn/legislature/member", async (req, res) => {
    const chamber = qstr(req.query.chamber).toUpperCase(), district = qstr(req.query.district);
    if (!/^[HS]$/.test(chamber) || !/^\d{1,3}$/.test(district)) return fail(res, 400, "chamber (H or S) and district are required.");
    try {
      const d = await memberDetail(chamber, district);
      if (!d) return fail(res, 404, "No member on file for that district.");
      res.json(d);
    } catch (e) { fail(res, 502, `Legislature lookup failed: ${e.message}`); }
  });

  return { lobbyIndex, syncLobby, syncLegislature };
}
