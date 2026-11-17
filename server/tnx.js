// Tennessee explorer routes — everything that searches Tennessee beyond one entity at a time:
//   • live form metadata + districts            /api/tn/meta, /api/tn/districts
//   • local directory of every candidate & PAC   /api/tn/directory*
//   • full contributions/expenditures search     /api/tn/explore/money
//   • filings search (report search)             /api/tn/explore/reports
//   • federal campaign money, Tennessee races    /api/tn/federal/races
//   • federal dollars into Tennessee             /api/tn/federal/spending*  (USAspending.gov)
// Field names and behaviours for the TREF forms were verified against the live site (Nov 2026);
// see server/tn.js. Registered from index.js, which hands in the shared cached gateways.

import { searchCandidatesPacs, searchReports, fetchDistricts, fetchFormMeta,
         TN_YEARS, TN_OFFICES, TN_PARTIES, TN_REPORT_TYPES } from "./tn.js";
import { cacheGet, cacheSet, cacheGetWithAge, cacheGetStale,
         tnEntityUpsertMany, tnEntitySearch, tnEntityStats, tnEntityFacets, tnSyncMark, tnSyncGet } from "./db.js";

const HOUR = 3_600_000, DAY = 86_400_000;
const qstr = (v, d = "") => (typeof v === "string" ? v : d);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// Tennessee's 95 counties: 3-digit county FIPS -> name (state FIPS 47).
export const TN_COUNTIES = { "001": "Anderson", "003": "Bedford", "005": "Benton", "007": "Bledsoe", "009": "Blount", "011": "Bradley", "013": "Campbell", "015": "Cannon", "017": "Carroll", "019": "Carter", "021": "Cheatham", "023": "Chester", "025": "Claiborne", "027": "Clay", "029": "Cocke", "031": "Coffee", "033": "Crockett", "035": "Cumberland", "037": "Davidson", "039": "Decatur", "041": "DeKalb", "043": "Dickson", "045": "Dyer", "047": "Fayette", "049": "Fentress", "051": "Franklin", "053": "Gibson", "055": "Giles", "057": "Grainger", "059": "Greene", "061": "Grundy", "063": "Hamblen", "065": "Hamilton", "067": "Hancock", "069": "Hardeman", "071": "Hardin", "073": "Hawkins", "075": "Haywood", "077": "Henderson", "079": "Henry", "081": "Hickman", "083": "Houston", "085": "Humphreys", "087": "Jackson", "089": "Jefferson", "091": "Johnson", "093": "Knox", "095": "Lake", "097": "Lauderdale", "099": "Lawrence", "101": "Lewis", "103": "Lincoln", "105": "Loudon", "107": "McMinn", "109": "McNairy", "111": "Macon", "113": "Madison", "115": "Marion", "117": "Marshall", "119": "Maury", "121": "Meigs", "123": "Monroe", "125": "Montgomery", "127": "Moore", "129": "Morgan", "131": "Obion", "133": "Overton", "135": "Perry", "137": "Pickett", "139": "Polk", "141": "Putnam", "143": "Rhea", "145": "Roane", "147": "Robertson", "149": "Rutherford", "151": "Scott", "153": "Sequatchie", "155": "Sevier", "157": "Shelby", "159": "Smith", "161": "Stewart", "163": "Sullivan", "165": "Sumner", "167": "Tipton", "169": "Trousdale", "171": "Unicoi", "173": "Union", "175": "Van Buren", "177": "Warren", "179": "Washington", "181": "Wayne", "183": "Weakley", "185": "White", "187": "Williamson", "189": "Wilson" };

// Award-type groups as USAspending defines them (spending_by_award accepts one group per call).
const AWARD_GROUPS = {
  contracts: ["A", "B", "C", "D"],
  grants: ["02", "03", "04", "05"],
  direct: ["06", "10"],
  loans: ["07", "08"],
  other: ["09", "11", "-1"],
};

// Generic cached upstream call: cache → coalesce identical in-flight calls → stale copy on failure.
const inflight = new Map();
export async function cached(key, ttlMs, fetcher, { force = false } = {}) {
  if (!force) {
    const hit = cacheGetWithAge(key);
    if (hit) return { ...hit.value, cachedAt: hit.createdAt };
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await fetcher();
      cacheSet(key, value, typeof ttlMs === "function" ? ttlMs(value) : ttlMs);
      return value;
    } catch (e) {
      const stale = cacheGetStale(key);
      if (stale) return { ...stale.value, cachedAt: stale.createdAt, stale: true, note: `Live source failed (${e.message}) — showing the saved copy.` };
      throw e;
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// USAspending.gov search API (POST, JSON, no key).
export async function usa(pathname, body) {
  const r = await fetch(`https://api.usaspending.gov/api/v2/${pathname}`, {
    method: "POST", headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error(data?.detail || data?.message || `USAspending HTTP ${r.status}`);
  return data;
}
export const currentFY = () => { const d = new Date(); return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear(); };

export function registerTnExplorer(app, { fecFetch, moneySearchAll, wantsRefresh, TTL }) {
  const fail = (res, code, message) => res.status(code).json({ error: { message } });

  // =====================================================================================
  //  Form metadata + districts
  // =====================================================================================
  const staticMeta = () => ({
    years: TN_YEARS, offices: TN_OFFICES, parties: TN_PARTIES, reportTypes: TN_REPORT_TYPES,
    reportYears: Array.from({ length: new Date().getFullYear() - 1999 }, (_, i) => String(new Date().getFullYear() - i)),
    counties: TN_COUNTIES, live: false,
  });
  let metaRefreshing = false;
  const refreshMeta = async () => {
    const m = await fetchFormMeta();
    const out = { ...staticMeta(), ...m, live: true, fetchedAt: Date.now() };
    cacheSet("tn:meta:v1", out, 7 * DAY);
    return out;
  };
  // Never blocks the TN tab on apps.tn.gov: serves the cached (or built-in) lists immediately and
  // refreshes from the live form in the background when the cached copy is missing or a week old.
  app.get("/api/tn/meta", async (req, res) => {
    if (req.query._refresh === "1") {
      try { return res.json(await refreshMeta()); }
      catch (e) { return res.json({ ...staticMeta(), note: `Live form unavailable (${e.message}) — using built-in lists.` }); }
    }
    const hit = cacheGet("tn:meta:v1") || cacheGetStale("tn:meta:v1")?.value;
    if (!cacheGet("tn:meta:v1") && !metaRefreshing) {
      metaRefreshing = true;
      refreshMeta().catch((e) => console.warn("[tn meta]", e.message)).finally(() => { metaRefreshing = false; });
    }
    res.json(hit ? { ...hit, counties: TN_COUNTIES } : staticMeta());
  });

  app.get("/api/tn/districts", async (req, res) => {
    const office = qstr(req.query.office);
    if (!/^\d{1,3}$/.test(office)) return fail(res, 400, "An office id is required.");
    try {
      const out = await cached(`tn:districts:v1:${office}`, 30 * DAY, async () => ({ office, districts: await fetchDistricts(office) }));
      res.json(out);
    } catch (e) { fail(res, 502, `TN district list failed: ${e.message}`); }
  });

  // =====================================================================================
  //  Directory — every candidate & PAC, stored locally
  // =====================================================================================
  app.get("/api/tn/directory", (req, res) => {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const out = tnEntitySearch({
      q: qstr(req.query.q), kind: qstr(req.query.kind), office: qstr(req.query.office), district: qstr(req.query.district),
      party: qstr(req.query.party), year: qstr(req.query.year), city: qstr(req.query.city), zip: qstr(req.query.zip),
      winner: qstr(req.query.winner), openOnly: req.query.open === "1", limit, offset,
    });
    res.json({ ...out, limit, offset, stats: tnEntityStats() });
  });
  app.get("/api/tn/directory/facets", (_req, res) => res.json({ ...tnEntityFacets(), stats: tnEntityStats() }));

  // ---- directory sync job: one full-column TREF search per election year (+ one for all PACs) ----
  const sync = { running: false, startedAt: null, finishedAt: null, done: 0, total: 0, current: "", added: 0, errors: [], log: [] };
  const labelYear = (label) => Number(String(label).slice(0, 4)) || 0;
  async function runSync({ scope = "current", force = false }) {
    const meta = cacheGet("tn:meta:v1");
    const years = (meta?.years?.length ? meta.years : TN_YEARS).filter((y) => !/\((aaa|bbb)\)/i.test(y.label));
    const nowY = new Date().getFullYear();
    const picked = years.filter((y) => scope === "all" || labelYear(y.label) >= nowY - 1);
    const jobs = [{ scope: "pacs", label: "All registered PACs", args: { type: "pac" } },
      ...picked.map((y) => ({ scope: `year:${y.id}`, label: `Election ${y.label}`, year: labelYear(y.label), args: { type: "both", yearId: y.id } }))];
    Object.assign(sync, { running: true, startedAt: Date.now(), finishedAt: null, done: 0, total: jobs.length, current: "", added: 0, errors: [], log: [] });
    let consecutiveFails = 0;
    for (const job of jobs) {
      sync.current = job.label;
      try {
        // Elections that are over don't change: once synced, skip them unless forced. Open cycles
        // and the PAC roster are re-read when older than a day.
        const prev = tnSyncGet(job.scope);
        const closed = job.year && job.year < nowY - 1;
        if (!force && prev && (closed || Date.now() - prev.syncedAt < DAY)) {
          sync.log.push(`${job.label}: up to date (${prev.count})`);
        } else {
          const data = await searchCandidatesPacs({ ...job.args, full: true });
          const n = tnEntityUpsertMany(data.entities || []);
          tnSyncMark(job.scope, job.label, data.count || 0);
          sync.added += n;
          const missing = (data.count || 0) - n;
          sync.log.push(`${job.label}: ${n} stored${missing > 0 ? ` (${missing} rows had no id)` : ""}`);
        }
        consecutiveFails = 0;
      } catch (e) {
        sync.errors.push(`${job.label}: ${e.message}`);
        // three straight failures = TREF is down or blocking; stop instead of hammering it
        if (++consecutiveFails >= 3) { sync.log.push("Stopped: TREF failed three times in a row."); break; }
      }
      sync.done++;
    }
    Object.assign(sync, { running: false, finishedAt: Date.now(), current: "" });
  }
  app.get("/api/tn/directory/sync", (_req, res) => res.json({ ...sync, log: sync.log.slice(-60), stats: tnEntityStats() }));
  app.post("/api/tn/directory/sync", (req, res) => {
    if (sync.running) return res.json({ ...sync, alreadyRunning: true });
    const scope = req.body?.scope === "all" ? "all" : "current";
    runSync({ scope, force: Boolean(req.body?.force) }).catch((e) => { sync.running = false; sync.errors.push(e.message); });
    res.json({ started: true, scope });
  });

  // =====================================================================================
  //  Full contributions / expenditures search
  // =====================================================================================
  const moneyCol = (headers, re) => headers.findIndex((h) => re.test(h));
  const parseAmt = (raw) => {
    const s = String(raw || "");
    let n = Number(s.replace(/[^0-9.-]/g, "")) || 0;
    if (/\(.*\)/.test(s)) n = -Math.abs(n);
    return n;
  };
  const topBy = (rows, idx, amtIdx, n = 15) => {
    if (idx < 0 || amtIdx < 0) return [];
    const m = new Map();
    for (const r of rows) {
      const k = String(r[idx] || "").trim();
      if (!k) continue;
      const g = m.get(k.toUpperCase()) || { name: k, total: 0, count: 0 };
      g.total += parseAmt(r[amtIdx]); g.count++;
      m.set(k.toUpperCase(), g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, n).map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }));
  };

  app.get("/api/tn/explore/money", async (req, res) => {
    const g = (k) => qstr(req.query[k]).trim();
    const kind = g("kind") === "expenditures" ? "expenditures" : "contributions";
    const nowY = new Date().getFullYear();
    const years = [...new Set(g("years").split(",").map((y) => y.trim()).filter((y) => /^(19|20)\d{2}$/.test(y)))].slice(0, 8);
    if (!years.length) years.push(String(nowY));
    const contains = req.query.contains !== "0";
    const wild = (v) => (v && contains && !v.includes("%") ? `%${v}` : v);
    const text = {
      recipientName: wild(g("recipient")), contributorName: wild(g("contributor")),
      employer: wild(g("employer")), occupation: wild(g("occupation")), zipCode: g("zip"),
      candName: wild(g("by")), vendorName: wild(g("vendor")), vendorZipCode: g("vendorZip"), purpose: wild(g("purpose")),
    };
    const amount = g("amount"), amountOp = g("amountOp") || "greater", typeOf = g("typeOf") || "all";
    const hasFilter = Object.values(text).some(Boolean) || (amount !== "" && Number(amount) > 0) || typeOf === "independent" || typeOf === "inkind";
    if (!hasFilter) {
      return fail(res, 400, "Add at least one filter (a name, employer, occupation, ZIP, vendor, purpose, an amount, or a type) — a year on its own would return every transaction in the state.");
    }
    if (amount !== "" && !Number.isFinite(Number(amount))) return fail(res, 400, "Amount must be a number.");
    const off = (k) => req.query[k] === "0";
    const args = {
      searchType: kind, ...text, typeOf, amountOp, amount,
      electionYearId: /^\d{1,4}$/.test(g("electionYear")) ? g("electionYear") : "",
      toType: g("toType") || "both",
      reportTypes: g("reportTypes").split(",").filter((x) => /^\d{1,2}$/.test(x)),
      from: { candidate: !off("fromCandidate"), pac: !off("fromPac"), individual: !off("fromIndividual"), organization: !off("fromOrg") },
      to: { candidate: !off("toCandidate"), pac: !off("toPac"), other: !off("toOther") },
    };
    let headers = [];
    const rows = [], perYear = [], errors = [];
    for (const ry of years) {
      try {
        const r = await moneySearchAll({ ...args, reportYear: ry });
        if (!headers.length && r.headers?.length) headers = r.headers;
        const amtIdx = moneyCol(r.headers || [], /^amount$/i);
        const yrRows = r.rows || [];
        perYear.push({ year: ry, count: r.count || yrRows.length, total: Math.round(yrRows.reduce((a, x) => a + parseAmt(x[amtIdx]), 0)), note: r.note || undefined,
          truncated: Boolean(r.truncated), split: Boolean(r.split) });
        rows.push(...yrRows);
      } catch (e) { errors.push(`${ry}: ${e.message}`); perYear.push({ year: ry, count: 0, total: 0, error: e.message }); }
    }
    if (!rows.length && errors.length === years.length) return fail(res, 502, `TN money search failed — ${errors[0]}`);
    const amtIdx = moneyCol(headers, /^amount$/i);
    const total = rows.reduce((a, x) => a + parseAmt(x[amtIdx]), 0);
    if (amtIdx >= 0) rows.sort((a, b) => parseAmt(b[amtIdx]) - parseAmt(a[amtIdx]));
    const CAP = 2000;
    const isExp = kind === "expenditures";
    res.json({
      source: "tn-tref", kind, years, headers,
      rows: rows.slice(0, CAP), count: rows.length, capped: rows.length > CAP,
      totalAmount: Math.round(total * 100) / 100, perYear,
      top: isExp
        ? { spenders: topBy(rows, moneyCol(headers, /candidate\/pac name/i), amtIdx), vendors: topBy(rows, moneyCol(headers, /^vendor name$/i), amtIdx), purposes: topBy(rows, moneyCol(headers, /^purpose$/i), amtIdx) }
        : { contributors: topBy(rows, moneyCol(headers, /^contributor name$/i), amtIdx), recipients: topBy(rows, moneyCol(headers, /^recipient name$/i), amtIdx), employers: topBy(rows, moneyCol(headers, /contributor employer/i), amtIdx) },
      ...(perYear.some((y) => y.truncated) ? { truncated: true } : {}),
      ...(errors.length ? { note: `Some years failed: ${errors.join("; ")}` } : {}),
    });
  });

  // =====================================================================================
  //  Filings search
  // =====================================================================================
  app.get("/api/tn/explore/reports", async (req, res) => {
    const g = (k) => qstr(req.query[k]).trim();
    const reportYear = g("reportYear") || String(new Date().getFullYear());
    if (!/^(19|20)\d{2}$/.test(reportYear)) return fail(res, 400, "reportYear (YYYY) is required.");
    const reportTypes = g("reportTypes").split(",").filter((x) => /^\d{1,2}$/.test(x));
    const nameRaw = g("name");
    const args = {
      name: nameRaw && !nameRaw.includes("%") && req.query.contains !== "0" ? `%${nameRaw}` : nameRaw,
      forAll: g("for") || "both", officeId: g("office"), districtId: g("district"),
      yearId: g("electionYear"), partyId: g("party"), reportYear, reportTypes,
    };
    if (!args.name && !args.officeId && !args.partyId && !reportTypes.length && !args.yearId) {
      return fail(res, 400, "Narrow the filings search with a name, office, party, election year or report type.");
    }
    const closed = Number(reportYear) < new Date().getFullYear() - 1;
    const ck = `tn:repsearch:v1:${JSON.stringify(args).toLowerCase()}`;
    try {
      const out = await cached(ck, (v) => (closed ? 30 * DAY : v.count ? TTL.tn : 5 * 60_000), () => searchReports(args), { force: wantsRefresh() && !closed });
      res.json({ ...out, reportYear });
    } catch (e) { fail(res, 502, `TN filings search failed: ${e.message}`); }
  });

  // =====================================================================================
  //  Federal campaign money — every Tennessee federal race in one call
  // =====================================================================================
  app.get("/api/tn/federal/races", async (req, res) => {
    const nowY = new Date().getFullYear();
    const cycle = /^(19|20)\d{2}$/.test(qstr(req.query.cycle)) ? qstr(req.query.cycle) : String(nowY % 2 ? nowY + 1 : nowY);
    try {
      const all = [];
      for (let page = 1; page <= 4; page++) {
        const d = await fecFetch("candidates/totals/", { state: "TN", cycle, election_full: "true", per_page: "100", page: String(page), sort: "-receipts" });
        all.push(...(d.results || []));
        if (page >= (d.pagination?.pages || 1)) break;
      }
      const num = (v) => Number(v) || 0;
      const cands = all.filter((c) => ["H", "S"].includes(c.office)).map((c) => ({
        id: c.candidate_id, name: c.name, party: c.party_full || c.party || "", office: c.office,
        district: c.office === "H" ? String(c.district || "").padStart(2, "0") : "",
        incumbent: c.incumbent_challenge_full || "", active: !c.candidate_inactive,
        receipts: num(c.receipts), disbursements: num(c.disbursements), cash: num(c.cash_on_hand_end_period),
        debts: num(c.debts_owed_by_committee), individual: num(c.individual_itemized_contributions) + num(c.individual_unitemized_contributions),
        pac: num(c.other_political_committee_contributions), self: num(c.candidate_contribution) + num(c.loans_made_by_candidate || 0),
        coverageEnd: c.coverage_end_date || null, electionYear: c.election_year || c.candidate_election_year || null,
      }));
      const races = new Map();
      for (const c of cands) {
        const key = c.office === "S" ? "S" : `H-${c.district}`;
        const r = races.get(key) || { key, office: c.office, district: c.district, label: c.office === "S" ? "U.S. Senate" : `TN-${c.district}`, receipts: 0, candidates: [] };
        r.receipts += c.receipts; r.candidates.push(c);
        races.set(key, r);
      }
      const list = [...races.values()].map((r) => ({ ...r, receipts: Math.round(r.receipts), candidates: r.candidates.sort((a, b) => b.receipts - a.receipts) }))
        .sort((a, b) => (a.office === b.office ? a.district.localeCompare(b.district) : a.office === "S" ? -1 : 1));
      res.json({ source: "fec", cycle, races: list, candidateCount: cands.length,
        totals: { receipts: Math.round(cands.reduce((a, c) => a + c.receipts, 0)), cash: Math.round(cands.reduce((a, c) => a + c.cash, 0)) } });
    } catch (e) { fail(res, 502, `FEC Tennessee totals failed: ${e.message}`); }
  });

  // =====================================================================================
  //  Federal dollars into Tennessee — USAspending.gov (contracts, grants, loans, direct payments)
  // =====================================================================================
  // Shared filter builder. place = where the work is performed (not where the recipient is based).
  function usaFilters(req) {
    const fy = /^20\d{2}$/.test(qstr(req.query.fy)) ? Number(req.query.fy) : currentFY();
    const county = /^\d{3}$/.test(qstr(req.query.county)) && TN_COUNTIES[req.query.county] ? req.query.county : "";
    const district = /^\d{1,2}$/.test(qstr(req.query.district)) ? String(req.query.district).padStart(2, "0") : "";
    const group = AWARD_GROUPS[qstr(req.query.group)] ? qstr(req.query.group) : "";
    const q = qstr(req.query.q).trim().slice(0, 100);
    const loc = { country: "USA", state: "TN" };
    if (county) loc.county = county; else if (district) loc.district_current = district;
    const filters = { time_period: [{ start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` }], place_of_performance_locations: [loc] };
    if (group) filters.award_type_codes = AWARD_GROUPS[group];
    if (q.length >= 3) filters.recipient_search_text = [q];
    const kw = qstr(req.query.keyword).trim().slice(0, 100);
    if (kw.length >= 3) filters.keywords = [kw];
    const ttl = fy < currentFY() - 1 ? 30 * DAY : DAY;
    const sig = JSON.stringify({ fy, county, district, group, q, kw });
    return { fy, county, district, group, filters, ttl, sig };
  }

  // Map layer: totals per county or per congressional district.
  app.get("/api/tn/federal/spending/geo", async (req, res) => {
    const f = usaFilters(req);
    const layer = req.query.layer === "district" ? "district" : "county";
    try {
      const out = await cached(`usa:geo:v1:${layer}:${f.sig}`, f.ttl, async () => {
        const d = await usa("search/spending_by_geography/", { scope: "place_of_performance", geo_layer: layer, filters: { ...f.filters, place_of_performance_locations: [{ country: "USA", state: "TN" }] } });
        const results = (d.results || []).filter((r) => String(r.shape_code || "").startsWith("47"))
          .map((r) => ({ code: layer === "county" ? String(r.shape_code).slice(2) : String(r.shape_code).slice(2), name: r.display_name, amount: Number(r.aggregated_amount) || 0, population: r.population ?? null, perCapita: r.per_capita ?? null }))
          .sort((a, b) => b.amount - a.amount);
        return { source: "usaspending", layer, fy: f.fy, results, total: results.reduce((a, r) => a + r.amount, 0) };
      }, { force: wantsRefresh() });
      res.json(out);
    } catch (e) { fail(res, 502, `USAspending lookup failed: ${e.message}`); }
  });

  // Breakdown: who receives it, which agencies send it, which programs, and counts by award type.
  app.get("/api/tn/federal/spending/summary", async (req, res) => {
    const f = usaFilters(req);
    try {
      const out = await cached(`usa:sum:v2:${f.sig}`, (v) => (v.partial ? 5 * 60_000 : f.ttl), async () => {
        // One call at a time: four parallel searches intermittently had one rejected upstream.
        let partial = false;
        const cat = async (name) => {
          try {
            const d = await usa(`search/spending_by_category/${name}/`, { filters: f.filters, limit: 25, page: 1 });
            return (d.results || []).map((r) => ({ name: r.name, code: r.code || null, id: r.recipient_id || r.id || null, amount: Number(r.amount) || 0 }));
          } catch { partial = true; return []; }
        };
        const recipients = await cat("recipient");
        const agencies = await cat("awarding_agency");
        const programs = await cat("cfda");
        let counts = null;
        try { counts = (await usa("search/spending_by_award_count/", { filters: f.filters })).results || null; } catch { partial = true; }
        return { source: "usaspending", fy: f.fy, county: f.county, countyName: TN_COUNTIES[f.county] || null, district: f.district, group: f.group,
          recipients, agencies, programs, counts, ...(partial ? { partial: true, note: "USAspending did not answer every part of this breakdown — refresh to retry." } : {}) };
      }, { force: wantsRefresh() });
      res.json(out);
    } catch (e) { fail(res, 502, `USAspending lookup failed: ${e.message}`); }
  });

  // Individual awards, largest first.
  app.get("/api/tn/federal/spending/awards", async (req, res) => {
    const f = usaFilters(req);
    const group = f.group || "grants";
    const page = Math.min(50, Math.max(1, parseInt(req.query.page, 10) || 1));
    const loans = group === "loans";
    const fields = loans
      ? ["Award ID", "Recipient Name", "Loan Value", "Subsidy Cost", "Awarding Agency", "Awarding Sub Agency", "Issued Date", "Description", "generated_internal_id"]
      : ["Award ID", "Recipient Name", "Award Amount", "Awarding Agency", "Awarding Sub Agency", "Start Date", "End Date", "Description", "Award Type", "generated_internal_id"];
    try {
      const out = await cached(`usa:awards:v1:${group}:${page}:${f.sig}`, f.ttl, async () => {
        const d = await usa("search/spending_by_award/", {
          filters: { ...f.filters, award_type_codes: AWARD_GROUPS[group] }, fields,
          sort: loans ? "Loan Value" : "Award Amount", order: "desc", limit: 50, page,
        });
        const awards = (d.results || []).map((a) => ({
          id: a["Award ID"], recipient: a["Recipient Name"], amount: Number(a[loans ? "Loan Value" : "Award Amount"]) || 0,
          agency: a["Awarding Agency"], subAgency: a["Awarding Sub Agency"] || "",
          start: a["Start Date"] || a["Issued Date"] || null, end: a["End Date"] || null,
          description: String(a.Description || "").slice(0, 400), type: a["Award Type"] || (loans ? "Loan" : ""),
          url: a.generated_internal_id ? `https://www.usaspending.gov/award/${encodeURIComponent(a.generated_internal_id)}` : null,
        }));
        return { source: "usaspending", fy: f.fy, group, page, hasNext: Boolean(d.page_metadata?.hasNext), county: f.county, countyName: TN_COUNTIES[f.county] || null, district: f.district, awards };
      }, { force: wantsRefresh() });
      res.json(out);
    } catch (e) { fail(res, 502, `USAspending lookup failed: ${e.message}`); }
  });
  return { runSync, syncState: sync };
}
