// Tennessee Registry of Election Finance (TREF) integration.
// apps.tn.gov/tncamp is a session-based JSP app with no API. Flow:
//   1. GET the search form -> capture JSESSIONID
//   2. POST criteria (stored server-side in the session)
//   3. GET the results page -> locate the DisplayTag CSV export link
//   4. GET the CSV export on the same session -> parse clean rows
// Pages are ISO-8859-1; all responses decoded as latin1.

const TN_BASE = "https://apps.tn.gov/tncamp";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// Election year labels -> TREF internal IDs (extracted from the live form, Jun 2026)
// TO UPDATE: visit https://apps.tn.gov/tncamp/public/cpsearch.htm, view-source,
// search for "electionYearSelection" — copy the new <option value="NNN"> entries here.
export const TN_YEARS = [
  { id: "240", label: "2030" }, { id: "239", label: "2028" }, { id: "234", label: "2026" },
  { id: "230", label: "2024" }, { id: "237", label: "2023 (HOUSE 3)" }, { id: "238", label: "2023 (HOUSE 51)" },
  { id: "235", label: "2023 (HOUSE 52)" }, { id: "233", label: "2023 (HOUSE 86)" }, { id: "236", label: "2023 (HOUSE 86 AUG GEN)" },
  { id: "225", label: "2022" }, { id: "232", label: "2021 (HOUSE 29)" }, { id: "221", label: "2020" },
  { id: "229", label: "2019 (HOUSE 77)" }, { id: "228", label: "2019 (Senate 22)" }, { id: "227", label: "2019 (Senate 32)" },
  { id: "214", label: "2018" }, { id: "226", label: "2018 (Senate 14)" }, { id: "222", label: "2017 (House 95)" },
  { id: "224", label: "2017 (Senate 17)" }, { id: "213", label: "2016" }, { id: "220", label: "2016 (19-3)" },
  { id: "218", label: "2015 (H14)" }, { id: "207", label: "2014" }, { id: "215", label: "2013 (House 91)" },
  { id: "200", label: "2012" }, { id: "210", label: "2012 (DA 2)" }, { id: "212", label: "2012 (DA 30)" },
  { id: "211", label: "2012 (PD 12)" }, { id: "205", label: "2011 (House 98)" }, { id: "206", label: "2011 (Senate 18)" },
  { id: "208", label: "2011 (Senate 6)" }, { id: "209", label: "2011 (Senate 6 Special)" }, { id: "4", label: "2010" },
  { id: "201", label: "2009 (House 62)" }, { id: "203", label: "2009 (House 83)" }, { id: "202", label: "2009 (Senate 31)" },
  { id: "1", label: "2008" }, { id: "152", label: "2007 (House 89)" }, { id: "158", label: "2007 (Senate 10)" },
  { id: "204", label: "2007 (Senate 30)" }, { id: "151", label: "2006" }, { id: "162", label: "2005 (House 22)" },
  { id: "160", label: "2005 (House 87)" }, { id: "161", label: "2005 (Senate 29)" }, { id: "159", label: "2005 (Senate 33)" },
  { id: "150", label: "2004" }, { id: "3", label: "2002" },
];

export const TN_OFFICES = [
  { id: "2", label: "Governor" }, { id: "3", label: "Senate" }, { id: "4", label: "House of Representatives" },
  { id: "5", label: "Court of Appeals" }, { id: "6", label: "Court of Criminal Appeals" }, { id: "7", label: "Supreme Court" },
  { id: "8", label: "District Attorney" }, { id: "9", label: "Public Defender" }, { id: "10", label: "Circuit Court" },
  { id: "11", label: "Criminal Court" }, { id: "12", label: "Chancery Court" }, { id: "13", label: "Probate Court" },
];

// ---- politeness: one request at a time, min spacing ----
let chain = Promise.resolve();
let lastReq = 0;
const MIN_GAP_MS = 1200;
function polite(fn) {
  const run = async () => {
    const wait = Math.max(0, lastReq + MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastReq = Date.now();
    return fn();
  };
  // .then(run, run): a rejected task must never poison the chain — the old
  // `chain.then(run)` pattern skipped every later caller once one task threw,
  // leaving all TN endpoints permanently rejecting until restart.
  const p = chain.then(run, run);
  chain = p.then(() => {}, () => {}); // internal chain stays always-settled
  return p;
}

// Hard cap per TREF request — without it one stalled socket blocks the entire
// single-flight `polite` chain forever.
const TN_FETCH_TIMEOUT_MS = Number(process.env.TN_FETCH_TIMEOUT_MS || 30000);

async function tnFetch(path, { method = "GET", cookie = "", body = null, referer = "" } = {}) {
  const headers = {
    "user-agent": UA,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  };
  if (cookie) headers.cookie = cookie;
  if (referer) headers.referer = referer;
  if (body) headers["content-type"] = "application/x-www-form-urlencoded";
  let res;
  try {
    res = await fetch(`${TN_BASE}${path}`, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(TN_FETCH_TIMEOUT_MS) });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error(`TREF request timed out after ${TN_FETCH_TIMEOUT_MS}ms (${path})`);
    throw e;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    location: res.headers.get("location"),
    setCookie: res.headers.get("set-cookie"),
    text: buf.toString("latin1"),
  };
}

function extractSession(setCookie) {
  const m = (setCookie || "").match(/JSESSIONID="?([^";,]+)"?/);
  return m ? `JSESSIONID="${m[1]}"` : null;
}

// minimal CSV parser (handles quoted fields, embedded commas/newlines)
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f.trim() !== "")) rows.push(row); }
  return rows;
}

function stripTags(html) {
  return html.replace(/<br\s*\/?>/gi, " | ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// ---- candidate / PAC search ----
export async function searchCandidatesPacs({ name = "", officeId = "", yearId = "", type = "both" }) {
  return polite(async () => {
    // 1. establish session
    const formPage = await tnFetch("/public/cpsearch.htm");
    let cookie = extractSession(formPage.setCookie);
    if (!cookie) throw new Error("TN site did not issue a session cookie — site may be down or has changed.");

    // 2. POST criteria (field names from the live form)
    const params = new URLSearchParams({
      searchType: type,            // candidate | pac | both
      name,
      officeSelection: officeId,
      districtSelection: "",
      electionYearSelection: yearId,
      partySelection: "",
      // result columns to include
      nameField: "true",
      contactField: "true",
      partyField: "true",
      officeField: "true",
      districtField: "true",
      electionYearField: "true",
      treasurerNameField: "true",
      _continue: "Search",
    });
    const post = await tnFetch("/public/cpsearch.htm", {
      method: "POST", cookie, body: params.toString(), referer: `${TN_BASE}/public/cpsearch.htm`,
    });
    if (![200, 302, 303].includes(post.status)) {
      throw new Error(`TN search POST returned HTTP ${post.status}`);
    }
    // Tomcat can rotate JSESSIONID on POST (session-fixation protection) and only sets the
    // cookie on some responses — refresh from EVERY response or the flow silently runs sessionless.
    cookie = extractSession(post.setCookie) || cookie;

    // 3. results page (criteria live in the session)
    const results = await tnFetch("/public/cpresults.htm", { cookie, referer: `${TN_BASE}/public/cpsearch.htm` });
    cookie = extractSession(results.setCookie) || cookie;
    const html = results.text;

    // "(?<![\d,])0" — a bare "0 items found" only; the substring also occurs inside "10/20/1,200
    // items found", which must NOT be treated as empty. Rescue regex covers DisplayTag's actual
    // "N items found" banner (nonzero) as well as "N results found" variants.
    if (/no results|(?<![\d,])0 items found|No records/i.test(html) && !/[1-9][\d,]* (?:items?|results?) found|One (?:item|result) found/i.test(html)) {
      return { rows: [], headers: [], count: 0, source: "tn-tref" };
    }

    // 4. DisplayTag CSV export on the same session (table id varies per render)
    const exp = html.match(/cpresults\.htm\?d-(\d+)-e=1[^"']*6578706f7274=1/);
    if (exp) {
      const csvRes = await tnFetch(`/public/cpresults.htm?d-${exp[1]}-e=1&6578706f7274=1`, { cookie, referer: `${TN_BASE}/public/cpresults.htm` });
      const rows = parseCSV(csvRes.text);
      if (rows.length > 1) {
        // Strategy 1 (primary): extract tnIds positionally from the HTML table rows.
        // Both the HTML table and the CSV are in the same sort order; this avoids
        // fragile name-matching and handles split First Name / Last Name columns.
        const htmlTrIds = [...html.matchAll(/<tr[^>]*class="(?:odd|even)"[^>]*>([\s\S]*?)<\/tr>/gi)]
          .map((m) => m[1].match(/replist\.htm\?id=(\d+)/)?.[1] || null);

        // Strategy 2 (fallback for rows beyond the HTML's first page): name-based map.
        const nameIds = {};
        for (const m of html.matchAll(/replist\.htm\?id=(\d+)&(?:amp;)?owner=([^"']+)/g)) {
          // scraped fragment — a malformed %-sequence must not throw and sink the whole search
          try {
            nameIds[decodeURIComponent(m[2].replace(/\+/g, " ")).trim().toUpperCase()] = m[1];
          } catch { /* skip unparseable owner name; positional strategy still applies */ }
        }

        const headers = rows[0].map((h) => h.trim());
        // Find the best "full name" column — exact "Name" match first, then any header
        // containing "name" but NOT treasurer/contact (avoids landing on "First Name").
        const nameIdx = (() => {
          let i = headers.findIndex((h) => /^name$/i.test(h.trim()));
          if (i < 0) i = headers.findIndex((h) => /\bname\b/i.test(h) && !/treasurer|contact/i.test(h));
          if (i < 0) i = headers.findIndex((h) => /name/i.test(h));
          return i;
        })();
        // Build full-name string for each CSV row (handles split first/last columns)
        const firstIdx = headers.findIndex((h) => /^first\s*name/i.test(h.trim()));
        const lastIdx  = headers.findIndex((h) => /^last\s*name/i.test(h.trim()));
        const rowName = (r) => {
          if (firstIdx >= 0 || lastIdx >= 0) {
            return [r[firstIdx] || "", r[lastIdx] || ""].filter(Boolean).join(" ").trim().toUpperCase()
              || (nameIdx >= 0 ? (r[nameIdx] || "").trim().toUpperCase() : "");
          }
          return nameIdx >= 0 ? (r[nameIdx] || "").trim().toUpperCase() : "";
        };

        return {
          headers,
          rows: rows.slice(1).map((r, i) => ({
            cells: r,
            tnId: htmlTrIds[i] || nameIds[rowName(r)] || null,
          })),
          count: rows.length - 1,
          source: "tn-tref",
        };
      }
    }

    // fallback: parse the HTML table directly
    const tbl = html.match(/<table[^>]*id="results"[^>]*>([\s\S]*?)<\/table>/);
    if (!tbl) return { rows: [], headers: [], count: 0, source: "tn-tref", note: "No results table found." };
    const headers = [...tbl[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]));
    const rows = [...tbl[1].matchAll(/<tr[^>]*class="(?:odd|even)"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1]));
      const idm = m[1].match(/replist\.htm\?id=(\d+)/);
      return { cells, tnId: idm ? idm[1] : null };
    });
    return { headers, rows, count: rows.length, source: "tn-tref" };
  });
}

// A stateful session helper: TREF (Tomcat) can rotate JSESSIONID on POST (session-fixation
// protection) and only sets the cookie on some responses. Reusing the first GET's cookie for the
// whole flow silently runs sessionless → replist/report_full bounce to the search home. So we keep
// a live cookie "jar" and refresh it from EVERY response's Set-Cookie.
function tnSession() {
  let cookie = "";
  const step = async (path, opts = {}) => {
    const r = await tnFetch(path, { ...opts, cookie });
    const fresh = extractSession(r.setCookie);
    if (fresh) cookie = fresh;
    return r;
  };
  // Establish + fully initialize a session: GET the form, run a search (any search warms the
  // session enough for replist/report_full, whose entity context comes from URL params, not state).
  const warm = async (seedName = "") => {
    await step("/public/cpsearch.htm");
    const params = new URLSearchParams({
      searchType: "both", name: seedName || "", officeSelection: "", districtSelection: "",
      electionYearSelection: "", partySelection: "", nameField: "true", contactField: "true",
      partyField: "true", officeField: "true", districtField: "true", electionYearField: "true",
      committeeField: "true", treasurerNameField: "true", _continue: "Search",
    });
    // POST may return HTTP 500 yet still register the session/criteria — that's expected, ignore status.
    await step("/public/cpsearch.htm", { method: "POST", body: params.toString(), referer: `${TN_BASE}/public/cpsearch.htm` });
    await step("/public/cpresults.htm", { referer: `${TN_BASE}/public/cpsearch.htm` });
  };
  return { step, warm, get cookie() { return cookie; } };
}

const looksLikeTnHome = (text) =>
  /Search for Candidates and PACs|Search the Online Campaign Finance Database/i.test(text) &&
  !/Report Name|Beginning Balance|Total Monetary/i.test(text);

// ---- reports filed by a candidate/PAC ----
// replist.htm needs an active search session — a bare GET redirects to the search home. Warm a
// session (seeded with the owner's name), then request replist; retry once if still bounced.
export async function listReports(tnId, owner = "") {
  return polite(async () => {
    const s = tnSession();
    await s.warm(owner);
    const getReplist = () => s.step(
      `/public/replist.htm?id=${encodeURIComponent(tnId)}&owner=${encodeURIComponent(owner)}`,
      { referer: `${TN_BASE}/public/cpresults.htm` },
    );
    let page = await getReplist();
    if (looksLikeTnHome(page.text)) { await s.warm(owner); page = await getReplist(); }

    const html = page.text;
    if (looksLikeTnHome(html)) {
      return { headers: [], rows: [], note: "TREF bounced the report request to its search home — the session could not be established (site may be rate-limiting or temporarily down). Try again shortly." };
    }
    // Prefer the table that actually holds the report list (has a "Report Name" header).
    const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((m) => m[1]);
    const body = tables.find((t) => /Report Name/i.test(t)) || tables[0];
    if (!body) return { headers: [], rows: [], note: "No report table found — the entity may have no filings on record." };
    const headers = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]));
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((m) => {
        const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1]));
        const links = [...m[1].matchAll(/href="([^"]+)"/g)].map((l) => l[1]).filter((u) => !/replist|cpsearch/.test(u));
        // report detail link: /tncamp/search/pub/report_full.htm?reportId=NNN&owner=...
        const reportId = links.map((l) => l.match(/reportId=(\d+)/i)?.[1]).find(Boolean) || null;
        return { cells, links, reportId };
      })
      .filter((r) => r.cells.some((c) => c.trim()) && r.reportId);
    return { headers, rows };
  });
}

// ---- parse a dollar string to a float ----
function parseDollar(str) {
  if (!str) return null;
  const s = String(str);
  // accounting-style negatives: ($1,234.56)
  const neg = /\(\s*\$?\s*[\d,.]+\s*\)/.test(s);
  const m = s.replace(/[$,\s()]/g, "").match(/-?[\d.]+/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return neg ? -Math.abs(n) : n;
}

// ---- full report detail: report_full.htm?reportId=NNN ----
// TREF uses /search/pub/ path for report detail (note: different from /public/ search forms).
export async function fetchReportDetail(reportId) {
  return polite(async () => {
    // report_full needs a warm session (its entity context comes from URL params, not session state).
    const s = tnSession();
    await s.warm();
    // Try /search/pub/ first (confirmed URL pattern from TREF UI), fall back to /public/
    let page = await s.step(`/search/pub/report_full.htm?reportId=${encodeURIComponent(reportId)}`, { referer: `${TN_BASE}/public/replist.htm` });
    if (page.status !== 200 || looksLikeTnHome(page.text)) {
      page = await s.step(`/public/report_full.htm?reportId=${encodeURIComponent(reportId)}`, { referer: `${TN_BASE}/public/replist.htm` });
    }
    if (page.status !== 200) throw new Error(`TREF returned HTTP ${page.status} for reportId ${reportId}`);
    if (looksLikeTnHome(page.text)) throw new Error(`TREF bounced reportId ${reportId} to its search home — session could not be established.`);
    return parseReportHtml(page.text, reportId);
  });
}

// Bump when parseReportHtml's totals extraction changes, so callers can invalidate stale cached
// report details (stored in SQLite keyed by reportId).
export const REPORT_PARSER_V = 4;

function parseReportHtml(html, reportId) {
  // --- meta: title / entity name ---
  const meta = { reportId: String(reportId), parserV: REPORT_PARSER_V };
  const titleM = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (titleM) meta.title = stripTags(titleM[1]);

  // Collect all tables
  const allTables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)];

  let totals = {};
  let contribs = [];
  let expenditures = [];

  // Itemized schedules in an active report_full live in HTML tables. The distinctive header tells
  // us which is which: a "Contributor" column = itemized contributions; a "Vendor" column =
  // itemized expenditures. (Other tables — purpose summaries, loans, obligations — are skipped.)
  for (const m of allTables) {
    const tblHtml = m[1];
    const headers = [...tblHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((h) => stripTags(h[1]).trim());
    if (!headers.length) continue;
    const dataRows = [...tblHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1]).trim()))
      .filter((r) => r.length > 0 && r.some((c) => c.length > 0));
    if (!dataRows.length) continue;

    const idxOf = (re) => headers.findIndex((h) => re.test(h));
    const ci = idxOf(/contributor/i);
    const vi = idxOf(/vendor/i);
    const ai = idxOf(/amount/i);
    const di = idxOf(/date/i);

    // Contributor/vendor cells are "NAME<br>ADDR<br>CITY, ST ZIP<br>EMPLOYER<br>OCC"; stripTags turns
    // <br> into " | ", so the name is the first pipe-segment. Fall back to cutting before the street
    // address if there's no <br>.
    const leadName = (s) => {
      const str = String(s || "").trim();
      let name = str.split(/\s*\|\s*/)[0].trim();
      if (name === str) {
        const cut = str.search(/\s(?=\d|PO\s?BOX|P\.O\.)/i);
        if (cut > 0) name = str.slice(0, cut);
      }
      return name.replace(/[\s,|]+$/, "").trim();
    };

    // A report can have SEVERAL contributor tables (monetary + in-kind) and several vendor tables
    // (expenditures + in-kind + obligations). CONCATENATE them all — don't overwrite, or only the
    // last (often tiny) schedule survives. (This was undercounting big filers like Bill Lee.)
    if (ci >= 0 && ai >= 0) {
      contribs.push(...dataRows.map((r) => ({
        name: leadName(r[ci]),
        contributor: r[ci] || "",
        type: r[idxOf(/^c\/p$/i)] || "",
        recdFor: r[idxOf(/rec'?d for|received for/i)] || "",
        date: di >= 0 ? r[di] : "",
        amount: parseDollar(r[ai]),
        aggregate: parseDollar(r[idxOf(/aggregate/i)]),
      })).filter((x) => x.name || x.amount));
    } else if (vi >= 0 && ai >= 0) {
      expenditures.push(...dataRows.map((r) => ({
        name: leadName(r[vi]),
        vendor: r[vi] || "",
        type: r[idxOf(/^c\/p$/i)] || "",
        purpose: r[idxOf(/purpose/i)] || "",
        date: di >= 0 ? r[di] : "",
        amount: parseDollar(r[ai]),
      })).filter((x) => x.name || x.amount));
    }
  }

  // --- div-based layout fallback (modern responsive TREF report_full) ---
  // Newer report pages have NO <table> elements; summary figures are label/value div pairs:
  //   <div class="… control-label text-left">Beginning Balance</div>
  //   <div class="… control inline-block text-right">$0.00</div>
  if (!Object.keys(totals).length) {
    // Match label and value divs with targeted class-specific regexes (the broad "any div"
    // approach fails because TREF nests these inside wrapper divs). Collect with their byte
    // offsets, merge in document order, then pair each label with the value that follows it.
    const tokens = [];
    for (const m of html.matchAll(/<div class="[^"]*control-label[^"]*">([\s\S]*?)<\/div>/gi)) {
      tokens.push({ pos: m.index, t: "L", txt: stripTags(m[1]) });
    }
    for (const m of html.matchAll(/<div class="[^"]*\bcontrol\b[^"]*text-right[^"]*">([\s\S]*?)<\/div>/gi)) {
      tokens.push({ pos: m.index, t: "V", txt: stripTags(m[1]) });
    }
    tokens.sort((a, b) => a.pos - b.pos);
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i].t === "L" && tokens[i + 1].t === "V") {
        const labelCell = tokens[i].txt.trim().replace(/:$/, "");
        const valCell = tokens[i + 1].txt;
        if (labelCell && /\$|\d/.test(valCell)) {
          totals[labelCell] = parseDollar(valCell) ?? (valCell || null);
        }
      }
    }
    // entity/title fallback from the page heading ("1st Quarter for NAME submitted on DATE")
    if (!meta.title) {
      const hM = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
      if (hM) meta.title = stripTags(hM[1]);
    }
  }

  // --- canonical totals via LABEL-ANCHORED extraction (robust) ---
  // TREF report summaries mix <table> and responsive <div> layouts and don't pair label→value in a
  // consistent DOM order, so position-based pairing mis-aligns (e.g. TOTAL RECEIPTS grabbing the
  // wrong $). Instead, flatten the page to text and read the dollar amount that immediately follows
  // each known grand-total label. This works for both layouts and for empty (balance-only) reports.
  const flatText = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const grabAmount = (labelRe) => {
    // first dollar amount within 120 chars after the label (no intervening $);
    // handles negatives written as -$1,234.56 or accounting-style ($1,234.56)
    const m = flatText.match(new RegExp(labelRe.source + "[^$]{0,120}?(\\(\\s*|-\\s*)?\\$\\s*(-?[\\d,]+\\.\\d{2})", "i"));
    if (!m) return null;
    const n = parseFloat(m[2].replace(/,/g, ""));
    const neg = /[(-]/.test(m[1] || "") || m[2].startsWith("-");
    return neg ? -Math.abs(n) : n;
  };
  const canonical = { ...totals }; // keep verbatim labels for the detailed view
  // delete the raw-label versions we map to canonical keys so the detailed view isn't doubled up
  const setIf = (key, ...labelRes) => {
    for (const re of labelRes) { const v = grabAmount(re); if (v !== null) { canonical[key] = v; return; } }
  };
  setIf("opening", /Beginning Balance/);
  setIf("receipts", /TOTAL RECEIPTS/, /TOTAL CONTRIBUTIONS/);
  setIf("expenditures", /TOTAL DISBURSEMENTS/, /TOTAL EXPENDITURES/);
  setIf("closing", /ENDING BALANCE/);
  setIf("loans", /TOTAL OUTSTANDING LOAN BALANCE/, /Loans Received/);

  return { totals: canonical, rawTotals: totals, contribs, expenditures, meta };
}

// ---- contributions & expenditures search (cesearch.htm) ----
// Same session flow as cpsearch. Field names extracted from the live form (Jun 2026).
// searchType: "contributions" | "expenditures"
//   - recipientName:   contributions TO this candidate/PAC (who funds them)
//   - contributorName: contributions FROM this name (which candidates a PAC/person funds)
//   - candName:        expenditures BY this candidate/PAC (vendors, independent spending)
// electionYearId is a TREF internal ID (TN_YEARS); reportYear is a literal year — both required by the form.
export async function searchMoney({ searchType, recipientName = "", contributorName = "", candName = "", electionYearId, reportYear }) {
  return polite(async () => {
    const formPage = await tnFetch("/public/cesearch.htm");
    let cookie = extractSession(formPage.setCookie);
    if (!cookie) throw new Error("TN site did not issue a session cookie — site may be down or has changed.");

    const params = new URLSearchParams({
      searchType,
      toType: "both",
      // "*From" / "*To" required checkbox groups — include everything
      fromCandidate: "true", fromPAC: "true", fromIndividual: "true", fromOrganization: "true",
      toCandidate: "true", toPac: "true", toOther: "true",
      electionYearSelection: String(electionYearId),
      yearSelection: String(reportYear),
      recipientName, contributorName, candName,
      employer: "", occupation: "", zipCode: "",
      vendorName: "", vendorZipCode: "", purpose: "",
      typeOf: "all",
      amountSelection: "equal", amountDollars: "", amountCents: "",
      // result columns
      typeField: "true", amountField: "true", dateField: "true", electionYearField: "true",
      reportNameField: "true", recipientNameField: "true", contributorNameField: "true",
      contributorAddressField: "true", contributorOccupationField: "true", contributorEmployerField: "true",
      descriptionField: "true", candidatePACNameField: "true", vendorNameField: "true",
      vendorAddressField: "true", purposeField: "true", candidateForField: "true",
    });
    // the form carries both a hidden _continue=Continue and the submit button _continue=Search
    params.append("_continue", "Continue");
    params.append("_continue", "Search");

    const post = await tnFetch("/public/cesearch.htm", {
      method: "POST", cookie, body: params.toString(), referer: `${TN_BASE}/public/cesearch.htm`,
    });
    if (![200, 302, 303].includes(post.status)) throw new Error(`TN money POST returned HTTP ${post.status}`);
    // refresh the cookie from every response — Tomcat can rotate JSESSIONID on POST
    cookie = extractSession(post.setCookie) || cookie;

    const results = await tnFetch("/public/ceresults.htm", { cookie, referer: `${TN_BASE}/public/cesearch.htm` });
    cookie = extractSession(results.setCookie) || cookie;
    const html = results.text;

    // "(?<![\d,])0" — a bare "0 items found" only; the substring also occurs inside "10/20/1,200
    // items found", which must NOT be treated as empty. Rescue regex covers DisplayTag's actual
    // "N items found" banner (nonzero) as well as "N results found" variants.
    if (/no results|(?<![\d,])0 items found|No records/i.test(html) && !/[1-9][\d,]* (?:items?|results?) found|One (?:item|result) found/i.test(html)) {
      return { rows: [], headers: [], count: 0, source: "tn-tref" };
    }

    // DisplayTag CSV export on the same session (gets ALL rows, not just page 1)
    const exp = html.match(/ceresults\.htm\?d-(\d+)-e=1[^"']*6578706f7274=1/);
    if (exp) {
      const csvRes = await tnFetch(`/public/ceresults.htm?d-${exp[1]}-e=1&6578706f7274=1`, { cookie, referer: `${TN_BASE}/public/ceresults.htm` });
      const rows = parseCSV(csvRes.text);
      if (rows.length > 1) {
        return { headers: rows[0].map((h) => h.trim()), rows: rows.slice(1), count: rows.length - 1, source: "tn-tref" };
      }
    }

    // fallback: parse the HTML table directly (first page only)
    const tbl = html.match(/<table[^>]*id="results"[^>]*>([\s\S]*?)<\/table>/) || html.match(/<table[^>]*>([\s\S]*?)<\/table>/);
    if (!tbl) return { rows: [], headers: [], count: 0, source: "tn-tref", note: "No results table found — the TN site layout may have changed." };
    const headers = [...tbl[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]));
    const rows = [...tbl[1].matchAll(/<tr[^>]*class="(?:odd|even)"[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1])));
    return { headers, rows, count: rows.length, source: "tn-tref", note: "CSV export unavailable — showing first page only." };
  });
}

export async function tnHealth() {
  try {
    const r = await tnFetch("/public/cpsearch.htm"); // same endpoint the real flows use
    return { status: r.status === 200 ? "ok" : "degraded", httpStatus: r.status };
  } catch (e) {
    return { status: "down", error: e.message };
  }
}
