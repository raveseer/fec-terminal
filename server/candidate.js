// Candidate workspace — everything about one Tennessee candidate, across both systems:
//   /api/tn/candidate/find        which federal committees and state accounts belong to a name
//   /api/tn/candidate/pull        background pull of a committee's itemized receipts from the FEC API
//   /api/tn/candidate/donors      merged donor list (FEC ledger + TREF filed reports), identities merged
//   /api/tn/candidate/geo         where the money comes from: state, Tennessee county, ZIP, city
//   /api/tn/candidate/employers   donors' employers joined to federal awards performed in Tennessee
//   /api/tn/candidate/spending    where the money goes (state vendors, federal payees) + outside spending
//   /api/tn/place                 the reverse view: who gives from a ZIP / county / city, and to whom
//   /api/tn/ie                    state-level independent expenditures by race
// Registered from index.js, which hands in the shared gateways.

import { searchCandidatesPacs } from "./tn.js";
import { cached, usa, currentFY, TN_COUNTIES } from "./tnx.js";
import { mergeDonorGroups, parseDonorName } from "./identity.js";
import { probeGet, probeSet, settingGet, settingSet,
         contribRecipientDonorGroups, contribRecipientRowCount, contribExistingCount, contribPlace,
         fecCommitteeGet, fecCommitteeByName, tnEntityUpsertMany, tnEntitySearch } from "./db.js";

const DAY = 86_400_000;
const qstr = (v, d = "") => (typeof v === "string" ? v : d);
const CONDUIT_RE = /^(WINRED|ACTBLUE|ACT BLUE|WINRED TECHNICAL|DEMOCRACY ENGINE|ANEDOT)\b/;
const CUR_CYCLE = (() => { const y = new Date().getFullYear(); return y % 2 ? y + 1 : y; })();
const tokensOf = (q) => String(q || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
const hasAll = (name, toks) => { const n = String(name || "").toUpperCase(); return toks.every((t) => n.includes(t)); };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GENERIC_EMPLOYER = /^(\(BLANK\)|SELF-EMPLOYED|NOT EMPLOYED|RETIRED|HOMEMAKER|STUDENT|NONE|N A|NA|INFORMATION REQUESTED.*|REQUESTED|UNKNOWN|ENTREPRENEUR|SELF|DISABLED)$/;

export function registerCandidate(app, { fecFetch, moneySearchAll, wantsRefresh, TTL, normalizeDonorKey, normDate, ingestScheduleA,
  tnLedgerData, parseTnContributor, normalizeEmployerName, lobbyIndex }) {
  const fail = (res, code, message) => res.status(code).json({ error: { message } });

  // =====================================================================================
  //  Find: accounts behind a name
  // =====================================================================================
  const ROLE = { P: "principal", A: "authorized", J: "joint fundraising", D: "leadership PAC" };
  async function affiliatedCommittees(cand) {
    const out = new Map();
    const add = (id, name, role, cycles) => { if (id && !out.has(id)) out.set(id, { id, name, role, cycles: (cycles || []).map(String) }); };
    for (const pc of cand.principal_committees || []) add(pc.committee_id, pc.name, "principal", pc.cycles);
    try { // every committee the FEC links to the candidacy: authorized + joint fundraising
      const d = await fecFetch(`candidate/${cand.candidate_id}/committees/`, { per_page: "50" });
      for (const c of d.results || []) add(c.committee_id, c.name, ROLE[c.designation] || c.designation_full || "linked", c.cycles);
    } catch { /* principal committees still listed */ }
    try { // leadership PACs sponsored by the candidate
      const d = await fecFetch("committees/", { sponsor_candidate_id: cand.candidate_id, per_page: "20" });
      for (const c of d.results || []) add(c.committee_id, c.name, "leadership PAC", c.cycles);
    } catch { /* optional */ }
    // Joint fundraising committees are often NOT linked to the candidate record (they list several
    // candidates). Catch them from the money: committees that transferred into the principal
    // committee and are named for the candidate or as a victory fund.
    const pccs = [...out.values()].filter((c) => c.role === "principal").map((c) => c.id);
    const surname = String(cand.name || "").split(",")[0].trim().toUpperCase();
    if (pccs.length && surname) {
      for (const g of contribRecipientDonorGroups(pccs, { limit: 400 })) {
        const nm = String(g.name || "").toUpperCase();
        if (!/^(PAC|CCM|COM|PTY|ORG)$/i.test(g.entityType || "")) continue;
        if (!(nm.includes(surname) || /VICTORY|JOINT FUND/.test(nm))) continue;
        const c = fecCommitteeByName(g.name);
        if (c && (c.designation === "J" || nm.includes(surname))) add(c.cmteId, c.name, c.designation === "J" ? "joint fundraising, transfers in" : "transfers in", []);
      }
    }
    return [...out.values()];
  }

  app.get("/api/tn/candidate/find", async (req, res) => {
    const q = qstr(req.query.q).trim();
    const toks = tokensOf(q);
    if (!toks.length) return fail(res, 400, "Type a candidate's name (at least two letters).");
    const out = { q, federal: [], state: [], notes: [] };
    try {
      const seen = new Map();
      // the FEC matches whole words; try the phrase, then each word (surname last = most likely), keep rows containing every word
      for (const term of [q, ...[...toks].reverse()]) {
        const d = await fecFetch("candidates/search/", { q: term, state: "TN", per_page: "50" });
        for (const c of d.results || []) if (hasAll(c.name, toks) && !seen.has(c.candidate_id)) seen.set(c.candidate_id, c);
        if (seen.size) break;
      }
      const raw = [...seen.values()].sort((a, b) => (Number(b.candidate_status === "C") - Number(a.candidate_status === "C"))
        || String(Math.max(0, ...(b.cycles || []))).localeCompare(String(Math.max(0, ...(a.cycles || [])))));
      const claimed = new Set(); // a committee reused across candidacies (House → Senate) is listed once
      for (const c of raw.slice(0, 6)) {
        const committees = (await affiliatedCommittees(c)).filter((pc) => !claimed.has(pc.id) && claimed.add(pc.id));
        out.federal.push({
          candId: c.candidate_id, name: c.name, party: c.party_full || c.party || "", office: c.office,
          district: c.office === "H" ? String(c.district || "").padStart(2, "0") : "",
          cycles: (c.cycles || []).map(String).sort().reverse(), incumbent: c.incumbent_challenge_full || "",
          active: c.candidate_status === "C", committees,
        });
      }
    } catch (e) { out.notes.push(`Federal lookup failed: ${e.message}`); }

    let rows = tnEntitySearch({ q: toks.join(" "), limit: 200 }).rows.filter((r) => hasAll(r.name, toks));
    if (!rows.length) {
      try { // TREF indexes candidates by last name; search the longest word first
        for (const term of [...toks].sort((a, b) => b.length - a.length).slice(0, 2)) {
          const data = await cached(`tn:candfind:v1:${term}`, (v) => (v.count ? TTL.tn : 5 * 60_000), () => searchCandidatesPacs({ name: `%${term}`, type: "both", full: true }));
          if (data.entities?.length) tnEntityUpsertMany(data.entities);
          rows = (data.entities || []).filter((r) => hasAll(r.name, toks));
          if (rows.length) break;
        }
      } catch (e) { out.notes.push(`State lookup failed: ${e.message}`); }
    }
    const byId = new Map();
    for (const r of rows) {
      const g = byId.get(r.tnId) || { tnId: r.tnId, name: r.name, kind: r.kind, party: r.party || "", office: r.office || "", district: r.district || "", years: [] };
      if (r.year && !g.years.includes(r.year)) g.years.push(r.year);
      byId.set(r.tnId, g);
    }
    out.state = [...byId.values()].map((g) => ({ ...g, years: g.years.sort().reverse() })).sort((a, b) => (b.years[0] || "").localeCompare(a.years[0] || ""));
    res.json(out);
  });

  // =====================================================================================
  //  Background pull of a committee's itemized receipts (FEC API, 100 rows per call)
  // =====================================================================================
  // Used when the bulk file hasn't been loaded. Largest-first, stored permanently, resumable.
  const pull = { running: false, startedAt: null, finishedAt: null, items: [], current: null, status: "", errors: [] };
  const pullKey = (cmte, cycle) => `fec:pullall:${cmte}:${cycle}`;
  const pullState = (cmte, cycle) => probeGet(pullKey(cmte, cycle))?.payload || null;
  const cursorOf = (d) => (d.pagination?.last_indexes ? Object.fromEntries(Object.entries(d.pagination.last_indexes).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) : null);
  async function fecPage(params) {
    for (let attempt = 0; ; attempt++) {
      try { return await fecFetch("schedules/schedule_a/", params); }
      catch (e) {
        const limited = /rate limit|429|OVER_RATE/i.test(e.message);
        if (limited && attempt < 40) { pull.status = "Waiting for the FEC rate limit to reset…"; await sleep(65_000); pull.status = ""; continue; }
        if (!limited && attempt < 2) { await sleep(2000); continue; }
        throw e;
      }
    }
  }
  async function pullCommitteeCycle(item, cap) {
    const { committee, cycle } = item;
    const closed = Number(cycle) < CUR_CYCLE;
    const prev = pullState(committee, cycle);
    const save = (st) => probeSet(pullKey(committee, cycle), String(st.available ?? ""), { ...st, at: Date.now() });
    const base = { committee_id: committee, two_year_transaction_period: String(cycle), per_page: "100" };
    if (prev?.complete) {
      if (closed || Date.now() - (prev.at || 0) < DAY) { Object.assign(item, { pulled: prev.pulled, available: prev.available, complete: true, skipped: true }); return; }
      // open cycle, complete once already: only what was filed since — newest first, stop at the first page with nothing new
      let cursor = null, added = 0, available = prev.available;
      for (let page = 0; page < 400; page++) {
        const d = await fecPage({ ...base, sort: "-contribution_receipt_date", ...(cursor || {}) });
        const results = d.results || [];
        available = d.pagination?.count ?? available;
        const known = contribExistingCount("fec", results.map((r) => r.sub_id));
        ingestScheduleA(results);
        added += results.length - known;
        Object.assign(item, { pulled: (prev.pulled || 0) + added, available });
        cursor = cursorOf(d);
        if (!cursor || results.length < 100 || known === results.length) break;
        await sleep(250);
      }
      save({ available, pulled: (prev.pulled || 0) + added, complete: true, cursor: null });
      item.complete = true;
      return;
    }
    let cursor = prev?.cursor || null, pulled = cursor ? prev.pulled || 0 : 0, available = prev?.available ?? null, complete = false, pages = 0;
    while (true) {
      const d = await fecPage({ ...base, sort: "-contribution_receipt_amount", ...(cursor || {}) });
      const results = d.results || [];
      ingestScheduleA(results);
      available = d.pagination?.count ?? available;
      pulled += results.length;
      Object.assign(item, { pulled, available });
      cursor = cursorOf(d);
      if (!cursor || results.length < 100) { complete = true; break; }
      if (pulled >= cap) break;
      if (++pages === 1 || pages % 10 === 0) save({ available, pulled, complete: false, cursor });
      await sleep(250);
    }
    save({ available, pulled, complete, cursor: complete ? null : cursor });
    item.complete = complete;
  }
  async function runPull(pairs, cap) {
    Object.assign(pull, { running: true, startedAt: Date.now(), finishedAt: null, errors: [], status: "", current: null,
      items: pairs.map((p) => ({ ...p, pulled: 0, available: null, complete: false, done: false })) });
    for (const item of pull.items) {
      pull.current = `${item.committee} · ${item.cycle}`;
      try { await pullCommitteeCycle(item, cap); }
      catch (e) { item.error = e.message; pull.errors.push(`${item.committee} ${item.cycle}: ${e.message}`); }
      item.done = true;
    }
    Object.assign(pull, { running: false, finishedAt: Date.now(), current: null, status: "" });
  }
  const cleanCommittees = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x).toUpperCase()).filter((x) => /^C\d{5,9}$/.test(x)))].slice(0, 12);
  const cleanCycles = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x) => /^(19|20)\d{2}$/.test(x) && Number(x) % 2 === 0))].slice(0, 10);
  const cleanState = (v) => (Array.isArray(v) ? v : []).slice(0, 6)
    .map((s) => ({ tnId: String(s?.tnId || ""), name: String(s?.name || "").trim().slice(0, 120) })).filter((s) => /^\d{1,12}$/.test(s.tnId));

  // Is this committee+period fully covered by a bulk individual-contributions load?
  const bulkCover = (committee, cycle) => {
    try {
      const meta = JSON.parse(settingGet(`bulkIndiv:${cycle}`) || "null");
      if (!meta) return null;
      const list = JSON.parse(settingGet(`bulkIndivCmtes:${cycle}`) || "[]");
      return list.includes(committee) ? meta : null;
    } catch { return null; }
  };

  app.get("/api/tn/candidate/pull", (_req, res) => res.json(pull));
  app.post("/api/tn/candidate/pull", (req, res) => {
    if (pull.running) return res.json({ ...pull, alreadyRunning: true });
    const committees = cleanCommittees(req.body?.committees), cycles = cleanCycles(req.body?.cycles);
    if (!committees.length || !cycles.length) return fail(res, 400, "Pick at least one federal committee and one cycle.");
    const cap = req.body?.full ? 500_000 : Math.min(20_000, Math.max(500, Number(req.body?.cap) || 3000));
    // the automatic first-look pull is skipped where the bulk file already covers the committee; an explicit "pull the rest" still runs
    const pairs = committees.flatMap((committee) => cycles.map((cycle) => ({ committee, cycle }))).filter((p) => req.body?.full || !bulkCover(p.committee, p.cycle));
    if (!pairs.length) return res.json({ started: false, reason: "Covered by the bulk file." });
    runPull(pairs, cap).catch((e) => { pull.running = false; pull.errors.push(e.message); });
    res.json({ started: true, pairs: pairs.length, cap });
  });

  // =====================================================================================
  //  The merged donor set (shared by donors / geo / employers)
  // =====================================================================================
  // Federal side reads the stored ledger. State side reads the itemized contributor schedules of
  // the account's actual filed reports — NOT TREF's contribution search, which silently stops at
  // 500 rows per query (verified Nov 2026: 500 rows / $57K for an account whose reports itemize
  // 52,890 gifts / $13.7M). Records that are the same donor written differently are merged
  // (server/identity.js); transfers from committees that are themselves selected are dropped so
  // their money isn't counted twice.
  const builtCache = new Map(); // short-lived: the three views of one selection share one build
  async function buildDonors(body) {
    const committees = cleanCommittees(body?.committees), cycles = cleanCycles(body?.cycles), state = cleanState(body?.state);
    if (!committees.length && !state.length) throw Object.assign(new Error("Pick at least one federal committee or state account."), { status: 400 });
    const sig = JSON.stringify({ committees, cycles, state });
    const hit = builtCache.get(sig);
    if (hit && Date.now() - hit.at < 45_000 && !pull.running && !wantsRefresh()) return hit.value;

    const groups = [];
    const conduits = { total: 0, count: 0, names: [] };
    const selectedNames = new Set(committees.map((c) => parseDonorName(fecCommitteeGet(c)?.name || "").org).filter(Boolean));
    let transfersDropped = 0;

    const coverage = [];
    if (committees.length) {
      for (const g of contribRecipientDonorGroups(committees, { cycles })) {
        const upper = String(g.name || "").toUpperCase();
        if (CONDUIT_RE.test(upper)) { conduits.total += g.total; conduits.count += g.count; if (!conduits.names.includes(g.name)) conduits.names.push(g.name); continue; }
        if (selectedNames.size && !upper.includes(",") && selectedNames.has(parseDonorName(g.name).org)) { transfersDropped += Number(g.total) || 0; continue; }
        groups.push({ key: g.donorKey, name: g.name, city: g.city || "", st: g.state || "", zip: g.zip || "", employer: g.employer || "", occupation: g.occupation || "",
          type: g.entityType || "", federal: Number(g.total) || 0, stateAmt: 0, fedCount: Number(g.count) || 0, stateCount: 0, firstDate: g.firstDate || null, lastDate: g.lastDate || null });
      }
      for (const c of committees) for (const cy of (cycles.length ? cycles : [""])) {
        const st = cy ? pullState(c, cy) : null, bulk = cy ? bulkCover(c, cy) : null;
        coverage.push({ committee: c, name: fecCommitteeGet(c)?.name || c, cycle: cy, stored: contribRecipientRowCount(c, cy), available: st?.available ?? null,
          // "complete" = every line the committee itemized (API pull finished). The bulk file is
          // narrower by design: donors whose giving passed $200, without the small earmarked gifts
          // committees also itemize — so a bulk load is reported separately, not as complete.
          complete: Boolean(st?.complete), bulkAt: bulk?.at ?? null, asOf: st?.at ?? null });
      }
    }

    const stateAccounts = [];
    const stateSpending = [];
    for (const acct of state) {
      try {
        const led = await tnLedgerData(acct.tnId, acct.name, wantsRefresh(), 80);
        const byYear = new Map(), slots = new Map();
        for (const c of led.contribs || []) {
          const who = parseTnContributor(c);
          if (!who.name) continue;
          const amt = Number(c.amount) || 0;
          const k = normalizeDonorKey(who.name, who.state);
          let d = slots.get(k);
          if (!d) { d = { key: k, name: who.name, city: who.city, st: who.state, zip: who.zip, employer: "", occupation: "", type: /individual/i.test(c.type || "") ? "IND" : (c.type || ""),
            federal: 0, stateAmt: 0, fedCount: 0, stateCount: 0, firstDate: null, lastDate: null }; slots.set(k, d); }
          if (!d.occupation && who.occupation) d.occupation = who.occupation;
          if (!d.employer && who.employer) d.employer = who.employer;
          d.stateAmt += amt; d.stateCount++;
          const iso = normDate(c.date);
          if (iso) { if (!d.firstDate || iso < d.firstDate) d.firstDate = iso; if (!d.lastDate || iso > d.lastDate) d.lastDate = iso; }
          const y = byYear.get(c.year) || { year: c.year, count: 0, total: 0 };
          y.count++; y.total += amt; byYear.set(c.year, y);
        }
        groups.push(...slots.values());
        for (const e of led.expenditures || []) stateSpending.push({ account: acct.name, name: e.name, purpose: e.purpose || "", amount: Number(e.amount) || 0, date: normDate(e.date), type: e.type || "" });
        stateAccounts.push({ tnId: acct.tnId, name: acct.name || led.name, reportsRead: led.reportsRead, reportsTotal: led.reportsTotal, partial: Boolean(led.partial),
          itemized: led.totalReceived, reportedReceipts: led.reportedReceipts ?? null, spent: led.totalSpent ?? null, note: led.note,
          years: [...byYear.values()].map((y) => ({ ...y, total: Math.round(y.total) })).sort((a, b) => String(b.year).localeCompare(String(a.year))) });
      } catch (e) { stateAccounts.push({ tnId: acct.tnId, name: acct.name, error: e.message }); }
    }

    const before = groups.length;
    const merged = mergeDonorGroups(groups, {
      weight: (g) => g.federal + g.stateAmt,
      combine: (into, from) => {
        into.federal += from.federal; into.stateAmt += from.stateAmt; into.fedCount += from.fedCount; into.stateCount += from.stateCount;
        if (from.firstDate && (!into.firstDate || from.firstDate < into.firstDate)) into.firstDate = from.firstDate;
        if (from.lastDate && (!into.lastDate || from.lastDate > into.lastDate)) into.lastDate = from.lastDate;
        for (const f of ["employer", "occupation", "city", "st", "zip", "type"]) if (!into[f] && from[f]) into[f] = from[f];
      },
    });
    const donors = merged.map((d) => ({ ...d, federal: round2(d.federal), stateAmt: round2(d.stateAmt), total: round2(d.federal + d.stateAmt), count: d.fedCount + d.stateCount }))
      .sort((a, b) => b.total - a.total);
    const value = {
      donors, coverage, stateAccounts, stateSpending, committees, cycles,
      conduits: { ...conduits, total: Math.round(conduits.total) }, transfersDropped: Math.round(transfersDropped), mergedRecords: before - donors.length,
      totals: { donors: donors.length, federal: Math.round(donors.reduce((a, d) => a + d.federal, 0)), state: Math.round(donors.reduce((a, d) => a + d.stateAmt, 0)),
        both: donors.filter((d) => d.federal && d.stateAmt).length, gifts: donors.reduce((a, d) => a + d.count, 0) },
    };
    builtCache.set(sig, { at: Date.now(), value });
    if (builtCache.size > 4) builtCache.delete(builtCache.keys().next().value);
    return value;
  }
  const guard = (fn) => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { fail(res, e.status || 502, e.message); }
  };

  app.post("/api/tn/candidate/donors", guard(async (req, res) => {
    const b = await buildDonors(req.body);
    const { stateSpending, ...rest } = b; // spending has its own endpoint
    res.json({ ...rest, pull: { running: pull.running } });
  }));

  // =====================================================================================
  //  Geography
  // =====================================================================================
  // ZIP → Tennessee county, from the Census 2020 ZCTA-to-county relationship file (fetched once,
  // kept in settings). A ZIP that straddles counties goes to the county holding most of its land.
  let zipCountyMem = null;
  async function zipCounty() {
    if (zipCountyMem) return zipCountyMem;
    try { const saved = JSON.parse(settingGet("tnZipCounty") || "null"); if (saved && Object.keys(saved).length > 300) return (zipCountyMem = saved); } catch { /* refetch */ }
    const r = await fetch("https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt", { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`Census ZIP-county file → HTTP ${r.status}`);
    const best = {};
    for (const line of (await r.text()).split(/\r?\n/)) {
      const c = line.split("|");
      const zip = c[1], county = c[9];
      if (!/^\d{5}$/.test(zip || "") || !/^47\d{3}$/.test(county || "")) continue;
      const land = Number(c[16]) || 0;
      if (!best[zip] || land > best[zip].land) best[zip] = { fips: county.slice(2), land };
    }
    const map = Object.fromEntries(Object.entries(best).map(([z, v]) => [z, v.fips]));
    if (Object.keys(map).length < 300) throw new Error("Census ZIP-county file parsed to too few Tennessee ZIPs — format may have changed.");
    settingSet("tnZipCounty", JSON.stringify(map));
    return (zipCountyMem = map);
  }

  app.post("/api/tn/candidate/geo", guard(async (req, res) => {
    const b = await buildDonors(req.body);
    let zc = {}, zcNote;
    try { zc = await zipCounty(); } catch (e) { zcNote = `County breakdown unavailable (${e.message}).`; }
    const add = (m, k, d, extra) => { if (!k) return; const g = m.get(k) || { name: k, total: 0, donors: 0, ...extra }; g.total += d.total; g.donors++; m.set(k, g); };
    const states = new Map(), counties = new Map(), zips = new Map(), cities = new Map();
    let inState = 0, outState = 0, unknown = 0, noZipTN = 0, orgs = 0;
    for (const d of b.donors) {
      // geography is about people: a committee's mailing address says nothing about where its money came from
      if (!(d.type ? /^IND/i.test(d.type) : d.name.includes(","))) { orgs += d.total; continue; }
      if (!d.st) { unknown += d.total; continue; }
      add(states, d.st, d);
      if (d.st === "TN") {
        inState += d.total;
        const fips = d.zip ? zc[d.zip] : null;
        if (fips) add(counties, `${TN_COUNTIES[fips] || fips} County`, d, { fips });
        else noZipTN += d.total;
        if (d.zip) add(zips, d.zip, d, { city: d.city, county: fips ? TN_COUNTIES[fips] : "" });
        if (d.city) add(cities, d.city.toUpperCase(), d);
      } else outState += d.total;
    }
    const top = (m, n) => [...m.values()].sort((x, y) => y.total - x.total).slice(0, n).map((g) => ({ ...g, total: Math.round(g.total) }));
    res.json({ inState: Math.round(inState), outState: Math.round(outState), unknown: Math.round(unknown), tnWithoutCounty: Math.round(noZipTN), orgs: Math.round(orgs),
      states: top(states, 60), counties: top(counties, 95), zips: top(zips, 40), cities: top(cities, 40), ...(zcNote ? { note: zcNote } : {}) });
  }));

  // =====================================================================================
  //  Employers × federal awards — who gives, and who gets
  // =====================================================================================
  // Index of organizations receiving federal awards performed in Tennessee for a fiscal year
  // (USAspending recipient totals, up to 3,000 largest), keyed by normalized name.
  async function tnRecipients(fy) {
    const ttl = fy < currentFY() - 1 ? 30 * DAY : 2 * DAY;
    return cached(`usa:tnrecips:v1:${fy}`, ttl, async () => {
      const filters = { time_period: [{ start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` }], place_of_performance_locations: [{ country: "USA", state: "TN" }] };
      const list = [];
      for (let page = 1; page <= 30; page++) {
        const d = await usa("search/spending_by_category/recipient/", { filters, limit: 100, page });
        for (const r of d.results || []) if (r.name && !/^MULTIPLE RECIPIENTS$/i.test(r.name) && !/REDACTED/i.test(r.name)) list.push({ name: r.name, amount: Number(r.amount) || 0, id: r.recipient_id || null });
        if (!d.page_metadata?.hasNext) break;
      }
      return { fy, list };
    }, { force: wantsRefresh() });
  }
  app.post("/api/tn/candidate/employers", guard(async (req, res) => {
    const b = await buildDonors(req.body);
    const fy = /^20\d{2}$/.test(String(req.body?.fy || "")) ? Number(req.body.fy) : currentFY() - 1;
    // roll donors up by employer (people) or by the organization itself (PACs, businesses)
    const emp = new Map();
    for (const d of b.donors) {
      const person = d.type ? /^IND/i.test(d.type) : d.name.includes(",");
      const raw = person ? d.employer : d.name;
      const key = person ? normalizeEmployerName(raw) : normalizeEmployerName(parseDonorName(raw).org || raw).replace(/\s+(EMPLOYEES?|EMPLOYEE OWNERS|GOOD GOVERNMENT( FUND)?|FEDERAL)$/g, "").trim();
      if (!key || GENERIC_EMPLOYER.test(key)) continue;
      const g = emp.get(key) || { key, name: raw, people: 0, peopleTotal: 0, orgTotal: 0, donors: [] };
      if (person) { g.people++; g.peopleTotal += d.total; if (g.donors.length < 5) g.donors.push({ name: d.name, total: d.total, occupation: d.occupation }); }
      else g.orgTotal += d.total;
      emp.set(key, g);
    }
    let recips = { list: [] }, note;
    try { recips = await tnRecipients(fy); } catch (e) { note = `Federal award lookup failed (${e.message}) — employers are listed without awards.`; }
    // state lobbying cross-reference (Ethics Commission roster): employers that retain lobbyists, and
    // donors whose name matches a registered lobbyist
    let lobby = { employers: new Map(), people: new Map(), year: "" };
    try { lobby = await lobbyIndex(); } catch { /* optional */ }
    const exact = new Map(), all = [];
    for (const r of recips.list) { const k = normalizeEmployerName(r.name); if (!exact.has(k)) exact.set(k, r); all.push({ k, r }); }
    const substantial = (k) => k.length >= 10 || k.split(" ").length >= 2;
    const out = [];
    for (const g of emp.values()) {
      let award = exact.get(g.key) ? { ...exact.get(g.key), match: "exact" } : null;
      if (!award && substantial(g.key)) {
        const hit = all.find(({ k }) => (k.startsWith(`${g.key} `) || (substantial(k) && g.key.startsWith(`${k} `))));
        if (hit) award = { ...hit.r, match: "partial" };
      }
      const lob = lobby.employers.get(g.key);
      out.push({ employer: g.name, key: g.key, people: g.people, peopleTotal: round2(g.peopleTotal), orgTotal: round2(g.orgTotal), total: round2(g.peopleTotal + g.orgTotal),
        donors: g.donors.sort((x, y) => y.total - x.total), award: award ? { recipient: award.name, amount: Math.round(award.amount), match: award.match } : null,
        lobby: lob ? { id: lob.id, name: lob.name } : null });
    }
    const lobbyistDonors = [];
    for (const d of b.donors) {
      const p = parseDonorName(d.name);
      if (!p.person) continue;
      const hits = lobby.people.get(`${p.last}|${p.first}`);
      if (!hits) continue;
      // a shared name is weak evidence on its own; a lobbying occupation or the same city makes it strong
      const strong = /LOBBY|GOVERNMENT (RELATIONS|AFFAIRS)|PUBLIC AFFAIRS|GOVT/i.test(`${d.occupation} ${d.employer}`) || hits.some((h) => h.city && d.city && h.city.toUpperCase() === d.city.toUpperCase());
      lobbyistDonors.push({ name: d.name, city: d.city, st: d.st, employer: d.employer, occupation: d.occupation, total: d.total, federal: d.federal, stateAmt: d.stateAmt,
        lobbyistId: hits[0].id, lobbyistName: hits[0].name, confidence: strong ? "strong" : "name only" });
    }
    lobbyistDonors.sort((x, y) => (x.confidence === y.confidence ? y.total - x.total : x.confidence === "strong" ? -1 : 1));
    out.sort((x, y) => y.total - x.total);
    const withAward = out.filter((e) => e.award);
    res.json({ fy, employers: out.slice(0, 400), matched: withAward.sort((x, y) => y.award.amount - x.award.amount).slice(0, 200),
      totals: { employers: out.length, matched: withAward.length, givenByMatched: Math.round(withAward.reduce((a, e) => a + e.total, 0)), awardsToMatched: Math.round(withAward.reduce((a, e) => a + e.award.amount, 0)) },
      lobbying: { year: lobby.year, employers: out.filter((e) => e.lobby).slice(0, 150), lobbyists: lobbyistDonors.slice(0, 150),
        totals: { employers: out.filter((e) => e.lobby).length, employerGiving: Math.round(out.filter((e) => e.lobby).reduce((a, e) => a + e.total, 0)),
          lobbyists: lobbyistDonors.filter((l) => l.confidence === "strong").length, lobbyistGiving: Math.round(lobbyistDonors.filter((l) => l.confidence === "strong").reduce((a, l) => a + l.total, 0)) } },
      recipientsIndexed: recips.list.length, ...(note ? { note } : {}) });
  }));

  // =====================================================================================
  //  Spending + outside money
  // =====================================================================================
  app.post("/api/tn/candidate/spending", guard(async (req, res) => {
    const b = await buildDonors(req.body);
    const candIds = [...new Set((Array.isArray(req.body?.candIds) ? req.body.candIds : []).map(String).filter((x) => /^[HSP]\d[A-Z]{2}\d{5}$/.test(x)))].slice(0, 4);
    const roll = (rows, keyOf, n = 25) => {
      const m = new Map();
      for (const r of rows) { const k = String(keyOf(r) || "").trim().toUpperCase(); if (!k) continue; const g = m.get(k) || { name: keyOf(r), total: 0, count: 0 }; g.total += r.amount; g.count++; m.set(k, g); }
      return [...m.values()].sort((x, y) => y.total - x.total).slice(0, n).map((g) => ({ ...g, total: Math.round(g.total) }));
    };
    const out = { state: { total: Math.round(b.stateSpending.reduce((a, r) => a + r.amount, 0)), vendors: roll(b.stateSpending, (r) => r.name), purposes: roll(b.stateSpending, (r) => r.purpose, 15) },
      federal: { total: 0, payees: [], purposes: [], partial: false }, outside: [], notes: [] };
    // federal: the 100 largest disbursements per committee and period (one cached call each)
    const fedRows = [];
    for (const c of b.committees) for (const cy of b.cycles) {
      try {
        const d = await fecFetch("schedules/schedule_b/", { committee_id: c, two_year_transaction_period: cy, sort: "-disbursement_amount", per_page: "100" });
        for (const r of d.results || []) fedRows.push({ name: r.recipient_name, purpose: r.disbursement_description || r.disbursement_purpose_category || "", amount: Number(r.disbursement_amount) || 0 });
        if ((d.pagination?.count || 0) > 100) out.federal.partial = true;
      } catch (e) { out.notes.push(`Federal spending ${c} ${cy}: ${e.message}`); }
    }
    out.federal.total = Math.round(fedRows.reduce((a, r) => a + r.amount, 0));
    out.federal.payees = roll(fedRows, (r) => r.name);
    out.federal.purposes = roll(fedRows, (r) => r.purpose, 15);
    // outside spending for/against the federal candidacy (Schedule E)
    for (const id of candIds) for (const cy of b.cycles.slice(0, 3)) {
      try {
        const d = await fecFetch("schedules/schedule_e/by_candidate/", { candidate_id: id, cycle: cy, per_page: "100", election_full: "false" });
        for (const r of d.results || []) out.outside.push({ candId: id, cycle: cy, committee: r.committee_name, committeeId: r.committee_id, support: r.support_oppose_indicator === "S", total: Math.round(Number(r.total) || 0), count: r.count });
      } catch (e) { out.notes.push(`Outside spending ${id} ${cy}: ${e.message}`); }
    }
    out.outside.sort((x, y) => y.total - x.total);
    res.json(out);
  }));

  // =====================================================================================
  //  Place: who gives from here, and to whom
  // =====================================================================================
  app.get("/api/tn/place", guard(async (req, res) => {
    const zip = qstr(req.query.zip).trim(), county = qstr(req.query.county).trim(), city = qstr(req.query.city).trim();
    let zips = [], label = "";
    if (/^\d{5}$/.test(zip)) { zips = [zip]; label = `ZIP ${zip}`; }
    else if (/^\d{3}$/.test(county) && TN_COUNTIES[county]) {
      const zc = await zipCounty();
      zips = Object.entries(zc).filter(([, f]) => f === county).map(([z]) => z);
      label = `${TN_COUNTIES[county]} County`;
    } else if (city.length >= 2) label = `${city}, TN`;
    else return fail(res, 400, "Give a 5-digit ZIP, a Tennessee county, or a city.");
    const r = contribPlace({ zips, city: zips.length ? "" : city, state: "TN", limit: 100 });
    let countyOfZip = null;
    if (zips.length === 1) { try { const f = (await zipCounty())[zip]; countyOfZip = f ? { fips: f, name: TN_COUNTIES[f] } : null; } catch { /* optional */ } }
    res.json({ label, zips: zips.length, county: countyOfZip, ...r,
      note: "Covers gifts stored with a ZIP code: Tennessee state filings read through the Registry or Candidate donors, federal gifts loaded from the bulk individual file, and anything pulled from the FEC since ZIPs were added." });
  }));

  // =====================================================================================
  //  State independent expenditures, by race
  // =====================================================================================
  app.get("/api/tn/ie", guard(async (req, res) => {
    const year = /^(19|20)\d{2}$/.test(qstr(req.query.year)) ? qstr(req.query.year) : String(new Date().getFullYear());
    const r = await moneySearchAll({ searchType: "expenditures", typeOf: "independent", reportYear: year });
    const H = r.headers || [];
    const ix = (re) => H.findIndex((h) => re.test(h));
    const iAmt = ix(/^amount$/i), iBy = ix(/candidate\/pac name/i), iFor = ix(/^candidate for$/i), iSO = ix(/^s\/o$/i), iVen = ix(/^vendor name$/i), iPur = ix(/^purpose$/i), iDate = ix(/^date$/i);
    const amt = (v) => { const s = String(v || ""); let n = Number(s.replace(/[^0-9.-]/g, "")) || 0; if (/\(.*\)/.test(s)) n = -Math.abs(n); return n; };
    const races = new Map(), spenders = new Map();
    let total = 0;
    for (const row of r.rows || []) {
      const a = amt(row[iAmt]); total += a;
      const target = String(row[iFor] || "").trim() || "(no candidate named)";
      const so = /^o/i.test(String(row[iSO] || "")) ? "oppose" : "support";
      const g = races.get(target) || { candidate: target, support: 0, oppose: 0, count: 0, spenders: new Map(), items: [] };
      g[so] += a; g.count++;
      const by = String(row[iBy] || "").trim();
      const sp = g.spenders.get(`${by}|${so}`) || { name: by, side: so, total: 0 }; sp.total += a; g.spenders.set(`${by}|${so}`, sp);
      if (g.items.length < 40) g.items.push({ by, side: so, amount: a, vendor: row[iVen] || "", purpose: row[iPur] || "", date: row[iDate] || "" });
      races.set(target, g);
      const s2 = spenders.get(by) || { name: by, total: 0, count: 0 }; s2.total += a; s2.count++; spenders.set(by, s2);
    }
    res.json({ year, total: Math.round(total), count: (r.rows || []).length, truncated: Boolean(r.truncated),
      races: [...races.values()].map((g) => ({ candidate: g.candidate, support: Math.round(g.support), oppose: Math.round(g.oppose), total: Math.round(g.support + g.oppose), count: g.count,
        spenders: [...g.spenders.values()].sort((x, y) => y.total - x.total).slice(0, 8).map((s) => ({ ...s, total: Math.round(s.total) })),
        items: g.items.sort((x, y) => y.amount - x.amount) })).sort((x, y) => y.total - x.total),
      spenders: [...spenders.values()].sort((x, y) => y.total - x.total).slice(0, 25).map((s) => ({ ...s, total: Math.round(s.total) })),
      ...(r.note ? { note: r.note } : {}) });
  }));
}
