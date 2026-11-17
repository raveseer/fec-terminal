import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { css } from "./styles.js";
import TennesseeHub from "./Tennessee.jsx";

// ---------- constants ----------
const STATES = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],
  ["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],
  ["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],
  ["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],
  ["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],
  ["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],
  ["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
  ["DC","District of Columbia"],["PR","Puerto Rico"],["GU","Guam"],["VI","U.S. Virgin Islands"],
  ["AS","American Samoa"],["MP","Northern Mariana Is."],
];

const CYCLES = [];
// Upper bound: current even year (FEC cycles are even-year); if we're in an odd year, next even year is already open for filings
const _curYear = new Date().getFullYear();
const _topCycle = _curYear % 2 === 0 ? _curYear : _curYear + 1;
for (let y = _topCycle; y >= 2000; y -= 2) CYCLES.push(y);

// Senate seats are staggered into 3 classes; each state holds 2 of the 3. A class votes
// every 6 years: class 1 in years ≡2 (mod 6) (…2018, 2024, 2030), class 2 ≡4 (…2020, 2026),
// class 3 ≡0 (…2022, 2028). This map (state → its two classes) lets us show only the cycles
// a given state actually elects a senator.
const SENATE_CLASS_RESIDUE = { 1: 2, 2: 4, 3: 0 };
const SENATE_CLASSES = {
  AL: [2, 3], AK: [2, 3], AZ: [1, 3], AR: [2, 3], CA: [1, 3], CO: [2, 3], CT: [1, 3], DE: [1, 2],
  FL: [1, 3], GA: [2, 3], HI: [1, 3], ID: [2, 3], IL: [2, 3], IN: [1, 3], IA: [2, 3], KS: [2, 3],
  KY: [2, 3], LA: [2, 3], ME: [1, 2], MD: [1, 3], MA: [1, 2], MI: [1, 2], MN: [1, 2], MS: [1, 2],
  MO: [1, 3], MT: [1, 2], NE: [1, 2], NV: [1, 3], NH: [2, 3], NJ: [1, 2], NM: [1, 2], NY: [1, 3],
  NC: [2, 3], ND: [1, 3], OH: [1, 3], OK: [2, 3], OR: [2, 3], PA: [1, 3], RI: [1, 2], SC: [2, 3],
  SD: [2, 3], TN: [1, 2], TX: [1, 2], UT: [1, 3], VT: [1, 3], VA: [1, 2], WA: [1, 3], WV: [1, 2],
  WI: [1, 3], WY: [1, 2],
};

// Valid election cycles per office: President every 4th year; Senate only the years the chosen
// state actually votes; House every even year. (CYCLES is newest-first, so [0] = last known cycle.)
const cyclesForOffice = (office, state) => {
  if (office === "P") return CYCLES.filter((y) => y % 4 === 0);
  if (office === "S") {
    const classes = SENATE_CLASSES[state];
    if (!classes) return CYCLES; // territory / no senators — don't over-restrict
    const residues = new Set(classes.map((c) => SENATE_CLASS_RESIDUE[c]));
    return CYCLES.filter((y) => residues.has(y % 6));
  }
  return CYCLES;
};

const PARTIES = [
  ["", "All parties"], ["DEM", "Democratic"], ["REP", "Republican"],
  ["IND", "Independent"], ["LIB", "Libertarian"], ["GRE", "Green"],
  ["CON", "Constitution"], ["NPA", "No party affiliation"],
];

// House seats by census apportionment era — keeps the district dropdown honest per state and cycle
const SEATS_2020 = {AL:7,AK:1,AZ:9,AR:4,CA:52,CO:8,CT:5,DE:1,FL:28,GA:14,HI:2,ID:2,IL:17,IN:9,IA:4,KS:4,KY:6,LA:6,ME:2,MD:8,MA:9,MI:13,MN:8,MS:4,MO:8,MT:2,NE:3,NV:4,NH:2,NJ:12,NM:3,NY:26,NC:14,ND:1,OH:15,OK:5,OR:6,PA:17,RI:2,SC:7,SD:1,TN:9,TX:38,UT:4,VT:1,VA:11,WA:10,WV:2,WI:8,WY:1};
const SEATS_2010 = {AL:7,AK:1,AZ:9,AR:4,CA:53,CO:7,CT:5,DE:1,FL:27,GA:14,HI:2,ID:2,IL:18,IN:9,IA:4,KS:4,KY:6,LA:6,ME:2,MD:8,MA:9,MI:14,MN:8,MS:4,MO:8,MT:1,NE:3,NV:4,NH:2,NJ:12,NM:3,NY:27,NC:13,ND:1,OH:16,OK:5,OR:5,PA:18,RI:2,SC:7,SD:1,TN:9,TX:36,UT:4,VT:1,VA:11,WA:10,WV:3,WI:8,WY:1};
const SEATS_2000 = {AL:7,AK:1,AZ:8,AR:4,CA:53,CO:7,CT:5,DE:1,FL:25,GA:13,HI:2,ID:2,IL:19,IN:9,IA:5,KS:4,KY:6,LA:7,ME:2,MD:8,MA:10,MI:15,MN:8,MS:4,MO:9,MT:1,NE:3,NV:3,NH:2,NJ:13,NM:3,NY:29,NC:13,ND:1,OH:18,OK:5,OR:5,PA:19,RI:2,SC:6,SD:1,TN:9,TX:32,UT:3,VT:1,VA:11,WA:9,WV:3,WI:8,WY:1};
const SEATS_1990 = {AL:7,AK:1,AZ:6,AR:4,CA:52,CO:6,CT:6,DE:1,FL:23,GA:11,HI:2,ID:2,IL:20,IN:10,IA:5,KS:4,KY:6,LA:7,ME:2,MD:8,MA:10,MI:16,MN:8,MS:5,MO:9,MT:1,NE:3,NV:2,NH:2,NJ:13,NM:3,NY:31,NC:12,ND:1,OH:19,OK:6,OR:5,PA:21,RI:2,SC:6,SD:1,TN:9,TX:30,UT:3,VT:1,VA:11,WA:9,WV:3,WI:9,WY:1};
// FIPS codes for Census TIGER API lookups
const STATE_FIPS = {
  AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",FL:"12",GA:"13",
  HI:"15",ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",MD:"24",
  MA:"25",MI:"26",MN:"27",MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",NJ:"34",
  NM:"35",NY:"36",NC:"37",ND:"38",OH:"39",OK:"40",OR:"41",PA:"42",RI:"44",SC:"45",
  SD:"46",TN:"47",TX:"48",UT:"49",VT:"50",VA:"51",WA:"53",WV:"54",WI:"55",WY:"56",DC:"11",
};

function seatsFor(st, cycle) {
  const era = cycle >= 2022 ? SEATS_2020 : cycle >= 2012 ? SEATS_2010 : cycle >= 2002 ? SEATS_2000 : SEATS_1990;
  return era[st] ?? 1; // DC + territories: non-voting delegate, at-large
}

// Conduit / pass-through processors — these lines aggregate other people's money
const CONDUIT_RE = /^(WINRED|ACTBLUE|WINRED TECHNICAL|DEMOCRACY ENGINE|ANEDOT)\b/;

// Is a grouped donor a PAC / committee / party (not an individual)? The "Committee YTD"
// aggregate only makes sense for committee filers, so we gate that column on this.
const isCommitteeDonor = (g) => {
  const t = (g?.type || "").toUpperCase();
  if (/^IND|INDIVIDUAL/.test(t)) return false;   // individuals never qualify
  if (g?.fecId) return true;                       // resolved to a committee FEC id
  return /PAC|COMMITTEE|PARTY|ORGANIZATION|^COM|^CCM|^PTY|^ORG/.test(t);
};

const PARTY_COLOR = { DEM: "#5B82B8", REP: "#B85B5B", IND: "#8F8F7A", LIB: "#C9A648", GRE: "#6FA06B" };
const partyColor = (p) => {
  const u = (p || "").toUpperCase();
  if (u.startsWith("DEM")) return PARTY_COLOR.DEM;
  if (u.startsWith("REP")) return PARTY_COLOR.REP;
  if (u.startsWith("LIB")) return PARTY_COLOR.LIB;
  if (u.startsWith("GRE")) return PARTY_COLOR.GRE;
  if (u.startsWith("IND")) return PARTY_COLOR.IND;
  return "#6B7257";
};

const fmtUSD = (n) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtUSDshort = (n) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");

// Coarse entity type from a name (+ optional expenditure purpose). Mirrors the server's classifyPayee
// so contributions, expenditures, and donor-lookup recipients all label consistently.
function classifyPayee(name, { purpose = "", isExpense = false } = {}) {
  const n = String(name || "").toUpperCase().trim();
  const p = String(purpose || "").toUpperCase();
  if (!n) return "Other";
  if (/\b(REPUBLICAN|DEMOCRAT(IC)?|LIBERTARIAN|GREEN)\b[^,]*\bPARTY\b|\b(GOP|TENNESSEE REPUBLICAN|TENNESSEE DEMOCRATIC)\b/.test(n)) return "Party";
  if (/\b(PAC|POLITICAL ACTION|COMMITTEE|CAMPAIGN|FRIENDS OF|CITIZENS FOR|COMMITTEE TO|RE-?ELECT|VICTORY FUND|LEADERSHIP)\b/.test(n) ||
      /\bFOR (SENATE|HOUSE|GOVERNOR|MAYOR|CONGRESS|STATE|TN|TENNESSEE|REP(RESENTATIVE)?|SHERIFF|JUDGE|D\.?A\.?|DISTRICT ATTORNEY|ASSEMBLY|COUNCIL)\b/.test(n))
    return "Committee/Politician";
  if (/\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|LTD|LLP|PLLC|ENTERPRISES?|GROUP|ASSOCIATES?|SERVICES?|SOLUTIONS|MEDIA|BROADCAST(ING)?|PRINTING|CATERING|CONSULTING|MARKETING|RESTAURANT|GRILL|HOTEL|BANK|REALTY|FARMS?|STORE|SHOP|BARN|AMAZON|GOOGLE|FACEBOOK|META|VERIZON|AT&T)\b/.test(n))
    return isExpense ? "Merchant" : "Business";
  if (isExpense) {
    if (/\b(CONTRIBUTION|DONAT|PAC|CANDIDATE|COMMITTEE)\b/.test(p)) return "Committee/Politician";
    if (/\b(AD|ADS|ADVERTIS|PRINT|MAIL|CONSULT|CATER|FOOD|MEAL|TRAVEL|LODG|FUEL|GAS|RENT|SUPPL|FLOWER|SOFTWARE|FEE|POSTAGE|SIGN|EVENT|VENUE|SPONSOR|PHONE|WEB|DIGITAL)\b/.test(p)) return "Merchant";
  }
  if (/^[A-Z][A-Z'’.\- ]*,\s*[A-Z]/.test(n)) return "Individual";
  return isExpense ? "Merchant" : "Other";
}

const timeAgo = (epochMs) => {
  if (!epochMs) return null;
  const s = Math.round((Date.now() - epochMs) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

async function fecGet(path, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api/fec/${path}?${qs}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      data?.error?.message || data?.message ||
      (res.status === 429 ? "FEC rate limit hit — set FEC_API_KEY in the container env for 1,000 req/hr." : `Request failed (HTTP ${res.status}).`)
    );
  }
  return data;
}

// ---------- CSV export ----------
function downloadCSV(filename, headers, rows) {
  const esc = (v) => {
    let s = v == null ? "" : String(v);
    // formula-injection guard: FEC data is third-party input; don't let a donor named
    // "=HYPERLINK(...)" execute when the CSV is opened in Excel/Sheets.
    // Plain numbers (incl. negative refund amounts) pass through untouched.
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Printable-report export ----------
// Renders a full HTML document into a hidden iframe and opens the browser's print
// dialog ("Save as PDF"). This replaces the old window.open() popup, which silently
// no-opped whenever a popup blocker was active and relied on an unreliable
// onload-after-document.write to trigger printing.
function printDocument(html) {
  const prev = document.getElementById("fec-print-frame");
  if (prev) prev.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "fec-print-frame";
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed", right: "0", bottom: "0",
    width: "0", height: "0", border: "0", visibility: "hidden",
  });
  document.body.appendChild(iframe);

  let printed = false;
  const cleanup = () => { try { iframe.remove(); } catch { /* already removed */ } };
  const doPrint = () => {
    if (printed) return;            // guard against onload + timeout both firing
    printed = true;
    const w = iframe.contentWindow;
    if (!w) { cleanup(); return; }
    try {
      w.focus();
      w.onafterprint = cleanup;     // remove the frame once the dialog closes
      w.print();
      setTimeout(cleanup, 60000);   // safety net where onafterprint never fires
    } catch { cleanup(); }
  };

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // document.write often completes without a reliable load event, so trigger on
  // whichever of these lands first; the `printed` guard makes the rest no-ops.
  iframe.onload = () => setTimeout(doPrint, 300);
  if (doc.readyState === "complete") setTimeout(doPrint, 350);
  setTimeout(doPrint, 1200);
}

// Escape user/third-party text before injecting into print HTML (FEC/TN data is untrusted).
function escHtml(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Only allow http(s) URLs in generated links — anything else (javascript:, data:, garbage) → "#".
function safeUrl(u) {
  try {
    const p = new URL(String(u));
    if (p.protocol === "http:" || p.protocol === "https:") return String(u);
  } catch { /* not a parseable absolute URL */ }
  return "#";
}

// Snapshot the on-screen district map SVG as a static, self-contained block (inlined colors,
// pan/zoom reset) for embedding in dossiers/PDFs. Returns "" when no map is on screen
// (Senate/President/TN have no district map).
function captureDistrictMapHtml(label = "") {
  const svgEl = document.querySelector(".fec-map-svg");
  if (!svgEl) return "";
  const w = Number(svgEl.getAttribute("width")) || 460;
  const h = Number(svgEl.getAttribute("height")) || 220;
  const svgStr = svgEl.outerHTML
    .replace(/position:\s*absolute[^;"']*/gi, "position:static")
    .replace(/inset:\s*0[^;"']*/gi, "")
    .replace(/transform="translate\([^"]*?\)\s*scale\([^"]*?\)"/gi, 'transform="translate(0,0) scale(1)"')
    .replace(/var\(--brass\)/g, "#C8B560").replace(/var\(--bone\)/g, "#E9E5D6")
    .replace(/var\(--ink\)/g, "#15170F").replace(/var\(--olive\)/g, "#8A9A5B")
    .replace(/var\(--muted\)/g, "#9AA083").replace(/var\(--line\)/g, "#3A3F2C")
    .replace(/var\(--panel2?\)/g, "#232719");
  return `<div style="background:#15170F; border:1px solid #3A3F2C; width:${w}px; max-width:100%; margin:8px 0 16px; overflow:hidden;">
    <div style="font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:#9AA083; padding:5px 8px 3px;">${escHtml(label)}${label ? " · " : ""}119th Congress</div>
    <div style="width:${w}px; max-width:100%; height:${h}px; overflow:hidden; position:relative;">${svgStr}</div>
  </div>`;
}

// Shared print stylesheet + document wrapper so every tab's PDF looks the same.
// `bodyHtml` is caller-built and already escaped where needed.
function reportShell({ title, metaLine = "", bodyHtml = "" }) {
  const genDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${escHtml(title)}</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 28px 36px; max-width: 860px; }
  h1 { font-size: 22px; font-weight: 800; margin: 0 0 3px; letter-spacing: -.02em; }
  .header-meta { color: #666; font-size: 10.5px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
  th { text-align: left; border-bottom: 2px solid #bbb; padding: 5px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #444; }
  td { padding: 5px 8px; border-bottom: 1px solid #e6e6e6; vertical-align: top; }
  td.amt, th.amt { text-align: right; white-space: nowrap; color: #1a5c2e; font-weight: 700; }
  td a { color: #0a58ca; text-decoration: none; }
  tr { page-break-inside: avoid; }
  .sub { color: #888; font-size: 9.5px; }
  .ai-block { background: #f0f4e8; border-left: 3px solid #7a8f50; padding: 10px 14px; margin: 14px 0; }
  .ai-label { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: #5a6f3a; margin-bottom: 6px; font-weight: 700; margin-top: 4px; }
  .ai-text { font-size: 11px; line-height: 1.6; white-space: pre-wrap; color: #222; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px,1fr)); gap: 10px; margin: 6px 0; }
  .stat { background: #f5f7f0; border-radius: 3px; padding: 7px 10px; }
  .stat .n { font-size: 14px; font-weight: 800; color: #1a5c2e; }
  .stat .l { font-size: 8.5px; text-transform: uppercase; letter-spacing: .08em; color: #666; margin-top: 2px; }
  .bar-row { display: flex; align-items: center; gap: 8px; font-size: 10.5px; padding: 2px 0; }
  .bar-lbl { flex: 0 0 175px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; background: #e4ecd4; height: 7px; border-radius: 2px; overflow: hidden; }
  .bar-fill { display: block; height: 100%; background: #7a9a4b; }
  .bar-row b { flex: 0 0 56px; text-align: right; color: #1a5c2e; }
  .src { font-size: 9.5px; margin-bottom: 3px; }
  .src a { color: #0055bb; text-decoration: none; }
  .src .k { display: inline-block; font-size: 8px; text-transform: uppercase; background: #7a8f50; color: #fff; border-radius: 2px; padding: 0 4px; margin-right: 5px; }
  .note { color: #888; font-style: italic; font-size: 10.5px; }
  h2.sec { font-size: 13px; margin: 18px 0 2px; border-top: 2px solid #bbb; padding-top: 8px; }
  @media print { body { padding: 16px 20px; } }
</style></head>
<body>
<h1>${escHtml(title)}</h1>
<div class="header-meta">${escHtml(metaLine)}${metaLine ? " · " : ""}Generated ${genDate}</div>
${bodyHtml}
</body></html>`;
}

// ---------- Print Dossier HTML ----------
const _fmtDossD = (n) => n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const _fmtK = (n) => "$" + Math.round((Number(n) || 0) / 1000).toLocaleString() + "K";

function _sourcesHtml(sources) {
  if (!sources?.length) return "";
  return `<div class="ai-label">Sources</div>` + sources.map((s) =>
    `<div class="src"><a href="${escHtml(safeUrl(s.url))}"><span class="k">${escHtml(s.kind || "src")}</span>${escHtml(s.title || s.url)}</a></div>`).join("");
}

// Money-flow bubble map for dossiers: top donors → entity → top expenditures. Static SVG string
// (print-safe); `dark` flips the palette for the on-screen modal. Bubble size and edge weight
// scale with √dollars. Returns "" when there's nothing to draw.
function _flowBubblesHTML(centerName, donorsIn = [], vendorsOut = [], { dark = false } = {}) {
  const donors = (donorsIn || []).filter((x) => x && (Number(x.amount) || 0) > 0).slice(0, 10);
  const vendors = (vendorsOut || []).filter((x) => x && (Number(x.amount) || 0) > 0).slice(0, 10);
  if (!donors.length && !vendors.length) return "";
  const C = dark
    ? { inn: "#8A9A5B", out: "#b3544a", center: "#C8B560", label: "#E9E5D6", sub: "#9AA083", inAmt: "#8A9A5B", outAmt: "#b3544a", title: "#E9E5D6" }
    : { inn: "#7a9a4b", out: "#b3544a", center: "#1a5c2e", label: "#333333", sub: "#666666", inAmt: "#1a5c2e", outAmt: "#8a3a32", title: "#111111" };
  const rows = Math.max(donors.length, vendors.length, 1);
  const W = 820, rowH = 52, H = Math.max(300, rows * rowH + 60);
  const cx = W / 2, cy = H / 2;
  const maxAmt = Math.max(...donors.map((d) => Number(d.amount) || 0), ...vendors.map((v) => Number(v.amount) || 0), 1);
  const rad = (a) => 8 + 18 * Math.sqrt((Number(a) || 0) / maxAmt);
  const wid = (a) => 1 + 5 * Math.sqrt((Number(a) || 0) / maxAmt);
  const trunc = (s, n = 26) => { const t = String(s || ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const place = (list, x, side) => list.map((it, i) => {
    const step = list.length > 1 ? Math.min(rowH, (H - 90) / (list.length - 1)) : 0;
    const y = cy - (step * (list.length - 1)) / 2 + i * step;
    return { ...it, x, y, r: rad(it.amount), side };
  });
  const L = place(donors, 230, -1), R = place(vendors, W - 230, 1);
  const paths = [
    ...L.map((n) => `<path d="M ${(n.x + n.r).toFixed(1)} ${n.y.toFixed(1)} C ${((n.x + cx) / 2).toFixed(1)} ${n.y.toFixed(1)}, ${((n.x + cx) / 2).toFixed(1)} ${cy}, ${cx - 36} ${cy}" fill="none" stroke="${C.inn}" stroke-opacity=".45" stroke-width="${wid(n.amount).toFixed(1)}"/>`),
    ...R.map((n) => `<path d="M ${cx + 36} ${cy} C ${((n.x + cx) / 2).toFixed(1)} ${cy}, ${((n.x + cx) / 2).toFixed(1)} ${n.y.toFixed(1)}, ${(n.x - n.r).toFixed(1)} ${n.y.toFixed(1)}" fill="none" stroke="${C.out}" stroke-opacity=".4" stroke-width="${wid(n.amount).toFixed(1)}"/>`),
  ].join("");
  const bubble = (n, fill, amtColor) =>
    `<circle cx="${n.x}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="${fill}" fill-opacity=".85"/>` +
    `<text x="${(n.x + n.side * (n.r + 8)).toFixed(1)}" y="${(n.y - 2).toFixed(1)}" text-anchor="${n.side < 0 ? "end" : "start"}" font-size="10" fill="${C.label}">${escHtml(trunc(n.name))}</text>` +
    `<text x="${(n.x + n.side * (n.r + 8)).toFixed(1)}" y="${(n.y + 10).toFixed(1)}" text-anchor="${n.side < 0 ? "end" : "start"}" font-size="9" font-weight="700" fill="${amtColor}">${_fmtK(n.amount)}</text>`;
  const sumIn = donors.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const sumOut = vendors.reduce((a, x) => a + (Number(x.amount) || 0), 0);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Money flow map">
    <text x="230" y="18" text-anchor="middle" font-size="9" letter-spacing="2" fill="${C.sub}">TOP DONORS IN</text>
    <text x="${W - 230}" y="18" text-anchor="middle" font-size="9" letter-spacing="2" fill="${C.sub}">TOP EXPENDITURES OUT</text>
    ${paths}
    ${L.map((n) => bubble(n, C.inn, C.inAmt)).join("")}
    ${R.map((n) => bubble(n, C.out, C.outAmt)).join("")}
    <circle cx="${cx}" cy="${cy}" r="30" fill="${C.center}"/>
    <text x="${cx}" y="${cy - 40}" text-anchor="middle" font-size="12" font-weight="800" fill="${C.title}">${escHtml(trunc(centerName, 34))}</text>
    <text x="${cx}" y="${cy + 52}" text-anchor="middle" font-size="9" fill="${C.sub}">in ${_fmtK(sumIn)} · out ${_fmtK(sumOut)} (top-10s only)</text>
  </svg>`;
}

// The dossier's "money flow" page: bubble map + the two top-10 lists side by side (print HTML).
function _flowPageHTML(centerName, donors, vendors) {
  const svg = _flowBubblesHTML(centerName, donors, vendors);
  if (!svg) return "";
  const tbl = (list, title, nameHdr) => (list || []).length
    ? `<div style="flex:1 1 300px; min-width:250px;"><div class="ai-label">${title}</div><table><thead><tr><th>${nameHdr}</th><th class="amt">Total</th></tr></thead><tbody>` +
      list.slice(0, 10).map((x) => `<tr><td>${escHtml(x.name)}</td><td class="amt">${_fmtDossD(x.amount)}</td></tr>`).join("") +
      `</tbody></table></div>` : "";
  return `<h2 class="sec" style="page-break-before:always">Money flow map</h2>
    <div class="note">Largest itemized donors (left, green) and largest expenditure recipients (right, red) — bubble size and line weight scale with dollars. Conduit pass-throughs are excluded upstream; unitemized small-dollar money is not shown.</div>
    ${svg}
    <div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:8px; page-break-inside:avoid;">
      ${tbl(donors, "Top 10 donors", "Donor")}${tbl(vendors, "Top 10 expenditures", "Recipient")}
    </div>`;
}

function buildDossierHTML(d, mapHtml = "") {
  if (d.kind === "tn") {
    let body = "";
    if (d.reports?.length) {
      body += `<h2 class="sec">TN filing history (${d.reports.length})</h2><table><tbody>` +
        d.reports.slice(0, 30).map((cells) => `<tr>${cells.slice(0, 5).map((c) => `<td>${escHtml(c)}</td>`).join("")}</tr>`).join("") + `</tbody></table>`;
    } else {
      body += `<div class="note">No TN filing history retrieved.</div>`;
    }
    if (d.money) {
      const m = d.money;
      body += `<h2 class="sec">Money flows (itemized from filed reports)</h2><div class="stat-grid">
        <div class="stat"><div class="n">${_fmtDossD(m.totalReceived)}</div><div class="l">Received</div></div>
        <div class="stat"><div class="n">${_fmtDossD(m.totalSpent)}</div><div class="l">Spent</div></div>
        </div><div class="note">${m.reportsRead} of ${m.reportsTotal} filed reports read${m.partial ? " (partial)" : ""}${m.conduitTotal ? ` · ${_fmtK(m.conduitTotal)} via ${m.conduitCount} conduit gift${m.conduitCount === 1 ? "" : "s"} (WinRed/ActBlue/etc., excluded from donor totals)` : ""}${m.note ? ` · ${escHtml(m.note)}` : ""}</div>`;
      if (m.analysis) body += `<div class="ai-text">${escHtml(m.analysis)}</div>`;
      if (m.byTypeReceived?.length) {
        body += `<div class="ai-label">Received by donor type</div>` + m.byTypeReceived.map((t) =>
          `<div class="bar-row"><span class="bar-lbl">${escHtml(t.name)}</span><b>${_fmtK(t.total)}</b> (${t.count})</div>`).join("");
      }
      if (m.topDonors?.length) {
        body += `<div class="ai-label">Largest donors</div><table><thead><tr><th>Donor</th><th>Gifts</th><th class="amt">Total</th></tr></thead><tbody>` +
          m.topDonors.map((x) => `<tr><td>${escHtml(x.name)}</td><td>${x.count}</td><td class="amt">${_fmtDossD(x.amount)}</td></tr>`).join("") + `</tbody></table>`;
      }
      if (m.byTypeSpent?.length) {
        body += `<div class="ai-label">Spent by vendor type</div>` + m.byTypeSpent.map((t) =>
          `<div class="bar-row"><span class="bar-lbl">${escHtml(t.name)}</span><b>${_fmtK(t.total)}</b> (${t.count})</div>`).join("");
      }
      if (m.topVendors?.length) {
        body += `<div class="ai-label">Largest vendors</div><table><thead><tr><th>Vendor</th><th>Payments</th><th class="amt">Total</th></tr></thead><tbody>` +
          m.topVendors.map((x) => `<tr><td>${escHtml(x.name)}</td><td>${x.count}</td><td class="amt">${_fmtDossD(x.amount)}</td></tr>`).join("") + `</tbody></table>`;
      }
      body += _flowPageHTML(d.entity.name, m.topDonors, m.topVendors);
    } else if (d.moneyError) {
      body += `<h2 class="sec">Money flows</h2><div class="note">Money flows unavailable: ${escHtml(d.moneyError)}</div>`;
    }
    body += `<h2 class="sec">Background & profile (AI web research)</h2>`;
    if (d.research?.available) body += `<div class="ai-text">${escHtml(d.research.answer)}</div>${_sourcesHtml(d.research.sources)}`;
    else body += `<div class="note">${escHtml(d.research?.note || "Web research unavailable.")}</div>`;
    return reportShell({ title: `Dossier — ${d.entity.name}`, metaLine: "Tennessee Registry of Election Finance", bodyHtml: body });
  }

  // federal
  const c = d.candidate;
  const where = c.office === "P" ? "President"
    : c.office === "H" ? `U.S. House · ${c.state || ""}${c.district && c.district !== "00" ? ` District ${c.district}` : ""}`.trim()
    : c.office === "S" ? `U.S. Senate · ${c.state || ""}`.trim()
    : `${c.office} ${c.state || ""}`.trim();
  // Top band: state map on the left, race roster on the right.
  let body = "";
  {
    const heading = c.office === "H" && c.district ? `${escHtml(c.state)} District ${escHtml(c.district)}` : c.office === "S" ? `${escHtml(c.state)} (Senate)` : "";
    const rosterTbl = d.race?.length
      ? `<div class="ai-label" style="margin-top:0">Candidates in this race${heading ? ` — ${heading}` : ""} (${d.race.length})</div>
         <table><thead><tr><th>Candidate</th><th>Party</th><th class="amt">Receipts</th></tr></thead><tbody>` +
        d.race.map((x) => `<tr${x.isSubject ? ' style="background:#eef3e3"' : ""}><td${x.isSubject ? ' style="font-weight:700"' : ""}>${escHtml(x.name)}${x.isSubject ? " ◂" : ""}${x.incumbent ? " · INC" : ""}</td><td>${escHtml(x.party || "")}</td><td class="amt">${_fmtDossD(x.receipts)}</td></tr>`).join("") +
        `</tbody></table>`
      : "";
    if (mapHtml || rosterTbl) {
      body += `<div style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; margin:4px 0 12px;">
        ${mapHtml ? `<div style="flex:0 0 auto;">${mapHtml}</div>` : ""}
        ${rosterTbl ? `<div style="flex:1 1 260px; min-width:240px;">${rosterTbl}</div>` : ""}
      </div>`;
    }
  }

  if (d.totals) {
    const t = d.totals;
    body += `<h2 class="sec">Financial summary</h2><div class="stat-grid">
      <div class="stat"><div class="n">${_fmtDossD(t.receipts_this_cycle)}</div><div class="l">Raised (cycle)</div></div>
      <div class="stat"><div class="n">${_fmtDossD(t.disbursements_this_cycle)}</div><div class="l">Spent (cycle)</div></div>
      <div class="stat"><div class="n">${_fmtDossD(t.cash_on_hand)}</div><div class="l">Cash on hand</div></div>
      <div class="stat"><div class="n">${_fmtDossD(t.debts_owed)}</div><div class="l">Debts</div></div>
      </div><div class="note">Receipts/disbursements are this cycle only; cash on hand is a running balance. Coverage through ${escHtml(t.coverage_end_date || "—")}.</div>`;
  }

  if (d.donors) {
    const dn = d.donors, agg = dn.aggregates;
    body += `<h2 class="sec">Donor base</h2><div class="note">${Number(dn.donorCount || 0).toLocaleString()} donors · ${Number(dn.sampleSize || 0).toLocaleString()} of ${dn.itemizedCount != null ? Number(dn.itemizedCount).toLocaleString() : "?"} itemized gifts (repeat gifts rolled up; WinRed/ActBlue conduit pass-throughs excluded${dn.conduitTotal ? `, ${_fmtK(dn.conduitTotal)} via conduits` : ""}). Itemized data excludes unitemized small-dollar gifts.</div>`;
    if (dn.analysis) body += `<div class="ai-text">${escHtml(dn.analysis)}</div>`;
    if (agg?.topEmployers?.length) {
      const max = agg.topEmployers[0].amount || 1;
      body += `<div class="ai-label">Top employers</div>` + agg.topEmployers.slice(0, 8).map((e) =>
        `<div class="bar-row"><span class="bar-lbl">${escHtml(e.name)}</span><span class="bar-track"><span class="bar-fill" style="width:${Math.round((e.amount / max) * 100)}%"></span></span><b>${_fmtK(e.amount)}</b></div>`).join("");
    }
    if (agg) body += `<div class="ai-label">Geography</div><div style="font-size:11px">In-state (${escHtml(c.state || "?")}): <b>${_fmtK(agg.inStateAmount)}</b> &nbsp;·&nbsp; Out-of-state: <b>${_fmtK(agg.outOfStateAmount)}</b></div>`;
    if (agg?.sizeBuckets) {
      body += `<div class="ai-label">By check size</div>` + Object.entries(agg.sizeBuckets).map(([kk, v]) =>
        `<div class="bar-row"><span class="bar-lbl">${escHtml(kk)}</span><b>${_fmtK(v)}</b></div>`).join("");
    }
    if (dn.timeline?.length > 1) {
      const maxT = Math.max(...dn.timeline.map((t) => t.total), 1);
      const bw = Math.max(6, Math.min(20, Math.floor(360 / dn.timeline.length)));
      const w = dn.timeline.length * bw;
      body += `<div class="ai-label">Contribution timeline</div><svg viewBox="0 0 ${w} 50" width="${w}" height="50" xmlns="http://www.w3.org/2000/svg">` +
        dn.timeline.map((p, i) => { const h = Math.max(2, Math.round((p.total / maxT) * 46)); return `<rect x="${i * bw}" y="${46 - h}" width="${bw - 2}" height="${h}" fill="#7a9a4b" rx="1"/>`; }).join("") +
        `</svg><div class="note">${escHtml(dn.timeline[0].month)} → ${escHtml(dn.timeline[dn.timeline.length - 1].month)}</div>`;
    }
    if (dn.topDonors?.length) {
      body += `<div class="ai-label">Largest donors</div><table><thead><tr><th>Donor</th><th>Employer</th><th>State</th><th>Gifts</th><th class="amt">Total</th></tr></thead><tbody>` +
        dn.topDonors.map((x) => `<tr><td><a href="https://www.fec.gov/data/receipts/?contributor_name=${encodeURIComponent(x.name || "")}&two_year_transaction_period=${escHtml(c.cycle)}">${escHtml(x.name)}</a></td><td>${escHtml(x.employer || "")}</td><td>${escHtml(x.state || "")}</td><td>${x.count || 1}</td><td class="amt">${_fmtDossD(x.amount)}</td></tr>`).join("") + `</tbody></table>`;
    }
  }

  if (d.spending?.top_recipients?.length) {
    body += `<h2 class="sec">Spending (Schedule B)</h2>`;
    if (d.spending.analysis) body += `<div class="ai-text">${escHtml(d.spending.analysis)}</div>`;
    body += `<table><thead><tr><th>Recipient</th><th class="amt">Amount</th></tr></thead><tbody>` +
      d.spending.top_recipients.slice(0, 10).map((r) => `<tr><td>${escHtml(r.name)}</td><td class="amt">${_fmtDossD(r.amount)}</td></tr>`).join("") + `</tbody></table>`;
  }

  body += _flowPageHTML(c.name, d.donors?.topDonors, d.spending?.top_recipients);

  if (d.outside && (d.outside.total_spent_FOR_candidate || d.outside.total_spent_AGAINST_candidate)) {
    body += `<h2 class="sec">Outside money (Schedule E)</h2>
      <div style="font-size:12px">Spent <b>FOR</b> this candidate: ${_fmtDossD(d.outside.total_spent_FOR_candidate)} &nbsp;·&nbsp; Spent <b>AGAINST</b>: ${_fmtDossD(d.outside.total_spent_AGAINST_candidate)}</div>`;
    if (d.outside.outside_spenders?.length) {
      body += `<table><thead><tr><th>Spender</th><th class="amt">For</th><th class="amt">Against</th></tr></thead><tbody>` +
        d.outside.outside_spenders.slice(0, 10).map((s) => `<tr><td>${escHtml(s.spender)}</td><td class="amt">${_fmtDossD(s.support_FOR)}</td><td class="amt">${_fmtDossD(s.oppose_AGAINST)}</td></tr>`).join("") + `</tbody></table>`;
    }
  }

  body += `<h2 class="sec">Background & positions (AI web research)</h2>`;
  if (d.research?.available) body += `<div class="ai-text">${escHtml(d.research.answer)}</div>${_sourcesHtml(d.research.sources)}`;
  else body += `<div class="note">${escHtml(d.research?.note || "Web research unavailable.")}</div>`;

  body += `<div class="note" style="margin-top:18px">AI narratives are generated from FEC filings and live web search; verify against the cited sources before relying on them.</div>`;

  return reportShell({ title: `Dossier — ${c.name}`, metaLine: `${c.party || ""}${c.party ? " · " : ""}${where} · ${c.cycle} cycle`, bodyHtml: body });
}

// ---------- styles ----------
// ---------- shared: AI summary header (label · model · cached-age · refresh) ----------
// Used by every AI narrative block so the refresh control and cache age look identical
// across the Money Race, Field, and TN tabs.
function AiMeta({ label = "Local AI", model, at, cached, extra, onRefresh, refreshing }) {
  const parts = [label];
  if (model) parts.push(model);
  if (extra) parts.push(extra);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
      <span className="fec-ai-label" style={{ margin: 0 }}>{parts.join(" · ")}</span>
      {at
        ? <span style={{ fontSize: 10, color: "var(--muted)" }}>cached {timeAgo(at)}</span>
        : cached ? <span style={{ fontSize: 10, color: "var(--muted)" }}>cached</span> : null}
      {onRefresh && (
        <button className="fec-btn ghost sm" onClick={onRefresh} disabled={refreshing}
          title="Regenerate this AI summary — bypasses the stored copy">
          {refreshing ? "…" : "↺ Refresh"}
        </button>
      )}
    </div>
  );
}

// Shared "this only reflects loaded data" disclaimer, shown atop AI summaries that
// aggregate the loaded rows (donors, spending, outside money) so they aren't read as complete.
function AiCaveat({ children }) {
  return <div className="fec-ai-caveat">⚠ {children}</div>;
}

// ---------- shared: lobbying / 990 / contracts block ----------
function OrgIntel({ data }) {
  if (!data) return null;
  const { lobbying, nonprofit, contracts, orgName } = data;
  if (!lobbying && !nonprofit && !contracts) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="fec-ai-label">Org intel{orgName ? ` · ${orgName}` : ""} (name-matched — verify)</div>
      <ul className="fec-funders" style={{ maxWidth: "none" }}>
        {lobbying && (
          <li>
            <span>Lobbying {lobbying.year}: {lobbying.filings} filing{lobbying.filings === 1 ? "" : "s"}
              {lobbying.topIssues?.length ? ` · ${lobbying.topIssues.slice(0, 4).join(", ")}` : ""}
              {lobbying.registrants?.length ? ` · via ${lobbying.registrants.slice(0, 2).join(", ")}` : ""}</span>
            <b>{fmtUSDshort(lobbying.totalReported)}</b>
          </li>
        )}
        {nonprofit && (
          <li>
            <span>IRS: {nonprofit.name}{nonprofit.subsection ? ` · ${nonprofit.subsection}` : ""}{nonprofit.latest ? ` · FY${nonprofit.latest.year} revenue` : ""}</span>
            <b>{nonprofit.latest ? fmtUSDshort(nonprofit.latest.revenue) : "on file"}</b>
          </li>
        )}
        {contracts && (
          <li>
            <span>Federal contracts/grants since FY{contracts.sinceFY} (USAspending)</span>
            <b>{contracts.total.toLocaleString()} awards</b>
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------- major cities by state (lat/lon for SVG projection) ----------
const STATE_CITIES = {
  AL:[{n:"Birmingham",lat:33.52,lon:-86.80},{n:"Montgomery",lat:32.36,lon:-86.30},{n:"Huntsville",lat:34.73,lon:-86.59}],
  AK:[{n:"Anchorage",lat:61.22,lon:-149.90},{n:"Fairbanks",lat:64.84,lon:-147.72}],
  AZ:[{n:"Phoenix",lat:33.45,lon:-112.07},{n:"Tucson",lat:32.22,lon:-110.97},{n:"Mesa",lat:33.42,lon:-111.83}],
  AR:[{n:"Little Rock",lat:34.75,lon:-92.29},{n:"Fort Smith",lat:35.39,lon:-94.43}],
  CA:[{n:"Los Angeles",lat:34.05,lon:-118.24},{n:"San Francisco",lat:37.77,lon:-122.42},{n:"San Diego",lat:32.72,lon:-117.16},{n:"Sacramento",lat:38.58,lon:-121.49}],
  CO:[{n:"Denver",lat:39.74,lon:-104.98},{n:"Colorado Springs",lat:38.83,lon:-104.82},{n:"Boulder",lat:40.01,lon:-105.27}],
  CT:[{n:"Hartford",lat:41.76,lon:-72.68},{n:"New Haven",lat:41.31,lon:-72.93},{n:"Bridgeport",lat:41.18,lon:-73.19}],
  DE:[{n:"Wilmington",lat:39.74,lon:-75.54},{n:"Dover",lat:39.16,lon:-75.52}],
  FL:[{n:"Miami",lat:25.77,lon:-80.19},{n:"Orlando",lat:28.54,lon:-81.38},{n:"Tampa",lat:27.95,lon:-82.46},{n:"Jacksonville",lat:30.33,lon:-81.66}],
  GA:[{n:"Atlanta",lat:33.75,lon:-84.39},{n:"Savannah",lat:32.08,lon:-81.10},{n:"Augusta",lat:33.47,lon:-81.97}],
  HI:[{n:"Honolulu",lat:21.31,lon:-157.86},{n:"Hilo",lat:19.71,lon:-155.07}],
  ID:[{n:"Boise",lat:43.61,lon:-116.20},{n:"Idaho Falls",lat:43.49,lon:-112.03}],
  IL:[{n:"Chicago",lat:41.85,lon:-87.65},{n:"Springfield",lat:39.80,lon:-89.65},{n:"Rockford",lat:42.27,lon:-89.09}],
  IN:[{n:"Indianapolis",lat:39.77,lon:-86.16},{n:"Fort Wayne",lat:41.08,lon:-85.14},{n:"Evansville",lat:37.97,lon:-87.57}],
  IA:[{n:"Des Moines",lat:41.60,lon:-93.62},{n:"Cedar Rapids",lat:41.98,lon:-91.67},{n:"Davenport",lat:41.52,lon:-90.58}],
  KS:[{n:"Wichita",lat:37.69,lon:-97.34},{n:"Topeka",lat:39.05,lon:-95.68},{n:"Kansas City",lat:39.12,lon:-94.63}],
  KY:[{n:"Louisville",lat:38.25,lon:-85.76},{n:"Lexington",lat:38.05,lon:-84.50},{n:"Bowling Green",lat:36.99,lon:-86.44}],
  LA:[{n:"New Orleans",lat:29.95,lon:-90.07},{n:"Baton Rouge",lat:30.45,lon:-91.13},{n:"Shreveport",lat:32.53,lon:-93.75}],
  ME:[{n:"Portland",lat:43.66,lon:-70.26},{n:"Bangor",lat:44.80,lon:-68.78},{n:"Augusta",lat:44.31,lon:-69.78}],
  MD:[{n:"Baltimore",lat:39.29,lon:-76.61},{n:"Annapolis",lat:38.98,lon:-76.49},{n:"Frederick",lat:39.41,lon:-77.41}],
  MA:[{n:"Boston",lat:42.36,lon:-71.06},{n:"Worcester",lat:42.27,lon:-71.80},{n:"Springfield",lat:42.10,lon:-72.59}],
  MI:[{n:"Detroit",lat:42.33,lon:-83.05},{n:"Grand Rapids",lat:42.96,lon:-85.67},{n:"Lansing",lat:42.73,lon:-84.55}],
  MN:[{n:"Minneapolis",lat:44.98,lon:-93.27},{n:"St. Paul",lat:44.95,lon:-93.09},{n:"Duluth",lat:46.79,lon:-92.11}],
  MS:[{n:"Jackson",lat:32.30,lon:-90.18},{n:"Gulfport",lat:30.37,lon:-89.09},{n:"Hattiesburg",lat:31.33,lon:-89.29}],
  MO:[{n:"Kansas City",lat:39.10,lon:-94.58},{n:"St. Louis",lat:38.63,lon:-90.20},{n:"Springfield",lat:37.21,lon:-93.30}],
  MT:[{n:"Billings",lat:45.78,lon:-108.50},{n:"Missoula",lat:46.87,lon:-113.99},{n:"Great Falls",lat:47.50,lon:-111.30}],
  NE:[{n:"Omaha",lat:41.26,lon:-95.94},{n:"Lincoln",lat:40.81,lon:-96.68}],
  NV:[{n:"Las Vegas",lat:36.17,lon:-115.14},{n:"Reno",lat:39.53,lon:-119.81},{n:"Carson City",lat:39.16,lon:-119.77}],
  NH:[{n:"Manchester",lat:42.99,lon:-71.46},{n:"Concord",lat:43.21,lon:-71.54},{n:"Nashua",lat:42.77,lon:-71.46}],
  NJ:[{n:"Newark",lat:40.74,lon:-74.17},{n:"Jersey City",lat:40.73,lon:-74.07},{n:"Trenton",lat:40.22,lon:-74.76}],
  NM:[{n:"Albuquerque",lat:35.08,lon:-106.65},{n:"Santa Fe",lat:35.69,lon:-105.94},{n:"Las Cruces",lat:32.31,lon:-106.78}],
  NY:[{n:"New York",lat:40.71,lon:-74.01},{n:"Buffalo",lat:42.89,lon:-78.87},{n:"Albany",lat:42.65,lon:-73.75},{n:"Rochester",lat:43.16,lon:-77.61}],
  NC:[{n:"Charlotte",lat:35.23,lon:-80.84},{n:"Raleigh",lat:35.78,lon:-78.64},{n:"Greensboro",lat:36.07,lon:-79.79}],
  ND:[{n:"Fargo",lat:46.88,lon:-96.79},{n:"Bismarck",lat:46.81,lon:-100.78}],
  OH:[{n:"Columbus",lat:39.96,lon:-82.99},{n:"Cleveland",lat:41.50,lon:-81.69},{n:"Cincinnati",lat:39.10,lon:-84.51}],
  OK:[{n:"Oklahoma City",lat:35.47,lon:-97.52},{n:"Tulsa",lat:36.15,lon:-95.99},{n:"Norman",lat:35.22,lon:-97.44}],
  OR:[{n:"Portland",lat:45.52,lon:-122.68},{n:"Eugene",lat:44.05,lon:-123.09},{n:"Salem",lat:44.94,lon:-123.03}],
  PA:[{n:"Philadelphia",lat:39.95,lon:-75.17},{n:"Pittsburgh",lat:40.44,lon:-80.00},{n:"Allentown",lat:40.61,lon:-75.49},{n:"Harrisburg",lat:40.27,lon:-76.89}],
  RI:[{n:"Providence",lat:41.82,lon:-71.42},{n:"Warwick",lat:41.70,lon:-71.42}],
  SC:[{n:"Columbia",lat:34.00,lon:-81.03},{n:"Charleston",lat:32.78,lon:-79.94},{n:"Greenville",lat:34.85,lon:-82.40}],
  SD:[{n:"Sioux Falls",lat:43.54,lon:-96.73},{n:"Rapid City",lat:44.08,lon:-103.23},{n:"Pierre",lat:44.37,lon:-100.34}],
  TN:[{n:"Nashville",lat:36.17,lon:-86.78},{n:"Memphis",lat:35.15,lon:-90.05},{n:"Knoxville",lat:35.96,lon:-83.92},{n:"Chattanooga",lat:35.05,lon:-85.31}],
  TX:[{n:"Houston",lat:29.76,lon:-95.37},{n:"Dallas",lat:32.78,lon:-96.80},{n:"San Antonio",lat:29.42,lon:-98.49},{n:"Austin",lat:30.27,lon:-97.74}],
  UT:[{n:"Salt Lake City",lat:40.76,lon:-111.89},{n:"Provo",lat:40.23,lon:-111.66},{n:"Ogden",lat:41.22,lon:-111.97}],
  VT:[{n:"Burlington",lat:44.48,lon:-73.21},{n:"Montpelier",lat:44.26,lon:-72.58}],
  VA:[{n:"Virginia Beach",lat:36.85,lon:-75.98},{n:"Richmond",lat:37.54,lon:-77.43},{n:"Norfolk",lat:36.85,lon:-76.29},{n:"Arlington",lat:38.88,lon:-77.10}],
  WA:[{n:"Seattle",lat:47.61,lon:-122.33},{n:"Spokane",lat:47.66,lon:-117.43},{n:"Tacoma",lat:47.25,lon:-122.44}],
  WV:[{n:"Charleston",lat:38.35,lon:-81.63},{n:"Huntington",lat:38.42,lon:-82.44},{n:"Morgantown",lat:39.63,lon:-79.95}],
  WI:[{n:"Milwaukee",lat:43.04,lon:-87.91},{n:"Madison",lat:43.07,lon:-89.40},{n:"Green Bay",lat:44.52,lon:-88.02}],
  WY:[{n:"Cheyenne",lat:41.14,lon:-104.82},{n:"Casper",lat:42.86,lon:-106.32}],
  DC:[{n:"Washington",lat:38.91,lon:-77.04}],
};

// ---------- district map: live GeoJSON boundaries from Census TIGER ----------
const MAP_W = 460, MAP_H = 220, MAP_PAD = 8;
const PARTY_FILL   = { Republican: "#7A2020", Democrat: "#1E3A7A", Independent: "#1A5A30" };
const PARTY_STROKE = { Republican: "#C04040", Democrat: "#4060C0", Independent: "#40A060" };

// ---- industry sector classification ----
const SECTOR_RULES = [
  ["Pharma & Healthcare", /pharm|health|medical|hospital|clinic|biotech|drug store|compounding|nurs|physician|doctor|dental|chiro|optom|rehab|therapy|wellness|emed|oncol/i],
  ["Finance & Banking", /\bbank\b|capital|financ|invest|\bfund\b|asset|wealth|insur|mortgage|credit union|loan|brokerage|securit|hedge|private equity|\bpe\b/i],
  ["Real Estate & Construction", /real estate|realt|propert|develop|construct|homebuil|housing|residential|commercial|contractor|builder/i],
  ["Defense & Aerospace", /defense|aerospace|military|weapon|lockheed|raytheon|boeing|northrop|general dynamic|l3|bae system/i],
  ["Energy & Utilities", /energy|oil\b|gas\b|\bpetrol|coal|utility|electric|power\b|nuclear|pipeline|refin|solar|wind\b|exxon|chevron|shell/i],
  ["Tech & Telecom", /tech|software|internet|digital|cyber|data center|compute|telecom|broadcast|cable|wireless|network|semicon/i],
  ["Legal & Lobbying", /attorney|lawyer|legal|law firm|\blaw\b|counsel|litigat|lobby|government relation|public affair/i],
  ["Retail & Hospitality", /retail|restaurant|food\b|beverage|grocery|hotel|hospitality|travel|tourism|entertainment|gaming|casino|wholesale/i],
  ["Automotive & Manufacturing", /manufactur|automotive|\bauto\b|vehicle|truck|industri|production|factory|steel|aluminum|chemical/i],
  ["Agriculture", /farm|agricult|livestock|crop|dairy|poultry|ranc|timber|forestry/i],
  ["Education & Research", /school|universit|college|educat|academic|research institute/i],
  ["Consulting & PR", /consult|strateg|advisory|public relations|marketing|advertis|communications/i],
  ["Retired / Individual", /retired|homemaker|self[- ]employed|student|housewife|independent/i],
];
function classifySector(employer = "", occupation = "") {
  const txt = `${employer} ${occupation}`;
  for (const [sector, re] of SECTOR_RULES) {
    if (re.test(txt)) return sector;
  }
  return "Other";
}
const PARTY_LABEL  = { Republican: "R", Democrat: "D", Independent: "I" };

function DistrictMap({ state, district, cycle, office, onSelect, memberRefreshKey = 0 }) {
  const [geo, setGeo]             = useState(null);
  const [geoErr, setGeoErr]       = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [members, setMembers]     = useState({});
  const [competitive, setCompetitive] = useState({}); // { "01": true, ... } for this state
  const [hover, setHover]         = useState(null);   // { cd, name, party, x, y } in container px
  // zoom/pan state
  const [zoom, setZoom]     = useState(1);
  const [pan, setPan]       = useState({ x: 0, y: 0 });
  const [drag, setDrag]     = useState(null); // { startX, startY, panX, panY, captured }
  const [isDragging, setIsDragging] = useState(false);
  const containerRef        = useRef(null);

  const fips      = STATE_FIPS[state];
  const n         = seatsFor(state, cycle);
  const isAtLarge = n <= 1;
  const stateName = STATES.find(([ab]) => ab === state)?.[1] || state;
  const mapUrl    = district && !isAtLarge
    ? `https://www.govtrack.us/congress/members/${state}/${Number(district)}`
    : `https://www.govtrack.us/congress/members/${state}`;

  // Reset zoom/pan when state changes
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [state]);

  // Fetch district GeoJSON
  useEffect(() => {
    if (!fips) return;
    setGeoLoading(true); setGeo(null); setGeoErr(null);
    const ctrl = new AbortController();
    fetch(`/api/districts/${fips}`, { signal: ctrl.signal })
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d?.error?.message || `HTTP ${r.status}`)))))
      .then((d) => { setGeo(d?.features || []); setGeoLoading(false); })
      .catch((e) => { if (e.name !== "AbortError") { setGeoErr(e.message); setGeoLoading(false); } });
    return () => ctrl.abort();
  }, [fips]);

  // Fetch member party data (re-runs when state changes OR after admin refresh)
  useEffect(() => {
    if (!state) return;
    const ctrl = new AbortController(); // discard out-of-order responses on state change/unmount
    fetch("/api/congress/members", { signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((all) => {
        const map = {};
        (all || []).filter((m) => m.state === state).forEach((m) => { map[m.district] = m; });
        setMembers(map);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [state, memberRefreshKey]);

  // Fetch contested district data
  useEffect(() => {
    const ctrl = new AbortController(); // discard out-of-order responses on state change/unmount
    fetch("/api/districts/competitive", { signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : {})
      .then((all) => setCompetitive(all[state] || {}))
      .catch(() => {});
    return () => ctrl.abort();
  }, [state]);

  // Latest zoom/pan for the wheel handler (attached once with empty deps below)
  const zoomRef = useRef(1);
  const panRef  = useRef({ x: 0, y: 0 });
  useEffect(() => { zoomRef.current = zoom; panRef.current = pan; }, [zoom, pan]);

  // Block passive wheel on the container so preventDefault works
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const z = zoomRef.current, p = panRef.current;
      const nz = Math.max(1, Math.min(10, z * factor));
      // keep the point under the cursor fixed
      const nx = mx - (mx - p.x) * (nz / z);
      const ny = my - (my - p.y) * (nz / z);
      setZoom(nz);
      setPan(clampPan(nx, ny, nz));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const clampPan = (x, y, z) => ({
    x: Math.max(MAP_W * (1 - z), Math.min(0, x)),
    y: Math.max(MAP_H * (1 - z), Math.min(0, y)),
  });

  const handlePointerDown = (e) => {
    if (e.button !== 0) return;
    // Don't capture yet — let clicks reach SVG paths normally.
    // Capture only kicks in once we detect real dragging (in handlePointerMove).
    setDrag({ startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, el: e.currentTarget, pid: e.pointerId });
    setIsDragging(false);
  };
  const handlePointerMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!isDragging) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // below threshold — still a click
      // crossed threshold: grab pointer so drag stays smooth even if cursor leaves the container
      try { drag.el.setPointerCapture(drag.pid); } catch { /* ignore */ }
      setIsDragging(true);
    }
    setPan(clampPan(drag.panX + dx, drag.panY + dy, zoom));
  };
  const handlePointerUp = () => { setDrag(null); setIsDragging(false); };

  const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const zoomIn    = () => { const nz = Math.min(10, zoom * 1.5); setZoom(nz); setPan((p) => clampPan(p.x, p.y, nz)); };
  const zoomOut   = () => { const nz = Math.max(1, zoom / 1.5); setZoom(nz); setPan((p) => clampPan(p.x, p.y, nz)); };

  // Build SVG paths from GeoJSON
  const { paths, cityDots } = useMemo(() => {
    if (!geo?.length) return { paths: null, cityDots: null };

    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    const walkCoords = (c) => {
      if (typeof c[0] === "number") {
        if (c[0] < minLon) minLon = c[0]; if (c[0] > maxLon) maxLon = c[0];
        if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
      } else { c.forEach(walkCoords); }
    };
    geo.forEach((f) => { if (f.geometry) walkCoords(f.geometry.coordinates); });

    const sx = (MAP_W - 2 * MAP_PAD) / (maxLon - minLon);
    const sy = (MAP_H - 2 * MAP_PAD) / (maxLat - minLat);
    const s  = Math.min(sx, sy);
    const ox = MAP_PAD + ((MAP_W - 2 * MAP_PAD) - (maxLon - minLon) * s) / 2;
    const oy = MAP_PAD + ((MAP_H - 2 * MAP_PAD) - (maxLat - minLat) * s) / 2;
    const px  = (lon) => ox + (lon - minLon) * s;
    const py  = (lat) => MAP_H - oy - (lat - minLat) * s;
    const pxS = (lon) => px(lon).toFixed(1);
    const pyS = (lat) => py(lat).toFixed(1);

    const ring2path = (ring) =>
      ring.map((c, i) => `${i ? "L" : "M"}${pxS(c[0])},${pyS(c[1])}`).join("") + "Z";
    const geo2path = (g) => {
      if (g.type === "Polygon")      return g.coordinates.map(ring2path).join("");
      if (g.type === "MultiPolygon") return g.coordinates.flatMap((p) => p.map(ring2path)).join("");
      return "";
    };
    const centroid = (g) => {
      const coords = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0];
      const nc = coords.length;
      return [coords.reduce((a, c) => a + c[0], 0) / nc, coords.reduce((a, c) => a + c[1], 0) / nc];
    };

    const noHighlight = office === "S" || office === "P";

    const built = geo.map((f, i) => {
      const cd      = f.properties?.CD119;
      const sel     = !noHighlight && (isAtLarge ? cd === "00" : cd === district);
      const member  = members[cd];
      const party   = member?.party;
      const contested = competitive[cd];
      const baseFill = PARTY_FILL[party] || "#252A1A";
      const [cLon, cLat] = f.geometry ? centroid(f.geometry) : [0, 0];
      const d = geo2path(f.geometry);
      return (
        <g key={i}>
          <path
            d={d}
            fill={sel ? "var(--brass)" : baseFill}
            fillOpacity={sel ? 0.9 : 0.92}
            stroke={sel ? "var(--brass)" : (PARTY_STROKE[party] || "#4A5030")}
            strokeWidth={sel ? 2 / zoom : 1 / zoom}
            style={{ cursor: onSelect && !noHighlight ? "pointer" : "default", transition: "fill 0.1s" }}
            onClick={() => !noHighlight && onSelect && cd && cd !== "00" && onSelect(cd)}
            onMouseEnter={(e) => {
              const rect = containerRef.current?.getBoundingClientRect();
              if (!rect) return;
              setHover({ cd, name: member?.name, party, contested,
                x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
            onMouseLeave={() => setHover(null)}
          />
          {/* contested district dashed overlay */}
          {contested && !sel && (
            <path d={d} fill="none"
              stroke="#D4A837" strokeWidth={1.5 / zoom} strokeDasharray={`${3/zoom},${3/zoom}`}
              strokeOpacity={0.6} style={{ pointerEvents: "none" }} />
          )}
        </g>
      );
    });

    const dots = (STATE_CITIES[state] || []).map((c, i) => {
      const cx = px(c.lon), cy = py(c.lat);
      if (cx < 0 || cx > MAP_W || cy < 0 || cy > MAP_H) return null;
      return (
        <g key={`city-${i}`} pointerEvents="none" style={{ pointerEvents: "none" }}>
          <circle cx={cx} cy={cy} r={2.2 / zoom} fill="var(--bone)" fillOpacity={0.7} pointerEvents="none" />
          <text x={cx + 4 / zoom} y={cy + 3 / zoom} fontSize={7.5 / zoom} fill="var(--bone)" fillOpacity={0.75}
            fontFamily="'IBM Plex Mono', monospace"
            pointerEvents="none"
            style={{ userSelect: "none", WebkitUserSelect: "none", pointerEvents: "none" }}
          >{c.n}</text>
        </g>
      );
    }).filter(Boolean);

    // cityDots rendered BEFORE paths so district paths stay on top and receive clicks
    return { paths: built, cityDots: dots };
  }, [geo, district, isAtLarge, members, competitive, onSelect, office, state, zoom]);

  const selMember = members[district];
  const distContested = competitive[district];

  return (
    <div style={{
      background: "var(--panel2)", border: "1px solid var(--line)",
      borderTop: "2px solid var(--olive)", padding: "14px 16px",
      display: "flex", alignItems: "flex-start", gap: 18, flexWrap: "wrap",
    }}>
      {/* SVG map */}
      <div style={{ flex: "1 1 auto", minWidth: 240, maxWidth: MAP_W }}>
        <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            {stateName} · 119th Congress
            {onSelect && office === "H" && <span style={{ marginLeft: 8, color: "var(--olive)" }}>· click district</span>}
          </span>
          {/* zoom controls */}
          <span style={{ display: "flex", gap: 4 }}>
            <button onClick={zoomIn}  title="Zoom in"  style={ZB_STYLE}>+</button>
            <button onClick={zoomOut} title="Zoom out" style={ZB_STYLE}>−</button>
            {zoom > 1 && <button onClick={resetZoom} title="Reset zoom" style={{ ...ZB_STYLE, color: "var(--brass)" }}>⌂</button>}
          </span>
        </div>
        {/* map container */}
        <div
          ref={containerRef}
          style={{
            width: "100%", maxWidth: MAP_W, height: MAP_H,
            background: "var(--ink)", border: "1px solid var(--line)",
            position: "relative", overflow: "hidden",
            cursor: drag ? "grabbing" : zoom > 1 ? "grab" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            touchAction: "none",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {geoLoading && <span className="fec-spin" style={{ fontSize: 11 }}>Loading boundaries</span>}
          {geoErr && (
            <div style={{ fontSize: 11, color: "var(--muted)", padding: 14, textAlign: "center", lineHeight: 1.6, pointerEvents: "none" }}>
              Boundaries not yet downloaded.<br />Use Admin → Run Script.
            </div>
          )}
          {paths && (
            <svg
              className="fec-map-svg"
              width={MAP_W} height={MAP_H}
              style={{ display: "block", position: "absolute", inset: 0, userSelect: "none", WebkitUserSelect: "none" }}
            >
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}
                 style={{ userSelect: "none", WebkitUserSelect: "none" }}>
                {paths}
                {cityDots}
              </g>
            </svg>
          )}
          {/* tooltip overlay div — unaffected by SVG transform */}
          {hover && (
            <div style={{
              position: "absolute",
              left: Math.min(hover.x + 6, MAP_W - 130),
              top: Math.max(hover.y - 38, 2),
              background: "#0D0F08ee",
              border: "1px solid var(--line)",
              borderRadius: 3, padding: "3px 7px",
              fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
              color: "var(--bone)", pointerEvents: "none", whiteSpace: "nowrap",
              lineHeight: 1.6,
            }}>
              <div>{state}-{hover.cd}{hover.party ? ` · ${PARTY_LABEL[hover.party] || hover.party[0]}` : ""}{hover.contested ? " ⚡" : ""}</div>
              {hover.name && <div style={{ color: "var(--muted)", fontSize: 9 }}>{hover.name.split(",")[0]}</div>}
            </div>
          )}
          {/* zoom level badge */}
          {zoom > 1 && (
            <div style={{
              position: "absolute", bottom: 4, right: 6,
              fontSize: 9, color: "var(--muted)", fontFamily: "'IBM Plex Mono', monospace",
              pointerEvents: "none",
            }}>{zoom.toFixed(1)}×</div>
          )}
        </div>
        <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 3, fontFamily: "'IBM Plex Mono', monospace" }}>
          scroll to zoom · drag to pan{onSelect && office === "H" ? " · click to select" : ""}
        </div>
      </div>

      {/* Legend / info */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 2, minWidth: 140 }}>
        <div style={{ fontSize: 12 }}>
          <span style={{ color: "var(--muted)" }}>District: </span>
          <span style={{ color: "var(--brass)", fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontWeight: 700, fontSize: 16 }}>
            {state}{isAtLarge ? " at-large" : `-${district}`}
          </span>
        </div>
        {selMember && (
          <div style={{ fontSize: 11, lineHeight: 1.5 }}>
            <div style={{ color: "var(--bone)" }}>{selMember.name}</div>
            <div style={{ color: selMember.party === "Republican" ? "#C05050" : selMember.party === "Democrat" ? "#5070C0" : "var(--muted)" }}>
              {selMember.party} · incumbent
            </div>
          </div>
        )}
        {distContested && (
          <div style={{ fontSize: 10, color: "#D4A837" }}>⚡ contested 2024</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {[
            ["var(--brass)", null, "Selected"],
            [PARTY_FILL.Republican, null, "Republican"],
            [PARTY_FILL.Democrat,   null, "Democrat"],
            ["var(--panel)", "1px solid var(--line)", "Unknown"],
            ["none", null, "⚡ contested"],
          ].map(([bg, border, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--muted)" }}>
              {bg === "none"
                ? <span style={{ display: "inline-block", width: 12, height: 8, border: "1.5px dashed #D4A837", borderRadius: 1 }} />
                : <span style={{ display: "inline-block", width: 12, height: 8, background: bg, border: border || "none", borderRadius: 1 }} />
              }
              {label}
            </div>
          ))}
        </div>
        <a href={mapUrl} target="_blank" rel="noopener noreferrer" style={{
          color: "var(--olive)", fontSize: 11, textDecoration: "none",
          borderBottom: "1px dotted var(--olive)", alignSelf: "flex-start", marginTop: 4,
        }}>
          GovTrack {isAtLarge ? state : `${state}-${district}`} ↗
        </a>
      </div>
    </div>
  );
}

// Zoom button style constant
const ZB_STYLE = {
  background: "var(--panel)", border: "1px solid var(--line)", color: "var(--muted)",
  fontSize: 12, cursor: "pointer", padding: "0 5px", lineHeight: "16px",
  fontFamily: "'IBM Plex Mono', monospace", borderRadius: 2,
};

// ---------- donor ledger caches (module-level, survive re-renders) ----------
const LEDGER_CACHE = new Map();  // key → {rows, lastIndexes, hasMore, count, ts}
const SPEND_CACHE  = new Map();  // key → {rows, lastIndexes, hasMore, count, ts}
const LEDGER_PAGE = 25;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes — re-fetches if tab left open
const cacheGet = (map, key) => {
  const v = map.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > CACHE_TTL_MS) { map.delete(key); return null; }
  return v;
};
const cacheSet = (map, key, data) => map.set(key, { ...data, ts: Date.now() });

// ---------- donor ledger component ----------
// Same normalization as the server's normalizeDonorKey, so ledger-side tracking lands on the
// identical watchlist key the Donors tab uses.
const ledgerDonorKey = (g) =>
  `${String(g.name || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim()}|${String(g.state || "").toUpperCase().trim()}`;

function DonorLedger({ target, cycle, raceState, onClose, onDonorInfo }) {
  const [trackedKeys, setTrackedKeys] = useState({}); // donorKey -> true (optimistic, this ledger only)
  const trackFromLedger = async (g) => {
    const donorKey = ledgerDonorKey(g);
    setTrackedKeys((p) => ({ ...p, [donorKey]: true }));
    try {
      await fetch("/api/donors/watch", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ donorKey, name: g.name, employer: g.employer || undefined, state: g.state || undefined }) });
    } catch { setTrackedKeys((p) => ({ ...p, [donorKey]: false })); }
  };
  const [rows, setRows] = useState([]);
  const [lastIndexes, setLastIndexes] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [individualsOnly, setIndividualsOnly] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [ai, setAi] = useState(null); // {loading} | {error, aggregates?} | {analysis, aggregates, model}
  const [mode, setMode] = useState("donations"); // donations | spending | outside
  const [spend, setSpend] = useState({ rows: [], lastIndexes: null, hasMore: true, count: null, loading: false, error: null });
  const [outside, setOutside] = useState(null); // null | {loading} | {rows} | {error}
  const [outsideProfiles, setOutsideProfiles] = useState({}); // spender key → {loading} | {open, analysis, error}
  const [spendAi, setSpendAi] = useState(null); // null | {loading} | {analysis, ...} | {error}
  const [spendGrouped, setSpendGrouped] = useState(true);
  const [spendProfiles, setSpendProfiles] = useState({}); // key → {loading} | {open, analysis, error}
  const [donorPage, setDonorPage]     = useState(0);
  const [spendPage, setSpendPage]     = useState(0);
  const [outsidePage, setOutsidePage] = useState(0);
  const [storedFallback, setStoredFallback] = useState(false); // FEC unreachable — rows came from the local store
  const rowsRef  = useRef([]);
  const spendRef = useRef([]);
  const loadingRef = useRef(false); // guards against concurrent/duplicate Schedule A loads
  const genRef = useRef(0); // bumped on every reset — stale in-flight fetches check it and discard

  const load = useCallback(async (reset = false) => {
    if (loadingRef.current && !reset) return; // a load is already in flight — don't double-fetch (resets always proceed)
    const gen = genRef.current;
    loadingRef.current = gen;
    setLoading(true); setError(null);
    const params = {
      committee_id: target.committeeId,
      two_year_transaction_period: String(cycle),
      sort: "-contribution_receipt_amount",
      per_page: "100",
    };
    if (individualsOnly) params.is_individual = "true";
    if (!reset && lastIndexes) {
      for (const [k, v] of Object.entries(lastIndexes)) if (v != null) params[k] = String(v);
    }
    try {
      const data = await fecGet("schedules/schedule_a/", params);
      if (gen !== genRef.current) return; // stale — a reset happened while this fetch was in flight
      const mapped = (data.results || []).map((r) => ({
        subId: r.sub_id != null ? String(r.sub_id) : null, // FEC unique line id (for dedup)
        name: r.contributor_name,
        street: r.contributor_street_1,
        city: r.contributor_city,
        state: r.contributor_state,
        zip: r.contributor_zip,
        employer: r.contributor_employer,
        occupation: r.contributor_occupation,
        fecId: r.contributor_id || null,
        amount: r.contribution_receipt_amount,
        ytd: r.contributor_aggregate_ytd,
        date: r.contribution_receipt_date,
        type: r.entity_type_desc || r.entity_type,
        isMemo: r.memo_code === "X",
        memo: r.memo_text,
        receiptType: r.receipt_type_full,
        txId: r.transaction_id || null,
        backRef: r.back_reference_transaction_id || null, // memo children point at their parent line
        // Pass-through, not a donor gift, when EITHER: (a) a named conduit processor
        // (WinRed/ActBlue/...), or (b) a MEMO line attributed to a non-individual entity —
        // e.g. AIPAC's "TOTAL EARMARKED THROUGH CONDUIT" batch summaries, whose dollars are
        // already itemized under each individual donor's own row. Verified live on Brian Jack
        // (GA-03): AIPAC memo lines "summed" to $2.4M against $1.7M total campaign receipts.
        isConduit: CONDUIT_RE.test((r.contributor_name || "").toUpperCase())
          || (r.memo_code === "X" && (r.entity_type || "") !== "" && !/^IND/i.test(r.entity_type)),
      }));
      // Dedupe by FEC sub_id so a pagination overlap or a stray double-load can't
      // count the same contribution twice.
      const combined = reset ? mapped : [...rowsRef.current, ...mapped];
      const seenIds = new Set();
      const nextRows = combined.filter((r) => {
        if (!r.subId) return true;
        if (seenIds.has(r.subId)) return false;
        seenIds.add(r.subId);
        return true;
      });
      const nextLI   = data.pagination?.last_indexes || null;
      const nextHM   = Boolean(data.pagination?.last_indexes) && mapped.length === 100;
      const nextCt   = data.pagination?.count ?? null;
      rowsRef.current = nextRows;
      setRows(nextRows);
      setCount(nextCt);
      setLastIndexes(nextLI);
      setHasMore(nextHM);
      setStoredFallback(false); // live FEC load succeeded
      // cache so re-opening same candidate skips the API call
      const ck = `${target.committeeId}-${cycle}-${individualsOnly ? "1" : "0"}`;
      cacheSet(LEDGER_CACHE, ck, { rows: nextRows, lastIndexes: nextLI, hasMore: nextHM, count: nextCt });
    } catch (e) {
      if (gen !== genRef.current) return; // stale — a reset happened while this fetch was in flight
      // FEC unreachable — fall back to rows the server has stored locally for this
      // committee/cycle. Only when nothing is loaded yet: a failed "load more" keeps
      // its live rows and shows the error instead of clobbering them with stored data.
      let fellBack = false;
      if (reset || rowsRef.current.length === 0) {
        try {
          const res = await fetch(`/api/fec/stored?committeeId=${encodeURIComponent(target.committeeId)}&cycle=${encodeURIComponent(String(cycle))}`);
          const data = res.ok ? await res.json().catch(() => null) : null;
          if (gen !== genRef.current) return;
          const stored = data?.rows || [];
          if (stored.length) {
            // Map stored rows to the exact shape the live schedule_a mapping produces above.
            const mapped = stored.map((r) => ({
              subId: r.subId != null ? String(r.subId) : null,
              name: r.name,
              street: null,
              city: r.city,
              state: r.state,
              zip: null,
              employer: r.employer,
              occupation: r.occupation,
              fecId: null,
              amount: r.amount,
              ytd: null,
              date: r.date,
              type: r.entityType,
              isMemo: r.memo === true || r.memo === "X",
              memo: typeof r.memo === "string" && r.memo !== "X" ? r.memo : null,
              receiptType: null,
              // same rule as the live path: named processors OR memo lines from non-individuals
              isConduit: CONDUIT_RE.test((r.name || "").toUpperCase())
                || ((r.memo === true || r.memo === "X") && (r.entityType || "") !== "" && !/^IND/i.test(r.entityType)),
            }));
            const seenIds = new Set();
            const nextRows = mapped.filter((r2) => {
              if (!r2.subId) return true;
              if (seenIds.has(r2.subId)) return false;
              seenIds.add(r2.subId);
              return true;
            });
            rowsRef.current = nextRows;
            setRows(nextRows);
            setCount(data.count ?? nextRows.length);
            setLastIndexes(null);
            setHasMore(false);
            setError(null);
            setStoredFallback(true);
            fellBack = true;
          }
        } catch { /* stored fallback unavailable — fall through to the original error */ }
      }
      if (!fellBack && gen === genRef.current) setError(e.message);
    } finally {
      // only the owning (non-superseded) load may clear the in-flight flag
      if (loadingRef.current === gen) {
        setLoading(false);
        loadingRef.current = false;
      }
    }
  }, [target.committeeId, cycle, individualsOnly, lastIndexes]);

  useEffect(() => {
    genRef.current += 1; // invalidate any in-flight fetches from the previous committee/cycle
    setAi(null); setMode("donations"); setStoredFallback(false);
    setSpend({ rows: [], lastIndexes: null, hasMore: true, count: null, loading: false, error: null });
    setOutside(null); setDonorPage(0); setSpendPage(0); setOutsidePage(0);
    // per-cycle caches — these are keyed by donor/recipient, not cycle, so they must not survive
    setProfiles({}); setCrossRefs({}); setSpendAi(null); setSpendProfiles({}); setOutsideProfiles({});
    const ck = `${target.committeeId}-${cycle}-${individualsOnly ? "1" : "0"}`;
    const cached = cacheGet(LEDGER_CACHE, ck);
    if (cached) {
      rowsRef.current = cached.rows;
      setRows(cached.rows); setLastIndexes(cached.lastIndexes);
      setHasMore(cached.hasMore); setCount(cached.count); setLoading(false); setError(null);
    } else {
      rowsRef.current = []; setRows([]); setLastIndexes(null); setHasMore(true);
      load(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.committeeId, individualsOnly, cycle]);

  // ---- Schedule B: committee disbursements (money out) ----
  const spendLoadingRef = useRef(false);
  const loadSpending = useCallback(async (reset = false) => {
    if (spendLoadingRef.current && !reset) return; // guard against concurrent/duplicate loads (resets always proceed)
    const gen = genRef.current;
    spendLoadingRef.current = gen;
    setSpend((s) => ({ ...s, loading: true, error: null }));
    const params = {
      committee_id: target.committeeId,
      two_year_transaction_period: String(cycle),
      sort: "-disbursement_amount",
      per_page: "100",
    };
    if (!reset && spend.lastIndexes) {
      for (const [k, v] of Object.entries(spend.lastIndexes)) if (v != null) params[k] = String(v);
    }
    try {
      const data = await fecGet("schedules/schedule_b/", params);
      if (gen !== genRef.current) return; // stale — a reset happened while this fetch was in flight
      const mapped = (data.results || []).map((r) => ({
        subId: r.sub_id != null ? String(r.sub_id) : null,
        recipient: r.recipient_name,
        city: r.recipient_city,
        state: r.recipient_state,
        purpose: r.disbursement_description,
        date: r.disbursement_date,
        amount: r.disbursement_amount,
      }));
      const combined = reset ? mapped : [...spendRef.current, ...mapped];
      const seenIds = new Set();
      const nextRows = combined.filter((r) => {
        if (!r.subId) return true;
        if (seenIds.has(r.subId)) return false;
        seenIds.add(r.subId);
        return true;
      });
      const nextLI   = data.pagination?.last_indexes || null;
      const nextHM   = Boolean(data.pagination?.last_indexes) && mapped.length === 100;
      const nextCt   = data.pagination?.count ?? null;
      spendRef.current = nextRows;
      setSpend({ rows: nextRows, lastIndexes: nextLI, hasMore: nextHM, count: nextCt, loading: false, error: null });
      const ck = `${target.committeeId}-${cycle}-spend`;
      cacheSet(SPEND_CACHE, ck, { rows: nextRows, lastIndexes: nextLI, hasMore: nextHM, count: nextCt });
    } catch (e) {
      if (gen === genRef.current) setSpend((s) => ({ ...s, loading: false, error: e.message }));
    } finally {
      // only the owning (non-superseded) load may clear the in-flight flag
      if (spendLoadingRef.current === gen) spendLoadingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.committeeId, cycle, spend.lastIndexes]);

  // ---- Schedule E: independent expenditures for/against this candidate ----
  const loadOutside = useCallback(async () => {
    setOutside({ loading: true });
    const base = { candidate_id: target.candidateId, sort: "-expenditure_amount", per_page: "100",
      two_year_transaction_period: String(cycle) };
    try {
      let data, cycleUsed = cycle;
      try { data = await fecGet("schedules/schedule_e/", base); }
      // If current cycle errors, try previous cycle (outside $ often lags)
      catch {
        data = await fecGet("schedules/schedule_e/", { ...base, two_year_transaction_period: String(cycle - 2) });
        cycleUsed = cycle - 2;
      }
      // Current cycle can also come back empty (not an error) — fall back the same way
      if (cycleUsed === cycle && !data.results?.length) {
        try {
          const prev = await fecGet("schedules/schedule_e/", { ...base, two_year_transaction_period: String(cycle - 2) });
          if (prev.results?.length) { data = prev; cycleUsed = cycle - 2; }
        } catch { /* keep the empty current-cycle result */ }
      }
      const mapped = (data.results || []).map((r) => ({
        spender: r.committee?.name || r.committee_id || "—",
        support: r.support_oppose_indicator,
        payee: r.payee_name,
        desc: r.expenditure_description,
        date: r.expenditure_date,
        amount: r.expenditure_amount,
      }));
      setOutside({ rows: mapped, cycleUsed });
    } catch (e) {
      setOutside({ error: e.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.candidateId, cycle]);

  useEffect(() => {
    if (mode === "spending" && !spend.rows.length && !spend.loading && !spend.error) {
      const ck = `${target.committeeId}-${cycle}-spend`;
      const cached = cacheGet(SPEND_CACHE, ck);
      if (cached) {
        spendRef.current = cached.rows;
        setSpend({ ...cached, loading: false, error: null });
      } else {
        spendRef.current = [];
        loadSpending(true);
      }
    }
    if (mode === "outside" && !outside) loadOutside();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- auto-fetch when user pages beyond what's loaded ----
  useEffect(() => {
    const total = grouped ? groups.length : rows.length;
    const pageStart = donorPage * LEDGER_PAGE;
    if (pageStart >= total && hasMore && !loading) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donorPage]);

  useEffect(() => {
    const pageStart = spendPage * LEDGER_PAGE;
    if (pageStart >= spend.rows.length && spend.hasMore && !spend.loading) loadSpending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendPage]);

  // ---- donor identity resolution ----
  // Conduit lines (WinRed/ActBlue) are pass-through aggregates of OTHER people's money;
  // the real donors appear as earmarked entries. Exclude conduits from grouping, and
  // dedupe memo entries that mirror an already-counted line (same name+date+amount).
  //
  // BACK-REFERENCE RESOLUTION (verified live on TN-01/Harshbarger): when memo lines
  // back-reference a loaded non-memo line's transaction_id, the memo CHILDREN are the true
  // attribution and the parent is a deposit/bundle line. Classic case: an over-limit gift
  // reported at $10,000 with memo children splitting it $3,500 donor / $3,000 spouse
  // (reattribution) — counting parent + children showed $13,500 from a donor whose real
  // attributed total was $7,000. So: parent → pass-through bucket, children counted.
  const txParents = new Set();
  {
    const nonMemoTx = new Set(rows.filter((r) => !r.isMemo && r.txId).map((r) => r.txId));
    for (const r of rows) if (r.isMemo && r.backRef && nonMemoTx.has(r.backRef)) txParents.add(r.backRef);
  }
  const isPassThrough = (r) => r.isConduit || (!r.isMemo && r.txId && txParents.has(r.txId));
  const personRows = rows.filter((r) => !isPassThrough(r));
  const conduitRows = rows.filter((r) => isPassThrough(r));
  const lineKey = (r) => `${(r.name || "").toUpperCase()}|${r.date || ""}|${r.amount}`;
  const nonMemoKeys = new Set(personRows.filter((r) => !r.isMemo).map(lineKey));
  const dedupedRows = personRows.filter((r) => !r.isMemo || !nonMemoKeys.has(lineKey(r)));

  const donorKey = (r) => `${(r.name || "").toUpperCase().replace(/[^A-Z ]/g, "").trim()}|${(r.zip || "").slice(0, 5)}`;
  const groups = (() => {
    const m = new Map();
    for (const r of dedupedRows) {
      const k = donorKey(r);
      const g = m.get(k) || {
        key: k, name: r.name, street: null, city: null, state: null, zip: null,
        employer: null, occupation: null, total: 0, count: 0, ytdMax: 0, lastDate: null, type: null, fecId: null,
      };
      g.total += Number(r.amount) || 0;
      g.count += 1;
      g.ytdMax = Math.max(g.ytdMax, Number(r.ytd) || 0);
      if (!g.fecId && r.fecId && r.type && !/^IND/i.test(r.type)) g.fecId = r.fecId;
      if (!g.type && r.type) g.type = r.type;
      if (!g.street && r.street) g.street = r.street;
      if (!g.city && r.city) { g.city = r.city; g.state = r.state; g.zip = r.zip; }
      if (!g.employer && r.employer) g.employer = r.employer;
      if (!g.occupation && r.occupation) g.occupation = r.occupation;
      if (!g.lastDate || (r.date && r.date > g.lastDate)) g.lastDate = r.date;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  })();
  const conduitTotal = conduitRows.reduce((a, r) => a + (Number(r.amount) || 0), 0);

  // ---- insights: sector rollup, timeline, geography ----
  const insights = useMemo(() => {
    if (!rows.length) return null;
    // sector rollup
    const sectorMap = {};
    for (const r of dedupedRows) {
      const s = classifySector(r.employer || "", r.occupation || "");
      if (!sectorMap[s]) sectorMap[s] = { sector: s, total: 0, count: 0 };
      sectorMap[s].total += Number(r.amount) || 0;
      sectorMap[s].count++;
    }
    const sectors = Object.values(sectorMap).sort((a, b) => b.total - a.total);

    // monthly timeline
    const monthMap = {};
    for (const r of dedupedRows) {
      if (!r.date) continue;
      const mo = r.date.slice(0, 7); // YYYY-MM
      if (!monthMap[mo]) monthMap[mo] = 0;
      monthMap[mo] += Number(r.amount) || 0;
    }
    const timeline = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b))
      .map(([month, total]) => ({ month, total }));

    // geography
    const geoMap = {};
    for (const r of dedupedRows) {
      const st = (r.state || "??").trim().toUpperCase();
      if (!geoMap[st]) geoMap[st] = 0;
      geoMap[st] += Number(r.amount) || 0;
    }
    const geo = Object.entries(geoMap).sort(([, a], [, b]) => b - a)
      .map(([state, total]) => ({ state, total }));
    const inState = geoMap[raceState?.toUpperCase()] || 0;
    const outState = (dedupedRows.reduce((a, r) => a + (Number(r.amount) || 0), 0)) - inState;

    return { sectors, timeline, geo, inState, outState };
  }, [dedupedRows, raceState]);

  // per-donor AI profile: key -> {open, loading, data?, error?}
  const [profiles, setProfiles] = useState({});
  // PAC cross-reference: key -> {open, loading, data?, error?, count?}
  const [crossRefs, setCrossRefs] = useState({});

  const loadCrossRef = async (g) => {
    const cur = crossRefs[g.key];
    if (cur?.open) { setCrossRefs((p) => ({ ...p, [g.key]: { ...cur, open: false } })); return; }
    if (cur?.data || cur?.error) { setCrossRefs((p) => ({ ...p, [g.key]: { ...cur, open: true } })); return; }
    setCrossRefs((p) => ({ ...p, [g.key]: { open: true, loading: true } }));
    try {
      const params = new URLSearchParams({
        committee_id: g.fecId,
        two_year_transaction_period: String(cycle),
        sort: "-disbursement_amount",
        per_page: "100",
      });
      const res = await fetch(`/api/fec/schedules/schedule_b/?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      // group by recipient, sum totals
      const recipMap = new Map();
      for (const r of data.results || []) {
        const rk = (r.recipient_name || "").toUpperCase().trim();
        if (!rk) continue;
        const ex = recipMap.get(rk) || { recipient: r.recipient_name, city: r.recipient_city, state: r.recipient_state, total: 0, count: 0, purpose: r.disbursement_description, type: r.entity_type_desc };
        ex.total += Number(r.disbursement_amount) || 0;
        ex.count++;
        recipMap.set(rk, ex);
      }
      const grouped = [...recipMap.values()].sort((a, b) => b.total - a.total);
      setCrossRefs((p) => ({ ...p, [g.key]: { open: true, data: grouped, count: data.pagination?.count } }));
    } catch (e) {
      setCrossRefs((p) => ({ ...p, [g.key]: { open: true, error: e.message } }));
    }
  };
  const profileDonor = async (g, forceRefresh = false) => {
    const cur = profiles[g.key];
    if (!forceRefresh) {
      if (cur?.open) { setProfiles((p) => ({ ...p, [g.key]: { ...cur, open: false } })); return; }
      if (cur?.data || cur?.error) { setProfiles((p) => ({ ...p, [g.key]: { ...cur, open: true } })); return; }
    }
    setProfiles((p) => ({ ...p, [g.key]: { open: true, loading: true } }));
    try {
      const res = await fetch("/api/analyze-donor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          donor: {
            name: g.name, fecId: g.fecId, entityType: g.type,
            employer: g.employer, occupation: g.occupation,
            city: g.city, state: g.state,
            total: g.total, count: g.count, ytd: g.ytdMax,
          },
          candidate: target.name,
          candidateParty: target.party,
          cycle,
          forceRefresh,
        }),
      });
      const data = await res.json().catch(() => null);
      setProfiles((p) => ({
        ...p,
        [g.key]: {
          open: true,
          data: data || {},
          error: data?.error?.message || (!res.ok && res.status !== 207 ? `Profile failed (HTTP ${res.status})` : null),
        },
      }));
    } catch (e) {
      setProfiles((p) => ({ ...p, [g.key]: { open: true, error: e.message } }));
    }
  };

  const exportCSV = () => {
    if (grouped) {
      downloadCSV(
        `donors_grouped_${target.committeeId}_${cycle}.csv`,
        ["donor_name", "street", "city", "state", "zip", "employer", "occupation", "contributions_loaded", "total_loaded", "committee_ytd_aggregate", "last_date"],
        groups.map((g) => [g.name, g.street, g.city, g.state, g.zip, g.employer, g.occupation, g.count, g.total, (isCommitteeDonor(g) && g.ytdMax) ? g.ytdMax : "", g.lastDate])
      );
    } else {
      downloadCSV(
        `donors_${target.committeeId}_${cycle}.csv`,
        ["contributor_name", "street", "city", "state", "zip", "employer", "occupation", "amount", "ytd_aggregate", "date", "entity_type", "memo", "receipt_type"],
        rows.map((r) => [r.name, r.street, r.city, r.state, r.zip, r.employer, r.occupation, r.amount, r.ytd, r.date, r.type, r.isMemo ? "X" : "", r.receiptType])
      );
    }
  };

  const exportPDF = () => {
    const fmtDollar = (n) =>
      n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

    // Capture the state map SVG from the DOM
    const svgEl = document.querySelector(".fec-map-svg") || document.querySelector("svg");
    let mapHtml = "";
    if (svgEl) {
      const w = Number(svgEl.getAttribute("width")) || 460;
      const h = Number(svgEl.getAttribute("height")) || 220;
      // Clone the SVG and fix up styles for static print layout:
      // - Remove position:absolute / inset:0 (those are for the live overlay)
      // - Inline CSS variable colors
      let svgStr = svgEl.outerHTML
        .replace(/position:\s*absolute[^;"']*/gi, "position:static")
        .replace(/inset:\s*0[^;"']*/gi, "")
        // reset any live pan/zoom so the print shows the full default map view
        .replace(/transform="translate\([^"]*?\)\s*scale\([^"]*?\)"/gi, 'transform="translate(0,0) scale(1)"')
        .replace(/var\(--brass\)/g, "#C8B560")
        .replace(/var\(--bone\)/g, "#E9E5D6")
        .replace(/var\(--ink\)/g, "#15170F")
        .replace(/var\(--olive\)/g, "#8A9A5B")
        .replace(/var\(--muted\)/g, "#9AA083");
      mapHtml = `
        <div style="background:#15170F; border:1px solid #3A3F2C; display:block; width:${w}px; margin-bottom:20px; overflow:hidden;">
          <div style="font-size:9px; letter-spacing:.12em; text-transform:uppercase; color:#9AA083; padding:5px 8px 3px;">
            ${raceState || ""} · 119th Congress
          </div>
          <div style="width:${w}px; height:${h}px; overflow:hidden; position:relative;">${svgStr}</div>
        </div>`;
    }

    // Overall AI donor summary
    let aiSummaryHtml = "";
    if (ai && !ai.loading && ai.analysis) {
      let aggsHtml = "";
      if (ai.aggregates) {
        const topEmp = (ai.aggregates.topEmployers || []).slice(0, 6)
          .map((e) => `<li><span>${escHtml(e.name)}</span><b>${fmtDollar(e.amount)}</b></li>`).join("");
        const topOcc = (ai.aggregates.topOccupations || []).slice(0, 6)
          .map((e) => `<li><span>${escHtml(e.name)}</span><b>${fmtDollar(e.amount)}</b></li>`).join("");
        aggsHtml = `<div class="aggs"><div><h4>Top Employers</h4><ul>${topEmp}</ul></div><div><h4>Top Occupations</h4><ul>${topOcc}</ul></div></div>`;
      }
      aiSummaryHtml = `
        <div class="ai-block">
          <div class="ai-label">AI Donor Summary · ${escHtml(ai.model)}</div>
          <div class="ai-caveat">Reflects only the ${Number(ai.sampleSize || 0).toLocaleString()} largest loaded contributions${count && count > (ai.sampleSize || 0) ? ` of ${Number(count).toLocaleString()} itemized on file` : ""} — a sample, not the complete donor base. Itemized FEC data excludes unitemized small-dollar gifts.</div>
          <div class="ai-text">${escHtml(ai.analysis)}</div>
          ${aggsHtml}
        </div>`;
    }

    // Build content by mode
    let modeLabel = "";
    let mainHtml = "";

    if (mode === "donations") {
      modeLabel = "Donor Report";

      // Insights section for PDF
      let insightsHtml = "";
      if (insights) {
        const totalLoaded = dedupedRows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
        const maxSector = insights.sectors[0]?.total || 1;
        const sectorBars = insights.sectors.slice(0, 8).map(({ sector, total }) =>
          `<div class="sector-row"><span>${sector}</span><div class="sector-bar-wrap"><div class="sector-bar" style="width:${Math.round((total/maxSector)*100)}%"></div></div><b>$${Math.round(total/1000)}K</b></div>`
        ).join("");
        const geoItems = insights.geo.slice(0, 6).map(({ state, total }) => `<b>${escHtml(state)}</b> $${Math.round(total/1000)}K`).join(" · ");
        // Timeline bars (inline SVG so it renders in print without CSS flex tricks)
        let timelineHtml = "";
        if (insights.timeline.length > 1) {
          const maxTL = Math.max(...insights.timeline.map((t) => t.total), 1);
          const barW = Math.max(6, Math.min(18, Math.floor(340 / insights.timeline.length)));
          const svgW = insights.timeline.length * barW;
          timelineHtml = `
            <div style="margin-top:14px">
              <div class="ai-label" style="margin-bottom:6px">Contribution Timeline</div>
              <svg viewBox="0 0 ${svgW} 48" width="${svgW}" height="48" xmlns="http://www.w3.org/2000/svg">
                <g>${insights.timeline.map(({ month, total }, i) => {
                  const h = Math.max(3, Math.round((total / maxTL) * 44));
                  return `<rect x="${i * barW}" y="${44 - h}" width="${barW - 2}" height="${h}" fill="#7a9a4b" rx="1"><title>${escHtml(month)}: $${Math.round(total/1000)}K</title></rect>`;
                }).join("")}</g>
              </svg>
              <div style="display:flex;justify-content:space-between;font-size:9px;color:#888;margin-top:2px;width:${svgW}px">
                <span>${escHtml(insights.timeline[0]?.month)}</span><span>${escHtml(insights.timeline[insights.timeline.length - 1]?.month)}</span>
              </div>
            </div>`;
        }
        insightsHtml = `
          <div class="insights">
            <div class="ai-label">Donor Insights · ${rows.length} contributions loaded</div>
            <div class="insights-grid">
              <div>
                <div class="ai-label" style="margin-bottom:8px">Industry Sectors</div>
                ${sectorBars}
                ${timelineHtml}
              </div>
              <div>
                <div class="ai-label" style="margin-bottom:8px">Geography</div>
                <div class="geo-row"><div class="geo-cell"><div class="geo-num">$${Math.round(insights.inState/1000)}K</div><div class="geo-lbl">In-state (${raceState || "?"})</div></div><div class="geo-cell"><div class="geo-num">$${Math.round(insights.outState/1000)}K</div><div class="geo-lbl">Out-of-state</div></div><div class="geo-cell"><div class="geo-num">${totalLoaded > 0 ? Math.round((insights.outState/totalLoaded)*100) : 0}%</div><div class="geo-lbl">Out-of-state %</div></div></div>
                <div style="font-size:10px;margin-top:8px;color:#555">${geoItems}</div>
              </div>
            </div>
          </div>`;
      }

      mainHtml = insightsHtml + (grouped ? groups : []).map((g) => {
        const pf = profiles[g.key];
        const analysis = pf?.data?.analysis || "";
        const links = pf?.data?.links || [];
        const linksHtml = links.length
          ? `<div class="links">${links.map((l) => `<a href="${escHtml(safeUrl(l.url))}">${escHtml(l.label)}</a>`).join("")}</div>`
          : "";
        const cr = crossRefs[g.key];
        const crossRefHtml = cr?.data?.length
          ? `<div style="margin-top:6px"><div class="ai-label" style="margin-bottom:4px">PAC Disbursements This Cycle (top ${Math.min(cr.data.length, 10)})</div>
              <table style="width:100%;border-collapse:collapse;font-size:9.5px">
                <thead><tr style="border-bottom:1px solid #ccc"><th style="text-align:left;padding:2px 4px">Recipient</th><th style="text-align:right;padding:2px 4px">Amount</th></tr></thead>
                <tbody>${cr.data.slice(0, 10).map((r) => `<tr style="border-bottom:1px solid #eee"><td style="padding:2px 4px">${escHtml(r.recipient || "—")}${r.city ? ` · ${escHtml([r.city, r.state].filter(Boolean).join(", "))}` : ""}</td><td style="text-align:right;padding:2px 4px;color:#1a5c2e;font-weight:700">${fmtDollar(r.total)}</td></tr>`).join("")}</tbody>
              </table>${cr.count > 100 ? `<div style="font-size:9px;color:#888;margin-top:3px">${cr.count.toLocaleString()} total disbursements — top 10 shown</div>` : ""}</div>`
          : "";
        return `
          <div class="item">
            <div class="item-name">${escHtml(g.name || "—")}</div>
            <div class="item-meta">${escHtml([g.employer, g.occupation, [g.city, g.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "))}</div>
            <div class="item-total">${fmtDollar(g.total)} · ${g.count} contribution${g.count === 1 ? "" : "s"}</div>
            ${analysis ? `<div class="analysis">${escHtml(analysis)}</div>` : ""}
            ${crossRefHtml}
            ${linksHtml}
          </div>`;
      }).join("");
    } else if (mode === "spending") {
      modeLabel = "Spending Report";
      let spendAiHtml = "";
      if (spendAi && !spendAi.loading && spendAi.analysis) {
        spendAiHtml = `
          <div class="ai-block">
            <div class="ai-label">AI Spending Analysis · ${escHtml(spendAi.model || "")}</div>
            <div class="ai-caveat">Based on the ${Math.min(spend.rows.length, 200).toLocaleString()} largest loaded disbursements${spend.count && spend.count > Math.min(spend.rows.length, 200) ? ` of ${Number(spend.count).toLocaleString()} on file` : ""} — a sample, not all spending.</div>
            <div class="ai-text">${escHtml(spendAi.analysis)}</div>
          </div>`;
      }
      // Spending categories
      let spendCatSection = "";
      if (spendCategories.length > 0) {
        const catTotal = spendCategories.reduce((a, c) => a + c.total, 0);
        const catRows = spendCategories.map(({ cat, total }) =>
          `<div class="sector-row"><span>${cat}</span><b>${Math.round((total/catTotal)*100)}% · $${Math.round(total/1000)}K</b></div>`
        ).join("");
        spendCatSection = `<div class="insights"><div class="ai-label" style="margin-bottom:8px">Spending by Category</div>${catRows}</div>`;
      }
      const recipientSections = (spendGrouped ? spendGroups : []).map((g) => {
        const sp = spendProfiles[g.key];
        const purposes = [...new Set(g.rows.map((r) => r.purpose).filter(Boolean))].slice(0, 5).join(", ");
        return `
          <div class="item">
            <div class="item-name">${escHtml(g.name || "—")}</div>
            <div class="item-meta">${escHtml([[g.city, g.state].filter(Boolean).join(", "), purposes].filter(Boolean).join(" · "))}</div>
            <div class="item-total">${fmtDollar(g.total)} · ${g.rows.length} payment${g.rows.length === 1 ? "" : "s"}</div>
            ${sp?.analysis ? `<div class="analysis">${escHtml(sp.analysis)}</div>` : ""}
          </div>`;
      }).join("");
      mainHtml = spendCatSection + spendAiHtml + recipientSections;
    } else if (mode === "outside") {
      modeLabel = "Outside Money Report";
      mainHtml = outsideGroups.map((g) => {
        const op = outsideProfiles[g.key];
        const forAgainst = [
          g.support > 0 ? `FOR ${fmtDollar(g.support)}` : "",
          g.oppose > 0 ? `AGAINST ${fmtDollar(g.oppose)}` : "",
        ].filter(Boolean).join(" / ");
        return `
          <div class="item">
            <div class="item-name">${escHtml(g.name || "—")}</div>
            <div class="item-meta">${forAgainst}</div>
            <div class="item-total">${fmtDollar(g.total)} total outside spending</div>
            ${op?.analysis ? `<div class="analysis">${escHtml(op.analysis)}</div>` : ""}
          </div>`;
      }).join("");
    }

    const genDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${modeLabel} — ${escHtml(target.name)} (${cycle})</title>
<style>
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 28px 36px; max-width: 800px; }
  h1 { font-size: 22px; font-weight: 800; margin: 0 0 3px; letter-spacing: -.02em; }
  .header-meta { color: #666; font-size: 10.5px; margin-bottom: 16px; }
  .ai-block { background: #f0f4e8; border-left: 3px solid #7a8f50; padding: 10px 14px; margin: 14px 0 18px; }
  .ai-label { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: #5a6f3a; margin-bottom: 6px; font-weight: 700; }
  .ai-caveat { font-size: 9.5px; color: #777; font-style: italic; line-height: 1.5; margin-bottom: 8px; }
  .ai-text { font-size: 11px; line-height: 1.65; white-space: pre-wrap; color: #222; }
  .aggs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; border-top: 1px solid #cfd8b8; padding-top: 10px; }
  .aggs h4 { font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: #5a6f3a; margin: 0 0 5px; font-weight: 700; }
  .aggs ul { margin: 0; padding: 0; list-style: none; }
  .aggs li { display: flex; justify-content: space-between; font-size: 10.5px; padding: 3px 0; border-bottom: 1px solid #e4ecd4; }
  .aggs li span { color: #333; }
  .aggs li b { color: #1a5c2e; font-weight: 700; }
  .item { border-top: 1px solid #e0e0e0; padding: 10px 0 8px; page-break-inside: avoid; }
  .item:first-of-type { border-top: 2px solid #bbb; }
  .item-name { font-size: 13px; font-weight: 700; margin-bottom: 1px; text-transform: uppercase; letter-spacing: .01em; }
  .item-meta { color: #666; font-size: 10px; margin-bottom: 3px; text-transform: uppercase; letter-spacing: .02em; }
  .item-total { font-weight: 700; color: #1a5c2e; font-size: 12px; margin-bottom: 4px; }
  .analysis { background: #f8f8f8; border-left: 3px solid #ccc; padding: 7px 10px; margin: 6px 0 4px; font-size: 10.5px; line-height: 1.55; white-space: pre-wrap; color: #333; }
  .links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .links a { font-size: 9.5px; color: #0055bb; text-decoration: none; border: 1px solid #b0c8ee; border-radius: 2px; padding: 1px 6px; }
  .insights { background: #f5f7f0; border-left: 3px solid #8A9A5B; padding: 10px 14px; margin: 14px 0; }
  .insights-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px; }
  .sector-row { display: flex; align-items: center; gap: 8px; font-size: 10.5px; padding: 3px 0; border-bottom: 1px solid #e4ecd4; }
  .sector-row span { flex: 0 0 160px; color: #333; }
  .sector-row b { flex: 0 0 40px; text-align: right; color: #1a5c2e; font-weight: 700; }
  .sector-bar-wrap { flex: 1; background: #e4ecd4; height: 6px; border-radius: 2px; overflow: hidden; }
  .sector-bar { height: 100%; background: #7a9a4b; border-radius: 2px; }
  .geo-row { display: flex; gap: 8px; margin-top: 4px; }
  .geo-cell { flex: 1; background: #eef1e8; padding: 5px 8px; border-radius: 3px; text-align: center; }
  .geo-num { font-size: 13px; font-weight: 700; color: #1a5c2e; }
  .geo-lbl { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-top: 2px; }
  @media print { body { padding: 16px 20px; } }
</style>
</head>
<body>
<h1>${escHtml(target.name)}</h1>
<div class="header-meta">${escHtml(target.party || "")} · Committee ${escHtml(target.committeeId)} · ${cycle} cycle · ${modeLabel} · Generated ${genDate}</div>
${mapHtml}
${aiSummaryHtml}
${mainHtml}
</body>
</html>`;

    printDocument(html);
  };

  const analyze = async (forceRefresh = false) => {
    setAi({ loading: true });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // send a flat, primitive-only projection of the fields the server actually uses —
          // never the live row objects, so the request body can't carry a cyclic reference
          donors: dedupedRows.map((r) => ({
            name: r.name, city: r.city, state: r.state,
            employer: r.employer, occupation: r.occupation, amount: r.amount,
          })),
          candidate: String(target.name || ""),
          party: String(target.party || ""),
          committeeId: String(target.committeeId || ""),
          cycle,
          raceState,
          forceRefresh,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAi({ error: data?.error?.message || `Analysis failed (HTTP ${res.status})`, aggregates: data?.aggregates });
        return;
      }
      setAi(data);
    } catch (e) {
      setAi({ error: e.message });
    }
  };

  const analyzeSpending = async (forceRefresh = false) => {
    if (!spend.rows.length) return;
    setSpendAi({ loading: true });
    try {
      const res = await fetch("/api/ai/spending", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: spend.rows.map((r) => ({
            recipient: r.recipient, city: r.city, state: r.state,
            purpose: r.purpose, date: r.date, amount: r.amount,
          })),
          candidate: String(target.name || ""), committeeId: String(target.committeeId || ""),
          cycle: String(cycle), forceRefresh,
        }),
      });
      const data = await res.json();
      if (!res.ok) setSpendAi({ error: data?.error?.message || "Analysis failed" });
      else setSpendAi(data);
    } catch (e) { setSpendAi({ error: e.message }); }
  };

  // Sum the same rows the grouped view counts (conduit pass-throughs and mirrored memo
  // lines excluded) so the header total doesn't double-count earmark pairs.
  const loadedTotal = dedupedRows.reduce((a, r) => a + (Number(r.amount) || 0), 0);

  // Group spending by recipient
  const spendGroups = useMemo(() => {
    const map = new Map();
    for (const r of spend.rows) {
      const key = (r.recipient || "Unknown").trim().toUpperCase();
      if (!map.has(key)) map.set(key, { key, name: r.recipient || "Unknown", city: r.city, state: r.state, rows: [], total: 0, lastDate: "" });
      const g = map.get(key);
      g.rows.push(r);
      g.total += Number(r.amount) || 0;
      if (!g.lastDate || r.date > g.lastDate) g.lastDate = r.date;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [spend.rows]);

  // Spending category breakdown
  const spendCategories = useMemo(() => {
    const SPEND_CATS = [
      ["Advertising & Media", /advertis|media buy|broadcast|tv\b|radio|digital ad|print|postage|mail|campaign literature|flyer|signage|yard sign/i],
      ["Consultants & Strategy", /consult|strateg|advisor|general consult|pollster|polling|research firm/i],
      ["Staff & Payroll", /salary|payroll|staff|wage|compensation|personnel|stipend|employee/i],
      ["Fundraising", /fundrais|event|gala|host|reception|ticket|contribution processing|actblue|winred/i],
      ["Travel & Lodging", /travel|airfare|flight|hotel|lodg|mileage|transportation|uber|lyft|car rental/i],
      ["Technology & Software", /tech|software|website|domain|hosting|app\b|platform|database|crm|email/i],
      ["Legal & Compliance", /legal|attorney|lawyer|compliance|fec|audit|accounting|bookkeep/i],
      ["Transfers to Committees", /transfer|contribution to|committee|party|pac\b/i],
      ["Office & Operations", /office|rent|utilities|supplies|equipment|printing|phone|copy/i],
    ];
    const catMap = {};
    for (const r of spend.rows) {
      const purpose = r.purpose || "";
      let cat = "Other";
      for (const [c, re] of SPEND_CATS) { if (re.test(purpose)) { cat = c; break; } }
      if (!catMap[cat]) catMap[cat] = 0;
      catMap[cat] += Number(r.amount) || 0;
    }
    return Object.entries(catMap).sort(([, a], [, b]) => b - a).map(([cat, total]) => ({ cat, total }));
  }, [spend.rows]);

  // Group outside $ by spender committee, sorted by total descending
  const outsideGroups = useMemo(() => {
    const rows = outside?.rows || [];
    const map = new Map();
    for (const r of rows) {
      const key = (r.spender || "Unknown").trim().toUpperCase();
      if (!map.has(key)) map.set(key, { key, name: r.spender || "Unknown", rows: [], total: 0, support: 0, oppose: 0 });
      const g = map.get(key);
      g.rows.push(r);
      g.total += Number(r.amount) || 0;
      if (r.support === "S") g.support += Number(r.amount) || 0;
      if (r.support === "O") g.oppose += Number(r.amount) || 0;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [outside?.rows]);

  const profileOutsideSpender = async (g, forceRefresh = false) => {
    const key = g.key;
    if (!forceRefresh) {
      if (outsideProfiles[key]?.open) { setOutsideProfiles((p) => ({ ...p, [key]: { ...p[key], open: false } })); return; }
      if (outsideProfiles[key]?.analysis !== undefined) { setOutsideProfiles((p) => ({ ...p, [key]: { ...p[key], open: true } })); return; }
    }
    setOutsideProfiles((p) => ({ ...p, [key]: { loading: true, open: true } }));
    try {
      const res = await fetch("/api/ai/spending", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: g.rows.map((r) => ({ recipient: r.spender, purpose: r.desc || r.payee, amount: r.amount, date: r.date })),
          candidate: `Outside spending on ${target.name} by ${g.name}`,
          cycle: String(cycle),
          forceRefresh,
        }),
      });
      const data = await res.json();
      if (!res.ok) setOutsideProfiles((p) => ({ ...p, [key]: { open: true, error: data?.error?.message || "Failed" } }));
      else setOutsideProfiles((p) => ({ ...p, [key]: { open: true, analysis: data.analysis, model: data.model, analysisAt: data.analysisAt, analysisCached: data.analysisCached } }));
    } catch (e) { setOutsideProfiles((p) => ({ ...p, [key]: { open: true, error: e.message } })); }
  };

  const profileRecipient = async (g, forceRefresh = false) => {
    const key = g.key;
    if (!forceRefresh) {
      if (spendProfiles[key]?.open) { setSpendProfiles((p) => ({ ...p, [key]: { ...p[key], open: false } })); return; }
      if (spendProfiles[key]?.analysis !== undefined) { setSpendProfiles((p) => ({ ...p, [key]: { ...p[key], open: true } })); return; }
    }
    setSpendProfiles((p) => ({ ...p, [key]: { loading: true, open: true } }));
    try {
      const purposes = [...new Set(g.rows.map((r) => r.purpose).filter(Boolean))].slice(0, 5).join(", ");
      const res = await fetch("/api/ai/spending", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rows: g.rows.map((r) => ({
            recipient: r.recipient, city: r.city, state: r.state,
            purpose: r.purpose, date: r.date, amount: r.amount,
          })),
          candidate: `${target.name} → ${g.name}`,
          cycle: String(cycle),
          forceRefresh,
        }),
      });
      const data = await res.json();
      if (!res.ok) setSpendProfiles((p) => ({ ...p, [key]: { open: true, error: data?.error?.message || "Failed" } }));
      else setSpendProfiles((p) => ({ ...p, [key]: { open: true, analysis: data.analysis, model: data.model, purposes, analysisAt: data.analysisAt, analysisCached: data.analysisCached } }));
    } catch (e) { setSpendProfiles((p) => ({ ...p, [key]: { open: true, error: e.message } })); }
  };

  return (
    <section className="fec-ledger" aria-label={`Donor ledger for ${target.name}`}>
      <div className="fec-ledger-head">
        <span className="fec-name">{target.name}</span>
        <span className="fec-tag">{target.party || "—"} · committee {target.committeeId}</span>
        <span className="fec-tab-nav" role="tablist" aria-label="Ledger view">
          {[["donations", "Donors"], ["spending", "Spending"], ...(target.candidateId ? [["outside", "Outside $"]] : [])].map(([m, label]) => (
            <button key={m} className="fec-tab" role="tab" style={{ fontSize: 14, padding: "2px 12px", whiteSpace: "nowrap" }}
              aria-selected={mode === m} onClick={() => setMode(m)}>{label}</button>
          ))}
        </span>
        <button className="close" onClick={onClose}>✕ Close</button>
      </div>

      {mode === "spending" && (
        <>
          <div className="fec-ledger-bar">
            <span className="fec-tag">
              {spend.count != null ? `${spend.count.toLocaleString()} disbursements on file` : ""} · {spend.rows.length} loaded
              ({fmtUSDshort(spend.rows.reduce((a, r) => a + (Number(r.amount) || 0), 0))}) · largest first — vendors, consultants, and transfers to other committees
            </span>
            <label className="fec-check" style={{ marginLeft: "auto" }}>
              <input type="checkbox" checked={spendGrouped} onChange={(e) => setSpendGrouped(e.target.checked)} />
              Group by recipient
            </label>
            <span style={{ display: "flex", gap: 8 }}>
              <button className="fec-btn ghost" disabled={!spend.rows.length || spendAi?.loading}
                onClick={() => analyzeSpending(false)}>
                {spendAi?.loading ? "Analyzing…" : "Analyze with local AI"}
              </button>
              <button className="fec-btn ghost" disabled={!spend.rows.length}
                onClick={() => downloadCSV(`spending_${target.committeeId}_${cycle}.csv`,
                  ["recipient", "city", "state", "purpose", "date", "amount"],
                  spend.rows.map((r) => [r.recipient, r.city, r.state, r.purpose, r.date, r.amount]))}>
                Export CSV ({spend.rows.length})
              </button>
              <button className="fec-btn ghost" onClick={exportPDF} disabled={!spend.rows.length}
                title="Export map, AI summaries, and spending data as a printable PDF">
                Export PDF
              </button>
            </span>
          </div>
          {spendAi && !spendAi.loading && (
            <div className="fec-ai">
              {spendAi.error ? (
                <><AiMeta label="Local AI · error" onRefresh={() => analyzeSpending(true)} refreshing={spendAi?.loading} /><div className="fec-ai-text">{spendAi.error}</div></>
              ) : (
                <>
                  <AiMeta model={spendAi.model} at={spendAi.analysisAt} cached={spendAi.analysisCached}
                    onRefresh={() => analyzeSpending(true)} refreshing={spendAi?.loading} />
                  <AiCaveat>
                    Based on the {Math.min(spend.rows.length, 200).toLocaleString()} largest loaded disbursement{Math.min(spend.rows.length, 200) === 1 ? "" : "s"}
                    {spend.count && spend.count > Math.min(spend.rows.length, 200) ? ` of ${Number(spend.count).toLocaleString()} on file` : ""}
                    {spend.hasMore ? " — load more for a fuller picture" : ""}.
                  </AiCaveat>
                  <div className="fec-ai-text">{spendAi.analysis}</div>
                  {spendAi.topRecipients && (
                    <div className="fec-ai-aggs">
                      <div>
                        <h4>Top recipients</h4>
                        <ul>{spendAi.topRecipients.slice(0, 6).map((e) => (
                          <li key={e.name}><span>{e.name}</span><b>{fmtUSDshort(e.amount)}</b></li>))}</ul>
                      </div>
                      <div>
                        <h4>By purpose</h4>
                        <ul>{(spendAi.topPurposes || []).slice(0, 6).map((e) => (
                          <li key={e.name}><span>{e.name}</span><b>{fmtUSDshort(e.amount)}</b></li>))}</ul>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {spendCategories.length > 0 && (
            <div className="fec-ai" style={{ padding: "12px 16px" }}>
              <div className="fec-ai-label" style={{ marginBottom: 8 }}>Spending by Category</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
                {spendCategories.map(({ cat, total }) => {
                  const pct = Math.round((total / (spendCategories.reduce((a, c) => a + c.total, 0))) * 100);
                  return (
                    <div key={cat} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid var(--line)" }}>
                      <span style={{ color: "var(--bone)" }}>{cat}</span>
                      <span><b style={{ color: "var(--brass)" }}>{fmtUSDshort(total)}</b><span style={{ color: "var(--muted)", marginLeft: 6 }}>{pct}%</span></span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {spend.error && <div className="fec-error" style={{ margin: "12px 16px" }} role="alert">{spend.error}</div>}
          <div className="fec-table-wrap">
            {spendGrouped ? (
              <table className="fec-table">
                <thead>
                  <tr><th>Recipient</th><th>Location</th><th>Payments</th><th>Last</th><th className="amt">Total</th><th></th></tr>
                </thead>
                <tbody>
                  {spendGroups.slice(spendPage * LEDGER_PAGE, (spendPage + 1) * LEDGER_PAGE).map((g) => {
                    const sp = spendProfiles[g.key];
                    const purposes = [...new Set(g.rows.map((r) => r.purpose).filter(Boolean))].slice(0, 3).join(" · ");
                    return (
                      <Fragment key={g.key}>
                        <tr>
                          <td>{g.name || "—"}{purposes && <div className="sub">{purposes}</div>}</td>
                          <td>{[g.city, g.state].filter(Boolean).join(", ") || "—"}</td>
                          <td>{g.rows.length}</td>
                          <td className="sub">{fmtDate(g.lastDate)}</td>
                          <td className="amt">{fmtUSD(g.total)}</td>
                          <td>
                            <button className="fec-btn ghost sm" onClick={() => profileRecipient(g)} aria-expanded={!!sp?.open}>
                              {sp?.loading ? "…" : sp?.open ? "Hide ▾" : "Profile ▸"}
                            </button>
                          </td>
                        </tr>
                        {sp?.open && (
                          <tr className="fec-profile-row">
                            <td colSpan={6}>
                              <div className="fec-profile">
                                {sp.loading && <span className="fec-spin">Analyzing payments to {g.name}…</span>}
                                {sp.analysis && (
                                  <>
                                    <AiMeta model={sp.model} at={sp.analysisAt} cached={sp.analysisCached}
                                      onRefresh={() => profileRecipient(g, true)} refreshing={sp?.loading} />
                                    <AiCaveat>Based on the {g.rows.length} loaded payment{g.rows.length === 1 ? "" : "s"} to this recipient{spend.hasMore ? "; not all disbursements are loaded yet" : ""}.</AiCaveat>
                                    <div className="fec-ai-text">{sp.analysis}</div>
                                  </>
                                )}
                                {sp.error && <div className="sub" style={{ color: "#B85B5B" }}>AI error: {sp.error}</div>}
                                {g.rows.length > 1 && (
                                  <table className="fec-table" style={{ marginTop: 10, fontSize: 11 }}>
                                    <thead><tr><th>Purpose</th><th>Date</th><th className="amt">Amount</th></tr></thead>
                                    <tbody>
                                      {g.rows.slice(0, 10).map((r, i) => (
                                        <tr key={i}>
                                          <td className="sub">{r.purpose || "—"}</td>
                                          <td className="sub">{fmtDate(r.date)}</td>
                                          <td className="amt">{fmtUSD(r.amount)}</td>
                                        </tr>
                                      ))}
                                      {g.rows.length > 10 && <tr><td colSpan={3} className="sub">+{g.rows.length - 10} more transactions</td></tr>}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="fec-table">
                <thead><tr><th>Recipient</th><th>Location</th><th>Purpose</th><th>Date</th><th className="amt">Amount</th></tr></thead>
                <tbody>
                  {spend.rows.slice(spendPage * LEDGER_PAGE, (spendPage + 1) * LEDGER_PAGE).map((r, i) => (
                    <tr key={i}>
                      <td>{r.recipient || "—"}</td>
                      <td>{[r.city, r.state].filter(Boolean).join(", ") || "—"}</td>
                      <td className="sub">{r.purpose || "—"}</td>
                      <td className="sub">{fmtDate(r.date)}</td>
                      <td className="amt">{fmtUSD(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {/* Prev / Next pager — spending */}
          {(() => {
            const total = spendGrouped ? spendGroups.length : spend.rows.length;
            const totalPages = Math.max(1, Math.ceil(total / LEDGER_PAGE));
            const isLastLoaded = spendPage >= totalPages - 1;
            return (
              <div className="fec-pager" style={{ padding: "0 16px 16px" }}>
                <button onClick={() => setSpendPage((p) => p - 1)} disabled={spendPage === 0 || spend.loading}>◂ Prev</button>
                <span className="fec-tag">
                  {spend.loading && isLastLoaded ? "Loading…" : `page ${spendPage + 1} / ${totalPages}${spend.hasMore ? "+" : ""}`}
                </span>
                <button onClick={() => setSpendPage((p) => p + 1)}
                  disabled={spend.loading || (isLastLoaded && !spend.hasMore)}>
                  {spend.loading && isLastLoaded ? "…" : "Next ▸"}
                </button>
                {spend.count != null && <span className="fec-tag" style={{ marginLeft: 8 }}>{spend.rows.length.toLocaleString()} loaded · {spend.count.toLocaleString()} total</span>}
              </div>
            );
          })()}
        </>
      )}

      {mode === "outside" && (
        <>
          <div className="fec-ledger-bar">
            <span className="fec-tag">
              Independent expenditures FOR or AGAINST {target.name} — outside money that never touches the campaign's books
              {outside?.cycleUsed && outside.cycleUsed !== cycle ? ` (no data for ${cycle}, showing ${outside.cycleUsed})` : ""}
              {outside?.rows?.length ? ` · ${outside.rows.length} transactions · ${fmtUSDshort(outside.rows.reduce((a, r) => a + (Number(r.amount) || 0), 0))} total · ${outsideGroups.length} spenders` : ""}
            </span>
            {outside?.rows?.length > 0 && (
              <button className="fec-btn ghost" style={{ marginLeft: "auto" }} onClick={exportPDF}
                title="Export map, AI summaries, and outside spending as a printable PDF">
                Export PDF
              </button>
            )}
          </div>
          {outside?.loading && <div style={{ padding: 16 }}><span className="fec-spin">Pulling Schedule E</span></div>}
          {outside?.error && <div className="fec-error" style={{ margin: "12px 16px" }} role="alert">{outside.error}</div>}
          {outside?.rows && (outside.rows.length === 0 ? (
            <div className="fec-empty" style={{ margin: 16 }}>No independent expenditures reported for this candidate in this cycle.</div>
          ) : (
            <div className="fec-table-wrap">
              <table className="fec-table">
                <thead>
                  <tr>
                    <th>Spender (committee)</th>
                    <th>For / Against</th>
                    <th className="amt">Total</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {outsideGroups.slice(outsidePage * LEDGER_PAGE, (outsidePage + 1) * LEDGER_PAGE).map((g) => {
                    const op = outsideProfiles[g.key];
                    return (
                      <Fragment key={g.key}>
                        <tr>
                          <td style={{ fontWeight: 500 }}>{g.name}</td>
                          <td>
                            {g.support > 0 && <span className="fec-badge" style={{ marginRight: 4 }}>FOR {fmtUSDshort(g.support)}</span>}
                            {g.oppose > 0 && <span className="fec-badge" style={{ borderColor: "#B85B5B", color: "#B85B5B" }}>AGAINST {fmtUSDshort(g.oppose)}</span>}
                          </td>
                          <td className="amt" style={{ fontWeight: 600 }}>{fmtUSD(g.total)}</td>
                          <td>
                            <button className="fec-btn ghost" style={{ fontSize: 11, padding: "1px 8px" }}
                              onClick={() => profileOutsideSpender(g)}
                              disabled={op?.loading}>
                              {op?.loading ? "…" : op?.open ? "Hide ▾" : "Profile ▸"}
                            </button>
                          </td>
                        </tr>
                        {/* expanded rows */}
                        {op?.open && !op?.loading && (
                          <tr className="fec-profile-row">
                            <td colSpan={4}>
                              <div className="fec-profile">
                                {op.error && <div className="fec-error">{op.error}</div>}
                                {op.analysis && (
                                  <>
                                    <AiMeta model={op.model} at={op.analysisAt} cached={op.analysisCached}
                                      onRefresh={() => profileOutsideSpender(g, true)} refreshing={op?.loading} />
                                    <AiCaveat>Based on the {g.rows.length} loaded independent-expenditure record{g.rows.length === 1 ? "" : "s"} for this spender — itemized Schedule E only.</AiCaveat>
                                    <div className="fec-ai-text">{op.analysis}</div>
                                  </>
                                )}
                                {/* detail rows for this spender */}
                                <table className="fec-table" style={{ marginTop: 8 }}>
                                  <thead><tr><th>Purpose / payee</th><th>For/Against</th><th>Date</th><th className="amt">Amount</th></tr></thead>
                                  <tbody>
                                    {[...g.rows].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).map((r, i) => (
                                      <tr key={i}>
                                        <td className="sub">{[r.desc, r.payee].filter(Boolean).join(" · ") || "—"}</td>
                                        <td>{r.support === "S" ? <span className="fec-badge">SUPPORT</span>
                                          : r.support === "O" ? <span className="fec-badge" style={{ borderColor: "#B85B5B", color: "#B85B5B" }}>OPPOSE</span> : "—"}</td>
                                        <td className="sub">{fmtDate(r.date)}</td>
                                        <td className="amt">{fmtUSD(r.amount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {outsideGroups.length > LEDGER_PAGE && (() => {
                const totalPages = Math.ceil(outsideGroups.length / LEDGER_PAGE);
                return (
                  <div className="fec-pager" style={{ padding: "0 16px 16px" }}>
                    <button onClick={() => setOutsidePage((p) => p - 1)} disabled={outsidePage === 0}>◂ Prev</button>
                    <span className="fec-tag">page {outsidePage + 1} / {totalPages}</span>
                    <button onClick={() => setOutsidePage((p) => p + 1)} disabled={outsidePage >= totalPages - 1}>Next ▸</button>
                  </div>
                );
              })()}
            </div>
          ))}
        </>
      )}

      {mode === "donations" && (<>
      <div className="fec-ledger-bar">
        <span className="fec-tag">
          {count != null ? `${count.toLocaleString()} itemized contributions on file` : ""} · {rows.length} loaded ({fmtUSDshort(loadedTotal)})
          {grouped ? ` · ${groups.length} unique donors` : " · largest first"}
        </span>
        <label className="fec-check">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          Group by donor
        </label>
        <label className="fec-check">
          <input type="checkbox" checked={individualsOnly} onChange={(e) => setIndividualsOnly(e.target.checked)} />
          Individuals only
        </label>
        <span style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
          <button className="fec-btn ghost" onClick={exportCSV} disabled={!rows.length}>
            Export CSV ({grouped ? groups.length : rows.length})
          </button>
          <button className="fec-btn ghost" onClick={exportPDF} disabled={!rows.length}
            title="Export map, AI summaries, totals, and links as a printable PDF">
            Export PDF
          </button>
          <button className="fec-btn ghost" onClick={() => analyze(false)} disabled={!dedupedRows.length || ai?.loading}>
            {ai?.loading ? "Analyzing…" : "Analyze with local AI"}
          </button>
        </span>
      </div>

      {grouped && conduitRows.length > 0 && (
        <div className="fec-ledger-bar" style={{ borderTop: "none" }}>
          <span className="fec-tag">
            ⓘ {conduitRows.length} conduit pass-through line{conduitRows.length === 1 ? "" : "s"} ({conduitRows[0].name}{conduitRows.some((r) => r.name !== conduitRows[0].name) ? " et al." : ""}, {fmtUSDshort(conduitTotal)}) excluded from grouping —
            that money belongs to the individual earmarked donors listed below.
          </span>
        </div>
      )}

      {storedFallback && (
        <div className="fec-ledger-bar" style={{ borderTop: "none" }}>
          <span className="fec-tag" style={{ color: "var(--brass)" }}>
            ⚠ FEC unreachable — showing {rows.length.toLocaleString()} stored rows (may be incomplete)
          </span>
        </div>
      )}

      {error && <div className="fec-error" style={{ margin: "12px 16px" }} role="alert">{error}</div>}

      {ai && !ai.loading && (
        <div className="fec-ai">
          {ai.error ? (
            <>
              <AiMeta label="Local AI · error" onRefresh={() => analyze(true)} refreshing={ai?.loading} />
              <div className="fec-ai-text">{ai.error}</div>
            </>
          ) : (
            <>
              <AiMeta model={ai.model} at={ai.analysisAt} cached={ai.analysisCached}
                onRefresh={() => analyze(true)} refreshing={ai?.loading} />
              <AiCaveat>
                Reflects only the {Number(ai.sampleSize || 0).toLocaleString()} largest loaded contribution{ai.sampleSize === 1 ? "" : "s"}
                {count && count > (ai.sampleSize || 0) ? ` of ${Number(count).toLocaleString()} itemized on file` : ""}
                {hasMore ? " — load more donors below for a fuller picture" : ""}. Itemized FEC data also excludes
                unitemized small-dollar gifts, so totals here are a sample, not the candidate's complete donor base.
              </AiCaveat>
              <div className="fec-ai-text">{ai.analysis}</div>
            </>
          )}
          {ai.aggregates && (
            <div className="fec-ai-aggs">
              <div>
                <h4>Top employers</h4>
                <ul>{(ai.aggregates.topEmployers || []).slice(0, 6).map((e) => (
                  <li key={e.name}><span>{e.name}</span><b>{fmtUSDshort(e.amount)}</b></li>))}</ul>
              </div>
              <div>
                <h4>Top occupations</h4>
                <ul>{(ai.aggregates.topOccupations || []).slice(0, 6).map((e) => (
                  <li key={e.name}><span>{e.name}</span><b>{fmtUSDshort(e.amount)}</b></li>))}</ul>
              </div>
              <div>
                <h4>Geography</h4>
                <ul>
                  <li><span>In-state ({raceState || "—"})</span><b>{fmtUSDshort(ai.aggregates.inStateAmount)}</b></li>
                  <li><span>Out-of-state</span><b>{fmtUSDshort(ai.aggregates.outOfStateAmount)}</b></li>
                  {(ai.aggregates.topStates || []).slice(0, 4).map((s) => (
                    <li key={s.name}><span>{s.name}</span><b>{fmtUSDshort(s.amount)}</b></li>))}
                </ul>
              </div>
              <div>
                <h4>Check size (by $ volume)</h4>
                <ul>{Object.entries(ai.aggregates.sizeBuckets || {}).map(([k, v]) => (
                  <li key={k}><span>{k}</span><b>{fmtUSDshort(v)}</b></li>))}</ul>
              </div>
            </div>
          )}
        </div>
      )}
      {ai?.loading && (
        <div className="fec-ai"><div className="fec-ai-label">Local AI</div>
          <span className="fec-spin">Running {rows.length} contributions through the model — first call after idle takes longer while the model loads</span>
        </div>
      )}

      {/* ── Donor Insights Panel ── */}
      {insights && rows.length > 0 && (() => {
        const maxSector = insights.sectors[0]?.total || 1;
        const maxTimeline = Math.max(...insights.timeline.map((t) => t.total), 1);
        const totalLoaded = dedupedRows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
        return (
          <div className="fec-ai" style={{ padding: "14px 16px" }}>
            <div className="fec-ai-label" style={{ marginBottom: 12 }}>Donor Insights · {rows.length} contributions loaded</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>

              {/* Sector rollup */}
              <div>
                <div className="fec-ai-label" style={{ marginBottom: 8 }}>Industry Sector Breakdown</div>
                {insights.sectors.slice(0, 8).map(({ sector, total }) => (
                  <div key={sector} style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 2 }}>
                      <span style={{ color: "var(--bone)" }}>{sector}</span>
                      <b style={{ color: "var(--brass)" }}>{fmtUSDshort(total)}</b>
                    </div>
                    <div style={{ background: "var(--ink)", height: 6, borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${Math.round((total / maxSector) * 100)}%`, height: "100%", background: "var(--olive)", borderRadius: 2 }} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Geography */}
                <div>
                  <div className="fec-ai-label" style={{ marginBottom: 6 }}>Geography</div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1, background: "var(--ink)", padding: "6px 10px", borderRadius: 3, textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--olive)" }}>{fmtUSDshort(insights.inState)}</div>
                      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".1em" }}>In-state ({raceState || "?"})</div>
                    </div>
                    <div style={{ flex: 1, background: "var(--ink)", padding: "6px 10px", borderRadius: 3, textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brass)" }}>{fmtUSDshort(insights.outState)}</div>
                      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".1em" }}>Out-of-state</div>
                    </div>
                    <div style={{ flex: 1, background: "var(--ink)", padding: "6px 10px", borderRadius: 3, textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--bone)" }}>
                        {totalLoaded > 0 ? `${Math.round((insights.outState / totalLoaded) * 100)}%` : "—"}
                      </div>
                      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".1em" }}>Out-of-state %</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                    {insights.geo.slice(0, 6).map(({ state, total }) => (
                      <span key={state} style={{ display: "inline-block", marginRight: 10, marginBottom: 3 }}>
                        <b style={{ color: "var(--bone)" }}>{state}</b> {fmtUSDshort(total)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Monthly timeline */}
                {insights.timeline.length > 1 && (
                  <div>
                    <div className="fec-ai-label" style={{ marginBottom: 6 }}>Contribution Timeline</div>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 50 }}>
                      {insights.timeline.map(({ month, total }) => (
                        <div key={month} title={`${month}: ${fmtUSDshort(total)}`}
                          style={{ flex: 1, background: "var(--olive)", opacity: 0.8,
                            height: `${Math.max(4, Math.round((total / maxTimeline) * 50))}px`,
                            borderRadius: "2px 2px 0 0", cursor: "default" }} />
                      ))}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--muted)", marginTop: 2 }}>
                      <span>{insights.timeline[0]?.month}</span>
                      <span>{insights.timeline[insights.timeline.length - 1]?.month}</span>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        );
      })()}

      <div className="fec-table-wrap">
        {grouped ? (
          <table className="fec-table">
            <thead>
              <tr>
                <th>Donor</th><th>Location</th><th>Employer / Occupation</th><th>Gifts</th><th>Last gift</th><th className="amt">Committee YTD</th><th className="amt">Loaded total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {groups.slice(donorPage * LEDGER_PAGE, (donorPage + 1) * LEDGER_PAGE).map((g) => {
                const pf = profiles[g.key];
                return (
                  <Fragment key={g.key}>
                    <tr>
                      <td>{g.name || "—"}{g.street && <div className="sub">{g.street}</div>}</td>
                      <td>{[g.city, g.state].filter(Boolean).join(", ") || "—"}{g.zip && <div className="sub">{(g.zip || "").slice(0, 5)}</div>}</td>
                      <td>{g.employer || "—"}<div className="sub">{g.occupation || ""}</div></td>
                      <td>{g.count}</td>
                      <td className="sub">{fmtDate(g.lastDate)}</td>
                      <td className="amt">{isCommitteeDonor(g) && g.ytdMax ? fmtUSD(g.ytdMax) : "—"}</td>
                      <td className="amt">{fmtUSD(g.total)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="fec-btn ghost sm" onClick={() => profileDonor(g)} aria-expanded={!!pf?.open}>
                          {pf?.loading ? "…" : pf?.open ? "Hide ▾" : "Profile ▸"}
                        </button>
                        {onDonorInfo && g.name && (
                          <>
                            {" "}
                            <button className="fec-btn ghost sm" onClick={() => onDonorInfo(g.name)}
                              title="Open this donor in the Donors tab — full cross-candidate giving history, tracking, flows">
                              Donor ▸
                            </button>
                            {" "}
                            {trackedKeys[ledgerDonorKey(g)]
                              ? <button className="fec-btn ghost sm" disabled title="On the Donors-tab watchlist">✓</button>
                              : <button className="fec-btn ghost sm" onClick={() => trackFromLedger(g)}
                                  title="Add to the donor watchlist — new gifts get flagged in Donors + 🔔 Alerts">☆</button>}
                          </>
                        )}
                      </td>
                    </tr>
                    {pf?.open && (
                      <tr className="fec-profile-row">
                        <td colSpan={8}>
                          <div className="fec-profile">
                            {pf.loading && <span className="fec-spin">Resolving identity in FEC records, then profiling with local AI</span>}
                            {!pf.loading && (
                              <>
                                {pf.data?.committee && (
                                  <div className="fec-profile-identity">
                                    <span className="chip">{pf.data.committee.type || "Committee"}</span>
                                    {pf.data.committee.designation && <span className="chip">{pf.data.committee.designation}</span>}
                                    {pf.data.committee.orgType && <span className="chip">{pf.data.committee.orgType}</span>}
                                    {pf.data.committee.connectedOrg && <span className="chip brass">Connected: {pf.data.committee.connectedOrg}</span>}
                                    {pf.data.committee.treasurer && <span className="sub">Treasurer: {pf.data.committee.treasurer}</span>}
                                  </div>
                                )}
                                {!pf.data?.committee && (
                                  <div className="fec-profile-identity">
                                    <span className="chip">{g.type || "Individual"}</span>
                                    <span className="sub">No FEC committee registration matched — likely an individual donor.</span>
                                  </div>
                                )}
                                {pf.data?.analysis && (
                                  <div style={{ marginTop: 10 }}>
                                    <AiMeta model={pf.data.model} at={pf.data.analysisAt} cached={pf.data.analysisCached}
                                      onRefresh={() => profileDonor(g, true)} refreshing={pf?.loading} />
                                    <div className="fec-ai-text">{pf.data.analysis}</div>
                                  </div>
                                )}
                                {pf.error && <div className="sub" style={{ marginTop: 10 }}>AI narrative unavailable: {pf.error}</div>}
                                {pf.data?.funders?.length > 0 && (
                                  <div style={{ marginTop: 12 }}>
                                    <div className="fec-ai-label">Who funds this committee (top {pf.data.funders.length} this cycle)</div>
                                    <ul className="fec-funders">
                                      {pf.data.funders.map((f, i) => (
                                        <li key={i}><span>{f.name}{f.employer ? ` · ${f.employer}` : ""}{f.state ? ` · ${f.state}` : ""}</span><b>{fmtUSDshort(f.amount)}</b></li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <OrgIntel data={pf.data} />
                                {/* PAC cross-reference — show who else this committee funded */}
                                {g.fecId && (() => {
                                  const cr = crossRefs[g.key];
                                  return (
                                    <div style={{ marginTop: 12 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                                        <div className="fec-ai-label" style={{ margin: 0 }}>PAC disbursements this cycle</div>
                                        <button className="fec-btn ghost sm" onClick={() => loadCrossRef(g)} aria-expanded={!!cr?.open}>
                                          {cr?.loading ? "…" : cr?.open ? "Hide ▾" : "Who else did they fund? ▸"}
                                        </button>
                                      </div>
                                      {cr?.open && !cr?.loading && (
                                        <>
                                          {cr.error && <div className="sub">Cross-ref failed: {cr.error}</div>}
                                          {cr.data?.length > 0 && (
                                            <>
                                              <table className="fec-table" style={{ marginTop: 4 }}>
                                                <thead>
                                                  <tr><th>Recipient</th><th>Location</th><th>Type</th><th>Txns</th><th className="amt">Total</th></tr>
                                                </thead>
                                                <tbody>
                                                  {cr.data.slice(0, 25).map((r, i) => (
                                                    <tr key={i}>
                                                      <td style={{ fontWeight: r.recipient?.toUpperCase().includes(target.name?.toUpperCase().slice(0, 8)) ? 600 : undefined }}>
                                                        {r.recipient || "—"}
                                                      </td>
                                                      <td className="sub">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</td>
                                                      <td className="sub">{r.type || r.purpose?.slice(0, 30) || "—"}</td>
                                                      <td className="sub">{r.count}</td>
                                                      <td className="amt">{fmtUSD(r.total)}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                              {cr.count != null && cr.count > 100 && (
                                                <div className="sub" style={{ marginTop: 4 }}>Showing top 25 of {cr.count.toLocaleString()} total disbursements · largest first</div>
                                              )}
                                            </>
                                          )}
                                          {cr.data?.length === 0 && <div className="sub">No disbursements found for this cycle.</div>}
                                        </>
                                      )}
                                    </div>
                                  );
                                })()}
                                {pf.data?.links?.length > 0 && (
                                  <div className="fec-profile-links">
                                    {pf.data.links.map((l) => (
                                      <a key={l.url} href={safeUrl(l.url)} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="fec-table">
            <thead>
              <tr>
                <th>Contributor</th><th>Location</th><th>Employer / Occupation</th><th>Type</th><th>Date</th><th className="amt">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(donorPage * LEDGER_PAGE, (donorPage + 1) * LEDGER_PAGE).map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.name || "—"}
                    {r.isConduit && <span className="fec-badge">CONDUIT</span>}
                    {r.isMemo && <span className="fec-badge memo">MEMO</span>}
                    {r.street && <div className="sub">{r.street}</div>}
                    {r.memo && <div className="sub">{r.memo}</div>}
                  </td>
                  <td>{[r.city, r.state].filter(Boolean).join(", ") || "—"}{r.zip && <div className="sub">{(r.zip || "").slice(0, 5)}</div>}</td>
                  <td>{r.employer || "—"}<div className="sub">{r.occupation || ""}</div></td>
                  <td className="sub">{r.type || "—"}</td>
                  <td className="sub">{fmtDate(r.date)}</td>
                  <td className="amt">{fmtUSD(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Prev / Next pager */}
      {(() => {
        const total = grouped ? groups.length : rows.length;
        const totalPages = Math.max(1, Math.ceil(total / LEDGER_PAGE));
        const isLastLoaded = donorPage >= totalPages - 1;
        return (
          <div className="fec-pager" style={{ padding: "0 16px 16px" }}>
            <button onClick={() => setDonorPage((p) => p - 1)} disabled={donorPage === 0 || loading}>◂ Prev</button>
            <span className="fec-tag">
              {loading && isLastLoaded ? "Loading…" : `page ${donorPage + 1} / ${totalPages}${hasMore ? "+" : ""}`}
            </span>
            <button onClick={() => setDonorPage((p) => p + 1)}
              disabled={loading || (isLastLoaded && !hasMore)}>
              {loading && isLastLoaded ? "…" : "Next ▸"}
            </button>
            {count != null && <span className="fec-tag" style={{ marginLeft: 8 }}>{rows.length.toLocaleString()} loaded · {count.toLocaleString()} total</span>}
          </div>
        );
      })()}
      </>)}
    </section>
  );
}

// ---------- Tennessee state records panel ----------

// Mini bar chart for year-over-year fundraising trend
function TnTrendChart({ points }) {
  if (!points?.length) return null;
  const max = Math.max(...points.map((p) => p.total), 1);
  const W = 340, H = 80, PAD = 10;
  const n = points.length;
  const slotW = (W - PAD * 2) / n;
  const barW = Math.max(slotW - 8, 10);
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} style={{ width: "100%", maxWidth: W, display: "block", overflow: "visible" }}>
      {points.map((p, i) => {
        const h = p.total > 0 ? Math.max(4, Math.round((p.total / max) * H)) : 4;
        const x = PAD + i * slotW + (slotW - barW) / 2;
        return (
          <g key={i}>
            <rect x={x} y={H - h} width={barW} height={h}
              fill={p.error ? "var(--line)" : "var(--brass)"} opacity={p.total > 0 ? 0.85 : 0.25} rx={2} />
            <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={9} fill="var(--sub)">{p.year.slice(0, 4)}</text>
            {p.total !== 0 && (
              <text x={x + barW / 2} y={H - h - 4} textAnchor="middle" fontSize={8} fill="var(--bone)">{p.total < 0 ? `-${fmtUSDshort(-p.total)}` : fmtUSDshort(p.total)}</text>
            )}
            <title>{p.year}: {fmtUSDshort(p.total)} ({(p.count || 0).toLocaleString()} records){p.error ? ` — ${p.error}` : ""}</title>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- Donors tab: cross-source donor watchlist / search / history ----------
const DONOR_GIFTS_PER = 25;

// Small per-cycle bar chart (mirrors TnTrendChart; self-contained for the Donors tab).
function DonorCycleChart({ points }) {
  if (!points?.length) return null;
  const max = Math.max(...points.map((p) => Math.abs(Number(p.total) || 0)), 1);
  const W = 340, H = 80, PAD = 10;
  const n = points.length;
  const slotW = (W - PAD * 2) / n;
  const barW = Math.max(slotW - 8, 10);
  const lbl = (v) => (v < 0 ? `-${fmtUSDshort(-v)}` : fmtUSDshort(v)); // fmtUSDshort mangles negatives — prepend the sign manually
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} style={{ width: "100%", maxWidth: W, display: "block", overflow: "visible" }}>
      {points.map((p, i) => {
        const total = Number(p.total) || 0;
        const h = total > 0 ? Math.max(4, Math.round((total / max) * H)) : 4;
        const x = PAD + i * slotW + (slotW - barW) / 2;
        return (
          <g key={i}>
            <rect x={x} y={H - h} width={barW} height={h}
              fill={total > 0 ? "var(--brass)" : "var(--line)"} opacity={total > 0 ? 0.85 : 0.35} rx={2} />
            <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize={9} fill="var(--sub)">{p.cycle}</text>
            {total !== 0 && (
              <text x={x + barW / 2} y={H - h - 4} textAnchor="middle" fontSize={8} fill="var(--bone)">{lbl(total)}</text>
            )}
            <title>{p.cycle}: {lbl(total)} ({(p.count || 0).toLocaleString()} gift{p.count === 1 ? "" : "s"})</title>
          </g>
        );
      })}
    </svg>
  );
}

// "fec" / "tn" source chip used across the Donors tab.
function DonorSourceBadge({ source, flush = false }) {
  if (!source) return null;
  return (
    <span className="fec-badge" style={{
      ...(flush ? { marginLeft: 0 } : {}),
      ...(source === "tn" ? { borderColor: "var(--brass)", color: "var(--brass)" } : {}),
    }}>{source}</span>
  );
}

// ---------- Donor AI: shared plumbing for the Ask AI / Research panels ----------
// Both donor endpoints stream the same NDJSON contract AskAI uses (status / step /
// tool_result / answer / error), so the reader, event switch, trace and sources
// renderers are factored once and shared by DonorAskAI and DonorResearch.
const donorToolLabel = (t) => ({
  donor_history: "stored giving history", wikipedia: "Wikipedia", news: "news headlines", web_search: "web search",
}[t] || t);

// POST + buffered-line NDJSON parse + final-line flush — same logic as AskAI's inline reader.
async function runDonorAi(endpoint, body, setSt) {
  setSt({ loading: true, status: "Starting…", trace: [], answer: "", citations: [], error: null });
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `HTTP ${res.status}`;
      try { msg = JSON.parse(text)?.error?.message || msg; } catch { /* body wasn't JSON */ }
      setSt({ loading: false, error: msg, trace: [], answer: "", citations: [] });
      return;
    }
    const trace = [];
    const apply = (ev) => {
      if (ev.type === "status") setSt((s) => ({ ...s, status: ev.note }));
      else if (ev.type === "step") { trace.push({ tool: ev.tool, running: true }); setSt((s) => ({ ...s, status: `Checking ${donorToolLabel(ev.tool)}…`, trace: [...trace] })); }
      else if (ev.type === "tool_result") { for (let i = trace.length - 1; i >= 0; i--) if (trace[i].tool === ev.tool && trace[i].running) { trace[i].running = false; trace[i].summary = ev.summary; break; } setSt((s) => ({ ...s, trace: [...trace] })); }
      else if (ev.type === "answer") setSt((s) => ({ ...s, loading: false, status: null, answer: ev.answer, citations: ev.citations || [], sources: ev.sources || [], model: ev.model, at: ev.at, cached: ev.cached, trace: [...trace] }));
      else if (ev.type === "error") setSt((s) => ({ ...s, loading: false, status: null, error: ev.message, trace: [...trace] }));
    };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { apply(JSON.parse(line)); } catch { /* ignore partial/garbage line */ }
      }
    }
    // flush a final event that arrived without a trailing newline
    if (buf.trim()) { try { apply(JSON.parse(buf.trim())); } catch { /* ignore partial line */ } }
    setSt((s) => (s && s.loading ? { ...s, loading: false, status: null } : s));
  } catch (e) {
    setSt((s) => ({ ...(s || {}), loading: false, status: null, error: e.message }));
  }
}

function DonorAiTrace({ st }) {
  if (!(st?.loading || st?.trace?.length > 0)) return null;
  return (
    <div className="fec-ask-trace">
      {(st.trace || []).map((t, i) => (
        <div key={i} className="fec-ask-step">
          <span className="fec-ask-tool">{t.running ? "▸" : "✓"} {donorToolLabel(t.tool)}</span>
          {t.summary && <span className="fec-ask-sum"> — {t.summary}</span>}
        </div>
      ))}
      {st?.loading && <div className="fec-ask-step fec-spin">{st.status || "Working…"}</div>}
    </div>
  );
}

function DonorAiSources({ sources, citations }) {
  if (sources?.length > 0) return (
    <div className="fec-ask-sources">
      <div className="fec-ai-label" style={{ marginBottom: 6 }}>Sources used ({sources.length})</div>
      {sources.map((s, i) => (
        <div key={i} className="fec-ask-source">
          <a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer" className="fec-src-title">
            <span className="fec-src-kind">{s.kind}</span>{s.title} ↗
          </a>
          {s.snippet && <div className="fec-src-snip">{s.snippet}</div>}
        </div>
      ))}
    </div>
  );
  if (citations?.length > 0) return (
    <div className="fec-profile-links" style={{ marginTop: 10 }}>
      {citations.map((c, i) => (
        <a key={i} href={safeUrl(c.url)} target="_blank" rel="noopener noreferrer">{c.label} ↗</a>
      ))}
    </div>
  );
  return null;
}

// ---------- Donor Ask AI: free-text agentic Q&A about one stored donor ----------
function DonorAskAI({ donorKey, name, employer, city, state }) {
  const [q, setQ] = useState("");
  const [lastQ, setLastQ] = useState("");
  const [st, setSt] = useState(null); // null | { loading, status, trace[], answer, citations[], model, at, cached, error }

  const SUGGESTIONS = [
    "What is this donor's giving pattern over time?",
    "Who does this donor give to the most — and is there a partisan lean?",
    "What do public sources say about this donor or their employer?",
    "Has their giving changed in the current cycle?",
  ];

  const ask = (forceRefresh = false) => {
    const question = (forceRefresh ? lastQ : q).trim();
    if (!question) return;
    setLastQ(question);
    runDonorAi("/api/donors/ask", {
      donorKey, name, employer: employer || undefined, city: city || undefined, state: state || undefined,
      question, forceRefresh,
    }, setSt);
  };

  return (
    <div className="fec-ask" style={{ marginTop: 0 }}>
      <div className="fec-ask-bar">
        <input
          className="fec-ask-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(false); }}
          placeholder={`Ask anything about ${name}…`}
          aria-label={`Ask AI about ${name}`}
          disabled={st?.loading}
        />
        <button className="fec-btn" onClick={() => ask(false)} disabled={st?.loading || !q.trim()}>
          {st?.loading ? "Researching…" : "Ask"}
        </button>
      </div>

      {!st && (
        <div className="fec-ask-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="fec-chip" onClick={() => { setQ(s); }}>{s}</button>
          ))}
        </div>
      )}

      <DonorAiTrace st={st} />

      {st?.error && <div className="fec-error" style={{ marginTop: 10 }}>Ask AI failed: {st.error}</div>}

      {st?.answer && (
        <div className="fec-ai" style={{ marginTop: 10 }}>
          <AiMeta label="Ask AI" model={st.model} at={st.at} cached={st.cached}
            onRefresh={() => ask(true)} refreshing={st.loading} />
          <AiCaveat>AI-generated from stored giving history, Wikipedia, news headlines and web search — it can be wrong or incomplete. Verify anything important against the cited sources before relying on it.</AiCaveat>
          <div className="fec-ai-text">{st.answer}</div>
          <DonorAiSources sources={st.sources} citations={st.citations} />
        </div>
      )}
    </div>
  );
}

// ---------- Donor Research: one-click cached AI brief on one stored donor ----------
function DonorResearch({ donorKey, name, employer, city, state }) {
  const [st, setSt] = useState(null); // same shape as DonorAskAI's st

  const run = (forceRefresh = false) => runDonorAi("/api/donors/research", {
    donorKey, name, employer: employer || undefined, city: city || undefined, state: state || undefined,
    forceRefresh,
  }, setSt);

  // Fetch on mount only — the component isn't rendered until its toggle opens,
  // so nobody pays for AI research they didn't ask for.
  useEffect(() => { run(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <DonorAiTrace st={st} />

      {st?.error && (
        <div className="fec-error" style={{ marginTop: 10 }}>
          Research failed: {st.error}{" "}
          <button className="fec-btn ghost sm" onClick={() => run(false)}>↺ Retry</button>
        </div>
      )}

      {st?.answer && (
        <div className="fec-ai" style={{ marginTop: 10 }}>
          <AiMeta label="Research" model={st.model} at={st.at} cached={st.cached}
            onRefresh={() => run(true)} refreshing={st.loading} />
          <AiCaveat>AI-generated from stored giving history, Wikipedia, news headlines and web search — it can be wrong or incomplete. Verify anything important against the cited sources before relying on it.</AiCaveat>
          <div className="fec-ai-text">{st.answer}</div>
          <DonorAiSources sources={st.sources} citations={st.citations} />
        </div>
      )}
    </div>
  );
}

// ---- shared-donor overlap panel (Money Race ⇄ comparison) ----
// Renders /api/donors/overlap: donors who gave to 2+ of the selected candidates, one amount
// column per candidate. Conduits are excluded server-side; org/PAC donors get a badge.
function OverlapPanel({ ov, onClose, onRerun }) {
  const data = ov?.data;
  const mode = ov?.mode || "donors";
  const noun = mode === "vendors" ? "vendor" : "donor";
  const short = (s) => { const t = String(s || "").split(",")[0].trim(); return t.length > 16 ? `${t.slice(0, 15)}…` : t || "—"; };
  const usd = (v) => (v < 0 ? `-${fmtUSDshort(-v)}` : fmtUSDshort(v));
  const exportCSV = () => {
    if (!data?.donors?.length) return;
    downloadCSV(`shared_${noun}s.csv`,
      [mode === "vendors" ? "Vendor" : "Donor", "Type", "Employer", "Occupation", "Location", ...data.targets.map((t) => t.name), "Races hit", "Total"],
      data.donors.map((d) => [d.name, d.org ? "org/PAC" : "individual", d.employer, d.occupation,
        [d.city, d.state].filter(Boolean).join(", "), ...d.per.map((p) => (p.count ? p.total : "")), d.targetsHit, d.total]));
  };
  return (
    <div className="fec-ledger" style={{ marginTop: 12 }}>
      <div className="fec-ledger-head">
        <span className="fec-name">⇄ Shared {noun}s</span>
        <span className="fec-tag">
          {data ? `${data.sharedCount} ${noun}${data.sharedCount === 1 ? "" : "s"} ${mode === "vendors" ? "paid by" : "gave to"} 2+ of the selected · ${data.cycle === "all" ? "all stored cycles" : `cycle ${data.cycle}`}` : ""}
        </span>
        {data && (
          <button className="fec-btn ghost sm" onClick={() => onRerun(ov.allCycles, mode === "vendors" ? "donors" : "vendors")}
            title="Flip between shared donors (money in) and shared vendors (money out — same consultants/media firms is a coordination tell)">
            {mode === "vendors" ? "Donors ⇄" : "Vendors ⇄"}
          </button>
        )}
        {data && (
          <button className="fec-btn ghost sm" onClick={() => onRerun(!ov.allCycles, mode)}
            title="Toggle between the selected cycle and every stored cycle">
            {ov.allCycles ? "This cycle only" : "All cycles"}
          </button>
        )}
        <button className="fec-btn ghost sm" onClick={exportCSV} disabled={!data?.donors?.length}>
          Export CSV ({data?.donors?.length || 0})
        </button>
        <button className="close" onClick={onClose}>Close ✕</button>
      </div>
      {ov?.error && <div className="fec-error" role="alert" style={{ margin: 10 }}>{ov.error}</div>}
      {data && (
        <>
          <div className="fec-ledger-bar" style={{ flexWrap: "wrap", gap: 6 }}>
            {data.targets.map((t) => (
              <span key={t.name} className="fec-tag">{t.name}: {t.donors} stored {noun}{t.donors === 1 ? "" : "s"}</span>
            ))}
          </div>
          {(data.conduitNote || data.note) && (
            <div className="sub" style={{ padding: "6px 16px" }}>{[data.conduitNote, data.note].filter(Boolean).join(" · ")}</div>
          )}
          {data.donors.length === 0 ? (
            <div className="fec-empty" style={{ margin: 12 }}>
              No shared {noun}s in the stored ledger yet — a top-100 top-up pull per committee runs automatically (once a day).
              {mode === "vendors" ? " Open each candidate's Flows and hit ⤢ Trace FEC," : " Open each candidate's Donors ledger and page deeper,"} then compare again.
            </div>
          ) : (
            <div className="fec-table-wrap" style={{ padding: "0 12px 12px" }}>
              <table className="fec-table">
                <thead>
                  <tr>
                    <th>{mode === "vendors" ? "Vendor" : "Donor"}</th><th>Employer / Occupation</th><th>Loc</th>
                    {data.targets.map((t) => <th key={t.name} className="amt" title={t.name}>{short(t.name)}</th>)}
                    <th className="amt">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.donors.map((d) => (
                    <tr key={d.donorKey}>
                      <td>
                        <b style={{ color: "var(--bone)" }}>{d.name || d.donorKey.split("|")[0]}</b>
                        {d.org && <span className="fec-badge memo" title={`FEC entity type ${d.entityType || "?"} — PAC / party / org money`}>org</span>}
                        {d.watched && <span title="On your watchlist" style={{ marginLeft: 6, color: "var(--brass)" }}>★</span>}
                      </td>
                      <td className="sub">{[d.employer, d.occupation].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="sub">{[d.city, d.state].filter(Boolean).join(", ") || "—"}</td>
                      {d.per.map((p, i) => (
                        <td key={i} className="amt">{p.count ? usd(p.total) : <span className="sub">—</span>}</td>
                      ))}
                      <td className="amt"><b>{usd(d.total)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="sub" style={{ padding: "0 16px 12px" }}>{data.coverage}</div>
        </>
      )}
    </div>
  );
}

// ---- money-flow graph ----
// 5-column deterministic flow layout around /api/graph's center node:
// [where donors also give] [donors in] [CENTER] [money out] [who else pays / co-donors].
// Edge width ∝ √amount; click any non-center node to re-center on it (breadcrumb Back).
const FLOW_KIND_COLOR = { committee: "var(--brass)", donor: "var(--bone)", org: "var(--rose)", conduit: "var(--muted)", payee: "var(--olive)" };
// tnPull (optional {id, name}): TN entities can't Trace FEC — instead a "⤢ Pull TN reports"
// button feeds the ledger through /api/tn/ledger (which parses + ingests the entity's filed
// reports) and then redraws the graph.
function FlowGraph({ committeeId = "", donorKey = "", name = "", cycle = "", bare = false, tnPull = null }) {
  const [center, setCenter] = useState({ committeeId, donorKey, name });
  const [trail, setTrail] = useState([]); // previous centers, for ◂ Back
  const [st, setSt] = useState({ loading: true }); // {loading} | {data} | {error}
  // scope: "all" | "y:<year-or-cycle>" | "r:<year>|<report name>" (TN reports only).
  // FEC graphs start scoped to the viewed cycle; TN graphs start at all years.
  const [scopeSel, setScopeSel] = useState(cycle ? `y:${cycle}` : "all");
  const [candOnly, setCandOnly] = useState(false); // cleaner view: only candidate-committee flows
  const [tracing, setTracing] = useState(false);
  const [tnPulling, setTnPulling] = useState(false);
  const [sel, setSel] = useState(null); // clicked node/edge → {donorKey?, committeeId?, kind?, label, node?}
  const [selRows, setSelRows] = useState(null); // {loading} | {data} | {error} — itemized rows for sel
  const genRef = useRef(0); // generation token — a re-center mid-flight must not clobber

  const load = useCallback(async (c, { trace = false } = {}) => {
    const gen = ++genRef.current;
    if (trace) setTracing(true); else setSt({ loading: true });
    try {
      const qs = new URLSearchParams();
      if (c.committeeId) qs.set("committeeId", c.committeeId); else qs.set("donorKey", c.donorKey);
      if (c.name) qs.set("name", c.name);
      if (scopeSel.startsWith("y:")) qs.set("cycle", scopeSel.slice(2));
      else if (scopeSel.startsWith("r:")) {
        const bar = scopeSel.indexOf("|");
        qs.set("cycle", scopeSel.slice(2, bar));
        qs.set("report", scopeSel.slice(bar + 1));
      }
      if (candOnly) qs.set("candOnly", "1");
      if (trace) qs.set("trace", "1");
      const res = await fetch(`/api/graph?${qs}`);
      const data = await res.json().catch(() => null);
      if (gen !== genRef.current) return;
      if (!res.ok) throw new Error(data?.error?.message || `Graph failed (HTTP ${res.status})`);
      setSt({ data });
    } catch (e) {
      if (gen === genRef.current) setSt({ error: e.message });
    } finally {
      if (gen === genRef.current) setTracing(false);
    }
  }, [scopeSel, candOnly]);

  useEffect(() => { setSel(null); setSelRows(null); load(center); }, [center, load]); // new center/cycle scope → stale filter would mislead

  // Itemized rows for the clicked node/edge — the drill-down table under the graph.
  useEffect(() => {
    if (!sel) { setSelRows(null); return; }
    let live = true;
    (async () => {
      setSelRows({ loading: true });
      try {
        const qs = new URLSearchParams();
        if (sel.donorKey) qs.set("donorKey", sel.donorKey);
        if (sel.committeeId) qs.set("committeeId", sel.committeeId);
        if (sel.kind) qs.set("kind", sel.kind);
        if (scopeSel.startsWith("y:")) qs.set("cycle", scopeSel.slice(2));
        else if (scopeSel.startsWith("r:")) {
          const bar = scopeSel.indexOf("|");
          qs.set("cycle", scopeSel.slice(2, bar));
          qs.set("report", scopeSel.slice(bar + 1));
        }
        const res = await fetch(`/api/flows/rows?${qs}`);
        const data = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) throw new Error(data?.error?.message || `Rows failed (HTTP ${res.status})`);
        setSelRows({ data });
      } catch (e) { if (live) setSelRows({ error: e.message }); }
    })();
    return () => { live = false; };
  }, [sel, scopeSel]);

  const recenter = (n) => {
    if (n.center) return;
    const next = n.committeeId ? { committeeId: String(n.committeeId), donorKey: "", name: n.name || "" }
      : n.donorKey ? { committeeId: "", donorKey: n.donorKey, name: n.name || "" } : null;
    if (!next) return;
    setTrail((t) => [...t, center].slice(-12));
    setCenter(next);
  };

  // Click a node → filter the itemized table to that donor / payee / committee (click again clears).
  const selectNode = (n) => {
    if (n.center) return;
    const s = n.kind === "committee"
      ? { committeeId: String(n.committeeId), label: n.name, node: n }
      : { donorKey: n.donorKey, kind: n.kind === "payee" ? "disbursement" : "contribution", label: n.name, node: n };
    setSel((cur) => (cur?.node?.id === n.id ? null : s));
  };

  // Click an edge → filter to exactly that flow (every edge joins one committee and one keyed entity).
  const selectEdge = (e, nodeById) => {
    const nf = nodeById.get(e.from), nt = nodeById.get(e.to);
    if (!nf || !nt) return;
    const committee = nf.kind === "committee" ? nf : nt.kind === "committee" ? nt : null;
    const keyed = nf.kind === "committee" ? nt : nf;
    if (!committee && !keyed) return;
    setSel({
      committeeId: committee?.committeeId ? String(committee.committeeId) : undefined,
      donorKey: keyed?.donorKey || undefined,
      kind: e.kind, label: `${nf.name} → ${nt.name}`,
      node: keyed?.donorKey ? keyed : committee,
    });
  };

  const data = st.data;
  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const nTotal = new Map();
  for (const e of edges) {
    nTotal.set(e.from, (nTotal.get(e.from) || 0) + (e.total || 0));
    nTotal.set(e.to, (nTotal.get(e.to) || 0) + (e.total || 0));
  }
  const cols = Array.from({ length: 5 }, () => []);
  for (const n of nodes) cols[Math.min(Math.max(n.col ?? 2, 0), 4)].push(n);
  for (const c of cols) c.sort((a, b) => (b.center ? 1 : 0) - (a.center ? 1 : 0) || (nTotal.get(b.id) || 0) - (nTotal.get(a.id) || 0));
  const maxRows = Math.max(1, ...cols.map((c) => c.length));
  const H = Math.max(280, maxRows * 30 + 80);
  const W = 1080, PAD = 150;
  const pos = new Map();
  cols.forEach((c, ci) => {
    const x = PAD + (ci * (W - 2 * PAD)) / 4;
    const step = c.length > 1 ? Math.min(48, (H - 80) / (c.length - 1)) : 0;
    const y0 = H / 2 - (step * (c.length - 1)) / 2;
    c.forEach((n, i) => pos.set(n.id, { x, y: y0 + i * step }));
  });
  const maxEdge = Math.max(1, ...edges.map((e) => e.total || 0));
  const trunc = (s, n = 26) => { const t = String(s || ""); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const usd = (v) => (v < 0 ? `-${fmtUSDshort(-v)}` : fmtUSDshort(v));
  const drawable = nodes.length > 1 && edges.length > 0;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const exportSelCSV = () => {
    const rows = selRows?.data?.rows || [];
    if (!rows.length) return;
    downloadCSV("flow_rows.csv",
      ["Date", "Kind", "From", "To", "Employer", "Occupation", "Purpose", "City", "State", "Cycle", "Source", "Amount"],
      rows.map((r) => [r.date, r.kind,
        r.kind === "disbursement" ? (r.recipientName || r.recipientId) : r.donorName,
        r.kind === "disbursement" ? r.donorName : (r.recipientName || r.recipientId),
        r.employer, r.occupation, r.kind === "disbursement" ? r.report : "", r.city, r.state, r.cycle, r.source, r.amount]));
  };

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: bare ? "0 0 8px" : "10px 16px", borderBottom: bare ? "none" : "1px solid var(--line)" }}>
        <span className="fec-ai-label" style={{ marginBottom: 0 }}>Money flows</span>
        <span className="fec-tag">
          {center.name || center.committeeId || center.donorKey.split("|")[0]}
          {` · ${scopeSel === "all" ? "all years" : scopeSel.startsWith("y:") ? scopeSel.slice(2) : scopeSel.slice(2).replace("|", " · ")}`}
        </span>
        {trail.length > 0 && (
          <button className="fec-btn ghost sm"
            onClick={() => setTrail((t) => { const nt = [...t]; const prev = nt.pop(); if (prev) setCenter(prev); return nt; })}>
            ◂ Back
          </button>
        )}
        {(() => {
          // year/report scope picker — years from the response (collected pre-filter, so the
          // list stays complete while filtered); TN entities also list each filed report.
          const selYear = scopeSel.startsWith("y:") ? scopeSel.slice(2)
            : scopeSel.startsWith("r:") ? scopeSel.slice(2, scopeSel.indexOf("|")) : "";
          const years = [...new Set([...(data?.years || []), ...(selYear ? [selYear] : [])])].sort().reverse();
          if (!years.length) return null;
          return (
            <label className="fec-check" style={{ fontSize: 11, gap: 4 }}
              title="Scope the graph and its itemized tables to one year/cycle — or, for TN entities, one filed report">
              scope
              <select value={scopeSel} onChange={(e) => setScopeSel(e.target.value)}
                style={{ background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", font: "inherit", maxWidth: 230 }}>
                <option value="all">All years</option>
                {years.map((y) => {
                  const reps = (data?.reports || []).filter((rp) => rp.year === y);
                  return reps.length ? (
                    <optgroup key={y} label={y}>
                      <option value={`y:${y}`}>{y} — all reports</option>
                      {reps.map((rp) => (
                        <option key={`${y}|${rp.report}`} value={`r:${y}|${rp.report}`}>{y} · {rp.report}</option>
                      ))}
                    </optgroup>
                  ) : (
                    <option key={y} value={`y:${y}`}>{y}</option>
                  );
                })}
              </select>
            </label>
          );
        })()}
        <label className="fec-check" style={{ fontSize: 11 }}
          title="Hide vendors, payees and non-candidate committees — just who funds candidates">
          <input type="checkbox" checked={candOnly} onChange={(e) => setCandOnly(e.target.checked)} />
          Candidates only
        </label>
        {center.committeeId && /^C\d{4,}$/i.test(center.committeeId) && (
          <button className="fec-btn ghost sm" onClick={() => load(center, { trace: true })} disabled={tracing || st.loading}
            title="Pull this committee's top-100 receipts and disbursements from the FEC into the ledger, then redraw">
            {tracing ? "Tracing…" : "⤢ Trace FEC"}
          </button>
        )}
        {tnPull && center.committeeId === String(tnPull.id) && (
          <button className="fec-btn ghost sm" disabled={tnPulling || st.loading}
            title="Parse this entity's filed TREF reports into the ledger (itemized contributions + expenditures), then redraw"
            onClick={async () => {
              setTnPulling(true);
              try {
                await fetch(`/api/tn/ledger?id=${encodeURIComponent(tnPull.id)}&owner=${encodeURIComponent(tnPull.name || "")}`);
              } catch { /* the reload below surfaces whatever state we're in */ }
              setTnPulling(false);
              load(center);
            }}>
            {tnPulling ? "Pulling reports…" : "⤢ Pull TN reports"}
          </button>
        )}
      </div>
      {st.loading && <div className="fec-spin" style={{ margin: 12 }}>Building flow graph…</div>}
      {st.error && <div className="fec-error" role="alert" style={{ margin: 12 }}>{st.error}</div>}
      {data && !drawable && !st.loading && (
        <div className="fec-empty" style={{ margin: 12 }}>
          Nothing stored to draw yet
          {tnPull && center.committeeId === String(tnPull.id)
            ? " — hit ⤢ Pull TN reports to parse this entity's filed reports into the ledger"
            : center.committeeId ? " — hit ⤢ Trace FEC to pull this committee's top receipts and spending" : " — run a donor search first so gifts land in the ledger"}.
        </div>
      )}
      {data && drawable && (
        <div className="fec-flow-scroll">
          <svg viewBox={`0 0 ${W} ${H}`} className="fec-flow-svg" style={{ fontFamily: "inherit" }}
            role="img" aria-label="Money-flow graph">
            {edges.map((e, i) => {
              const p1 = pos.get(e.from), p2 = pos.get(e.to);
              if (!p1 || !p2) return null;
              const dir = p2.x >= p1.x ? 1 : -1;
              const x1 = p1.x + 9 * dir, x2 = p2.x - 9 * dir;
              const mid = (x1 + x2) / 2;
              return (
                <path key={i} d={`M ${x1} ${p1.y} C ${mid} ${p1.y}, ${mid} ${p2.y}, ${x2} ${p2.y}`}
                  fill="none" stroke={e.kind === "disbursement" ? "var(--rose)" : "var(--olive)"}
                  strokeWidth={1 + 6 * Math.sqrt((e.total || 0) / maxEdge)} opacity="0.45"
                  style={{ cursor: "pointer" }} pointerEvents="visibleStroke"
                  onClick={() => selectEdge(e, nodeById)}>
                  <title>{`${usd(e.total)} · ${e.count} item${e.count === 1 ? "" : "s"} (${e.kind}) — click to itemize this flow`}</title>
                </path>
              );
            })}
            {nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const col = Math.min(Math.max(n.col ?? 2, 0), 4);
              const anchor = n.center ? "middle" : col < 2 ? "end" : col > 2 ? "start" : "middle";
              const tx = n.center ? p.x : col < 2 ? p.x - 12 : col > 2 ? p.x + 12 : p.x;
              const ty = n.center ? p.y - 14 : p.y + 4;
              const clickable = !n.center && (n.committeeId || n.donorKey);
              const selected = sel?.node?.id === n.id;
              return (
                <g key={n.id} onClick={() => clickable && selectNode(n)} style={{ cursor: clickable ? "pointer" : "default" }}>
                  <circle cx={p.x} cy={p.y} r={n.center ? 9 : selected ? 7 : 5.5}
                    fill={FLOW_KIND_COLOR[n.kind] || "var(--bone)"}
                    stroke={selected ? "var(--brass)" : n.passThrough ? "var(--danger)" : "var(--ink)"}
                    strokeWidth={selected ? 2.5 : n.passThrough ? 2.5 : 1}
                    strokeDasharray={n.passThrough && !selected ? "3 2" : "none"} />
                  <text x={tx} y={ty} textAnchor={anchor} fontSize={n.center ? 13 : 11}
                    fill={n.center ? "var(--bone)" : "var(--sub)"} style={{ fontWeight: n.center ? 700 : 400 }}>
                    {trunc(n.name)}{n.passThrough ? " ⇄" : ""}
                  </text>
                  {!n.center && (
                    <text x={tx} y={ty + 12} textAnchor={anchor} fontSize="9.5" fill="var(--muted)">
                      {usd(nTotal.get(n.id) || 0)}
                    </text>
                  )}
                  <title>
                    {`${n.name}${n.employer ? ` · ${n.employer}` : ""}${n.state ? ` · ${n.state}` : ""} — ${usd(nTotal.get(n.id) || 0)}${n.passThrough ? " · PASS-THROUGH: money flows in AND out of the center" : ""}${clickable ? " (click to itemize)" : ""}`}
                  </title>
                </g>
              );
            })}
          </svg>
          <div className="fec-legend" style={{ padding: "0 12px 10px", marginTop: 4 }}>
            <span><span className="fec-sw" style={{ background: "var(--olive)" }} /> contributions</span>
            <span><span className="fec-sw" style={{ background: "var(--rose)" }} /> disbursements</span>
            <span><span className="fec-sw" style={{ background: "var(--brass)" }} /> committee</span>
            <span><span className="fec-sw" style={{ background: "var(--bone)" }} /> individual</span>
            <span><span className="fec-sw" style={{ background: "var(--muted)" }} /> conduit</span>
            <span>⇄ pass-through · click a node or edge to itemize it below</span>
          </div>
          {sel && (
            <div style={{ borderTop: "1px solid var(--line)", margin: "0 12px 12px", paddingTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="fec-ai-label" style={{ marginBottom: 0 }}>Itemized · {sel.label}</span>
                {selRows?.data && (
                  <span className="fec-tag">
                    {selRows.data.count.toLocaleString()} row{selRows.data.count === 1 ? "" : "s"} · {usd(selRows.data.total)}
                    {selRows.data.truncated ? " · first 500 fetched" : ""}
                  </span>
                )}
                {sel.node && !sel.node.center && (
                  <button className="fec-btn ghost sm" onClick={() => recenter(sel.node)}
                    title="Rebuild the whole graph around this node">⤢ Center here</button>
                )}
                <button className="fec-btn ghost sm" onClick={exportSelCSV} disabled={!selRows?.data?.rows?.length}>
                  Export CSV ({selRows?.data?.rows?.length || 0})
                </button>
                <button className="fec-btn ghost sm" onClick={() => setSel(null)}>✕ Clear filter</button>
              </div>
              {selRows?.loading && <div className="fec-spin" style={{ marginTop: 8 }}>Loading rows…</div>}
              {selRows?.error && <div className="fec-error" role="alert" style={{ marginTop: 8 }}>{selRows.error}</div>}
              {selRows?.data && (selRows.data.rows.length === 0 ? (
                <div className="fec-empty" style={{ marginTop: 8 }}>
                  No itemized rows stored for this selection{scopeSel !== "all" ? " in this scope — try All years" : ""}.
                </div>
              ) : (
                <div className="fec-table-wrap" style={{ marginTop: 8 }}>
                  <table className="fec-table">
                    <thead>
                      <tr><th>Date</th><th>Kind</th><th>From</th><th>To</th><th>Employer / Purpose</th><th>Cycle</th><th className="amt">Amount</th></tr>
                    </thead>
                    <tbody>
                      {selRows.data.rows.slice(0, 200).map((r, i) => (
                        <tr key={i}>
                          <td className="sub">{r.date || "—"}</td>
                          <td className="sub">{r.kind === "disbursement" ? "spent" : "gift"}</td>
                          <td>{r.kind === "disbursement" ? (r.recipientName || r.recipientId || "—") : (r.donorName || "—")}</td>
                          <td>{r.kind === "disbursement" ? (r.donorName || "—") : (r.recipientName || r.recipientId || "—")}</td>
                          <td className="sub">
                            {r.kind === "disbursement"
                              ? (r.report || "—")
                              : ([r.employer, r.occupation].filter(Boolean).join(" · ") || "—")}
                          </td>
                          <td className="sub">{r.cycle || "—"}</td>
                          <td className="amt">{usd(r.amount || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {selRows.data.rows.length > 200 && (
                    <div className="sub" style={{ padding: "6px 0" }}>
                      Showing the newest 200 of {selRows.data.rows.length} fetched — Export CSV gets them all.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {data && (data.note || data.coverage) && (
        <div className="sub" style={{ padding: bare ? "6px 0 0" : "0 16px 12px" }}>{[data.note, data.coverage].filter(Boolean).join(" ")}</div>
      )}
    </>
  );
  return bare ? <div>{body}</div> : <div className="fec-ledger" style={{ marginTop: 10 }}>{body}</div>;
}

// ---- Patterns panel (per-committee investigation tabs) ----
// Timing | Movement | Geography | Sectors | Households | Outside $ — each tab lazy-loads its
// endpoint; Geography/Sectors/Households share one /api/patterns/composition fetch.
function PatternsPanel({ committeeId, candidateId, name, cycle, raceState }) {
  const [tab, setTab] = useState("timing");
  const usd = (v) => (v < 0 ? `-${fmtUSDshort(-v)}` : fmtUSDshort(v));
  const TABS = [["timing", "Timing"], ["movement", "Movement"], ["geo", "Geography"],
    ["sectors", "Sectors"], ["households", "Households"], ["outside", "Outside $"]];

  // shared composition fetch (geo / sectors / households ride the same row pull).
  // IMPORTANT: `comp` must NOT be an effect dependency with a cancel-guard — setComp({loading})
  // re-ran the effect, whose cleanup flipped the guard and discarded the arriving response,
  // leaving the spinner stuck forever (caught live on Harshbarger TN-01). compRef tracks
  // in-flight/done state without re-triggering the effect.
  const [comp, setComp] = useState(null); // null | {loading} | {data} | {error}
  const compRef = useRef(null);
  const [compNonce, setCompNonce] = useState(0); // bump to force a refetch after an error
  const needComp = tab === "geo" || tab === "sectors" || tab === "households";
  useEffect(() => {
    if (!needComp || compRef.current) return; // already fetched (or in flight) for this mount
    compRef.current = { loading: true };
    setComp(compRef.current);
    (async () => {
      try {
        const qs = new URLSearchParams({ committeeId });
        if (cycle) qs.set("cycle", String(cycle));
        if (raceState) qs.set("homeState", raceState);
        const res = await fetch(`/api/patterns/composition?${qs}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error?.message || `Composition failed (HTTP ${res.status})`);
        compRef.current = { data };
      } catch (e) {
        compRef.current = { error: e.message, retryable: true };
      }
      setComp(compRef.current);
    })();
  }, [needComp, committeeId, cycle, raceState, compNonce]);

  return (
    <div className="fec-ledger" style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
        <span className="fec-ai-label" style={{ marginBottom: 0 }}>Giving patterns</span>
        <span className="fec-tag">{name}</span>
        <span className="fec-tab-nav" role="tablist" style={{ marginLeft: "auto", minWidth: 0, flexShrink: 1, maxWidth: "100%" }}>
          {TABS.map(([id, label]) => (
            <button key={id} className="fec-tab" role="tab" aria-selected={tab === id}
              onClick={() => setTab(id)} style={{ fontSize: 11, padding: "4px 10px" }}>{label}</button>
          ))}
        </span>
      </div>
      <div style={{ padding: "10px 16px 14px" }}>
        {tab === "timing" && <TimingSection committeeId={committeeId} cycle={cycle} usd={usd} />}
        {tab === "movement" && <MovementSection committeeId={committeeId} cycle={cycle} usd={usd} />}
        {needComp && comp?.loading && <div className="fec-spin">Analyzing the donor base…</div>}
        {needComp && comp?.error && (
          <div className="fec-error" role="alert">
            {comp.error}{" "}
            <button className="fec-btn ghost sm" onClick={() => { compRef.current = null; setCompNonce((n) => n + 1); }}>↺ Retry</button>
          </div>
        )}
        {tab === "geo" && comp?.data && <GeoSection data={comp.data} usd={usd} />}
        {tab === "sectors" && comp?.data && <SectorSection data={comp.data} usd={usd} />}
        {tab === "households" && comp?.data && <HouseholdSection data={comp.data} usd={usd} />}
        {tab === "outside" && <OutsideSection candidateId={candidateId} cycle={cycle} usd={usd} />}
      </div>
    </div>
  );
}

// Same-day donor clusters from /api/patterns/timing: fundraiser events, workplace bundling
// (2+ donors, same employer, same day), and max-out days. Click a date to itemize it.
function TimingSection({ committeeId, cycle, usd }) {
  const [st, setSt] = useState({ loading: true }); // {loading} | {data} | {error}
  const [allCycles, setAllCycles] = useState(false);
  const [minDonors, setMinDonors] = useState(3);
  const [openDate, setOpenDate] = useState(null); // date string → inline itemized rows
  const [dayRows, setDayRows] = useState(null); // {loading} | {data} | {error}
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;
    setSt({ loading: true }); setOpenDate(null); setDayRows(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ committeeId, minDonors: String(minDonors) });
        if (!allCycles && cycle) qs.set("cycle", String(cycle));
        const res = await fetch(`/api/patterns/timing?${qs}`);
        const data = await res.json().catch(() => null);
        if (gen !== genRef.current) return;
        if (!res.ok) throw new Error(data?.error?.message || `Patterns failed (HTTP ${res.status})`);
        setSt({ data });
      } catch (e) { if (gen === genRef.current) setSt({ error: e.message }); }
    })();
  }, [committeeId, cycle, allCycles, minDonors]);

  const toggleDay = async (date) => {
    if (openDate === date) { setOpenDate(null); setDayRows(null); return; }
    setOpenDate(date); setDayRows({ loading: true });
    try {
      const qs = new URLSearchParams({ committeeId, kind: "contribution", date });
      if (!allCycles && cycle) qs.set("cycle", String(cycle));
      const res = await fetch(`/api/flows/rows?${qs}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `Rows failed (HTTP ${res.status})`);
      setDayRows({ data });
    } catch (e) { setDayRows({ error: e.message }); }
  };

  const data = st.data;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingBottom: 8 }}>
        <span className="fec-tag">{allCycles ? "all stored cycles" : `cycle ${cycle}`}</span>
        <label className="fec-check" style={{ fontSize: 11 }}>
          <input type="checkbox" checked={allCycles} onChange={(e) => setAllCycles(e.target.checked)} />
          All cycles
        </label>
        <label className="fec-check" style={{ fontSize: 11, gap: 4 }} title="Minimum distinct donors on one day to count as a cluster">
          min donors
          <select value={minDonors} onChange={(e) => setMinDonors(Number(e.target.value))}
            style={{ background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", font: "inherit" }}>
            {[2, 3, 5, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {data && <span className="fec-tag">{data.clusters.length} cluster day{data.clusters.length === 1 ? "" : "s"} · {data.rowsScanned.toLocaleString()} gifts scanned</span>}
      </div>
      {st.loading && <div className="fec-spin" style={{ margin: 12 }}>Scanning for same-day clusters…</div>}
      {st.error && <div className="fec-error" role="alert" style={{ margin: 12 }}>{st.error}</div>}
      {data && data.note && <div className="fec-tag" style={{ margin: "8px 16px 0" }}>ⓘ {data.note}</div>}
      {data && (data.clusters.length === 0 ? (
        <div className="fec-empty" style={{ margin: 12 }}>
          No days with {data.minDonors}+ distinct donors in the stored ledger — lower min donors, try All cycles, or open the Donors ledger to pull more rows first.
        </div>
      ) : (
        <div className="fec-table-wrap" style={{ padding: "8px 12px 12px" }}>
          <table className="fec-table">
            <thead>
              <tr>
                <th>Date</th><th>Donors</th><th>Gifts</th>
                <th title={`Gifts at or above $3,300 (individual per-election limit)`}>Max-outs</th>
                <th title="2+ distinct donors sharing an employer on the same day">Employer bundling</th>
                <th className="amt">Total</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.clusters.map((c) => (
                <Fragment key={c.date}>
                  <tr>
                    <td><b style={{ color: "var(--bone)" }}>{c.date}</b></td>
                    <td>{c.donors}</td>
                    <td className="sub">{c.gifts}</td>
                    <td>{c.maxOuts > 0 ? <span style={{ color: "var(--brass)", fontWeight: 700 }}>▲ {c.maxOuts}</span> : <span className="sub">—</span>}</td>
                    <td className="sub">
                      {c.employers.length
                        ? c.employers.map((e) => `${e.employer} (${e.donors} donors · ${fmtUSDshort(e.total)})`).join(" · ")
                        : "—"}
                    </td>
                    <td className="amt">{usd(c.total)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="fec-btn ghost sm" onClick={() => toggleDay(c.date)} aria-expanded={openDate === c.date}>
                        {openDate === c.date ? "Close ▾" : "Itemize ▸"}
                      </button>
                    </td>
                  </tr>
                  {openDate === c.date && (
                    <tr>
                      <td colSpan={7} style={{ padding: "4px 8px 10px", borderTop: "none" }}>
                        {dayRows?.loading && <div className="fec-spin">Loading {c.date}…</div>}
                        {dayRows?.error && <div className="fec-error" role="alert">{dayRows.error}</div>}
                        {dayRows?.data && (
                          <table className="fec-table">
                            <thead><tr><th>Donor</th><th>Employer / Occupation</th><th>Location</th><th className="amt">Amount</th></tr></thead>
                            <tbody>
                              {dayRows.data.rows.map((r, i) => (
                                <tr key={i}>
                                  <td>{r.donorName || "—"}</td>
                                  <td className="sub">{[r.employer, r.occupation].filter(Boolean).join(" · ") || "—"}</td>
                                  <td className="sub">{[r.city, r.state].filter(Boolean).join(", ") || "—"}</td>
                                  <td className="amt">{usd(r.amount || 0)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="sub" style={{ paddingTop: 8 }}>{data.coverage}</div>
        </div>
      ))}
    </div>
  );
}

// Donor movement between this cycle and the last: new money, loyal money, and lost donors
// with where their dollars went instead (/api/patterns/migration).
function MovementSection({ committeeId, cycle, usd }) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    (async () => {
      setSt({ loading: true });
      try {
        const res = await fetch(`/api/patterns/migration?committeeId=${encodeURIComponent(committeeId)}&cycle=${encodeURIComponent(cycle)}`);
        const data = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) throw new Error(data?.error?.message || `Movement failed (HTTP ${res.status})`);
        setSt({ data });
      } catch (e) { if (live) setSt({ error: e.message }); }
    })();
    return () => { live = false; };
  }, [committeeId, cycle]);
  const d = st.data;
  return (
    <div>
      {st.loading && <div className="fec-spin">Comparing cycles…</div>}
      {st.error && <div className="fec-error" role="alert">{st.error}</div>}
      {d && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 8 }}>
            <span className="fec-tag">{d.prior} → {d.cycle}</span>
            <span className="fec-tag" style={{ color: "var(--olive)" }}>New: {d.summary.new.donors} donors · {usd(d.summary.new.total)}</span>
            <span className="fec-tag">Loyal: {d.summary.loyal.donors} · {usd(d.summary.loyal.total)}</span>
            <span className="fec-tag" style={{ color: "var(--rose)" }}>Lost: {d.summary.lost.donors} · {usd(d.summary.lost.total)}</span>
            {d.summary.retentionPct != null && <span className="fec-tag">retention {d.summary.retentionPct}%</span>}
          </div>
          {d.note && <div className="fec-tag" style={{ marginBottom: 6 }}>ⓘ {d.note}</div>}
          {d.topNew.length > 0 && (
            <>
              <div className="fec-ai-label">New this cycle</div>
              <div className="fec-table-wrap" style={{ marginBottom: 12 }}>
                <table className="fec-table">
                  <thead><tr><th>Donor</th><th>Employer</th><th>State</th><th className="amt">Gave {d.cycle}</th></tr></thead>
                  <tbody>
                    {d.topNew.map((x) => (
                      <tr key={x.donorKey}>
                        <td><b style={{ color: "var(--bone)" }}>{x.name || x.donorKey.split("|")[0]}</b>
                          {x.org && <span className="fec-badge memo">org</span>}</td>
                        <td className="sub">{x.employer || "—"}</td>
                        <td className="sub">{x.state || "—"}</td>
                        <td className="amt">{usd(x.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {d.topLost.length > 0 && (
            <>
              <div className="fec-ai-label">Gave {d.prior}, not {d.cycle} — and where their money went</div>
              <div className="fec-table-wrap">
                <table className="fec-table">
                  <thead><tr><th>Donor</th><th className="amt">Gave {d.prior}</th><th>Went to ({d.cycle})</th></tr></thead>
                  <tbody>
                    {d.topLost.map((x) => (
                      <tr key={x.donorKey}>
                        <td><b style={{ color: "var(--bone)" }}>{x.name || x.donorKey.split("|")[0]}</b>
                          {x.org && <span className="fec-badge memo">org</span>}
                          <div className="sub">{[x.employer, x.state].filter(Boolean).join(" · ")}</div></td>
                        <td className="amt">{usd(x.total)}</td>
                        <td className="sub">
                          {x.wentTo?.length
                            ? x.wentTo.map((w) => `${w.name} (${fmtUSDshort(w.total)})`).join(" · ")
                            : "no stored gifts this cycle"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {d.topNew.length === 0 && d.topLost.length === 0 && (
            <div className="fec-empty">Not enough stored rows across both cycles yet — open the Donors ledger for each cycle first.</div>
          )}
          <div className="sub" style={{ paddingTop: 8 }}>{d.coverage}</div>
        </>
      )}
    </div>
  );
}

// In-state vs out-of-state share, plus the top states and cities (/api/patterns/composition).
function GeoSection({ data, usd }) {
  const g = data.geo || {};
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 8 }}>
        {g.inState && (
          <>
            <span className="fec-tag" style={{ color: "var(--olive)" }}>
              In-state ({data.homeState}): {usd(g.inState.total)} · {g.inState.donors} donors
            </span>
            <span className="fec-tag" style={{ color: "var(--rose)" }}>
              Out-of-state: {usd(g.outState.total)} · {g.outState.donors} donors
            </span>
            {g.inStatePct != null && <span className="fec-tag">{g.inStatePct}% in-state</span>}
          </>
        )}
        <span className="fec-tag">{data.rowsScanned.toLocaleString()} gifts · {usd(data.grandTotal)}</span>
      </div>
      {data.note && <div className="fec-tag" style={{ marginBottom: 6 }}>ⓘ {data.note}</div>}
      <div className="fec-ai-label">Top states</div>
      <div className="fec-table-wrap" style={{ marginBottom: 12 }}>
        <table className="fec-table">
          <thead><tr><th>State</th><th>Donors</th><th className="amt">Total</th><th className="amt">%</th></tr></thead>
          <tbody>
            {(g.byState || []).map((s) => (
              <tr key={s.state}>
                <td><b style={{ color: "var(--bone)" }}>{s.state}</b></td>
                <td>{s.donors}</td>
                <td className="amt">{usd(s.total)}</td>
                <td className="amt">{data.grandTotal ? `${((s.total / data.grandTotal) * 100).toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fec-ai-label">Top cities</div>
      <div className="fec-table-wrap">
        <table className="fec-table">
          <thead><tr><th>City</th><th>Donors</th><th className="amt">Total</th></tr></thead>
          <tbody>
            {(g.byCity || []).map((c) => (
              <tr key={c.city}><td>{c.city}</td><td>{c.donors}</td><td className="amt">{usd(c.total)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sub" style={{ paddingTop: 8 }}>{data.coverage}</div>
    </div>
  );
}

// Industry-sector rollup of the donor base (/api/patterns/composition), with a per-sector
// "Donors ▸" drill-through — top donors ride along in the composition payload, so expanding
// a sector costs zero extra requests.
function SectorSection({ data, usd }) {
  const [openSector, setOpenSector] = useState(null);
  return (
    <div>
      {data.note && <div className="fec-tag" style={{ marginBottom: 6 }}>ⓘ {data.note}</div>}
      <div className="fec-table-wrap">
        <table className="fec-table">
          <thead><tr><th>Sector</th><th>Donors</th><th>Gifts</th><th className="amt">Total</th><th className="amt">%</th><th>Top employers</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {(data.sectors || []).map((s) => {
              const open = openSector === s.sector;
              return (
                <Fragment key={s.sector}>
                  <tr>
                    <td><b style={{ color: "var(--bone)" }}>{s.sector}</b></td>
                    <td>{s.donors}</td>
                    <td className="sub">{s.gifts}</td>
                    <td className="amt">{usd(s.total)}</td>
                    <td className="amt">{s.pct}%</td>
                    <td className="sub">{(s.topEmployers || []).map((e) => `${e.employer} (${fmtUSDshort(e.total)})`).join(" · ") || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="fec-btn ghost sm" aria-expanded={open}
                        onClick={() => setOpenSector(open ? null : s.sector)}
                        disabled={!(s.topDonors || []).length}
                        title="Top donors classified under this sector">
                        {open ? "Close ▾" : "Donors ▸"}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={7} style={{ padding: "4px 8px 10px", borderTop: "none" }}>
                        <table className="fec-table">
                          <thead><tr><th>Donor</th><th>Employer / Occupation</th><th>Location</th><th>Gifts</th><th className="amt">Total</th><th className="amt">% of sector</th></tr></thead>
                          <tbody>
                            {(s.topDonors || []).map((d) => (
                              <tr key={d.donorKey}>
                                <td><b style={{ color: "var(--bone)" }}>{d.name || d.donorKey.split("|")[0]}</b></td>
                                <td className="sub">{[d.employer, d.occupation].filter(Boolean).join(" · ") || "—"}</td>
                                <td className="sub">{[d.city, d.state].filter(Boolean).join(", ") || "—"}</td>
                                <td>{d.count}</td>
                                <td className="amt">{usd(d.total)}</td>
                                <td className="amt">{s.total ? `${((d.total / s.total) * 100).toFixed(1)}%` : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {(s.donors || 0) > (s.topDonors || []).length && (
                          <div className="sub" style={{ paddingTop: 4 }}>
                            Top {(s.topDonors || []).length} of {s.donors} donors in this sector — search any name in the Donors tab for their full history.
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sub" style={{ paddingTop: 8 }}>{data.coverage}</div>
    </div>
  );
}

// Household clusters: same surname + same city, 2+ distinct donors — how over-limit money
// legally spreads across a family. Same-day events are the coordinated-giving tell.
function HouseholdSection({ data, usd }) {
  return (
    <div>
      {data.note && <div className="fec-tag" style={{ marginBottom: 6 }}>ⓘ {data.note}</div>}
      {(data.households || []).length === 0 ? (
        <div className="fec-empty">No multi-member households in the stored rows — pull more of the donor ledger first.</div>
      ) : (
        <div className="fec-table-wrap">
          <table className="fec-table">
            <thead>
              <tr><th>Household</th><th>Members</th>
                <th title="Days when 2+ members of the household gave together">Same-day</th>
                <th className="amt">Total</th></tr>
            </thead>
            <tbody>
              {data.households.map((h) => (
                <tr key={`${h.surname}|${h.place}`}>
                  <td>
                    <b style={{ color: "var(--bone)" }}>{h.surname}</b>
                    <div className="sub">{h.place}</div>
                  </td>
                  <td className="sub">{h.names.map((m) => `${m.name} (${fmtUSDshort(m.total)})`).join(" · ")}</td>
                  <td>{h.sameDayEvents > 0
                    ? <span style={{ color: "var(--brass)", fontWeight: 700 }}>▲ {h.sameDayEvents}</span>
                    : <span className="sub">—</span>}</td>
                  <td className="amt">{usd(h.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="sub" style={{ paddingTop: 8 }}>{data.coverage}</div>
    </div>
  );
}

// Outside money (Schedule E) with funder chains: who spends FOR/AGAINST this candidate and
// who funds those spenders. FOR and AGAINST are shown separately — never summed.
function OutsideSection({ candidateId, cycle, usd }) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    (async () => {
      setSt({ loading: true });
      try {
        const res = await fetch(`/api/patterns/outside?candidateId=${encodeURIComponent(candidateId || "")}&cycle=${encodeURIComponent(cycle)}`);
        const data = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) throw new Error(data?.error?.message || `Outside money failed (HTTP ${res.status})`);
        setSt({ data });
      } catch (e) { if (live) setSt({ error: e.message }); }
    })();
    return () => { live = false; };
  }, [candidateId, cycle]);
  const d = st.data;
  return (
    <div>
      {st.loading && <div className="fec-spin">Pulling independent expenditures…</div>}
      {st.error && <div className="fec-error" role="alert">{st.error}</div>}
      {d && (d.spenders.length === 0 ? (
        <div className="fec-empty">No independent expenditures on file for this candidate.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingBottom: 8 }}>
            <span className="fec-tag" style={{ color: "var(--olive)" }}>FOR: {usd(d.totalSupport)}</span>
            <span className="fec-tag" style={{ color: "var(--rose)" }}>AGAINST: {usd(d.totalOppose)}</span>
            <span className="fec-tag">cycle {d.cycleUsed} · top {d.onFile} rows</span>
          </div>
          {d.note && <div className="fec-tag" style={{ marginBottom: 6 }}>ⓘ {d.note}</div>}
          <div className="fec-table-wrap">
            <table className="fec-table">
              <thead>
                <tr><th>Outside spender</th><th className="amt">FOR</th><th className="amt">AGAINST</th><th>Who funds the spender</th></tr>
              </thead>
              <tbody>
                {d.spenders.map((s, i) => (
                  <tr key={s.committeeId || i}>
                    <td>
                      <b style={{ color: "var(--bone)" }}>{s.name}</b>
                      {s.committeeId && (
                        <>
                          {" "}
                          <a className="fec-extlink" href={safeUrl(`https://www.fec.gov/data/committee/${s.committeeId}/`)}
                            target="_blank" rel="noopener noreferrer">FEC ↗</a>
                        </>
                      )}
                    </td>
                    <td className="amt">{s.support ? usd(s.support) : <span className="sub">—</span>}</td>
                    <td className="amt">{s.oppose ? usd(s.oppose) : <span className="sub">—</span>}</td>
                    <td className="sub">
                      {s.funders?.length
                        ? s.funders.map((f) => `${f.name}${f.org ? " [org]" : ""} (${fmtUSDshort(f.total)})`).join(" · ")
                        : "no stored donor rows yet"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sub" style={{ paddingTop: 8 }}>{d.coverage}</div>
        </>
      ))}
    </div>
  );
}

// ---- "donors most like this one" (recipient-slate similarity) ----
// Jaccard overlap of recipient slates from /api/patterns/similar — for a PAC this surfaces
// aligned PAC networks; org donors are badged so individuals can be filtered out.
function SimilarDonors({ donorKey, name, onSearch }) {
  const [st, setSt] = useState({ loading: true });
  const [orgOnly, setOrgOnly] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      setSt({ loading: true });
      try {
        const res = await fetch(`/api/patterns/similar?donorKey=${encodeURIComponent(donorKey)}`);
        const data = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) throw new Error(data?.error?.message || `Similarity failed (HTTP ${res.status})`);
        setSt({ data });
      } catch (e) { if (live) setSt({ error: e.message }); }
    })();
    return () => { live = false; };
  }, [donorKey]);

  const usd = (v) => (v < 0 ? `-${fmtUSDshort(-v)}` : fmtUSDshort(v));
  const data = st.data;
  const list = (data?.similar || []).filter((s) => !orgOnly || s.org);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingBottom: 8 }}>
        <span className="fec-tag">
          {data ? `${name || donorKey.split("|")[0]} funds ${data.recipients} stored recipient${data.recipients === 1 ? "" : "s"}` : ""}
        </span>
        <label className="fec-check" style={{ fontSize: 11 }}>
          <input type="checkbox" checked={orgOnly} onChange={(e) => setOrgOnly(e.target.checked)} />
          PACs / orgs only
        </label>
      </div>
      {st.loading && <div className="fec-spin">Comparing recipient slates…</div>}
      {st.error && <div className="fec-error" role="alert">{st.error}</div>}
      {data && (list.length === 0 ? (
        <div className="fec-empty">
          No donors share 2+ recipients with this one in the stored ledger{orgOnly ? " (try unchecking PACs/orgs only)" : ""} — pull more committees' donor ledgers to widen the pool.
        </div>
      ) : (
        <div className="fec-table-wrap">
          <table className="fec-table">
            <thead>
              <tr>
                <th>Donor</th>
                <th title="Recipients in common / this donor's own slate size">Shared</th>
                <th title="Jaccard: shared ÷ combined slates">Overlap</th>
                <th className="amt" title="Their dollars into the shared recipients">$ into shared</th>
                <th>Top shared recipients</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.donorKey}>
                  <td>
                    <b style={{ color: "var(--bone)" }}>{s.name}</b>
                    {s.org && <span className="fec-badge memo" title={`FEC entity type ${s.entityType || "?"}`}>org</span>}
                    {s.watched && <span title="On your watchlist" style={{ marginLeft: 6, color: "var(--brass)" }}>★</span>}
                    {s.state && <div className="sub">{s.state}</div>}
                  </td>
                  <td>{s.shared} / {s.theirRecipients}</td>
                  <td><b style={{ color: "var(--brass)" }}>{Math.round(s.jaccard * 100)}%</b></td>
                  <td className="amt">{usd(s.sharedTotal)}</td>
                  <td className="sub">{(s.sharedNames || []).join(" · ") || "—"}</td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    <button className="fec-btn ghost sm" onClick={() => onSearch?.(s.name)}
                      title="Run a donor search for this name">Search ▸</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sub" style={{ paddingTop: 6 }}>{data.coverage}</div>
        </div>
      ))}
    </div>
  );
}

function DonorsPanel({ onDrillTn, seed }) {
  // watchlist
  const [watch, setWatch] = useState({ loading: true, donors: [] });
  const [stats, setStats] = useState(null); // {rows, donors, recipients}
  const [refreshRes, setRefreshRes] = useState(null); // null | {loading} | {results, checked} | {error}
  const [actionErr, setActionErr] = useState(null); // track/untrack failures
  const [watchOverride, setWatchOverride] = useState({}); // donorKey -> bool, optimistic until watchlist reloads
  // search
  const [qName, setQName] = useState("");
  const [qState, setQState] = useState("");
  const [qEmployer, setQEmployer] = useState("");
  const [deep, setDeep] = useState(false); // depth=6 → back to 2016
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState(null);
  const [searchRes, setSearchRes] = useState(null);
  const [qMode, setQMode] = useState("name"); // "name" | "employer" | "occupation" — reverse lookup modes
  const [fieldRes, setFieldRes] = useState(null); // /api/donors/byfield result
  // typeahead over the stored ledger (debounced, local-only — zero FEC calls)
  const [typeahead, setTypeahead] = useState([]);
  const [taOpen, setTaOpen] = useState(false);
  const taSeq = useRef(0);
  const taTimer = useRef(null);
  useEffect(() => () => clearTimeout(taTimer.current), []);
  const onNameInput = (v) => {
    setQName(v);
    clearTimeout(taTimer.current);
    const q = v.trim();
    if (qMode !== "name" || q.length < 2) { setTaOpen(false); setTypeahead([]); return; }
    const seq = ++taSeq.current;
    taTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/donors/suggest?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => null);
        if (seq !== taSeq.current) return; // a newer keystroke superseded this lookup
        setTypeahead(data?.suggestions || []);
        setTaOpen(Boolean(data?.suggestions?.length));
      } catch { /* typeahead is best-effort */ }
    }, 250);
  };
  // history (one open donor at a time)
  const [hist, setHist] = useState(null); // null | {key, loading} | {key, data} | {key, notFound} | {key, error}
  const [giftPage, setGiftPage] = useState(0);
  const [donorAi, setDonorAi] = useState({ ask: false, research: false, flows: false, similar: false }); // per-donor panel toggles — reset per donor
  // History opens INLINE under the clicked row (hist.origin: "watch" | "search"), so the panel
  // appears where the user is already looking — no scroll management needed.

  const inputStyle = { width: "100%", background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", padding: "8px 10px", font: "inherit" };

  // Dates arrive as strings of unknown shape — pretty-print when parseable, pass through otherwise.
  const dshort = (s) => {
    if (!s) return "—";
    const d = new Date(s);
    return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };
  // addedAt / lastChecked can be epoch ms or an ISO string.
  const when = (v) => {
    if (!v) return "—";
    const n = typeof v === "number" ? v : Date.parse(v);
    return Number.isFinite(n) ? timeAgo(n) : String(v);
  };
  const usd = (v) => (v < 0 ? `-${fmtUSDshort(-v)}` : fmtUSDshort(v));

  const loadWatchlist = async () => {
    try {
      const res = await fetch("/api/donors/watchlist");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `Watchlist failed (HTTP ${res.status})`);
      setWatch({ donors: data?.donors || [] });
      setWatchOverride({}); // server list is now the truth
    } catch (e) {
      setWatch((w) => ({ donors: w.donors || [], error: e.message }));
    }
  };
  const loadStats = async () => {
    try {
      const res = await fetch("/api/donors/stats");
      const data = await res.json().catch(() => null);
      if (res.ok && data) setStats(data);
    } catch { /* non-fatal — stats line just stays hidden */ }
  };
  useEffect(() => { loadWatchlist(); loadStats(); }, []);

  const watchedKeys = new Set((watch.donors || []).map((d) => d.donorKey));
  const isWatched = (key, fallback = false) =>
    watchOverride[key] != null ? watchOverride[key] : (watchedKeys.has(key) || fallback);

  const track = async (d) => {
    setActionErr(null);
    try {
      const res = await fetch("/api/donors/watch", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ donorKey: d.donorKey, name: d.name, employer: d.employer || undefined, state: d.state || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `Track failed (HTTP ${res.status})`);
      setWatchOverride((p) => ({ ...p, [d.donorKey]: true }));
      loadWatchlist();
    } catch (e) { setActionErr(e.message); }
  };

  const untrack = async (donorKey) => {
    setActionErr(null);
    try {
      const res = await fetch(`/api/donors/watch?key=${encodeURIComponent(donorKey)}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `Untrack failed (HTTP ${res.status})`);
      setWatchOverride((p) => ({ ...p, [donorKey]: false }));
      loadWatchlist();
    } catch (e) { setActionErr(e.message); }
  };

  const openHistory = async (donorKey, { markSeen = false, origin = "search" } = {}) => {
    // clicking the same row again toggles the inline panel closed
    if (hist?.key === donorKey && hist?.origin === origin) { setHist(null); return; }
    setHist({ key: donorKey, origin, loading: true });
    setGiftPage(0);
    setDonorAi({ ask: false, research: false, flows: false, similar: false }); // a different donor shouldn't inherit open panels
    try {
      const res = await fetch(`/api/donors/history?key=${encodeURIComponent(donorKey)}`);
      if (res.status === 404) { setHist({ key: donorKey, origin, notFound: true }); return; }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `History failed (HTTP ${res.status})`);
      // A truthy-but-shapeless response (e.g. an HTML page from a stale server build) would satisfy
      // none of the render branches — the button would silently do nothing. Fail loudly instead.
      if (!data?.donor || !data?.totals) throw new Error("Unexpected response from /api/donors/history — if this persists, rebuild the container (server and UI may be out of sync).");
      setHist({ key: donorKey, origin, data });
      if (markSeen) {
        try {
          await fetch("/api/donors/watch/seen", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ donorKey }),
          });
          loadWatchlist(); // clears the ▲ new badge
        } catch { /* non-fatal — badge clears on the next refresh */ }
      }
    } catch (e) { setHist({ key: donorKey, origin, error: e.message }); }
  };

  const runWatchRefresh = async () => {
    setRefreshRes({ loading: true });
    try {
      const res = await fetch("/api/donors/watchlist/refresh", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `Refresh failed (HTTP ${res.status})`);
      setRefreshRes({ results: data?.results || [], checked: data?.checked });
      loadWatchlist(); loadStats();
    } catch (e) { setRefreshRes({ error: e.message }); }
  };

  const runSearch = async (fresh = false, overrideName) => {
    // an explicit override name (typeahead, did-you-mean, Similar ▸) is ALWAYS a name search,
    // even if the mode select still says employer/occupation — closure state may not have settled
    if (qMode !== "name" && typeof overrideName !== "string") return runFieldSearch(fresh);
    const nm = (typeof overrideName === "string" ? overrideName : qName).trim(); // typeahead/did-you-mean pass the name before state settles
    if (!nm) { setSearchErr("Enter a donor name to search."); return; }
    setTaOpen(false);
    if (hist?.origin === "search") setHist(null); // result rows are about to change — close the inline panel
    setSearching(true); setSearchErr(null); setFieldRes(null);
    try {
      const qs = new URLSearchParams({ name: nm, depth: deep ? "6" : "2" });
      if (qState.trim()) qs.set("state", qState.trim().toUpperCase());
      if (qEmployer.trim()) qs.set("employer", qEmployer.trim());
      if (fresh) qs.set("fresh", "1");
      const res = await fetch(`/api/donors/search?${qs}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `Donor search failed (HTTP ${res.status})`);
      setSearchRes(data);
    } catch (e) { setSearchErr(e.message); setSearchRes(null); }
    finally { setSearching(false); }
  };

  // Money Race "Donor ▸" drill-through: seed arrives with a fresh timestamp → run a name search
  useEffect(() => {
    if (!seed?.name) return;
    setQMode("name");
    setQName(seed.name);
    runSearch(false, seed.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.t]);

  // Reverse lookup: everyone whose employer/occupation contains the query, grouped by
  // recipient (who the money reaches) and by donor. Backed by /api/donors/byfield.
  const runFieldSearch = async (fresh = false) => {
    const q = qName.trim();
    if (q.length < 3) { setSearchErr(`Enter at least 3 characters of ${qMode}.`); return; }
    setTaOpen(false);
    if (hist?.origin === "search") setHist(null);
    setSearching(true); setSearchErr(null); setSearchRes(null);
    try {
      const qs = new URLSearchParams({ q, field: qMode, depth: deep ? "6" : "2" });
      if (qState.trim()) qs.set("state", qState.trim().toUpperCase());
      if (fresh) qs.set("fresh", "1");
      const res = await fetch(`/api/donors/byfield?${qs}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `Lookup failed (HTTP ${res.status})`);
      setFieldRes(data);
    } catch (e) { setSearchErr(e.message); setFieldRes(null); }
    finally { setSearching(false); }
  };

  const exportGiftsCSV = () => {
    const gifts = hist?.data?.gifts || [];
    if (!gifts.length) return;
    const nm = (hist.data.donor?.name || "donor").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
    downloadCSV(`donor_${nm}_gifts.csv`,
      ["Date", "Recipient", "Amount", "Source", "Cycle", "Report", "Employer", "City", "State"],
      gifts.map((g) => [g.date, g.recipientName, g.amount, g.source, g.cycle, g.report, g.employer, g.city, g.state]));
  };

  // Inline history panel — rendered directly under the clicked row (watchlist or search results).
  const renderHistPanel = () => (
    <div style={{ padding: "2px 8px 10px" }}>
      {hist?.loading && <div className="fec-spin" style={{ marginTop: 10 }}>Loading donor history…</div>}
      {hist?.error && <div className="fec-error" role="alert" style={{ marginTop: 10 }}>{hist.error}</div>}
      {hist?.notFound && (
        <div className="fec-empty" style={{ marginTop: 10 }}>Nothing stored for this donor yet — run a search to pull their FEC filings.</div>
      )}
      {hist?.data && (() => {
        const { donor, totals, byCycle, recipients, gifts } = hist.data;
        const watched = isWatched(donor?.donorKey, hist.data.watched);
        const giftList = gifts || [];
        const totalPages = Math.max(1, Math.ceil(giftList.length / DONOR_GIFTS_PER));
        const pageGifts = giftList.slice(giftPage * DONOR_GIFTS_PER, (giftPage + 1) * DONOR_GIFTS_PER);
        return (
          <div className="fec-ledger" style={{ marginTop: 10 }}>
            <div className="fec-ledger-head">
              <span className="fec-name">{donor?.name || "—"}</span>
              <span className="fec-tag">
                {[donor?.employer, donor?.occupation].filter(Boolean).join(" · ")}
                {(donor?.city || donor?.state) ? `${(donor?.employer || donor?.occupation) ? " · " : ""}${[donor?.city, donor?.state].filter(Boolean).join(", ")}` : ""}
              </span>
              <button className="fec-btn ghost sm"
                onClick={() => setDonorAi((p) => ({ ...p, research: !p.research }))}
                aria-expanded={donorAi.research} title="AI web brief on this donor (cached until refreshed)">
                {donorAi.research ? "Hide ▾" : "Research ▸"}
              </button>
              <button className="fec-btn ghost sm"
                onClick={() => setDonorAi((p) => ({ ...p, ask: !p.ask }))}
                aria-expanded={donorAi.ask} title="Ask the AI a free-text question about this donor">
                {donorAi.ask ? "Close ▾" : "Ask AI ▸"}
              </button>
              <button className="fec-btn ghost sm"
                onClick={() => setDonorAi((p) => ({ ...p, flows: !p.flows }))}
                aria-expanded={donorAi.flows} title="Money-flow graph — everyone this donor funds, plus co-donors">
                {donorAi.flows ? "Close ▾" : "Flows ▸"}
              </button>
              <button className="fec-btn ghost sm"
                onClick={() => setDonorAi((p) => ({ ...p, similar: !p.similar }))}
                aria-expanded={donorAi.similar} title="Donors whose recipient slates overlap this one's — aligned PAC networks">
                {donorAi.similar ? "Close ▾" : "Similar ▸"}
              </button>
              <button className="fec-btn ghost sm"
                onClick={() => watched
                  ? untrack(donor.donorKey)
                  : track({ donorKey: donor.donorKey, name: donor.name, employer: donor.employer, state: donor.state })}
                title={watched ? "Stop tracking this donor" : "Add to the watchlist"}>
                {watched ? "★ Untrack" : "☆ Track"}
              </button>
              <button className="close" onClick={() => setHist(null)}>Close ✕</button>
            </div>
            <div className="fec-ledger-bar">
              <span className="fec-tag">
                {usd(totals?.amount || 0)} across {(totals?.count || 0).toLocaleString()} gifts · {dshort(totals?.firstDate)} → {dshort(totals?.lastDate)}
              </span>
            </div>

            {donorAi.research && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <div className="fec-ai-label">Research (AI)</div>
                <DonorResearch key={hist.key} donorKey={donor.donorKey} name={donor.name}
                  employer={donor.employer} city={donor.city} state={donor.state} />
              </div>
            )}

            {donorAi.ask && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <div className="fec-ai-label">Ask AI</div>
                <DonorAskAI key={hist.key} donorKey={donor.donorKey} name={donor.name}
                  employer={donor.employer} city={donor.city} state={donor.state} />
              </div>
            )}

            {donorAi.flows && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <FlowGraph key={hist.key} donorKey={donor.donorKey} name={donor.name} bare />
              </div>
            )}

            {donorAi.similar && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <div className="fec-ai-label">Similar donors</div>
                <SimilarDonors key={hist.key} donorKey={donor.donorKey} name={donor.name}
                  onSearch={(nm) => { setQMode("name"); setQName(nm); runSearch(false, nm); }} />
              </div>
            )}

            {(byCycle || []).length > 0 && (
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <div className="fec-ai-label">Giving by cycle</div>
                <DonorCycleChart points={byCycle} />
              </div>
            )}

            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
              <div className="fec-ai-label">Recipients</div>
              {(recipients || []).length === 0 ? (
                <div className="sub">No recipients on file.</div>
              ) : (
                <div className="fec-table-wrap">
                  <table className="fec-table">
                    <thead>
                      <tr><th>Recipient</th><th>Source</th><th>Gifts</th><th>Last gift</th><th className="amt">Total</th><th className="amt">%</th><th aria-label="Actions" /></tr>
                    </thead>
                    <tbody>
                      {(recipients || []).map((r, i) => (
                        <tr key={`${r.recipientId || r.recipientName || "r"}-${i}`}>
                          <td>{r.recipientName || "—"}</td>
                          <td><DonorSourceBadge source={r.source} flush /></td>
                          <td>{(r.count || 0).toLocaleString()}</td>
                          <td className="sub">{dshort(r.lastDate)}</td>
                          <td className="amt">{usd(r.total || 0)}</td>
                          <td className="amt">{totals?.amount ? `${(((r.total || 0) / totals.amount) * 100).toFixed(1)}%` : "—"}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {r.source === "tn" && (
                              <button className="fec-btn ghost sm" onClick={() => onDrillTn?.(r.recipientName)}
                                title="Search this recipient in the TN State tab">TN ▸</button>
                            )}
                            {r.source === "fec" && r.recipientId && (
                              <a className="fec-extlink" href={safeUrl(`https://www.fec.gov/data/committee/${r.recipientId}/`)}
                                target="_blank" rel="noopener noreferrer" title="FEC filings for this committee">FEC ↗</a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div className="fec-ai-label" style={{ marginBottom: 0 }}>All gifts · {giftList.length.toLocaleString()}</div>
                <button className="fec-btn ghost sm" onClick={exportGiftsCSV} disabled={!giftList.length}>
                  Export CSV ({giftList.length})
                </button>
              </div>
              {giftList.length === 0 ? (
                <div className="sub" style={{ marginTop: 6 }}>No itemized gifts stored.</div>
              ) : (
                <div className="fec-table-wrap" style={{ marginTop: 6 }}>
                  <table className="fec-table">
                    <thead>
                      <tr><th>Date</th><th>Recipient</th><th className="amt">Amount</th><th>Source</th><th>Cycle / Report</th></tr>
                    </thead>
                    <tbody>
                      {pageGifts.map((g, i) => (
                        <tr key={`${giftPage}-${i}`}>
                          <td className="sub">{dshort(g.date)}</td>
                          <td>
                            {g.recipientName || "—"}
                            {g.memo ? <span className="fec-badge memo">memo</span> : null}
                          </td>
                          <td className="amt">{usd(g.amount || 0)}</td>
                          <td><DonorSourceBadge source={g.source} flush /></td>
                          <td className="sub">{[g.cycle, g.report].filter(Boolean).join(" · ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {giftList.length > DONOR_GIFTS_PER && (
                <div className="fec-pager" style={{ marginTop: 10 }}>
                  <button onClick={() => setGiftPage((p) => p - 1)} disabled={giftPage === 0}>◂ Prev</button>
                  <span className="fec-tag">page {giftPage + 1} / {totalPages}</span>
                  <button onClick={() => setGiftPage((p) => p + 1)} disabled={giftPage >= totalPages - 1}>Next ▸</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );

  return (
    <>
      {/* ── a. Watchlist ── */}
      <section className="fec-controls" style={{ marginTop: 18, display: "block" }} aria-label="Tracked donors">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="fec-ai-label" style={{ marginBottom: 0 }}>Tracked donors</span>
          {stats && (
            <span className="fec-tag">
              {Number(stats.rows || 0).toLocaleString()} stored rows · {Number(stats.donors || 0).toLocaleString()} donors · {Number(stats.recipients || 0).toLocaleString()} recipients
            </span>
          )}
          {/* bulk-data status consolidated into ⚙ Admin (Connections & FEC bulk data sections) */}
          <span style={{ marginLeft: "auto" }}>
            <button className="fec-btn ghost sm" onClick={runWatchRefresh}
              disabled={refreshRes?.loading || !(watch.donors || []).length}
              title="Re-check every tracked donor for new gifts">
              {refreshRes?.loading ? "Checking…" : "↺ Check for new gifts"}
            </button>
          </span>
        </div>
        {refreshRes?.error && <div className="fec-error" role="alert" style={{ marginTop: 10 }}>{refreshRes.error}</div>}
        {refreshRes?.results && (() => {
          const checked = refreshRes.checked ?? refreshRes.results.length;
          const newGifts = refreshRes.results.reduce((a, r) => a + (r.newCount || 0), 0);
          const flagged = refreshRes.results.filter((r) => (r.newCount || 0) > 0 || r.error);
          return (
            <div className="fec-tag" style={{ marginTop: 8 }}>
              {checked} donor{checked === 1 ? "" : "s"} checked — {newGifts} new gift{newGifts === 1 ? "" : "s"}
              {flagged.map((r) => (
                <div key={r.donorKey} style={{ marginTop: 3 }}>
                  {r.error
                    ? <span style={{ color: "var(--rose)" }}>✕ {r.name}: {r.error}</span>
                    : <span style={{ color: "var(--brass)" }}>▲ {r.name}: {r.newCount} new (+{fmtUSDshort(r.newAmount)}) · now {fmtUSDshort(r.total)} / {(r.count || 0).toLocaleString()} gifts</span>}
                </div>
              ))}
            </div>
          );
        })()}
        {watch.error && <div className="fec-error" role="alert" style={{ marginTop: 10 }}>{watch.error}</div>}
        {actionErr && <div className="fec-error" role="alert" style={{ marginTop: 10 }}>{actionErr}</div>}
        {watch.loading ? (
          <div className="fec-spin" style={{ marginTop: 10 }}>Loading watchlist…</div>
        ) : (watch.donors || []).length > 0 ? (
          <div className="fec-table-wrap" style={{ marginTop: 10 }}>
            <table className="fec-table">
              <thead><tr><th>Donor</th><th className="amt">Total</th><th>New gifts</th><th>Checked</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {watch.donors.map((d) => {
                  const open = hist?.key === d.donorKey && hist?.origin === "watch";
                  return (
                    <Fragment key={d.donorKey}>
                      <tr>
                        <td>
                          <b style={{ color: "var(--bone)" }}>{d.displayName}</b>
                          <div className="sub">{[d.employer, d.state].filter(Boolean).join(" · ") || "—"}</div>
                        </td>
                        <td className="amt">
                          {fmtUSDshort(d.total)}
                          <div className="sub" style={{ color: "var(--muted)" }}>{(d.count || 0).toLocaleString()} gifts</div>
                        </td>
                        <td>
                          {d.newCount > 0
                            ? <span style={{ color: "var(--brass)", fontWeight: 700 }}>▲ {d.newCount} new (+{fmtUSDshort(d.newAmount)})</span>
                            : <span className="sub">—</span>}
                        </td>
                        <td className="sub">
                          {when(d.lastChecked)}
                          {d.addedAt ? <div className="sub">added {when(d.addedAt)}</div> : null}
                        </td>
                        <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                          <button className="fec-btn ghost sm" onClick={() => openHistory(d.donorKey, { markSeen: true, origin: "watch" })}
                            aria-expanded={open}
                            title={open ? "Collapse" : "Open full giving history (marks new gifts as seen)"}>
                            {open ? "Close ▾" : "Open ▸"}
                          </button>
                          {" "}
                          <button className="fec-btn ghost sm" onClick={() => untrack(d.donorKey)} title="Stop tracking this donor">✕</button>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={5} style={{ padding: 0, borderTop: "none" }}>{renderHistPanel()}</td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !watch.error && (
          <div className="fec-empty" style={{ marginTop: 12, padding: 16 }}>No tracked donors yet — search below and ★ Track.</div>
        )}
      </section>

      {/* ── b. Search ── */}
      <section className="fec-controls" style={{ marginTop: 18 }} aria-label="Donor search">
        <div className="fec-field">
          <label htmlFor="dn-mode">Search by</label>
          <select id="dn-mode" value={qMode} style={inputStyle}
            onChange={(e) => { setQMode(e.target.value); setTaOpen(false); setSearchErr(null); }}>
            <option value="name">Donor name</option>
            <option value="employer">Employer</option>
            <option value="occupation">Occupation</option>
          </select>
        </div>
        <div className="fec-field" style={{ gridColumn: "span 2", position: "relative" }}>
          <label htmlFor="dn-name">
            {qMode === "name" ? "Donor name" : qMode === "employer" ? "Employer contains" : "Occupation contains"}
          </label>
          <input id="dn-name" value={qName} onChange={(e) => onNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(false); if (e.key === "Escape") setTaOpen(false); }}
            onBlur={() => setTimeout(() => setTaOpen(false), 150)}
            autoComplete="off"
            placeholder={qMode === "name" ? "Any word order works — Jane Doe, DOE JANE, or an organization"
              : qMode === "employer" ? "e.g. FedEx, Eastman, Pilot" : "e.g. Realtor, Physician, Lobbyist"}
            style={inputStyle} />
          {taOpen && typeahead.length > 0 && (
            <div role="listbox" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30,
              background: "var(--panel2)", border: "1px solid var(--line)", borderTop: "none" }}>
              {typeahead.map((s) => (
                <div key={s.donorKey} role="option" aria-selected={false}
                  onMouseDown={() => { setQName(s.name); runSearch(false, s.name); }}
                  style={{ padding: "6px 10px", cursor: "pointer", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
                  <b style={{ color: "var(--bone)" }}>{s.name}</b>
                  <span className="sub" style={{ marginLeft: 8 }}>
                    {[s.employer, s.state].filter(Boolean).join(" · ")}
                    {(s.employer || s.state) ? " · " : ""}{fmtUSDshort(s.total)} ({s.count})
                  </span>
                </div>
              ))}
              <div className="sub" style={{ padding: "4px 10px", fontSize: 10 }}>from your stored ledger — Enter searches the FEC too</div>
            </div>
          )}
        </div>
        <div className="fec-field">
          <label htmlFor="dn-state">State (optional)</label>
          <input id="dn-state" value={qState} maxLength={2}
            onChange={(e) => setQState(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && runSearch(false)}
            placeholder="TN" style={inputStyle} />
        </div>
        {qMode === "name" && (
          <div className="fec-field">
            <label htmlFor="dn-employer">Employer (optional)</label>
            <input id="dn-employer" value={qEmployer} onChange={(e) => setQEmployer(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch(false)}
              placeholder="e.g. Eastman" style={inputStyle} />
          </div>
        )}
        <div className="fec-actions">
          <button className="fec-btn" onClick={() => runSearch(false)} disabled={searching}>
            {searching ? "Searching…" : qMode === "name" ? "Search donors" : `Search ${qMode}s`}
          </button>
          <button className="fec-btn ghost" onClick={() => runSearch(true)} disabled={searching}
            title="Bypass cached cycles and re-check the FEC">↺ Fresh</button>
          <label className="fec-check">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
            Search back to 2016
          </label>
          <span className="fec-hint">
            {qMode === "name"
              ? "Searches FEC itemized filings plus stored TN records. Recent cycles cache after the first pull — ↺ Fresh re-checks them."
              : "Reverse lookup: who gives under this " + qMode + ", and which campaigns the money reaches. Pulls the FEC's top matches per cycle plus everything already in the stored ledger."}
          </span>
        </div>
      </section>

      {searchErr && <div className="fec-error" role="alert">{searchErr}</div>}
      {searching && <div className="fec-spin" style={{ marginTop: 14 }}>Searching donor filings{deep ? " back to 2016" : ""}…</div>}
      {searchRes && !searching && !searchErr && (() => {
        const donors = searchRes.donors || [];
        return (
          <>
            <div className="fec-status">
              <span>
                {donors.length} donor{donors.length === 1 ? "" : "s"} matched
                {searchRes.cyclesSearched?.length ? <span style={{ color: "var(--muted)" }}> · searched {searchRes.cyclesSearched.join(", ")}</span> : null}
                {searchRes.skippedCycles?.length ? <span style={{ color: "var(--muted)" }}> · {searchRes.skippedCycles.join(", ")} cached — ↺ Fresh re-checks</span> : null}
              </span>
            </div>
            {searchRes.note && <div className="fec-tag" style={{ marginTop: 4 }}>ⓘ {searchRes.note}</div>}
            {searchRes.suggestions?.length > 0 && (
              <div className="fec-tag" style={{ marginTop: 6 }}>
                Did you mean:{" "}
                {searchRes.suggestions.map((s) => (
                  <button key={s.donorKey} className="fec-btn ghost sm" style={{ margin: "2px 4px" }}
                    onClick={() => { setQName(s.name); runSearch(false, s.name); }}>
                    {s.name}{s.state ? ` (${s.state})` : ""} — {fmtUSDshort(s.total)} · {s.count} gift{s.count === 1 ? "" : "s"}
                  </button>
                ))}
              </div>
            )}
            {donors.length === 0 ? (
              <div className="fec-empty">
                No donors matched{searchRes.suggestions?.length ? " exactly — try a suggestion above" : ""} — or try fewer words (word order doesn't matter) or drop the state/employer filters.
              </div>
            ) : (
              <div className="fec-table-wrap" style={{ marginTop: 10 }}>
                <table className="fec-table">
                  <thead>
                    <tr>
                      <th>Donor</th><th>Employer</th><th>Location</th><th>Gifts</th><th>Recipients</th>
                      <th>First – Last</th><th className="amt">Total</th><th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {donors.map((d) => {
                      const open = hist?.key === d.donorKey && hist?.origin === "search";
                      return (
                        <Fragment key={d.donorKey}>
                          <tr>
                            <td>
                              <b style={{ color: "var(--bone)" }}>{d.name}</b>
                              {String(d.sources || "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => (
                                <DonorSourceBadge key={s} source={s} />
                              ))}
                              {d.occupation && <div className="sub">{d.occupation}</div>}
                            </td>
                            <td className="sub">{d.employer || "—"}</td>
                            <td className="sub">{[d.city, d.state].filter(Boolean).join(", ") || "—"}</td>
                            <td>{(d.count || 0).toLocaleString()}</td>
                            <td>{d.recipients ?? "—"}</td>
                            <td className="sub">{dshort(d.firstDate)} – {dshort(d.lastDate)}</td>
                            <td className="amt">{usd(d.total || 0)}</td>
                            <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                              {isWatched(d.donorKey, d.watched)
                                ? <button className="fec-btn ghost sm" disabled title="Already on the watchlist">✓ Tracked</button>
                                : <button className="fec-btn ghost sm" onClick={() => track(d)} title="Add to the watchlist">★ Track</button>}
                              {" "}
                              <button className="fec-btn ghost sm" onClick={() => openHistory(d.donorKey, { origin: "search" })} aria-expanded={open}>
                                {open ? "Close ▾" : "Details ▸"}
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={8} style={{ padding: 0, borderTop: "none" }}>{renderHistPanel()}</td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      })()}

      {/* ── c. Employer / occupation reverse-lookup results ── */}
      {fieldRes && !searching && !searchErr && (() => {
        const t = fieldRes.totals || {};
        const label = fieldRes.field === "occupation" ? "occupation" : "employer";
        return (
          <>
            <div className="fec-status">
              <button className="fec-btn ghost sm" style={{ marginRight: 8 }}
                title="Standing search — the 🔔 alert scan flags new gifts matching this query"
                onClick={async () => {
                  await fetch("/api/searches", { method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ q: fieldRes.q, field: fieldRes.field }) }).catch(() => {});
                }}>★ Save search</button>
              <span>
                “{fieldRes.q}” ({label}) — {Number(t.donors || 0).toLocaleString()} donor{t.donors === 1 ? "" : "s"} ·{" "}
                {Number(t.count || 0).toLocaleString()} gifts · {fmtUSDshort(t.total || 0)} → {Number(t.recipients || 0).toLocaleString()} recipient{t.recipients === 1 ? "" : "s"}
                {fieldRes.cyclesSearched?.length ? <span style={{ color: "var(--muted)" }}> · searched {fieldRes.cyclesSearched.join(", ")}</span> : null}
                {fieldRes.skippedCycles?.length ? <span style={{ color: "var(--muted)" }}> · {fieldRes.skippedCycles.join(", ")} cached — ↺ Fresh re-checks</span> : null}
              </span>
            </div>
            {fieldRes.note && <div className="fec-tag" style={{ marginTop: 4 }}>ⓘ {fieldRes.note}</div>}
            {(t.count || 0) === 0 ? (
              <div className="fec-empty">No stored gifts match this {label} — try fewer characters or ↺ Fresh to re-check the FEC.</div>
            ) : (
              <>
                {(fieldRes.variants || []).length > 1 && (
                  <div className="fec-tag" style={{ marginTop: 8 }}>
                    Rolls up as:{" "}
                    {(fieldRes.variants || []).slice(0, 12).map((v) => (
                      <span key={v.value} className="fec-tag" style={{ margin: "2px 4px" }}
                        title={v.raw?.length ? `Raw filings: ${v.raw.join(" · ")}` : undefined}>
                        {v.value} — {fmtUSDshort(v.total)} ({v.count})
                      </span>
                    ))}
                  </div>
                )}
                <div className="fec-ai-label" style={{ marginTop: 14 }}>Where the money goes</div>
                <div className="fec-table-wrap" style={{ marginTop: 6 }}>
                  <table className="fec-table">
                    <thead>
                      <tr><th>Recipient</th><th>Source</th><th>Donors</th><th>Gifts</th><th>First – Last</th><th className="amt">Total</th><th className="amt">%</th></tr>
                    </thead>
                    <tbody>
                      {(fieldRes.recipients || []).slice(0, 40).map((r, i) => (
                        <tr key={`${r.recipientId || "r"}-${i}`}>
                          <td>
                            <b style={{ color: "var(--bone)" }}>{r.recipientName || r.recipientId || "—"}</b>
                            {r.source === "fec" && r.recipientId && (
                              <>
                                {" "}
                                <a className="fec-extlink" href={safeUrl(`https://www.fec.gov/data/committee/${r.recipientId}/`)}
                                  target="_blank" rel="noopener noreferrer" title="FEC filings for this committee">FEC ↗</a>
                              </>
                            )}
                          </td>
                          <td><DonorSourceBadge source={r.source} flush /></td>
                          <td>{Number(r.donors || 0).toLocaleString()}</td>
                          <td>{Number(r.count || 0).toLocaleString()}</td>
                          <td className="sub">{dshort(r.firstDate)} – {dshort(r.lastDate)}</td>
                          <td className="amt">{usd(r.total || 0)}</td>
                          <td className="amt">{t.total ? `${(((r.total || 0) / t.total) * 100).toFixed(1)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="fec-ai-label" style={{ marginTop: 14 }}>Top donors under this {label}</div>
                <div className="fec-table-wrap" style={{ marginTop: 6 }}>
                  <table className="fec-table">
                    <thead>
                      <tr><th>Donor</th><th>Employer / Occupation</th><th>Location</th><th>Gifts</th><th>Recipients</th><th className="amt">Total</th><th aria-label="Actions" /></tr>
                    </thead>
                    <tbody>
                      {(fieldRes.donors || []).slice(0, 50).map((d) => {
                        const open = hist?.key === d.donorKey && hist?.origin === "search";
                        return (
                          <Fragment key={d.donorKey}>
                            <tr>
                              <td><b style={{ color: "var(--bone)" }}>{d.name || d.donorKey.split("|")[0]}</b></td>
                              <td className="sub">{[d.employer, d.occupation].filter(Boolean).join(" · ") || "—"}</td>
                              <td className="sub">{[d.city, d.state].filter(Boolean).join(", ") || "—"}</td>
                              <td>{Number(d.count || 0).toLocaleString()}</td>
                              <td>{d.recipients ?? "—"}</td>
                              <td className="amt">{usd(d.total || 0)}</td>
                              <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                                {isWatched(d.donorKey, d.watched)
                                  ? <button className="fec-btn ghost sm" disabled title="Already on the watchlist">✓ Tracked</button>
                                  : <button className="fec-btn ghost sm" onClick={() => track(d)} title="Add to the watchlist">★ Track</button>}
                                {" "}
                                <button className="fec-btn ghost sm" onClick={() => openHistory(d.donorKey, { origin: "search" })} aria-expanded={open}>
                                  {open ? "Close ▾" : "Details ▸"}
                                </button>
                              </td>
                            </tr>
                            {open && (
                              <tr>
                                <td colSpan={7} style={{ padding: 0, borderTop: "none" }}>{renderHistPanel()}</td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {fieldRes.coverage && <div className="sub" style={{ marginTop: 8 }}>{fieldRes.coverage}</div>}
              </>
            )}
          </>
        );
      })()}

    </>
  );
}

function TnPanel({ seed }) {
  const [meta, setMeta] = useState(null);
  // entity search
  const [name, setName] = useState("");
  const [office, setOffice] = useState("");
  const [year, setYear] = useState("");
  const [type, setType] = useState("both");
  const [district, setDistrict] = useState(""); // TREF district id (depends on office)
  const [party, setParty] = useState("");       // TREF party id
  const [winner, setWinner] = useState("");     // "" | primary | general
  const [districtOpts, setDistrictOpts] = useState([]);
  useEffect(() => {
    let live = true;
    setDistrict(""); setDistrictOpts([]);
    if (!office) return undefined;
    fetch(`/api/tn/districts?office=${encodeURIComponent(office)}`).then((r) => r.json())
      .then((d) => { if (live) setDistrictOpts(d?.districts || []); }).catch(() => {});
    return () => { live = false; };
  }, [office]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reports, setReports] = useState({});
  const [aiProfiles, setAiProfiles] = useState({});
  const [money, setMoney] = useState({});
  const [moneyTab, setMoneyTab] = useState({}); // rowIdx -> active tab string
  const [trends, setTrends] = useState({});     // rowIdx -> {loading, data, error}
  const [activity, setActivity] = useState({}); // rowIdx -> {loading, data, error} (year scan)
  const [ledger, setLedger] = useState({}); // rowIdx -> {loading, data, error} (itemized from reports)
  const [ledgerYear, setLedgerYear] = useState({}); // rowIdx -> "all" | "2024" (optional ledger filter)
  const [recvView, setRecvView] = useState({}); // rowIdx -> raw | donors | employers | filings
  const [spentView, setSpentView] = useState({}); // rowIdx -> raw | vendors | filings
  const [lastFiled, setLastFiled] = useState({}); // tnId -> {loading, date, error}
  const [flowsOpen, setFlowsOpen] = useState({}); // tnId -> bool (money-flow graph, mirrors the FEC tab's Flows ▸)
  const [localFilter, setLocalFilter] = useState(""); // client-side substring filter on results
  // donor reverse lookup
  const [donorMode, setDonorMode] = useState(false);
  const [donorName, setDonorName] = useState("");
  const [donorYear, setDonorYear] = useState("");
  const [donorRy, setDonorRy] = useState(String(new Date().getFullYear()));
  const [donorResult, setDonorResult] = useState(null);
  const [donorLoading, setDonorLoading] = useState(false);
  const [donorError, setDonorError] = useState(null);
  const [donorGiftYear, setDonorGiftYear] = useState("all"); // filter the gift ledger by year
  const [donorGiftFilter, setDonorGiftFilter] = useState(""); // partial-string filter on recipient/name
  // previous searches (paginated history)
  const [history, setHistory] = useState({ rows: [], total: 0 });

  // ---- tracked TN entities (mirrors the Donors tab watchlist) ----
  const [tnWatch, setTnWatch] = useState({ loading: true, entities: [] });
  const [twOverride, setTwOverride] = useState({}); // tnId -> bool, optimistic until list reloads
  const loadTnWatch = async () => {
    try {
      const res = await fetch("/api/tn/watchlist");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `Watchlist failed (HTTP ${res.status})`);
      setTnWatch({ entities: data?.entities || [] });
      setTwOverride({});
    } catch (e) { setTnWatch((w) => ({ entities: w.entities || [], error: e.message })); }
  };
  useEffect(() => { loadTnWatch(); }, []);
  const tnWatchedIds = new Set((tnWatch.entities || []).map((w) => String(w.tnId)));
  const isTnWatched = (tnId) => (twOverride[tnId] != null ? twOverride[tnId] : tnWatchedIds.has(String(tnId)));
  const trackTn = async (r, office, party) => {
    const tnId = String(r.tnId);
    try {
      const res = await fetch("/api/tn/watch", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tnId, name: entityName(r), office: office || "", party: party || "" }),
      });
      if (!res.ok) throw new Error(`Track failed (HTTP ${res.status})`);
      setTwOverride((p) => ({ ...p, [tnId]: true }));
      loadTnWatch();
    } catch (e) { setError(e.message); }
  };
  const untrackTn = async (tnId) => {
    try {
      await fetch(`/api/tn/watch?id=${encodeURIComponent(tnId)}`, { method: "DELETE" });
      setTwOverride((p) => ({ ...p, [tnId]: false }));
      loadTnWatch();
    } catch { /* list reload corrects */ }
  };
  // Open ▸ = run the TN search for this entity (marks its new-row badge as seen)
  const openTracked = (w) => {
    setName(w.name);
    search(false, w.name);
    fetch("/api/tn/watch/seen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tnId: w.tnId }) })
      .then(() => loadTnWatch()).catch(() => { /* badge clears next reload */ });
  };
  const [histPage, setHistPage] = useState(0);
  const [histExpanded, setHistExpanded] = useState({}); // id -> {loading, data, error}
  const HIST_PER = 10;

  useEffect(() => {
    fetch("/api/tn/meta").then((r) => r.json()).then(setMeta).catch(() => setMeta({ years: [], offices: [] }));
  }, []);

  // Background: fetch most-recent filing date for every entity in results
  useEffect(() => {
    if (!result?.rows?.length) return;
    const tnIds = [...new Set(result.rows.map((r) => r.tnId).filter(Boolean))];
    // Small result sets fetch each entity's report list live. Bigger ones only read what is already
    // stored (live=0) — otherwise a 40-row result fired 40 report-list scrapes at apps.tn.gov in the
    // background just to fill the "last filed" column. Opening an entity still fetches it live.
    const liveParam = tnIds.length > 6 ? "&live=0" : "";
    for (const id of tnIds) {
      setLastFiled((p) => { if (p[id]) return p; return { ...p, [id]: { loading: true } }; });
      fetch(`/api/tn/reports?id=${id}${liveParam}`)
        .then((r) => r.json())
        .then((data) => {
          const rows = data.rows || data.reports || [];
          // Parse MM/DD/YYYY or YYYY-MM-DD, return sortable string
          const parseDateVal = (s) => {
            if (!s) return "";
            const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            return m ? `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}` : s;
          };
          const dated = rows
            .map((r) => ({ date: r.submitted || r.cells?.[3] || "", election: r.election || r.cells?.[0] || "" }))
            .filter((x) => x.date)
            .sort((a, b) => parseDateVal(b.date).localeCompare(parseDateVal(a.date)));
          const latest = dated[0] || null;
          setLastFiled((p) => ({ ...p, [id]: { date: latest?.date || null, election: latest?.election || null } }));
          // Pre-seed reports state so clicking "Reports ▸" opens instantly
          setReports((p) => p[id] ? p : { ...p, [id]: { data, open: false } });
          // Pre-seed detail for any reports already in the DB
          const preloaded = {};
          for (const rr of rows) {
            const rid = rr.reportId || rr.report_id;
            if (rid && rr.detail) preloaded[rid] = { data: rr.detail, open: false };
          }
          if (Object.keys(preloaded).length) setReportDetails((p) => ({ ...p, ...preloaded }));
        })
        .catch(() => setLastFiled((p) => ({ ...p, [id]: { error: true } })));
    }
  }, [result]);

  const eyLabel = (id) => (meta?.years || []).find((y) => y.id === id)?.label || "";
  const curYear = new Date().getFullYear();

  const search = async (forceRefresh = false, overrideName) => {
    const nm = typeof overrideName === "string" ? overrideName : name; // drill-through passes the clicked name before state settles
    if (!nm && !office && !year && !party) { setError("Provide at least a name, office, party, or election year."); return; }
    setLoading(true); setError(null); setReports({}); setAiProfiles({}); setMoney({}); setMoneyTab({}); setTrends({}); setLastFiled({}); setLocalFilter("");
    setActivity({}); setLedger({}); setLedgerYear({}); setRecvView({}); setSpentView({}); setFlowsOpen({}); // index-keyed per-row state — stale across result sets
    try {
      const qs = new URLSearchParams({ name: nm, office, year, type });
      if (district) qs.set("district", district);
      if (party) qs.set("party", party);
      if (winner) qs.set("winner", winner);
      if (forceRefresh) qs.set("_refresh", "1");
      const res = await fetch(`/api/tn/candidates?${qs}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `TN search failed (HTTP ${res.status})`);
      setResult(data);
    } catch (e) {
      setError(e.message); setResult(null);
    } finally { setLoading(false); loadHistory(histPage); }
  };

  // Drill-through from the Donors tab: seed carries a recipient name — flip to entity
  // search and run it immediately (search() accepts a name override so we don't wait
  // for setName's state to settle). Keyed on seed.t so repeat clicks re-fire.
  useEffect(() => {
    if (!seed?.name) return;
    setDonorMode(false);
    setName(seed.name);
    search(false, seed.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.t]);

  // ---- previous searches (history) ----
  const loadHistory = async (page = 0) => {
    try {
      const res = await fetch(`/api/tn/searches?limit=${HIST_PER}&offset=${page * HIST_PER}`);
      const data = await res.json().catch(() => null);
      if (data?.searches) setHistory({ rows: data.searches, total: data.total || 0 });
    } catch { /* non-fatal */ }
  };
  useEffect(() => { loadHistory(histPage); }, [histPage]);

  // Human label for a stored search row.
  const histLabel = (s) => {
    const parts = [];
    if (s.name) parts.push(`"${s.name}"`);
    const off = (meta?.offices || []).find((o) => o.id === s.office)?.label;
    if (off) parts.push(off);
    if (s.year) parts.push(eyLabel(s.year) || s.year);
    if (s.type && s.type !== "both") parts.push(s.type === "cand" ? "candidates" : "PACs");
    return parts.length ? parts.join(" · ") : "(all)";
  };

  // Re-run a stored search into the main form.
  const applyHistory = (s, force = false) => {
    setName(s.name || ""); setOffice(s.office || ""); setYear(s.year || ""); setType(s.type || "both");
    setDonorMode(false);
    // run with the just-set values (search() reads state, so push via a microtask)
    setTimeout(() => runHistorySearch(s, force), 0);
  };
  const runHistorySearch = async (s, force) => {
    setLoading(true); setError(null); setReports({}); setAiProfiles({}); setMoney({}); setMoneyTab({}); setTrends({}); setLastFiled({}); setLocalFilter("");
    setActivity({}); setLedger({}); setLedgerYear({}); setRecvView({}); setSpentView({}); setFlowsOpen({}); // index-keyed per-row state — stale across result sets
    try {
      const qs = new URLSearchParams({ name: s.name || "", office: s.office || "", year: s.year || "", type: s.type || "both" });
      if (force) qs.set("_refresh", "1");
      const res = await fetch(`/api/tn/candidates?${qs}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `TN search failed (HTTP ${res.status})`);
      setResult(data);
    } catch (e) { setError(e.message); setResult(null); }
    finally { setLoading(false); loadHistory(histPage); }
  };

  // Expand a history row inline to preview its cached entities.
  const toggleHistExpand = async (s) => {
    const cur = histExpanded[s.id];
    if (cur && cur.open) { setHistExpanded((p) => ({ ...p, [s.id]: { ...cur, open: false } })); return; }
    if (cur && cur.data) { setHistExpanded((p) => ({ ...p, [s.id]: { ...cur, open: true } })); return; }
    setHistExpanded((p) => ({ ...p, [s.id]: { open: true, loading: true } }));
    try {
      const qs = new URLSearchParams({ name: s.name || "", office: s.office || "", year: s.year || "", type: s.type || "both" });
      const res = await fetch(`/api/tn/candidates?${qs}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setHistExpanded((p) => ({ ...p, [s.id]: { open: true, data } }));
    } catch (e) {
      setHistExpanded((p) => ({ ...p, [s.id]: { open: true, error: e.message } }));
    }
  };

  const [reportDetails, setReportDetails] = useState({}); // reportId -> {loading,data,error,open}
  const [prefetchJobs, setPrefetchJobs] = useState({});   // tnId -> {jobId, total, done, complete}
  const prefetchAliveRef = useRef(true); // stops the prefetch poll chain when the panel unmounts
  useEffect(() => {
    prefetchAliveRef.current = true;
    return () => { prefetchAliveRef.current = false; };
  }, []);

  const toggleReports = async (row) => {
    const id = row.tnId;
    if (!id) return;
    const cur = reports[id];
    if (cur?.open) { setReports((p) => ({ ...p, [id]: { ...cur, open: false } })); return; }
    if (cur?.data) { setReports((p) => ({ ...p, [id]: { ...cur, open: true } })); return; }
    setReports((p) => ({ ...p, [id]: { open: true, loading: true } }));
    try {
      const ownerName = entityName(row) || (row.cells[0] || "").trim();
      const res = await fetch(`/api/tn/reports?id=${id}&owner=${encodeURIComponent(ownerName)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      // Seed reportDetails with any pre-loaded detail from the DB
      const rows = data.rows || data.reports || [];
      const preloaded = {};
      for (const r of rows) {
        const rid = r.reportId || r.report_id;
        if (rid && r.detail) preloaded[rid] = { data: r.detail, open: false };
      }
      if (Object.keys(preloaded).length) setReportDetails((p) => ({ ...p, ...preloaded }));
      setReports((p) => ({ ...p, [id]: { open: true, data } }));
    } catch (e) {
      setReports((p) => ({ ...p, [id]: { open: true, error: e.message } }));
    }
  };

  const fetchOneReport = async (reportId, tnId) => {
    if (!reportId) return;
    setReportDetails((p) => ({ ...p, [reportId]: { ...(p[reportId] || {}), loading: true, open: true } }));
    try {
      const res = await fetch(`/api/tn/report/${reportId}?tnId=${tnId}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setReportDetails((p) => ({ ...p, [reportId]: { data, open: true } }));
    } catch (e) {
      setReportDetails((p) => ({ ...p, [reportId]: { error: e.message, open: true } }));
    }
  };

  const toggleReportDetail = (reportId) => {
    setReportDetails((p) => ({ ...p, [reportId]: { ...(p[reportId] || {}), open: !p[reportId]?.open } }));
  };

  const startPrefetch = async (tnId, ownerName) => {
    if (prefetchJobs[tnId]?.running) return;
    setPrefetchJobs((p) => ({ ...p, [tnId]: { running: true, done: 0, total: 0, complete: false } }));
    try {
      const res = await fetch("/api/tn/reports/prefetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tnId, owner: ownerName }),
      });
      const { jobId } = await res.json().catch(() => ({}));
      if (!jobId) { setPrefetchJobs((p) => ({ ...p, [tnId]: { error: "No job started" } })); return; }
      // Poll for completion
      const poll = async () => {
        if (!prefetchAliveRef.current) return; // panel unmounted — stop the chain
        try {
          const jr = await fetch(`/api/tn/reports/prefetch/${jobId}`);
          const job = await jr.json().catch(() => ({}));
          if (!prefetchAliveRef.current) return;
          setPrefetchJobs((p) => ({ ...p, [tnId]: { running: !job.complete && !job.failed, ...job } }));
          if (!job.complete && !job.failed) setTimeout(poll, 2000);
          else {
            // Reload report list to pick up newly stored details
            const rr = await fetch(`/api/tn/reports?id=${tnId}`);
            const fresh = await rr.json().catch(() => null);
            if (fresh) {
              setReports((p) => ({ ...p, [tnId]: { ...p[tnId], data: fresh } }));
              const rows = fresh.rows || fresh.reports || [];
              const preloaded = {};
              for (const r of rows) {
                const rid = r.reportId || r.report_id;
                if (rid && r.detail) preloaded[rid] = { data: r.detail, open: false };
              }
              if (Object.keys(preloaded).length) setReportDetails((p) => ({ ...p, ...preloaded }));
            }
          }
        } catch { /* poll errors are non-fatal */ }
      };
      setTimeout(poll, 2000);
    } catch (e) {
      setPrefetchJobs((p) => ({ ...p, [tnId]: { error: e.message } }));
    }
  };

  const entityName = (row, headers = result?.headers) => {
    if (!headers) return (row.cells?.[0] || "").trim();
    const get = (re) => {
      const idx = headers.findIndex((h) => re.test(h));
      return idx >= 0 ? (row.cells[idx] || "").trim() : "";
    };
    return [get(/^first\s*name/i), get(/^last\s*name/i)].filter(Boolean).join(" ") || get(/name/i);
  };

  const askAI = async (row, i, forceRefresh = false) => {
    const cur = aiProfiles[i];
    if (!forceRefresh) {
      if (cur?.open) { setAiProfiles((p) => ({ ...p, [i]: { ...cur, open: false } })); return; }
      if (cur?.data || cur?.error) { setAiProfiles((p) => ({ ...p, [i]: { ...cur, open: true } })); return; }
    }
    setAiProfiles((p) => ({ ...p, [i]: { open: true, loading: true } }));
    try {
      const fields = {};
      result.headers.forEach((h, j) => { if ((row.cells[j] || "").trim()) fields[h] = row.cells[j].trim(); });
      const res = await fetch("/api/tn/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: entityName(row), fields, tnId: row.tnId, forceRefresh }),
      });
      const data = await res.json().catch(() => null);
      setAiProfiles((p) => ({
        ...p, [i]: { open: true, data: data || {},
          error: data?.error?.message || (!res.ok ? `Profile failed (HTTP ${res.status})` : null) },
      }));
    } catch (e) {
      setAiProfiles((p) => ({ ...p, [i]: { open: true, error: e.message } }));
    }
  };

  // ---- money flows ----
  // Default election year: prefer the search form's selection ONLY if it's a plain 4-digit year
  // (not a special/runoff election). Fall back to the most recent plain-year entry.
  const defaultEy = () => {
    const plainYear = (id) => /^\d{4}$/.test((meta?.years || []).find((y) => y.id === id)?.label || "");
    if (year && plainYear(year)) return year;
    // Most recent *non-future* plain (4-digit) election year — avoids defaulting to 2030/2028,
    // which have no filings yet and make every money flow come back blank.
    const cur = new Date().getFullYear();
    const plain = (meta?.years || []).filter((y) => /^\d{4}$/.test(y.label));
    return (plain.find((y) => Number(y.label) <= cur) || plain[plain.length - 1] || plain[0])?.id || "";
  };
  const defaultRy = (eyId) => { const m = eyLabel(eyId).match(/\d{4}/); return m ? m[0] : String(curYear); };

  const loadMoney = async (row, i, eyOverride, ryOverride) => {
    const nm = entityName(row);
    const ey = eyOverride || money[i]?.ey || defaultEy();
    const ry = ryOverride || money[i]?.ry || defaultRy(ey);
    setMoney((p) => ({ ...p, [i]: { ...p[i], open: true, loading: true, ey, ry } }));
    try {
      const res = await fetch(`/api/tn/money?name=${encodeURIComponent(nm)}&electionYear=${ey}&reportYear=${ry}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setMoney((p) => ({ ...p, [i]: { open: true, data, ey, ry } }));
    } catch (e) {
      setMoney((p) => ({ ...p, [i]: { open: true, error: e.message, ey, ry } }));
    }
  };

  const toggleMoney = (row, i) => {
    const cur = money[i];
    if (cur?.open) { setMoney((p) => ({ ...p, [i]: { ...cur, open: false } })); return; }
    if (row.tnId) loadLedger(row, i); // itemized money flows from filed reports (PRIMARY source)
    if (cur?.data || cur?.error) { setMoney((p) => ({ ...p, [i]: { ...cur, open: true } })); return; }
    // Open the panel immediately; the slower TREF name-search (cesearch) loads lazily — only when
    // the user opens the "Gave" tab or changes the year — so we don't hammer the TN site.
    if (row.tnId) {
      const ey = cur?.ey || defaultEy();
      setMoney((p) => ({ ...p, [i]: { ...(cur || {}), open: true, ey, ry: cur?.ry || defaultRy(ey) } }));
    } else {
      loadMoney(row, i); // no report id → name-search is the only source
    }
  };

  // ---- aggregation helpers ----
  // Group rows by a named column; return [{name, total, count}] sorted by total desc
  const aggregateBy = (sec, colPat) => groupAndSum(sec, colPat).groups;

  // Conduit / pass-through processors — their lines aggregate OTHER people's earmarked money, so
  // they're surfaced separately, not counted as real donors (mirrors the FEC dossier logic).
  const TN_CONDUIT_RE = /^(WINRED|ACTBLUE|WINRED TECHNICAL|DEMOCRACY ENGINE|ANEDOT)\b/i;

  // Group transaction rows by a column, sum amounts, dedup conduits, and return totals — the
  // itemize→group→sum primitive shared by Received (by donor/employer/filing) and Spent (by vendor/filing).
  const groupAndSum = (sec, colPat, { conduit = false } = {}) => {
    if (!sec?.rows?.length || !sec?.headers?.length) return { groups: [], total: 0, count: 0, conduitTotal: 0, conduitCount: 0 };
    const hi = sec.headers.findIndex((h) => colPat.test(h));
    const ai = sec.headers.findIndex((h) => /amount/i.test(h));
    if (hi < 0) return { groups: [], total: 0, count: 0, conduitTotal: 0, conduitCount: 0 };
    const map = {};
    let total = 0, count = 0, conduitTotal = 0, conduitCount = 0;
    for (const row of sec.rows) {
      const key = (row[hi] || "").trim() || "(unknown)";
      const mapKey = key.toUpperCase(); // case-insensitive grouping — filings format the same name differently
      const raw = ai >= 0 ? String(row[ai] || "") : "";
      let amt = raw ? Number(raw.replace(/[^0-9.-]/g, "")) || 0 : 0;
      if (/\(.*\)/.test(raw)) amt = -Math.abs(amt); // accounting-style "(1,234.56)" negatives
      if (conduit && TN_CONDUIT_RE.test(mapKey)) { conduitTotal += amt; conduitCount++; continue; }
      if (!map[mapKey]) map[mapKey] = { name: key, total: 0, count: 0 }; // display keeps first-seen casing
      map[mapKey].total += amt; map[mapKey].count++;
      total += amt; count++;
    }
    const groups = Object.values(map).sort((a, b) => b.total - a.total);
    return { groups, total, count, conduitTotal: Math.round(conduitTotal), conduitCount };
  };

  // % of contributions from PAC/Committee/Organization sources (dark money indicator)
  const darkMoneyPct = (sec) => {
    if (!sec?.rows?.length || !sec?.headers?.length) return 0;
    const ti = sec.headers.findIndex((h) => /^type$/i.test(h));
    if (ti < 0) return 0;
    const n = sec.rows.filter((r) => /pac|committee|organization/i.test(r[ti] || "")).length;
    return Math.round((n / sec.rows.length) * 100);
  };

  // ---- trend loading ----
  const loadTrend = async (row, i) => {
    const nm = entityName(row);
    if (trends[i]?.loading || trends[i]?.data) return;
    setTrends((p) => ({ ...p, [i]: { loading: true } }));
    try {
      const res = await fetch(`/api/tn/trend?name=${encodeURIComponent(nm)}&dataType=received`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setTrends((p) => ({ ...p, [i]: { data } }));
    } catch (e) {
      setTrends((p) => ({ ...p, [i]: { error: e.message } }));
    }
  };

  // ---- activity scan: which years have data ----
  const scanActivity = async (row, i, force = false) => {
    const nm = entityName(row);
    setActivity((p) => ({ ...p, [i]: { loading: true } }));
    try {
      const res = await fetch(`/api/tn/activity?name=${encodeURIComponent(nm)}${row.tnId ? `&id=${encodeURIComponent(row.tnId)}` : ""}${force ? "&_refresh=1" : ""}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setActivity((p) => ({ ...p, [i]: { data } }));
    } catch (e) {
      setActivity((p) => ({ ...p, [i]: { error: e.message } }));
    }
  };

  // ---- itemized ledger from filed reports (reliable money flows) ----
  const loadLedger = async (row, i, force = false) => {
    if (!row.tnId) return;
    if (!force && (ledger[i]?.loading || ledger[i]?.data)) return;
    setLedger((p) => ({ ...p, [i]: { loading: true } }));
    try {
      const res = await fetch(`/api/tn/ledger?id=${encodeURIComponent(row.tnId)}&owner=${encodeURIComponent(entityName(row))}${force ? "&_refresh=1" : ""}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setLedger((p) => ({ ...p, [i]: { data } }));
    } catch (e) {
      setLedger((p) => ({ ...p, [i]: { error: e.message } }));
    }
  };

  // Group an array of ledger rows ({name, amount, ...}) by a field, sum amounts, dedup conduits.
  const groupLedger = (rows, field = "name", { conduit = false } = {}) => {
    if (!Array.isArray(rows) || !rows.length) return { groups: [], total: 0, count: 0, conduitTotal: 0, conduitCount: 0 };
    const map = {};
    let total = 0, count = 0, conduitTotal = 0, conduitCount = 0;
    for (const r of rows) {
      const key = (r[field] || "").trim() || "(unknown)";
      const mapKey = key.toUpperCase(); // case-insensitive grouping — filings format the same name differently
      const amt = Number(r.amount) || 0;
      if (conduit && TN_CONDUIT_RE.test(mapKey)) { conduitTotal += amt; conduitCount++; continue; }
      if (!map[mapKey]) map[mapKey] = { name: key, total: 0, count: 0 }; // display keeps first-seen casing
      map[mapKey].total += amt; map[mapKey].count++;
      total += amt; count++;
    }
    const groups = Object.values(map).sort((a, b) => b.total - a.total);
    return { groups, total, count, conduitTotal: Math.round(conduitTotal), conduitCount };
  };

  // Color for a payee type badge.
  const typeColor = (t) => ({
    "Individual": "#5cb860", "Business": "#4a9bd1", "Merchant": "#4a9bd1",
    "Committee/Politician": "#d6a93b", "Party": "#c06bd1", "Other": "var(--muted)",
  })[t] || "var(--muted)";
  const TypeBadge = ({ t }) => t ? (
    <span style={{ fontSize: 9, color: typeColor(t), border: `1px solid ${typeColor(t)}`, borderRadius: 2, padding: "0 5px", whiteSpace: "nowrap", letterSpacing: ".03em" }}>{t}</span>
  ) : null;

  // Raw itemized rows from the report ledger (FEC-style ledger view).
  const renderLedgerRaw = (rows, kind, fname) => {
    if (!rows?.length) return <div className="sub" style={{ marginTop: 8 }}>No itemized {kind} in the reports read.</div>;
    const isContrib = kind === "contributions";
    return (
      <>
        <div className="fec-table-wrap" style={{ maxHeight: 320, overflowY: "auto", marginTop: 6 }}>
          <table className="fec-table">
            <thead><tr>
              <th>{isContrib ? "Contributor" : "Vendor"}</th>
              <th>Type</th>
              {!isContrib && <th>Purpose</th>}
              <th>Date</th><th className="amt">Amount</th><th>Filing</th>
            </tr></thead>
            <tbody>
              {rows.slice(0, 300).map((r, k) => (
                <tr key={k}>
                  <td>{r.name || "—"}</td>
                  <td><TypeBadge t={r.type} /></td>
                  {!isContrib && <td className="sub">{r.purpose || "—"}</td>}
                  <td className="sub">{r.date || "—"}</td>
                  <td className="amt">{r.amount != null ? fmtUSDshort(r.amount) : "—"}</td>
                  <td className="sub">{r.report || ""}{r.year ? ` ${r.year}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button className="fec-btn ghost sm" onClick={() => downloadCSV(fname,
            isContrib ? ["Contributor", "Type", "Date", "Amount", "Aggregate", "Filing", "Year"] : ["Vendor", "Type", "Purpose", "Date", "Amount", "Filing", "Year"],
            rows.map((r) => isContrib ? [r.name, r.type, r.date, r.amount, r.aggregate, r.report, r.year] : [r.name, r.type, r.purpose, r.date, r.amount, r.report, r.year]))}>
            Export CSV ({rows.length})
          </button>
          {rows.length > 300 && <span className="sub">first 300 of {rows.length.toLocaleString()} shown (newest filings first)</span>}
        </div>
      </>
    );
  };

  // Group ledger rows by type and sum (for the "By type" breakdown).
  const groupLedgerByType = (rows) => {
    if (!Array.isArray(rows) || !rows.length) return { groups: [], total: 0, count: 0 };
    const map = {}; let total = 0, count = 0;
    for (const r of rows) {
      const key = r.type || "Other"; const amt = Number(r.amount) || 0;
      if (!map[key]) map[key] = { name: key, total: 0, count: 0 };
      map[key].total += amt; map[key].count++; total += amt; count++;
    }
    return { groups: Object.values(map).sort((a, b) => b.total - a.total), total, count };
  };

  // ---- money panel with tabs ----
  const getTab = (i) => moneyTab[i] || "received";
  const setTab = (i, t) => setMoneyTab((p) => ({ ...p, [i]: t }));

  const renderRawTable = (sec, fname, emptyMsg = "Nothing on file.") => {
    if (!sec) return null;
    if (!sec.rows.length) return <div className="sub" style={{ marginTop: 8 }}>{emptyMsg}</div>;
    return (
      <>
        <div className="fec-table-wrap" style={{ maxHeight: 260, overflowY: "auto", marginTop: 6 }}>
          <table className="fec-table">
            <thead><tr>{sec.headers.map((h, k) => <th key={k}>{h}</th>)}</tr></thead>
            <tbody>
              {sec.rows.slice(0, 50).map((row, k) => (
                <tr key={k}>{row.map((c, j) => <td key={j}>{c || "—"}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
          <button className="fec-btn ghost sm" onClick={() => downloadCSV(fname, sec.headers, sec.rows)}>
            Export CSV ({sec.rows.length})
          </button>
          {(sec.rows.length > 50 || sec.capped) && (
            <span className="sub">top 50 shown{sec.capped ? ` · server capped at 300 of ${sec.count.toLocaleString()}` : ""}</span>
          )}
        </div>
      </>
    );
  };

  // FEC-dossier-style grouped table: rank, name, summed total, % of total, gift count, plus a
  // grand-total footer and an optional conduit note. Accepts either an array of groups (legacy)
  // or the full {groups,total,count,conduitTotal,conduitCount} object from groupAndSum.
  const renderAggTable = (input, emptyMsg = "Nothing to aggregate.", onNameClick = null) => {
    const agg = Array.isArray(input) ? { groups: input } : input;
    const groups = agg.groups || [];
    if (!groups.length) return <div className="sub" style={{ marginTop: 8 }}>{emptyMsg}</div>;
    const total = agg.total != null ? agg.total : groups.reduce((a, g) => a + g.total, 0);
    const count = agg.count != null ? agg.count : groups.reduce((a, g) => a + g.count, 0);
    const pct = (n) => total > 0 ? `${Math.round((n / total) * 100)}%` : "—";
    return (
      <>
        <div className="fec-table-wrap" style={{ maxHeight: 300, overflowY: "auto", marginTop: 6 }}>
          <table className="fec-table">
            <thead><tr><th style={{ width: 28 }}>#</th><th>Name</th><th className="amt">Total</th><th className="amt">% </th><th className="amt">Gifts</th></tr></thead>
            <tbody>
              {groups.slice(0, 100).map((g, k) => (
                <tr key={k}>
                  <td className="sub">{k + 1}</td>
                  <td>
                    {onNameClick
                      ? <button className="fec-row-btn" style={{ textAlign: "left", fontWeight: "inherit" }}
                          onClick={() => onNameClick(g.name)}>{g.name}</button>
                      : g.name}
                  </td>
                  <td className="amt">{fmtUSDshort(g.total)}</td>
                  <td className="amt sub">{pct(g.total)}</td>
                  <td className="amt">{g.count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--line)", fontWeight: 600 }}>
                <td></td>
                <td>{groups.length.toLocaleString()} unique{groups.length === 100 ? "+" : ""}</td>
                <td className="amt">{fmtUSDshort(total)}</td>
                <td className="amt sub">100%</td>
                <td className="amt">{count}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {agg.conduitCount > 0 && (
          <div className="sub" style={{ marginTop: 4 }}>
            Plus {fmtUSDshort(agg.conduitTotal)} via {agg.conduitCount} conduit/earmark line{agg.conduitCount === 1 ? "" : "s"} (ActBlue / WinRed / PAC earmark batch totals like AIPAC's) — pass-through and summary entries whose dollars are itemized under the individual donors, shown separately so they aren't double-counted.
          </div>
        )}
      </>
    );
  };

  const renderMoneyPanel = (mp, row, i) => {
    let tab = getTab(i);
    if (tab === "donors" || tab === "employers") tab = "received"; // old tabs folded into Received
    const trend = trends[i];
    const act = activity[i];
    const { received, gave, spent } = mp.data || {};
    const dm = darkMoneyPct(received);
    const rv = recvView[i] || "donors";
    const setRv = (v) => setRecvView((p) => ({ ...p, [i]: v }));
    const sv = spentView[i] || "vendors";
    const setSv = (v) => setSpentView((p) => ({ ...p, [i]: v }));
    const led = ledger[i];
    // Optional year filter for the report ledger — only offers years that actually have data.
    const ledgerYears = (() => {
      const set = new Set();
      for (const c of (led?.data?.contribs || [])) if (c.year) set.add(c.year);
      for (const e of (led?.data?.expenditures || [])) if (e.year) set.add(e.year);
      return [...set].sort((a, b) => b.localeCompare(a));
    })();
    const lyr = ledgerYear[i] || "all";
    const setLyr = (v) => setLedgerYear((p) => ({ ...p, [i]: v }));
    const byYear = (rows) => lyr === "all" ? rows : rows.filter((r) => r.year === lyr);
    const YearChips = () => ledgerYears.length > 1 ? (
      <div style={{ display: "flex", gap: 5, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="sub" style={{ marginRight: 2 }}>Year:</span>
        {["all", ...ledgerYears].map((y) => (
          <button key={y} className="fec-btn ghost sm" style={{ opacity: lyr === y ? 1 : 0.45, fontWeight: lyr === y ? 700 : 400 }}
            aria-pressed={lyr === y} onClick={() => setLyr(y)}>{y === "all" ? "All" : y}</button>
        ))}
      </div>
    ) : null;
    const has = (sec) => Boolean(sec && sec.rows && sec.rows.length);
    const blankFor = (what) => `No ${what} on file for ${mp.ry}. Use "Scan years" above to find years with records, or change the Year above.`;
    const TS = { fontSize: 12, padding: "4px 12px", whiteSpace: "nowrap" };
    const drillDonor = (donorNameVal) => {
      setDonorMode(true); setDonorName(donorNameVal);
      setDonorResult(null); setDonorError(null); // don't leave the previous donor's results under the new name
      searchDonor(donorNameVal);
    };
    const drillRecipient = (recipName) => {
      setName(recipName); setDonorMode(false);
      setResult(null); setError(null); // don't leave the previous entity's results under the new name
      search(false, recipName);
    };

    return (
      <>
        {/* Activity scanner: which years actually have records */}
        <div style={{ marginBottom: 10 }}>
          <button className="fec-btn ghost sm" onClick={() => scanActivity(row, i, Boolean(act?.data || act?.error))} disabled={act?.loading}
            title="Scan this entity's filed reports (and recent cycles) to see which years have records">
            {act?.loading ? "Scanning…" : (act?.data || act?.error) ? "↺ Rescan (fresh)" : "📅 Scan years for activity"}
          </button>
          {act?.error && <span className="sub" style={{ marginLeft: 8 }}>Scan failed: {act.error}</span>}
          {act?.data?.note && <div className="sub" style={{ marginTop: 6 }}>⚠ {act.data.note}</div>}
          {act?.data?.dormant && (
            <div style={{ marginTop: 8, background: "rgba(200,114,58,.14)", color: "#d99", border: "1px solid rgba(200,114,58,.4)", borderRadius: 4, padding: "6px 12px", fontSize: 12, maxWidth: 600 }}>
              💤 <b>Dormant filer.</b> {(act.data.dormantReasons || []).join("; ")}
              {act.data.latestYear ? ` Most recent filing: ${act.data.latestYear}.` : ""}
            </div>
          )}
          {act?.data?.years && act.data.source === "tn-reports" && (() => {
            const hasReceipts = act.data.years.some((y) => y.receipts || y.expenditures);
            return (
            <div className="fec-table-wrap" style={{ marginTop: 6, maxWidth: 600 }}>
              <table className="fec-table">
                <thead><tr>
                  <th>Year</th><th>Reports</th>
                  <th className="amt">Ending Balance</th><th className="amt">Net Change</th>
                  {hasReceipts && <><th className="amt">Received</th><th className="amt">Spent</th></>}
                </tr></thead>
                <tbody>{act.data.years.map((y) => (
                  <tr key={y.year}>
                    <td><b style={{ color: "var(--bone)" }}>{y.year}</b></td>
                    <td className="sub">{y.reports}{y.detailed < y.reports ? ` (${y.detailed} read)` : ""}</td>
                    <td className="amt">{y.endingBalance != null ? fmtUSDshort(y.endingBalance) : "—"}</td>
                    <td className="amt" style={{ color: y.netChange > 0 ? "var(--olive)" : y.netChange < 0 ? "#C8723A" : "inherit" }}>
                      {y.netChange != null ? (y.netChange > 0 ? "+" : "") + fmtUSDshort(y.netChange) : "—"}
                    </td>
                    {hasReceipts && <>
                      <td className="amt">{y.detailed ? fmtUSDshort(y.receipts || 0) : "—"}</td>
                      <td className="amt">{y.detailed ? fmtUSDshort(y.expenditures || 0) : "—"}</td>
                    </>}
                  </tr>
                ))}</tbody>
              </table>
              <div className="sub" style={{ marginTop: 4 }}>
                From {act.data.reportCount} filed report{act.data.reportCount === 1 ? "" : "s"}. Balances are read from each report's summary cover sheet. For itemized contributions/expenditures, open <b>Reports ▸</b> below or use the <b>Received / Spent</b> tabs (TREF name search).
              </div>
            </div>
            );
          })()}
          {act?.data?.years && act.data.source !== "tn-reports" && (
            <div className="fec-table-wrap" style={{ marginTop: 6, maxWidth: 480 }}>
              <table className="fec-table">
                <thead><tr><th>Year</th><th className="amt">Received</th><th className="amt">Gave</th><th className="amt">Spent</th></tr></thead>
                <tbody>{act.data.years.map((y) => {
                  const v = (f) => f?.error
                    ? <span title={`Couldn't check this cycle: ${typeof f.error === "string" ? f.error : "fetch failed"}`} style={{ color: "var(--brass)", cursor: "help" }}>⚠</span>
                    : (f && f.count > 0) ? fmtUSDshort(f.total) : "—";
                  const active = [y.received, y.gave, y.spent].some((f) => f && !f.error && f.count > 0);
                  const isCur = mp.ey === y.electionYearId;
                  return (
                    <tr key={y.year} onClick={() => loadMoney(row, i, y.electionYearId, y.reportYear)}
                      style={{ cursor: "pointer", opacity: active ? 1 : 0.45, background: isCur ? "var(--panel2)" : undefined }}
                      title={`Load ${y.year} money flows`}>
                      <td><b style={{ color: isCur ? "var(--brass)" : "var(--bone)" }}>{y.year}{isCur ? " ◂" : ""}</b></td>
                      <td className="amt">{v(y.received)}</td>
                      <td className="amt">{v(y.gave)}</td>
                      <td className="amt">{v(y.spent)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <div className="sub" style={{ marginTop: 4 }}>Click a year to load its full flows. "—" = no records that year · "⚠" = couldn't check that cycle.</div>
            </div>
          )}
        </div>

        {/* Flow tabs */}
        <div className="fec-tab-nav" role="tablist" style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 10, borderBottom: "1px solid var(--line)" }}>
          <button className="fec-tab" role="tab" aria-selected={tab === "received"} style={TS} onClick={() => setTab(i, "received")}>
            Received{led?.data?.contribs?.length ? ` (${fmtUSDshort(led.data.totalReceived)})` : has(received) ? ` (${fmtUSDshort(received.totalAmount)})` : ""}{dm >= 70 ? " ⚠️" : ""}
          </button>
          <button className="fec-tab" role="tab" aria-selected={tab === "gave"} style={TS} onClick={() => { setTab(i, "gave"); if (!mp.data && !mp.loading) loadMoney(row, i); }}>
            Gave{has(gave) ? ` (${fmtUSDshort(gave.totalAmount)})` : ""}
          </button>
          <button className="fec-tab" role="tab" aria-selected={tab === "spent"} style={TS} onClick={() => setTab(i, "spent")}>
            Spent{led?.data?.expenditures?.length ? ` (${fmtUSDshort(led.data.totalSpent)})` : has(spent) ? ` (${fmtUSDshort(spent.totalAmount)})` : ""}
          </button>
          <button className="fec-tab" role="tab" aria-selected={tab === "trend"} style={TS} onClick={() => setTab(i, "trend")}>Trend ▸</button>
        </div>

        {tab === "received" && (() => {
          const lc = led?.data?.contribs || [];
          const useLedger = lc.length > 0;
          return (
          <>
            {led?.loading && <div className="fec-spin" style={{ marginBottom: 8 }}>Reading itemized contributions from filed reports…</div>}
            {useLedger && (
              <div className="sub" style={{ marginBottom: 8 }}>
                <b style={{ color: "var(--olive)" }}>{fmtUSDshort(led.data.totalReceived)}</b> itemized · {lc.length.toLocaleString()} contributions from {led.data.reportsRead} report{led.data.reportsRead === 1 ? "" : "s"} pulled directly from TREF filings{led.data.partial ? ` (newest ${led.data.reportsRead} of ${led.data.reportsTotal})` : ""}.
              </div>
            )}
            {led?.data?.note && <div className="sub" style={{ marginBottom: 8 }}>⚠ {led.data.note}</div>}
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {[["donors", "By donor"], ...(useLedger ? [["types", "By type"]] : []), ["raw", "Itemized"], ["filings", "By filing"]].map(([v, l]) => (
                <button key={v} className="fec-btn ghost sm" style={{ opacity: rv === v ? 1 : 0.5 }} aria-pressed={rv === v} onClick={() => setRv(v)}>{l}</button>
              ))}
            </div>
            {useLedger ? (<>
              {rv !== "filings" && <YearChips />}
              {rv === "donors" && (<>
                <div className="fec-ai-label" style={{ marginTop: 4 }}>Top contributors · grouped &amp; summed · click a name to look them up as a donor</div>
                {renderAggTable(groupLedger(byYear(lc), "name", { conduit: true }), "No itemized contributors.", drillDonor)}
              </>)}
              {rv === "types" && (<>
                <div className="fec-ai-label" style={{ marginTop: 4 }}>Contributions by source type</div>
                {renderAggTable(groupLedgerByType(byYear(lc)), "No typed contributions.")}
              </>)}
              {rv === "raw" && renderLedgerRaw(byYear(lc), "contributions", `tn_received_${led.data.id}.csv`)}
              {rv === "filings" && (<>
                <div className="fec-ai-label" style={{ marginTop: 4 }}>Totals per filing (report)</div>
                {renderAggTable(groupLedger(lc.map((r) => ({ ...r, filing: r.year ? `${r.year} · ${r.report}` : r.report })), "filing"), "No filings.")}
              </>)}
            </>) : led?.loading ? null : (<>
              {led?.error && (
                <div className="sub" style={{ marginBottom: 8 }}>
                  Report ledger failed: {led.error}{" "}
                  <button className="fec-btn ghost sm" onClick={() => loadLedger(row, i, true)}>↺ Retry</button>
                </div>
              )}
              {!mp.data && !mp.loading && !led?.error && (
                <div className="sub" style={{ marginBottom: 8 }}>
                  {led?.data ? `No itemized contributions in the ${led.data.reportsRead} report${led.data.reportsRead === 1 ? "" : "s"} read — the money may be unitemized (small donors); see the per-year totals above.` : "Open from a result with a TN filing id to pull itemized contributions from reports."}
                  {row.tnId && <> You can also run TREF's name search: <button className="fec-btn ghost sm" onClick={() => loadMoney(row, i)}>Load name search</button></>}
                </div>
              )}
              {mp.loading && <div className="fec-spin">Searching TREF by name — ~20s cold…</div>}
              {mp.data?.receivedError && <div className="sub">Search failed: {mp.data.receivedError}</div>}
              {received?.note && <div className="sub" style={{ marginBottom: 6 }}>⚠ {received.note}</div>}
              {mp.data && rv === "donors" && renderAggTable(groupAndSum(received, /contributor.*name|^name$/i, { conduit: true }), blankFor("contributions received"), drillDonor)}
              {mp.data && rv === "raw" && renderRawTable(received, `tn_received_${mp.ry}.csv`, blankFor("contributions received"))}
              {mp.data && rv === "filings" && renderAggTable(groupAndSum(received, /report.*name/i), blankFor("filing data"))}
            </>)}
          </>
          );
        })()}

        {tab === "gave" && (
          <>
            <div className="fec-ai-label" style={{ marginTop: 4 }}>Who they gave to · via TREF name search · click a recipient to search their entity profile</div>
            {ledgerYears.length > 0 && (
              <div style={{ display: "flex", gap: 5, margin: "6px 0", flexWrap: "wrap", alignItems: "center" }}>
                <span className="sub" style={{ marginRight: 2 }}>Year:</span>
                {ledgerYears.map((y) => {
                  const opt = (meta?.years || []).find((o) => o.label === y);
                  return (
                    <button key={y} className="fec-btn ghost sm" disabled={mp.loading || !opt}
                      style={{ opacity: mp.ry === y ? 1 : 0.45, fontWeight: mp.ry === y ? 700 : 400 }}
                      onClick={() => opt && loadMoney(row, i, opt.id, y)}>{y}</button>
                  );
                })}
              </div>
            )}
            {mp.loading && <div className="fec-spin" style={{ marginTop: 8 }}>Searching TREF by name — ~20s cold, instant from cache…</div>}
            {mp.data?.gaveError && <div className="sub">Search failed: {mp.data.gaveError}</div>}
            {gave?.note && <div className="sub" style={{ marginBottom: 6 }}>⚠ {gave.note}</div>}
            {has(gave) ? (
              <>
                <div className="fec-table-wrap" style={{ maxHeight: 260, overflowY: "auto", marginTop: 6 }}>
                  <table className="fec-table">
                    <thead><tr>{gave.headers.map((h, k) => <th key={k}>{h}</th>)}</tr></thead>
                    <tbody>
                      {gave.rows.slice(0, 50).map((row, k) => {
                        const recipIdx = gave.headers.findIndex((h) => /recipient.*name|candidate.*pac/i.test(h));
                        return (
                          <tr key={k}>
                            {row.map((c, j) => (
                              <td key={j}>
                                {j === recipIdx && c
                                  ? <button className="fec-row-btn" style={{ textAlign: "left" }} onClick={() => drillRecipient(c.trim())}>{c}</button>
                                  : (c || "—")}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <button className="fec-btn ghost sm" onClick={() => downloadCSV(`tn_gave_${mp.ry}.csv`, gave.headers, gave.rows)}>
                    Export CSV ({gave.rows.length})
                  </button>
                  {(gave.rows.length > 50 || gave.capped) && <span className="sub">top 50 shown</span>}
                </div>
              </>
            ) : mp.data && !mp.data?.gaveError ? <div className="sub" style={{ marginTop: 8 }}>{blankFor("outgoing contributions")}</div> : null}
          </>
        )}

        {tab === "spent" && (() => {
          const le = led?.data?.expenditures || [];
          const useLedger = le.length > 0;
          return (
          <>
            {led?.loading && <div className="fec-spin" style={{ marginBottom: 8 }}>Reading itemized expenditures from filed reports…</div>}
            {useLedger && (
              <div className="sub" style={{ marginBottom: 8 }}>
                <b style={{ color: "#C8723A" }}>{fmtUSDshort(led.data.totalSpent)}</b> itemized · {le.length.toLocaleString()} expenditures from {led.data.reportsRead} report{led.data.reportsRead === 1 ? "" : "s"} pulled directly from TREF filings{led.data.partial ? ` (newest ${led.data.reportsRead} of ${led.data.reportsTotal})` : ""}.
              </div>
            )}
            {led?.data?.note && <div className="sub" style={{ marginBottom: 8 }}>⚠ {led.data.note}</div>}
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {[["vendors", "By vendor"], ...(useLedger ? [["types", "By type"]] : []), ["raw", "Itemized"], ["filings", "By filing"]].map(([v, l]) => (
                <button key={v} className="fec-btn ghost sm" style={{ opacity: sv === v ? 1 : 0.5 }} aria-pressed={sv === v} onClick={() => setSv(v)}>{l}</button>
              ))}
            </div>
            {useLedger ? (<>
              {sv !== "filings" && <YearChips />}
              {sv === "vendors" && (<>
                <div className="fec-ai-label" style={{ marginTop: 4 }}>Vendors / payees · grouped &amp; summed</div>
                {renderAggTable(groupLedger(byYear(le), "name"), "No itemized vendors.")}
              </>)}
              {sv === "types" && (<>
                <div className="fec-ai-label" style={{ marginTop: 4 }}>Spending by recipient type</div>
                {renderAggTable(groupLedgerByType(byYear(le)), "No typed expenditures.")}
              </>)}
              {sv === "raw" && renderLedgerRaw(byYear(le), "expenditures", `tn_spent_${led.data.id}.csv`)}
              {sv === "filings" && (<>
                <div className="fec-ai-label" style={{ marginTop: 4 }}>Totals per filing (report)</div>
                {renderAggTable(groupLedger(le.map((r) => ({ ...r, filing: r.year ? `${r.year} · ${r.report}` : r.report })), "filing"), "No filings.")}
              </>)}
            </>) : led?.loading ? null : (<>
              {led?.error && (
                <div className="sub" style={{ marginBottom: 8 }}>
                  Report ledger failed: {led.error}{" "}
                  <button className="fec-btn ghost sm" onClick={() => loadLedger(row, i, true)}>↺ Retry</button>
                </div>
              )}
              {!mp.data && !mp.loading && !led?.error && (
                <div className="sub" style={{ marginBottom: 8 }}>
                  {led?.data ? `No itemized expenditures in the ${led.data.reportsRead} report${led.data.reportsRead === 1 ? "" : "s"} read — see the per-year totals above.` : "Open from a result with a TN filing id to pull itemized expenditures from reports."}
                  {row.tnId && <> You can also run TREF's name search: <button className="fec-btn ghost sm" onClick={() => loadMoney(row, i)}>Load name search</button></>}
                </div>
              )}
              {mp.loading && <div className="fec-spin">Searching TREF by name — ~20s cold…</div>}
              {mp.data?.spentError && <div className="sub">Search failed: {mp.data.spentError}</div>}
              {spent?.note && <div className="sub" style={{ marginBottom: 6 }}>⚠ {spent.note}</div>}
              {mp.data && sv === "vendors" && renderAggTable(groupAndSum(spent, /vendor.*name|payee|recipient.*name|^name$/i), blankFor("expenditures"))}
              {mp.data && sv === "raw" && renderRawTable(spent, `tn_spent_${mp.ry}.csv`, blankFor("expenditures"))}
              {mp.data && sv === "filings" && renderAggTable(groupAndSum(spent, /report.*name/i), blankFor("filing data"))}
            </>)}
          </>
          );
        })()}

        {tab === "trend" && (() => {
          const lc = led?.data?.contribs || [];
          const le = led?.data?.expenditures || [];
          // Build a reliable trend straight from the filed reports: received & spent per year.
          if (lc.length || le.length) {
            const yrs = {};
            for (const c of lc) { const y = c.year; if (/^\d{4}$/.test(y || "")) (yrs[y] = yrs[y] || { year: y, received: 0, spent: 0 }).received += c.amount || 0; }
            for (const e of le) { const y = e.year; if (/^\d{4}$/.test(y || "")) (yrs[y] = yrs[y] || { year: y, received: 0, spent: 0 }).spent += e.amount || 0; }
            const ordered = Object.values(yrs).sort((a, b) => a.year.localeCompare(b.year));
            const recvPts = ordered.map((p) => ({ year: p.year, total: Math.round(p.received) }));
            const spentPts = ordered.map((p) => ({ year: p.year, total: Math.round(p.spent) }));
            return (
              <>
                <div className="fec-ai-label" style={{ marginTop: 4 }}>Itemized contributions received by year — from filed reports</div>
                <div style={{ marginTop: 8, marginBottom: 4 }}><TnTrendChart points={recvPts} /></div>
                <div className="fec-ai-label" style={{ marginTop: 14 }}>Itemized expenditures by year — from filed reports</div>
                <div style={{ marginTop: 8, marginBottom: 4 }}><TnTrendChart points={spentPts} /></div>
                <div className="sub" style={{ marginTop: 6 }}>{ordered.map((p) => `${p.year}: +${fmtUSDshort(p.received)} / -${fmtUSDshort(p.spent)}`).join(" · ")}</div>
                {led.data.partial && <div className="sub" style={{ marginTop: 4 }}>Covers the newest {led.data.reportsRead} of {led.data.reportsTotal} reports; open older years via Reports ▸ to extend.</div>}
              </>
            );
          }
          // Fallback: name-search trend across cycles (older flow; unreliable for many PACs).
          return (
            <>
              <div className="fec-ai-label" style={{ marginTop: 4 }}>Contributions received — trend across recent cycles (TREF name search)</div>
              {!trend && !led?.loading && <button className="fec-btn ghost sm" style={{ marginTop: 6 }} onClick={() => loadTrend(row, i)}>Load trend</button>}
              {led?.loading && <div className="fec-spin" style={{ marginTop: 8 }}>Reading filed reports…</div>}
              {trend?.loading && <div className="fec-spin" style={{ marginTop: 8 }}>Querying 5 TREF election cycles — ~25s cold, instant from cache</div>}
              {trend?.error && <div className="sub" style={{ marginTop: 8 }}>Trend failed: {trend.error}</div>}
              {trend?.data?.points && (
                <>
                  <div style={{ marginTop: 10, marginBottom: 4 }}><TnTrendChart points={trend.data.points} /></div>
                  <div className="sub">{trend.data.points.map((p) => `${p.year}: ${fmtUSDshort(p.total)}`).join(" · ")}</div>
                </>
              )}
            </>
          );
        })()}
      </>
    );
  };

  // ---- donor lookup ----
  const searchDonor = async (overrideName) => {
    const nm = typeof overrideName === "string" ? overrideName : donorName; // drill-through passes the clicked name before state settles
    if (!nm.trim()) { setDonorError("Enter a contributor name."); return; }
    setDonorLoading(true); setDonorError(null); setDonorResult(null);
    setDonorGiftYear("all"); setDonorGiftFilter("");
    try {
      // Year is optional — with no year we search across all recent cycles server-side.
      let url = `/api/tn/donor?name=${encodeURIComponent(nm)}`;
      if (donorYear) {
        const ry = donorRy || eyLabel(donorYear).match(/\d{4}/)?.[0] || String(curYear);
        url += `&electionYear=${donorYear}&reportYear=${ry}`;
      }
      const res = await fetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setDonorResult(data);
    } catch (e) { setDonorError(e.message); } finally { setDonorLoading(false); }
  };

  const exportTn = () => {
    if (!result?.rows?.length) return;
    downloadCSV(`tn_candidates_pacs.csv`, result.headers, result.rows.map((r) => r.cells));
  };

  const exportTnPDF = () => {
    if (!result?.rows?.length) return;
    const cols = (result.headers || []).slice(0, 6);
    const head = `<tr>${cols.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr>`;
    const body = result.rows.map((r) =>
      `<tr>${cols.map((_, j) => `<td>${escHtml((r.cells || [])[j] || "")}</td>`).join("")}</tr>`
    ).join("");
    printDocument(reportShell({
      title: "Tennessee Registry of Election Finance",
      metaLine: `${result.count} result${result.count === 1 ? "" : "s"}${name ? ` · "${name}"` : ""}`,
      bodyHtml: `<table><thead>${head}</thead><tbody>${body}</tbody></table>`,
    }));
  };

  return (
    <>
      {/* ── Tracked TN entities (mirrors the Donors tab watchlist) ── */}
      <section className="fec-controls" style={{ marginTop: 18, display: "block", borderTopColor: "var(--olive)" }} aria-label="Tracked TN entities">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="fec-ai-label" style={{ marginBottom: 0 }}>Tracked TN entities</span>
          {(tnWatch.entities || []).length > 0 && (
            <span className="fec-tag">{tnWatch.entities.length} tracked · ★ Track any search result below</span>
          )}
        </div>
        {tnWatch.error && <div className="fec-error" role="alert" style={{ marginTop: 10 }}>{tnWatch.error}</div>}
        {tnWatch.loading ? (
          <div className="fec-spin" style={{ marginTop: 10 }}>Loading tracked entities…</div>
        ) : (tnWatch.entities || []).length > 0 ? (
          <div className="fec-table-wrap" style={{ marginTop: 10 }}>
            <table className="fec-table">
              <thead>
                <tr><th>Entity</th><th>Office / Party</th><th className="amt">Stored received</th><th className="amt">Stored spent</th><th>New rows</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {tnWatch.entities.map((w) => (
                  <tr key={w.tnId}>
                    <td>
                      <b style={{ color: "var(--bone)" }}>{w.name}</b>
                      <div className="sub">added {timeAgo(w.addedAt)}</div>
                    </td>
                    <td className="sub">{[w.office, w.party].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="amt">{fmtUSDshort(w.received || 0)}</td>
                    <td className="amt">{fmtUSDshort(w.spent || 0)}</td>
                    <td>
                      {w.newCount > 0
                        ? <span style={{ color: "var(--brass)", fontWeight: 700 }} title="Itemized rows stored since you last opened this entity">▲ {w.newCount} new</span>
                        : <span className="sub">—</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <button className="fec-btn ghost sm" onClick={() => openTracked(w)}
                        title="Search this entity below (marks new rows as seen)">Open ▸</button>
                      {" "}
                      <button className="fec-btn ghost sm" onClick={() => untrackTn(w.tnId)} title="Stop tracking">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !tnWatch.error && (
          <div className="sub" style={{ marginTop: 8 }}>No tracked TN entities yet — search below and hit ★ Track on any result.</div>
        )}
      </section>

      <section className="fec-controls" style={{ marginTop: 18, borderTopColor: "var(--olive)" }} aria-label="TN search">
        {/* Mode toggle */}
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 6, marginBottom: 2 }}>
          <button style={{ padding: "3px 14px", fontSize: 12, cursor: "pointer", borderRadius: 3,
            background: !donorMode ? "var(--panel2)" : "none",
            border: !donorMode ? "1px solid var(--line)" : "1px solid var(--line)",
            color: !donorMode ? "var(--bone)" : "var(--sub)" }}
            onClick={() => setDonorMode(false)}>Entity Search</button>
          <button style={{ padding: "3px 14px", fontSize: 12, cursor: "pointer", borderRadius: 3,
            background: donorMode ? "var(--panel2)" : "none",
            border: donorMode ? "1px solid var(--line)" : "1px solid var(--line)",
            color: donorMode ? "var(--bone)" : "var(--sub)" }}
            onClick={() => setDonorMode(true)}>Donor Lookup</button>
        </div>

        {!donorMode ? (
          <>
            <div className="fec-field" style={{ gridColumn: "span 2" }}>
              <label htmlFor="tn-name">Candidate / PAC name</label>
              <input id="tn-name" value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                placeholder="Any part of the name — e.g. yager, health, realtors"
                style={{ width: "100%", background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", padding: "8px 10px", font: "inherit" }} />
              <span className="sub" style={{ marginTop: 4, display: "block" }}>
Matches any part of the name. For a <b>candidate</b>, use the <b>last name</b> (TREF indexes candidates by last name — "Yager", not "Ken Yager").
              </span>
            </div>
            <div className="fec-field">
              <label htmlFor="tn-type">Type</label>
              <select id="tn-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="both">Candidates & PACs</option>
                <option value="candidate">Candidates</option>
                <option value="pac">PACs</option>
              </select>
            </div>
            <div className="fec-field">
              <label htmlFor="tn-office">Office</label>
              <select id="tn-office" value={office} onChange={(e) => setOffice(e.target.value)}>
                <option value="">Any office</option>
                {(meta?.offices || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div className="fec-field">
              <label htmlFor="tn-year">Election year</label>
              <select id="tn-year" value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">Any year</option>
                {(meta?.years || []).map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
              </select>
            </div>
            <div className="fec-field">
              <label htmlFor="tn-district">District</label>
              <select id="tn-district" value={district} onChange={(e) => setDistrict(e.target.value)} disabled={!districtOpts.length}>
                <option value="">{office ? (districtOpts.length ? "Any district" : "No districts") : "Pick an office first"}</option>
                {districtOpts.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <div className="fec-field">
              <label htmlFor="tn-party">Party</label>
              <select id="tn-party" value={party} onChange={(e) => setParty(e.target.value)}>
                <option value="">Any party</option>
                {(meta?.parties || []).map((pt) => <option key={pt.id} value={pt.id}>{pt.label}</option>)}
              </select>
            </div>
            <div className="fec-field">
              <label htmlFor="tn-winner">Election result</label>
              <select id="tn-winner" value={winner} onChange={(e) => setWinner(e.target.value)}>
                <option value="">Any</option>
                <option value="primary">Won the primary</option>
                <option value="general">Won the general</option>
              </select>
            </div>
            <div className="fec-actions">
              <button className="fec-btn" onClick={() => search(false)} disabled={loading}>{loading ? "Querying TREF…" : "Pull records"}</button>
              <span className="fec-hint">Tennessee Registry of Election Finance. One wildcard search matches any part of the name; results are saved for a day. Election years, offices and districts are read from the live TREF form.</span>
            </div>
          </>
        ) : (
          <>
            <div className="fec-field" style={{ gridColumn: "span 2" }}>
              <label htmlFor="tn-donor-name">Contributor name (individual, org, or PAC — begins with)</label>
              <input id="tn-donor-name" value={donorName} onChange={(e) => setDonorName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchDonor()}
                placeholder="e.g. Smith John or Tennessee Medical Assoc"
                style={{ width: "100%", background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", padding: "8px 10px", font: "inherit" }} />
            </div>
            <div className="fec-field">
              <label htmlFor="tn-donor-year">Year (optional)</label>
              <select id="tn-donor-year" value={donorYear} onChange={(e) => {
                const opt = (meta?.years || []).find((y) => y.id === e.target.value);
                setDonorYear(e.target.value);
                if (opt) setDonorRy(opt.label);
              }}>
                <option value="">All years</option>
                {(meta?.years || []).filter((y) => /^\d{4}$/.test(y.label)).map((y) => (
                  <option key={y.id} value={y.id}>{y.label}</option>
                ))}
              </select>
            </div>
            <div className="fec-actions">
              <button className="fec-btn" onClick={searchDonor} disabled={donorLoading}>{donorLoading ? "Searching…" : "Lookup Donor"}</button>
              <span className="fec-hint">Find every candidate &amp; PAC this person or organization contributed to. Leave year as <b>All years</b> to search every recent cycle (~20s first time, then cached).</span>
            </div>
          </>
        )}
      </section>

      {/* Donor lookup results */}
      {donorMode && donorError && <div className="fec-error" role="alert">{donorError}</div>}
      {donorMode && donorLoading && (
        <div className="fec-spin" style={{ marginTop: 16 }}>Searching TREF for contributions by "{donorName}"{donorYear ? "" : " across all recent cycles — ~20s first time, then cached"}</div>
      )}
      {donorMode && donorResult && !donorLoading && (() => {
        const recipients = aggregateBy(donorResult, /recipient.*name|candidate.*pac/i);
        return (
          <div className="fec-profile" style={{ marginTop: 12, borderLeftColor: "var(--olive)" }}>
            <div className="fec-ai-label">
              "{donorName}" · {(donorResult.count || 0).toLocaleString()} contribution{donorResult.count !== 1 ? "s" : ""} · {fmtUSDshort(donorResult.totalAmount || 0)} total
            </div>
            {(donorResult.note || donorResult.capped) && (
              <div className="sub" style={{ marginBottom: 6 }}>
                ⚠ {donorResult.note}{donorResult.note && donorResult.capped ? " · " : ""}
                {donorResult.capped ? "row cap hit for some cycles — totals may be low" : ""}
              </div>
            )}
            {donorResult.count === 0 ? (
              <div className="sub">No contributions found{donorResult.allYears ? " in any recent cycle" : ""} — try a different name (TREF matches on name prefix, e.g. "Smith" or "Tennessee Medical").</div>
            ) : (
              (() => {
                const H = donorResult.headers || [];
                const ci = (re) => H.findIndex((h) => re.test(h));
                const amtI = ci(/amount/i), dateI = ci(/date/i), recI = ci(/recipient.*name|candidate.*pac/i), repI = ci(/report.*name/i), typeI = ci(/^type$/i), conI = ci(/contributor.*name/i);
                const sortKey = (d) => { const m = String(d || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}${m[1].padStart(2, "0")}${m[2].padStart(2, "0")}` : "0"; };
                const yearOf = (d) => (String(d || "").match(/\b(\d{4})\b/) || [])[1] || "—";
                const gifts = (donorResult.rows || []).map((r) => ({
                  date: dateI >= 0 ? r[dateI] : "", year: yearOf(dateI >= 0 ? r[dateI] : ""),
                  recipient: recI >= 0 ? (r[recI] || "").trim() : "",
                  amount: amtI >= 0 ? Number(String(r[amtI] || "").replace(/[^0-9.-]/g, "")) || 0 : 0,
                  report: repI >= 0 ? r[repI] : "", type: typeI >= 0 ? r[typeI] : "",
                  who: conI >= 0 ? (r[conI] || "").trim() : "",
                })).map((g) => ({ ...g, ptype: classifyPayee(g.recipient) }))
                  .sort((a, b) => sortKey(b.date).localeCompare(sortKey(a.date)));
                // TREF's contributor index is a SURNAME search — group by contributor so three
                // Parliers don't read as one donor (caught live: Brian/Lisa/Steve blended).
                const peopleM = new Map();
                for (const g of gifts) {
                  const k = (g.who || "?").toUpperCase();
                  const p = peopleM.get(k) || { name: g.who || "?", total: 0, count: 0, years: new Set() };
                  p.total += g.amount; p.count++; p.years.add(g.year);
                  peopleM.set(k, p);
                }
                const people = [...peopleM.values()].sort((a, b) => b.total - a.total);
                const multi = people.length > 1;
                const byYr = {};
                for (const g of gifts) { (byYr[g.year] = byYr[g.year] || { year: g.year, total: 0, count: 0 }); byYr[g.year].total += g.amount; byYr[g.year].count++; }
                const years = Object.values(byYr).sort((a, b) => b.year.localeCompare(a.year));
                const q = donorGiftFilter.trim().toLowerCase();
                const shown = gifts.filter((g) =>
                  (donorGiftYear === "all" || g.year === donorGiftYear) &&
                  (!q || g.recipient.toLowerCase().includes(q) || (g.ptype || "").toLowerCase().includes(q) || (g.who || "").toLowerCase().includes(q)));
                const shownTotal = shown.reduce((a, g) => a + g.amount, 0);
                return (
                  <>
                    {multi && (
                      <div style={{ marginTop: 10 }}>
                        <div className="fec-ai-label">
                          ⚠ Surname search — {people.length} distinct contributors matched · click one to filter to just their gifts
                        </div>
                        <div className="fec-table-wrap" style={{ marginTop: 4 }}>
                          <table className="fec-table">
                            <thead><tr><th>Contributor</th><th>Gifts</th><th>Years</th><th className="amt">Their total</th></tr></thead>
                            <tbody>
                              {people.map((p) => (
                                <tr key={p.name} style={{ cursor: "pointer" }}
                                  onClick={() => setDonorGiftFilter(donorGiftFilter === p.name ? "" : p.name)}>
                                  <td><b style={{ color: donorGiftFilter === p.name ? "var(--brass)" : "var(--bone)" }}>{p.name}</b></td>
                                  <td>{p.count}</td>
                                  <td className="sub">{[...p.years].sort().join(", ")}</td>
                                  <td className="amt">{fmtUSDshort(p.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="sub" style={{ marginTop: 4 }}>
                          The totals above the ledger combine ALL matched contributors — they are different people, not one donor.
                        </div>
                      </div>
                    )}
                    {years.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div className="fec-ai-label">By year · click to filter</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                          <button className="fec-btn ghost sm" style={{ opacity: donorGiftYear === "all" ? 1 : 0.5, fontWeight: donorGiftYear === "all" ? 700 : 400 }}
                            onClick={() => setDonorGiftYear("all")}>All</button>
                          {years.map((y) => (
                            <button key={y.year} className="fec-btn ghost sm"
                              style={{ opacity: donorGiftYear === y.year ? 1 : 0.6, fontWeight: donorGiftYear === y.year ? 700 : 400 }}
                              aria-pressed={donorGiftYear === y.year}
                              onClick={() => setDonorGiftYear(donorGiftYear === y.year ? "all" : y.year)}>
                              {y.year} · {fmtUSDshort(y.total)} <span className="sub">({y.count})</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {recipients.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <div className="fec-ai-label">Recipients (aggregated) · click to search that entity</div>
                        {renderAggTable(recipients, "No recipients found.", (nm) => { setName(nm); setDonorMode(false); })}
                      </div>
                    )}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div className="fec-ai-label" style={{ marginBottom: 0 }}>
                          Every gift · {shown.length.toLocaleString()}{shown.length !== gifts.length ? ` of ${gifts.length.toLocaleString()}` : ""} · {fmtUSDshort(shownTotal)}
                          {donorGiftYear !== "all" ? ` · ${donorGiftYear}` : ""}
                        </div>
                        <input value={donorGiftFilter} onChange={(e) => setDonorGiftFilter(e.target.value)}
                          placeholder="Filter recipient or type…"
                          style={{ background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", padding: "4px 9px", font: "inherit", fontSize: 12, width: 200 }} />
                        {(donorGiftFilter || donorGiftYear !== "all") && (
                          <button className="fec-btn ghost sm" onClick={() => { setDonorGiftFilter(""); setDonorGiftYear("all"); }}>Clear</button>
                        )}
                      </div>
                      <div className="fec-table-wrap" style={{ maxHeight: 360, overflowY: "auto", marginTop: 6 }}>
                        <table className="fec-table">
                          <thead><tr><th>Year</th>{multi && <th>Contributor</th>}<th>Date</th><th>Recipient</th><th>Type</th><th className="amt">Amount</th><th>Filing</th></tr></thead>
                          <tbody>
                            {shown.slice(0, 400).map((g, k) => (
                              <tr key={k}>
                                <td><b style={{ color: "var(--bone)" }}>{g.year}</b></td>
                                {multi && <td>{g.who || "—"}</td>}
                                <td className="sub">{g.date || "—"}</td>
                                <td>{g.recipient
                                  ? <button className="fec-row-btn" style={{ textAlign: "left", fontWeight: "inherit" }} onClick={() => { setName(g.recipient); setDonorMode(false); }}>{g.recipient}</button>
                                  : "—"}</td>
                                <td><TypeBadge t={g.ptype} /></td>
                                <td className="amt">{fmtUSDshort(g.amount)}</td>
                                <td className="sub">{g.report || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {shown.length > 400 && <div className="sub" style={{ marginTop: 4 }}>Showing first 400 of {shown.length.toLocaleString()}</div>}
                      {shown.length === 0 && <div className="sub" style={{ marginTop: 6 }}>No gifts match the current filter.</div>}
                      <div style={{ marginTop: 8 }}>
                        <button className="fec-btn ghost sm"
                          onClick={() => downloadCSV(`tn_donor_${donorName.replace(/\s+/g, "_")}.csv`,
                            ["Year", "Contributor", "Date", "Recipient", "Type", "Amount", "Filing"],
                            shown.map((g) => [g.year, g.who, g.date, g.recipient, g.ptype, g.amount, g.report]))}>
                          Export CSV ({shown.length})
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()
            )}
          </div>
        );
      })()}

      {/* Entity search results */}
      {!donorMode && error && <div className="fec-error" role="alert">{error}</div>}
      {!donorMode && result && !error && (
        <>
          <div className="fec-status">
            <span>
              {result.count} result{result.count === 1 ? "" : "s"} · TN Registry of Election Finance
              {result.cachedAt && <span style={{ color: "var(--muted)", fontSize: 11 }}> · cached {timeAgo(result.cachedAt)}</span>}
            </span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {result.rows?.length > 4 && (
                <input value={localFilter} onChange={(e) => setLocalFilter(e.target.value)}
                  placeholder="Filter results…"
                  style={{ background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", padding: "4px 9px", font: "inherit", fontSize: 12, width: 180 }} />
              )}
              {result.cachedAt && (
                <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                  onClick={() => search(true)} disabled={loading} title="Bypass cache and re-query the TN registry">
                  ↺ Refresh
                </button>
              )}
              <button className="fec-btn ghost" onClick={exportTn} disabled={!result.rows?.length}>Export CSV ({result.rows?.length || 0})</button>
              <button className="fec-btn ghost" onClick={exportTnPDF} disabled={!result.rows?.length}
                title="Export these TN results as a printable PDF">Export PDF</button>
            </span>
          </div>
          {result.count === 0 && (
            <div className="fec-empty">
              No TN records matched — tried {result.variantsTried?.length || 1} name variant{(result.variantsTried?.length || 1) === 1 ? "" : "s"}
              {result.variantsTried?.length > 1 ? ` (${result.variantsTried.map((v) => `"${v}"`).join(", ")})` : ""}.
              TREF searches by name prefix — try a shorter term or use the office/year filters alone.
            </div>
          )}
          {result.note && <div className="fec-status"><span className="fec-hint">{result.note}</span></div>}
          {result.rows?.length > 0 && (() => {
            // ---- parse column indices from headers ----
            const H = result.headers;
            const col = (re) => { const i = H.findIndex((h) => re.test(h)); return i >= 0 ? i : -1; };
            // prefer exact "Name" match; fall back to any col with "name" that isn't "Treasurer Name"
            const nameIdx = (() => {
              let i = H.findIndex((h) => /^name$/i.test(h.trim()));
              if (i < 0) i = H.findIndex((h) => /name/i.test(h) && !/treasurer/i.test(h));
              return i;
            })();
            const contactIdx = col(/contact|address/i);
            const partyIdx   = col(/party/i);
            const officeIdx  = col(/office|type/i);
            const distIdx    = col(/district/i);
            const yearIdx    = col(/election.*year|year/i);
            const treasIdx   = col(/treasurer/i);
            const cell = (r, idx) => idx >= 0 ? (r.cells[idx] || "").trim() : "";

            // group by type — check all cells so PAC/committee type column is caught
            const candidates = [], pacs = [], others = [];
            const filterLow = localFilter.toLowerCase();
            for (const r of result.rows) {
              const allText = r.cells.join(" ").toLowerCase();
              if (filterLow && !allText.includes(filterLow)) continue;
              const allUpper = allText.toUpperCase();
              if (/\bPAC\b|POLITICAL ACTION|COMMITTEE TYPE|FUND\b/i.test(allUpper)) pacs.push(r);
              else if (/\bPARTY\b|REPUBLICAN PARTY|DEMOCRATIC PARTY|LIBERTARIAN PARTY/i.test(allUpper)) others.push(r);
              else candidates.push(r);
            }
            const filtered = [...candidates, ...pacs, ...others];
            if (filtered.length === 0) return <div className="fec-empty">No results match "{localFilter}" — try a different filter.</div>;

            const PARTY_COLOR = { republican: "#C04040", democrat: "#4060C0", libertarian: "#C09020", green: "#40A060" };
            const partyColor = (p) => { const pl = (p || "").toLowerCase(); return Object.entries(PARTY_COLOR).find(([k]) => pl.includes(k))?.[1] || "var(--muted)"; };

            const renderGroup = (rows, label) => {
              if (!rows.length) return null;
              return (
                <div key={label} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)", padding: "6px 0 4px", borderBottom: "1px solid var(--line)", marginBottom: 8 }}>{label} · {rows.length}</div>
                  {rows.map((r, rawIdx) => {
                    const globalIdx = result.rows.indexOf(r);
                    const rp = r.tnId ? reports[r.tnId] : null;
                    const ap = aiProfiles[globalIdx];
                    const mp = money[globalIdx];
                    const nm = entityName(r) || "—";
                    const party = cell(r, partyIdx);
                    const office = cell(r, officeIdx);
                    const dist = cell(r, distIdx);
                    const contact = cell(r, contactIdx);
                    const elYear = cell(r, yearIdx);
                    const treas = cell(r, treasIdx);
                    const lf = r.tnId ? lastFiled[r.tnId] : null;
                    // Color-code last-filing staleness: >6 years = red (likely dormant), 3-6 = amber,
                    // recent = green.
                    const lfColor = (() => {
                      if (!lf?.date) return "var(--muted)";
                      const yr = parseInt(lf.date.match(/\d{4}/)?.[0] || "0");
                      const age = new Date().getFullYear() - yr;
                      if (age > 6) return "#d9534f";   // red
                      if (age >= 3) return "#d6a93b";  // amber
                      return "#5cb860";                // green
                    })();
                    const lfStale = lf?.date && (new Date().getFullYear() - parseInt(lf.date.match(/\d{4}/)?.[0] || "0")) > 6;
                    return (
                      <Fragment key={rawIdx}>
                        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderLeft: `3px solid ${partyColor(party)}`, padding: "10px 14px", marginBottom: 6 }}>
                          {/* Header row */}
                          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                            <button
                              onClick={() => toggleMoney(r, globalIdx)}
                              aria-expanded={!!mp?.open}
                              title={mp?.open ? "Hide money flows" : "Click to view money flows"}
                              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, fontSize: 14, color: "var(--bone)", display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                              <span style={{ color: "var(--brass)", fontSize: 11 }}>{mp?.open ? "▾" : "▸"}</span>
                              {nm}
                            </button>
                            {lfStale && <span title="No filings in over 6 years — likely dormant" style={{ width: 8, height: 8, borderRadius: "50%", background: "#d9534f", display: "inline-block", alignSelf: "center" }} />}
                            {party && <span style={{ fontSize: 10, color: partyColor(party), border: `1px solid ${partyColor(party)}`, padding: "1px 6px", borderRadius: 2, letterSpacing: ".06em" }}>{party}</span>}
                            {r.via && <span className="fec-badge" title={`Found via "${r.via}"`}>via "{r.via}"</span>}
                            {lf?.loading && <span style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic" }}>checking…</span>}
                            {lf?.date && (
                              <span style={{ fontSize: 11, color: lfColor, fontWeight: 600 }}
                                title={lf.election ? `Most recent filing: ${lf.date} (${lf.election})` : `Most recent filing: ${lf.date}`}>
                                📄 {lf.date}
                              </span>
                            )}
                            {lf && !lf.loading && !lf.date && !lf.error && (
                              <span style={{ fontSize: 10, color: "var(--muted)" }}>no filings</span>
                            )}
                          </div>
                          {/* Details */}
                          <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
                            {office && <span>🏛 {office}{dist ? ` · Dist. ${dist}` : ""}</span>}
                            {elYear && <span>📅 {elYear}</span>}
                            {contact && <span>📍 {contact.replace(/\s*\|\s*/g, ", ")}</span>}
                            {treas && <span>💼 Treasurer: {treas}</span>}
                          </div>
                          {/* Actions */}
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button className="fec-btn ghost sm" onClick={() => askAI(r, globalIdx)} aria-expanded={!!ap?.open}>
                              {ap?.loading ? "…" : ap?.open ? "Hide ▾" : "Profile ▸"}
                            </button>
                            <button className="fec-btn ghost sm" onClick={() => toggleMoney(r, globalIdx)} aria-expanded={!!mp?.open}>
                              {mp?.loading ? "…" : mp?.open ? "Hide $ ▾" : "Money Flows ▸"}
                            </button>
                            {r.tnId && (
                              <button className="fec-btn ghost sm" onClick={() => toggleReports(r)}>
                                {rp?.loading ? "…" : rp?.open ? "Hide ▾" : "Reports ▸"}
                              </button>
                            )}
                            {r.tnId && (
                              <button className="fec-btn ghost sm" aria-expanded={!!flowsOpen[r.tnId]}
                                onClick={() => setFlowsOpen((p) => ({ ...p, [r.tnId]: !p[r.tnId] }))}
                                title="Money-flow graph — who funds this entity, where its money goes, and where its donors also give (click any node or edge to itemize)">
                                {flowsOpen[r.tnId] ? "Close ▾" : "Flows ▸"}
                              </button>
                            )}
                            {r.tnId && (
                              isTnWatched(String(r.tnId))
                                ? <button className="fec-btn ghost sm" onClick={() => untrackTn(String(r.tnId))}
                                    title="Stop tracking this entity">★ Untrack</button>
                                : <button className="fec-btn ghost sm" onClick={() => trackTn(r, office, party)}
                                    title="Add to the Tracked TN entities list at the top of this tab">☆ Track</button>
                            )}
                            <DossierButton sm endpoint="/api/tn/dossier" payload={{ tnId: r.tnId || "", name: entityName(r) }} />
                          </div>
                        </div>
                        {r.tnId && flowsOpen[r.tnId] && (
                          <div style={{ marginBottom: 6 }}>
                            <FlowGraph key={`tnflow-${r.tnId}`} committeeId={String(r.tnId)}
                              name={entityName(r)} cycle="" tnPull={{ id: r.tnId, name: entityName(r) }} />
                          </div>
                        )}
                        {mp?.open && (
                          <div className="fec-profile" style={{ borderLeftColor: "var(--brass)", marginBottom: 6 }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                              <span className="fec-ai-label" style={{ marginBottom: 0 }}>Money flows · {entityName(r)}</span>
                            </div>
                            {mp.error && <div className="sub" style={{ marginTop: 10 }}>Money search failed: {mp.error}</div>}
                            {renderMoneyPanel(mp, r, globalIdx)}
                          </div>
                        )}
                        {ap?.open && (
                          <div className="fec-profile" style={{ marginBottom: 6 }}>
                            {ap.loading && <span className="fec-spin">Pulling filing history from TREF, then profiling with local AI</span>}
                            {!ap.loading && (
                              <>
                                {ap.data?.federal && (
                                  <div className="fec-profile-identity" style={{ marginBottom: 10 }}>
                                    <span className="chip brass">Federal sibling: {ap.data.federal.name}</span>
                                    {ap.data.federal.type && <span className="chip">{ap.data.federal.type}</span>}
                                    {ap.data.federal.connectedOrg && <span className="chip">Connected: {ap.data.federal.connectedOrg}</span>}
                                    <span className="sub">name match — verify it's the same org</span>
                                  </div>
                                )}
                                {ap.data?.analysis && (
                                  <>
                                    <AiMeta model={ap.data.model} at={ap.data.analysisAt} cached={ap.data.analysisCached}
                                      onRefresh={() => askAI(r, globalIdx, true)} refreshing={ap?.loading} />
                                    <div className="fec-ai-text">{ap.data.analysis}</div>
                                  </>
                                )}
                                {ap.error && <div className="sub">AI narrative unavailable: {ap.error}</div>}
                                {ap.data?.federal?.funders?.length > 0 && (
                                  <div style={{ marginTop: 12 }}>
                                    <div className="fec-ai-label">Top funders of the federal committee this cycle</div>
                                    <ul className="fec-funders">
                                      {ap.data.federal.funders.map((f, k) => (
                                        <li key={k}><span>{f.name}{f.employer ? ` · ${f.employer}` : ""}{f.state ? ` · ${f.state}` : ""}</span><b>{fmtUSDshort(f.amount)}</b></li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <OrgIntel data={ap.data} />
                                {ap.data?.news?.length > 0 && (
                                  <div style={{ marginTop: 12 }}>
                                    <div className="fec-ai-label">Recent news mentioning this name</div>
                                    <ul className="fec-funders" style={{ maxWidth: "none" }}>
                                      {ap.data.news.map((n, k) => (
                                        <li key={k}>
                                          <span>{n.title}{n.source ? ` — ${n.source}` : ""}</span>
                                          <a href={n.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--olive)" }}>read ↗</a>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {ap.data?.reports?.length > 0 && (
                                  <div style={{ marginTop: 12 }}>
                                    <div className="fec-ai-label">Filing history ({ap.data.reports.length} most recent)</div>
                                    <ul className="fec-funders" style={{ maxWidth: "none" }}>
                                      {ap.data.reports.map((rep, k) => <li key={k}><span>{rep}</span></li>)}
                                    </ul>
                                  </div>
                                )}
                                {ap.data?.links?.length > 0 && (
                                  <div className="fec-profile-links">
                                    {ap.data.links.map((l) => (
                                      <a key={l.url} href={safeUrl(l.url)} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {rp?.open && (
                          <div className="fec-profile" style={{ marginBottom: 6, borderLeftColor: "var(--brass)" }}>
                            {rp.loading && <span className="fec-spin">Pulling filed reports from TREF…</span>}
                            {rp.error && <div className="sub">Report list unavailable: {rp.error}</div>}
                            {rp.data && (() => {
                              const repRows = rp.data.rows || rp.data.reports || [];
                              const pj = prefetchJobs[r.tnId];
                              const ownerName = nm;
                              if (!repRows.length) return <div className="sub">{rp.data.note || "No reports on file."}</div>;
                              const preloadedCount = repRows.filter((rr) => {
                                const rid = rr.reportId || rr.report_id;
                                return rid && (rr.detail || reportDetails[rid]?.data);
                              }).length;
                              return (
                                <>
                                  {/* Header + prefetch button */}
                                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                                    <span className="fec-ai-label" style={{ marginBottom: 0 }}>
                                      Filed Reports · {repRows.length} · {preloadedCount}/{repRows.length} cached
                                      {rp.data.source === "db" ? " · from DB" : ""}
                                    </span>
                                    {!pj?.running && preloadedCount < repRows.length && (
                                      <button className="fec-btn ghost sm" onClick={() => startPrefetch(r.tnId, ownerName)}>
                                        ⬇ Fetch &amp; Cache All
                                      </button>
                                    )}
                                    {pj?.running && (
                                      <span className="fec-spin" style={{ fontSize: 11 }}>
                                        Fetching… {pj.done}/{pj.total}
                                      </span>
                                    )}
                                    {pj?.failed ? (
                                      <span style={{ fontSize: 11, color: "var(--rose)" }}>⚠ Prefetch failed{pj.errors ? ` (${pj.errors} error${pj.errors === 1 ? "" : "s"})` : ""}</span>
                                    ) : pj?.complete ? (
                                      <span style={{ fontSize: 11, color: pj.errors > 0 ? "var(--brass)" : "var(--olive)" }}>
                                        {pj.errors > 0 ? `✓ cached with ${pj.errors} error${pj.errors === 1 ? "" : "s"}` : "✓ All cached"}
                                      </span>
                                    ) : null}
                                    {pj?.error && <span style={{ fontSize: 11, color: "var(--rose)" }}>Prefetch error: {pj.error}</span>}
                                  </div>

                                  {/* Report rows */}
                                  {repRows.map((rr, k) => {
                                    const rid = rr.reportId || rr.report_id;
                                    const election = rr.election || rr.cells?.[0] || "";
                                    const repName = rr.reportName || rr.report_name || rr.cells?.[1] || "";
                                    const submitted = rr.submitted || rr.cells?.[3] || "";
                                    const amended = rr.amended || rr.cells?.[2] || "";
                                    const rd = rid ? (reportDetails[rid] || (rr.detail ? { data: rr.detail, open: false } : null)) : null;
                                    const hasDetail = Boolean(rd?.data);
                                    const detailOpen = rd?.open || false;
                                    const d = rd?.data;
                                    return (
                                      <div key={k} style={{ border: "1px solid var(--line)", borderRadius: 3, marginBottom: 6, overflow: "hidden" }}>
                                        {/* Row header */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--ink)", flexWrap: "wrap" }}>
                                          <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 36 }}>{election}</span>
                                          <span style={{ fontWeight: 600, fontSize: 12, flex: 1, color: "var(--bone)" }}>
                                            {repName}
                                            {amended === "Y" && <span className="fec-badge" style={{ marginLeft: 6 }}>amended</span>}
                                          </span>
                                          {submitted && <span style={{ fontSize: 10, color: "var(--muted)" }}>{submitted}</span>}

                                          {/* Inline totals if loaded */}
                                          {hasDetail && d?.totals && (
                                            <span style={{ fontSize: 10, color: "var(--olive)", display: "flex", gap: 10 }}>
                                              {d.totals.receipts != null && <span title="Total receipts">▲ {fmtUSD(d.totals.receipts)}</span>}
                                              {d.totals.expenditures != null && <span title="Total expenditures">▼ {fmtUSD(d.totals.expenditures)}</span>}
                                              {d.totals.closing != null && <span title="Closing balance">💰 {fmtUSD(d.totals.closing)}</span>}
                                            </span>
                                          )}

                                          {/* Action buttons */}
                                          <div style={{ display: "flex", gap: 4 }}>
                                            {!hasDetail && rid && (
                                              <button className="fec-btn ghost sm"
                                                disabled={rd?.loading}
                                                onClick={() => fetchOneReport(rid, r.tnId)}>
                                                {rd?.loading ? "…" : "Fetch ▸"}
                                              </button>
                                            )}
                                            {hasDetail && (
                                              <button className="fec-btn ghost sm" onClick={() => toggleReportDetail(rid)}>
                                                {detailOpen ? "Hide ▾" : "Detail ▸"}
                                              </button>
                                            )}
                                            {(rr.links?.[0] || rid) && (
                                              <a className="fec-btn ghost sm"
                                                href={rid
                                                  ? `https://apps.tn.gov/tncamp/search/pub/report_full.htm?reportId=${rid}`
                                                  : `https://apps.tn.gov${rr.links[0].startsWith("/") ? "" : "/tncamp/public/"}${rr.links[0]}`}
                                                target="_blank" rel="noopener noreferrer">TREF ↗</a>
                                            )}
                                          </div>
                                        </div>

                                        {/* Fetch failure (no detail available to open) */}
                                        {rd?.error && !rd?.data && (
                                          <div className="sub" style={{ padding: "6px 10px", borderTop: "1px solid var(--line)" }}>
                                            Fetch failed: {rd.error}
                                          </div>
                                        )}

                                        {/* Detail panel */}
                                        {detailOpen && hasDetail && (
                                          <div style={{ padding: "10px 12px", background: "var(--panel)", borderTop: "1px solid var(--line)" }}>
                                            {rd.error && <div className="sub">Error: {rd.error}</div>}
                                            {d && (
                                              <>
                                                {/* Totals grid */}
                                                {Object.keys(d.totals || {}).length > 0 && (
                                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "6px 16px", marginBottom: 10 }}>
                                                    {Object.entries(d.totals).map(([k2, v]) => (
                                                      <div key={k2} style={{ fontSize: 11 }}>
                                                        <div style={{ color: "var(--muted)", textTransform: "uppercase", fontSize: 9, letterSpacing: ".08em" }}>{k2}</div>
                                                        <div style={{ fontWeight: 700, color: "var(--bone)" }}>
                                                          {typeof v === "number" ? fmtUSD(v) : (v || "—")}
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                )}
                                                {/* Raw totals fallback */}
                                                {Object.keys(d.totals || {}).length === 0 && Object.keys(d.rawTotals || {}).length > 0 && (
                                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "6px 16px", marginBottom: 10 }}>
                                                    {Object.entries(d.rawTotals).map(([k2, v]) => (
                                                      <div key={k2} style={{ fontSize: 11 }}>
                                                        <div style={{ color: "var(--muted)", textTransform: "uppercase", fontSize: 9 }}>{k2}</div>
                                                        <div style={{ fontWeight: 700, color: "var(--bone)" }}>
                                                          {typeof v === "number" ? fmtUSD(v) : (v || "—")}
                                                        </div>
                                                      </div>
                                                    ))}
                                                  </div>
                                                )}

                                                {/* Contributions table */}
                                                {(d.contribs?.length > 0) && (() => {
                                                  const cols = Object.keys(d.contribs[0]).filter((k2) => !k2.startsWith("_"));
                                                  return (
                                                    <div style={{ marginBottom: 8 }}>
                                                      <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--olive)", marginBottom: 4 }}>
                                                        Contributions Received · {d.contribs.length}
                                                      </div>
                                                      <div style={{ overflowX: "auto" }}>
                                                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                                          <thead>
                                                            <tr>{cols.map((c) => <th key={c} style={{ textAlign: "left", padding: "3px 8px", borderBottom: "1px solid var(--line)", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{c}</th>)}</tr>
                                                          </thead>
                                                          <tbody>
                                                            {d.contribs.slice(0, 200).map((row2, ri) => (
                                                              <tr key={ri} style={{ borderBottom: "1px solid var(--line)" }}>
                                                                {cols.map((c) => <td key={c} style={{ padding: "3px 8px", color: "var(--bone)" }}>{row2[c] || ""}</td>)}
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                        {d.contribs.length > 200 && <div className="sub" style={{ marginTop: 4 }}>Showing first 200 of {d.contribs.length}</div>}
                                                      </div>
                                                    </div>
                                                  );
                                                })()}

                                                {/* Expenditures table */}
                                                {(d.expenditures?.length > 0) && (() => {
                                                  const cols = Object.keys(d.expenditures[0]).filter((k2) => !k2.startsWith("_"));
                                                  return (
                                                    <div>
                                                      <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--rose)", marginBottom: 4 }}>
                                                        Expenditures · {d.expenditures.length}
                                                      </div>
                                                      <div style={{ overflowX: "auto" }}>
                                                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                                                          <thead>
                                                            <tr>{cols.map((c) => <th key={c} style={{ textAlign: "left", padding: "3px 8px", borderBottom: "1px solid var(--line)", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{c}</th>)}</tr>
                                                          </thead>
                                                          <tbody>
                                                            {d.expenditures.slice(0, 200).map((row2, ri) => (
                                                              <tr key={ri} style={{ borderBottom: "1px solid var(--line)" }}>
                                                                {cols.map((c) => <td key={c} style={{ padding: "3px 8px", color: "var(--bone)" }}>{row2[c] || ""}</td>)}
                                                              </tr>
                                                            ))}
                                                          </tbody>
                                                        </table>
                                                        {d.expenditures.length > 200 && <div className="sub" style={{ marginTop: 4 }}>Showing first 200 of {d.expenditures.length}</div>}
                                                      </div>
                                                    </div>
                                                  );
                                                })()}

                                                {/* Fallback: no tables parsed */}
                                                {!d.contribs?.length && !d.expenditures?.length && Object.keys({ ...d.totals, ...d.rawTotals }).length === 0 && (
                                                  <div className="sub">Report fetched but no structured data found — <a href={`https://apps.tn.gov/tncamp/search/pub/report_full.htm?reportId=${rid}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--olive)" }}>view on TREF ↗</a></div>
                                                )}

                                                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 8 }}>
                                                  Cached {d.fetchedAt ? new Date(d.fetchedAt).toLocaleDateString() : "just now"} · source: {d.source || "live"}
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                </div>
              );
            };
            return (
              <div style={{ marginTop: 10 }}>
                {renderGroup(candidates, "Candidates")}
                {renderGroup(pacs, "PACs & Committees")}
                {renderGroup(others, "Parties & Other")}
              </div>
            );
          })()}
        </>
      )}
      {!result && !error && !donorMode && (
        <div className="fec-empty">Search Tennessee state campaign finance records — state House/Senate, Governor, judicial races, and state PACs.</div>
      )}

      {(
        <div style={{ marginTop: 28, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Previous searches</h3>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{history.total} total</span>
          </div>
          {history.rows.length === 0 && (
            <div className="sub" style={{ padding: "6px 0" }}>No previous searches yet — run a search above and it'll be logged here (cached, so repeat lookups don't re-hit the TN site).</div>
          )}
          {history.rows.length > 0 && (<>
          <table className="fec-table" style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Search</th>
                <th style={{ textAlign: "right" }}>Results</th>
                <th style={{ textAlign: "left" }}>Last refreshed</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map((s) => {
                const ex = histExpanded[s.id];
                return (
                  <Fragment key={s.id}>
                    <tr>
                      <td style={{ textAlign: "left" }}>{histLabel(s)}</td>
                      <td style={{ textAlign: "right" }}>{s.count}</td>
                      <td style={{ textAlign: "left", color: "var(--muted)" }}>{timeAgo(s.last_refresh)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="fec-btn fec-btn-sm" onClick={() => toggleHistExpand(s)}>
                          {ex?.open ? "Hide ▾" : "Expand ▸"}
                        </button>{" "}
                        <button className="fec-btn fec-btn-sm" onClick={() => applyHistory(s, false)} title="Re-run this search">Load</button>{" "}
                        <button className="fec-btn fec-btn-sm" onClick={() => applyHistory(s, true)} title="Bypass cache and re-fetch">↺ Refresh</button>
                      </td>
                    </tr>
                    {ex?.open && (
                      <tr>
                        <td colSpan={4} style={{ background: "var(--panel)", padding: 10 }}>
                          {ex.loading && <span style={{ color: "var(--muted)" }}>Loading…</span>}
                          {ex.error && <span style={{ color: "var(--danger)" }}>{ex.error}</span>}
                          {ex.data && (
                            ex.data.rows?.length ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {ex.data.rows.slice(0, 40).map((r, i) => (
                                  <button
                                    key={i}
                                    className="fec-btn fec-btn-sm"
                                    title="Load this search to view this entity"
                                    onClick={() => applyHistory(s, false)}
                                  >
                                    {entityName(r, ex.data.headers) || (r.cells?.[0] || "").trim() || "—"}
                                  </button>
                                ))}
                                {ex.data.rows.length > 40 && (
                                  <span style={{ color: "var(--muted)", fontSize: 11, alignSelf: "center" }}>
                                    +{ex.data.rows.length - 40} more — click Load
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: "var(--muted)" }}>No entities in this cached result.</span>
                            )
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {history.total > HIST_PER && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <button className="fec-btn fec-btn-sm" disabled={histPage === 0} onClick={() => setHistPage((p) => Math.max(0, p - 1))}>← Prev</button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                Page {histPage + 1} of {Math.ceil(history.total / HIST_PER)}
              </span>
              <button
                className="fec-btn fec-btn-sm"
                disabled={(histPage + 1) * HIST_PER >= history.total}
                onClick={() => setHistPage((p) => p + 1)}
              >Next →</button>
            </div>
          )}
          </>
          )}
        </div>
      )}
    </>
  );
}

// ---------- admin panel ----------
// ---- alerts panel (filings · attack ads · PAC spreading · standing searches) ----
const ALERT_ICON = { filing: "📄", ie: "📣", pac: "🕸", search: "⌕", tn: "🏛", local: "🏘" };
function AlertsPanel({ onClose, onCount }) {
  const [st, setSt] = useState(null);
  const [scanning, setScanning] = useState(false);
  const load = async () => {
    try { const d = await fetch("/api/alerts").then((r) => r.json()); setSt(d); onCount?.(d.unseen || 0); }
    catch { /* panel shows nothing */ }
  };
  useEffect(() => { load(); }, []);
  const scan = async () => {
    setScanning(true);
    try { await fetch("/api/alerts/scan", { method: "POST" }); await load(); }
    finally { setScanning(false); }
  };
  const markRead = async () => { await fetch("/api/alerts/seen", { method: "POST" }).catch(() => {}); load(); };
  return (
    <div className="fec-ledger" style={{ marginTop: 12 }}>
      <div className="fec-ledger-head">
        <span className="fec-name">🔔 Alerts</span>
        <span className="fec-tag">{st?.lastScanAt ? `last scan ${timeAgo(st.lastScanAt)}` : "never scanned"} · scans also run after scheduled bulk imports</span>
        <button className="fec-btn ghost sm" onClick={scan} disabled={scanning}>{scanning ? "Scanning…" : "↺ Scan now"}</button>
        <button className="fec-btn ghost sm" onClick={markRead} disabled={!st?.unseen}>Mark all read</button>
        <button className="close" onClick={onClose}>Close ✕</button>
      </div>
      {(st?.searches || []).length > 0 && (
        <div className="fec-ledger-bar" style={{ flexWrap: "wrap", gap: 6 }}>
          {st.searches.map((s) => (
            <span key={s.id} className="fec-tag">
              ⌕ {s.q} ({s.field}){" "}
              <button className="fec-btn ghost sm" style={{ padding: "0 6px" }} title="Remove standing search"
                onClick={async () => { await fetch(`/api/searches?id=${encodeURIComponent(s.id)}`, { method: "DELETE" }); load(); }}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div style={{ padding: "8px 16px 14px" }}>
        {!st && <div className="fec-spin">Loading…</div>}
        {st && !(st.feed || []).length && <div className="fec-empty" style={{ marginTop: 8 }}>No alerts yet — track candidates/donors, save a search, then hit ↺ Scan now.</div>}
        {/* daily digest: alerts grouped under the day they arrived, with a one-line count and a copy button */}
        {(st?.feed || []).flatMap((a, i, all) => {
          const dayOf = (x) => new Date(x.at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
          const head = i === 0 || dayOf(all[i - 1]) !== dayOf(a);
          const same = head ? all.filter((x) => dayOf(x) === dayOf(a)) : [];
          const kinds = head ? Object.entries(same.reduce((m, x) => ({ ...m, [x.kind]: (m[x.kind] || 0) + 1 }), {})).map(([k, n]) => `${n} ${({ filing: "filing", ie: "outside spending", pac: "PAC", search: "saved search", tn: "Tennessee", local: "local" })[k] || k}`).join(" · ") : "";
          return [head && (
            <div key={`day-${a.id || a.ref}`} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "10px 0 2px" }}>
              <b style={{ fontSize: 13 }}>{dayOf(a)}</b><span className="sub">{kinds}</span>
              <button className="fec-btn ghost sm" style={{ marginLeft: "auto" }} title="Copy this day’s alerts as plain text"
                onClick={() => navigator.clipboard?.writeText(`${dayOf(a)}\n` + same.map((x) => `- ${x.subject}: ${x.detail || ""}`).join("\n"))}>Copy digest</button>
            </div>
          ), (
          <div key={a.id || a.ref} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 12, alignItems: "baseline" }}>
            <span title={a.kind}>{ALERT_ICON[a.kind] || "•"}</span>
            <b style={{ color: "var(--bone)", whiteSpace: "nowrap" }}>{a.subject}</b>
            <span className={a.kind === "ie" && /AGAINST/.test(a.detail || "") ? "" : "sub"}
              style={a.kind === "ie" && /AGAINST/.test(a.detail || "") ? { color: "var(--rose)" } : {}}>{a.detail}</span>
            <span className="sub" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>{timeAgo(a.at)}</span>
          </div>
          )];
        })}
      </div>
    </div>
  );
}

// ---- receipts sparkline (filing-period history from candidate_totals) ----
function Spark({ points, title = "Receipts by filing period" }) {
  const vals = (points || []).map((p) => Number(p.receipts) || 0).filter((v) => v > 0);
  if (vals.length < 2) return null; // history accrues as totals get pulled — render only when there's a trend
  const max = Math.max(...vals, 1);
  const w = 64, h = 18, step = w / (vals.length - 1);
  const d = vals.map((v, i) => `${i ? "L" : "M"} ${(i * step).toFixed(1)} ${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ opacity: 0.9, flexShrink: 0 }} role="img" aria-label={title}>
      <title>{`${title} — ${vals.length} filings, latest ${fmtUSDshort(vals[vals.length - 1])}`}</title>
      <path d={d} fill="none" stroke="var(--brass)" strokeWidth="1.5" />
    </svg>
  );
}

// ---- nationwide quick-find (stored masters + ledger, zero FEC calls) ----
function QuickFind({ onRace, onDonorsTab }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const [flow, setFlow] = useState(null); // {committeeId, name} → inline FlowGraph
  const seq = useRef(0), timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onInput = (v) => {
    setQ(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) { setOpen(false); setRes(null); return; }
    const s = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const d = await fetch(`/api/find?q=${encodeURIComponent(v.trim())}`).then((r) => r.json());
        if (s === seq.current) { setRes(d); setOpen(true); }
      } catch { /* best-effort */ }
    }, 250);
  };
  const any = (res?.candidates?.length || 0) + (res?.committees?.length || 0) + (res?.donors?.length || 0) > 0;
  const row = { display: "flex", gap: 8, alignItems: "center", padding: "5px 10px", borderBottom: "1px solid var(--line)", fontSize: 12, flexWrap: "wrap" };
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ position: "relative", maxWidth: 720 }}>
        <input value={q} onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onFocus={() => res && setOpen(true)}
          placeholder="Find any candidate, committee or donor already stored"
          style={{ width: "100%", background: "var(--panel)", color: "var(--bone)", border: "1px solid var(--line)", padding: "9px 12px", font: "inherit", fontSize: 14 }} />
        {open && (
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 40, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow)", maxHeight: 340, overflowY: "auto" }}>
            {!any && <div className="sub" style={{ padding: "8px 10px" }}>Nothing stored matches — masters fill in via browsing and the bulk import.</div>}
            {(res?.candidates || []).map((c) => (
              <div key={c.candId} style={row}>
                <b style={{ color: "var(--bone)" }}>{c.name}</b>
                <span className="sub">{[c.party, c.office === "H" ? `${c.state}-${c.district}` : c.office === "S" ? `${c.state} Senate` : c.office === "P" ? "President" : c.state].filter(Boolean).join(" · ")}{c.lastCycle ? ` · ${c.lastCycle}` : ""}</span>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {c.office !== "P" && c.state && (
                    <button className="fec-btn ghost sm" onMouseDown={() => { setOpen(false); onRace?.(c); }}
                      title="Open this candidate's race in Money Race">Race ▸</button>
                  )}
                  {c.pcc && (
                    <button className="fec-btn ghost sm" onMouseDown={() => { setOpen(false); setFlow({ committeeId: c.pcc, name: c.name }); }}>Flows ▸</button>
                  )}
                </span>
              </div>
            ))}
            {(res?.committees || []).map((c) => (
              <div key={c.cmteId} style={row}>
                <span style={{ color: "var(--bone)" }}>{c.name}</span>
                <span className="sub">{[c.type, c.party, c.state].filter(Boolean).join(" · ")} · committee</span>
                <span style={{ marginLeft: "auto" }}>
                  <button className="fec-btn ghost sm" onMouseDown={() => { setOpen(false); setFlow({ committeeId: c.cmteId, name: c.name }); }}>Flows ▸</button>
                </span>
              </div>
            ))}
            {(res?.donors || []).map((d) => (
              <div key={d.donorKey} style={row}>
                <span style={{ color: "var(--bone)" }}>{d.name}</span>
                <span className="sub">{[d.employer, d.state].filter(Boolean).join(" · ")} · donor · {fmtUSDshort(d.total)} ({d.count})</span>
                <span style={{ marginLeft: "auto" }}>
                  <button className="fec-btn ghost sm" onMouseDown={() => { setOpen(false); onDonorsTab?.(d.name); }}
                    title="Open the Donors tab">Donors ▸</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {flow && (
        <div style={{ position: "relative" }}>
          <button className="fec-btn ghost sm" onClick={() => setFlow(null)}
            style={{ position: "absolute", right: 8, top: 18, zIndex: 5 }}>Close ✕</button>
          <FlowGraph key={flow.committeeId} committeeId={flow.committeeId} name={flow.name} cycle="" />
        </div>
      )}
    </div>
  );
}

// ---- Admin: consolidated connections + bulk-source freshness ----
// Everything that used to live scattered (header text, tab tags) reports here. Bulk rows compare
// the FEC's Last-Modified against the local zip — "new data available" is measured, not guessed.
function ConnectionsSection() {
  const [src, setSrc] = useState(null); // /api/admin/sources payload
  const [loading, setLoading] = useState(true);
  const load = async (fresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sources${fresh ? "?fresh=1" : ""}`);
      setSrc(await res.json());
    } catch (e) { setSrc({ error: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const dot = (ok) => <span className="fec-dot" style={{ background: ok ? "#8A9A5B" : "#B85B5B" }} />;
  const when = (t) => (t ? timeAgo(t) : "—");
  const VERDICT_COLOR = { "up to date": "var(--olive)", "new data available": "var(--brass)", "not downloaded": "var(--muted)", unreachable: "var(--rose)" };
  return (
    <div style={{ borderTop: "1px dashed var(--line)", marginTop: 14, paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase" }}>Connections & data sources</span>
        <button className="fec-btn ghost sm" onClick={() => load(true)} disabled={loading}
          title="Re-check every source now (bypasses the 10-minute status cache)">
          {loading ? "Checking…" : "↺ Re-check"}
        </button>
        {src?.cachedAt && <span className="sub" style={{ fontSize: 10 }}>checked {timeAgo(src.cachedAt)}</span>}
      </div>
      {src?.error && <div className="fec-error" role="alert">{src.error}</div>}
      {src && !src.error && (
        <>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, marginBottom: 10 }}>
            <span>{dot(true)} FEC API — {src.fec?.keyConfigured ? "custom key" : <b style={{ color: "var(--brass)" }}>DEMO_KEY (set FEC_API_KEY)</b>}</span>
            <span>
              {dot(src.tn?.status === "ok")} TN TREF — {src.tn?.status === "ok" ? "reachable"
                : src.tn?.status === "degraded" ? `degraded (HTTP ${src.tn?.httpStatus})`
                : (src.tn?.error || "unreachable")}
            </span>
            <span>{dot(!!src.search?.configured)} web search — {src.search?.configured ? src.search.provider : "off (local only)"}</span>
          </div>
          <div className="fec-table-wrap">
            <table className="fec-table">
              <thead>
                <tr><th>Bulk file</th><th>Cycle</th><th>FEC last updated</th><th>Local copy</th><th>Status</th></tr>
              </thead>
              <tbody>
                {(src.bulk || []).map((b) => (
                  <tr key={`${b.kind}${b.cycle}`}>
                    <td>
                      <a className="fec-extlink" href={safeUrl(b.url)} target="_blank" rel="noopener noreferrer"
                        title={b.url}>{b.kind}{String(b.cycle).slice(2)}.zip ↗</a>
                      <span className="sub" style={{ marginLeft: 8 }}>
                        {{ cm: "committee master", cn: "candidate master", ccl: "linkages", pas2: "PAC→candidate", oth: "PAC→PAC" }[b.kind] || ""}
                      </span>
                    </td>
                    <td className="sub">{b.cycle}</td>
                    <td className="sub">{b.remote?.lastModified ? `${when(b.remote.lastModified)}${b.remote.size ? ` · ${(b.remote.size / 1e6).toFixed(1)} MB` : ""}` : (b.error || "—")}</td>
                    <td className="sub">{b.local ? `downloaded ${when(b.local.mtime)}` : "—"}</td>
                    <td><b style={{ color: VERDICT_COLOR[b.verdict] || "var(--muted)" }}>{b.verdict}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sub" style={{ marginTop: 6, fontSize: 10.5 }}>
            "new data available" = the FEC regenerated the file since your last download — run the bulk import below to pick it up.
          </div>
        </>
      )}
    </div>
  );
}

// ---- Admin: FEC bulk import (nationwide PAC layer) — run now, schedule, last/next status ----
// The import runs server-side detached from this page (closing the browser doesn't kill it);
// this section just polls /api/admin/bulk-import (3s while running, 20s idle).
function BulkImportSection() {
  const [st, setSt] = useState(null); // GET /api/admin/bulk-import payload
  const [cyclesIn, setCyclesIn] = useState("");
  const [othIn, setOthIn] = useState(true);
  const [indivIn, setIndivIn] = useState(false);
  const [schedOn, setSchedOn] = useState(false);
  const [schedHours, setSchedHours] = useState(168);
  const [msg, setMsg] = useState(null);
  const firstRef = useRef(true);

  useEffect(() => {
    let timer, dead = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/admin/bulk-import");
        const d = await res.json();
        if (dead) return;
        setSt(d);
        if (firstRef.current && d?.schedule) { // seed inputs from saved schedule once
          firstRef.current = false;
          setCyclesIn((d.schedule.cycles || []).join(","));
          setOthIn(d.schedule.oth !== false);
          setIndivIn(!!d.schedule.indiv);
          setSchedOn(!!d.schedule.enabled);
          setSchedHours(d.schedule.everyHours || 168);
        }
        timer = setTimeout(tick, d?.running ? 3000 : 20000);
      } catch { if (!dead) timer = setTimeout(tick, 20000); }
    };
    tick();
    return () => { dead = true; clearTimeout(timer); };
  }, []);

  const runNow = async () => {
    setMsg(null);
    try {
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cycles: cyclesIn, oth: othIn, indiv: indivIn }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error?.message || `HTTP ${res.status}`);
      setSt((s) => ({ ...(s || {}), running: true, log: [] }));
      setMsg("Import started — safe to close this page.");
    } catch (e) { setMsg(`Failed: ${e.message}`); }
  };

  const saveSchedule = async (enabled) => {
    setMsg(null);
    try {
      const res = await fetch("/api/admin/bulk-schedule", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, everyHours: schedHours, cycles: cyclesIn, oth: othIn, indiv: indivIn }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error?.message || `HTTP ${res.status}`);
      setSchedOn(enabled);
      setSt((s) => (s ? { ...s, schedule: { ...s.schedule, ...d.schedule } } : s));
      setMsg(enabled ? "Schedule saved." : "Schedule disabled.");
    } catch (e) { setMsg(`Failed: ${e.message}`); }
  };

  const rel = (t) => {
    if (!t) return "—";
    const d = t - Date.now();
    if (d <= 0) return "due now";
    const h = Math.round(d / 3600000);
    return h < 48 ? `in ~${h}h` : `in ~${Math.round(h / 24)}d`;
  };
  const last = st?.last;
  const inputStyle = { background: "var(--ink)", color: "var(--bone)", border: "1px solid var(--line)", font: "inherit", fontSize: 12, padding: "3px 6px" };

  return (
    <div style={{ borderTop: "1px dashed var(--line)", marginTop: 14, paddingTop: 12 }}>
      <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 8 }}>
        FEC bulk data — nationwide PAC layer
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, marginBottom: 8, alignItems: "baseline" }}>
        <span>
          Last load:{" "}
          {st?.running ? <b style={{ color: "var(--brass)" }}>⟳ importing now…</b>
            : last ? (
              <>
                <b style={{ color: last.ok ? "var(--olive)" : "var(--rose)" }}>{last.ok ? "✓ ok" : "✕ failed"}</b>
                {" "}<span className="sub">{timeAgo(last.at)} · cycles {(last.cycles || []).join(", ")}{last.oth ? " +oth" : ""} · {last.seconds}s · {last.trigger}</span>
                {!last.ok && last.error ? <span style={{ color: "var(--rose)" }}> · {last.error}</span> : null}
              </>
            ) : <span className="sub">never</span>}
        </span>
        <span>
          Next scheduled:{" "}
          {st?.schedule?.enabled && st.schedule.nextAt
            ? <><b style={{ color: "var(--brass)" }}>{new Date(st.schedule.nextAt).toLocaleString()}</b> <span className="sub">({rel(st.schedule.nextAt)}, every {st.schedule.everyHours}h)</span></>
            : <span className="sub">off</span>}
        </span>
        {st?.stats && (
          <span className="sub">
            ledger {Number(st.stats.rows || 0).toLocaleString()} rows · {Number(st.stats.committees || 0).toLocaleString()} committees · {Number(st.stats.candidates || 0).toLocaleString()} candidates
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="fec-check" style={{ gap: 5 }} title={`"auto" always means the current cycle — a schedule saved as auto rolls over to new cycles by itself`}>
          cycles
          <input value={cyclesIn} onChange={(e) => setCyclesIn(e.target.value)} placeholder="auto,2024" style={{ ...inputStyle, width: 110 }} />
        </label>
        <label className="fec-check">
          <input type="checkbox" checked={othIn} onChange={(e) => setOthIn(e.target.checked)} />
          PAC→PAC (oth)
        </label>
        <label className="fec-check" title="Every itemized individual gift to Tennessee committees and from Tennessee residents. Streams the nationwide file (1–2 GB per cycle) and keeps only Tennessee rows — expect several minutes per cycle.">
          <input type="checkbox" checked={indivIn} onChange={(e) => setIndivIn(e.target.checked)} />
          TN individual donors (indiv)
        </label>
        <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }} onClick={runNow} disabled={st?.running}>
          {st?.running ? "⟳ Importing…" : "⬇ Load bulk data now"}
        </button>
        <label className="fec-check" style={{ gap: 5 }}>
          every
          <select value={schedHours} onChange={(e) => setSchedHours(Number(e.target.value))} style={inputStyle}>
            <option value={24}>day</option>
            <option value={72}>3 days</option>
            <option value={168}>week</option>
            <option value={336}>2 weeks</option>
          </select>
        </label>
        {schedOn
          ? <>
              <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }} onClick={() => saveSchedule(true)}
                title="Save cycles/interval changes to the schedule">✓ Save schedule</button>
              <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }} onClick={() => saveSchedule(false)}>■ Disable</button>
            </>
          : <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }} onClick={() => saveSchedule(true)}>▶ Enable schedule</button>}
        {msg && <span style={{ fontSize: 11, color: msg.startsWith("Failed") ? "var(--rose)" : "var(--olive)" }}>{msg}</span>}
      </div>
      {st?.running && (
        <div style={{ background: "var(--ink)", border: "1px solid var(--line)", padding: "8px 10px", marginTop: 8,
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, whiteSpace: "pre-wrap", lineHeight: 1.5,
          maxHeight: 160, overflowY: "auto" }}
          ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
          {(st.log || []).join("\n") || "Starting…"}<span className="fec-spin"> ▌</span>
        </div>
      )}
      <div className="sub" style={{ marginTop: 6, fontSize: 10.5 }}>
        Loads the FEC's nationwide bulk files (committee/candidate masters + every PAC→candidate contribution; +oth adds PAC→PAC transfers)
        into the permanent ledger. Downloads cache in data/bulk and re-runs only re-read changed cycles' files. The import survives closing this page.
      </div>
    </div>
  );
}

function AdminPanel({ onClose, onMembersRefreshed }) {
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [scriptLog, setScriptLog] = useState(null); // null | string (running/done output)
  const [scriptRunning, setScriptRunning] = useState(false);
  const [cacheClearing, setCacheClearing] = useState(false);
  const logRef = { current: null };

  const [oll, setOll] = useState(null); // ollama health: agent model + search status
  const [agentSaved, setAgentSaved] = useState(false);
  const esRef = useRef(null); // run-script EventSource — closed on unmount
  useEffect(() => () => { esRef.current?.close(); }, []);

  const loadStatus = () => {
    setStatusLoading(true);
    fetch("/api/admin/status")
      .then((r) => r.json())
      .then((d) => { setStatus(d); setStatusLoading(false); })
      .catch(() => { setStatus({ error: "Failed to load" }); setStatusLoading(false); });
    fetch("/api/ollama/health").then((r) => r.json()).then(setOll).catch(() => setOll(null));
  };

  const changeAgentModel = async (model) => {
    setOll((o) => ({ ...o, agentModel: model, agentModelAvailable: (o?.models || []).includes(model) }));
    try {
      const res = await fetch("/api/settings/agent-model", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }),
      });
      if (res.ok) { setAgentSaved(true); setTimeout(() => setAgentSaved(false), 2500); }
    } catch { /* next health poll corrects */ }
  };

  const [narrSaved, setNarrSaved] = useState(false);
  const changeNarrModel = async (model) => { // moved here from the header — Admin owns model choice now
    setOll((o) => ({ ...o, configuredModel: model, modelAvailable: (o?.models || []).includes(model) }));
    try {
      const res = await fetch("/api/settings/model", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }),
      });
      if (res.ok) { setNarrSaved(true); setTimeout(() => setNarrSaved(false), 2500); }
    } catch { /* next health poll corrects */ }
  };

  useEffect(() => { loadStatus(); }, []);

  const runScript = () => {
    if (scriptRunning) return;
    setScriptRunning(true);
    setScriptLog("");
    const es = new EventSource("/api/admin/run-script");
    esRef.current = es;
    es.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; } // ignore malformed frames
      if (msg.out || msg.err) setScriptLog((s) => (s || "") + (msg.out || msg.err));
      if (msg.done) {
        es.close();
        setScriptRunning(false);
        loadStatus(); // refresh stats after script completes
      }
    };
    es.onerror = () => {
      es.close();
      setScriptRunning(false);
      setScriptLog((s) => (s || "") + "\n[Connection closed]");
    };
  };

  const [backingUp, setBackingUp] = useState(false);
  const [backupMsg, setBackupMsg] = useState(null);
  const runBackup = async () => {
    setBackingUp(true); setBackupMsg(null);
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error?.message || `HTTP ${res.status}`);
      setBackupMsg(`Saved data/backups/${d.file} (${(d.bytes / 1e6).toFixed(1)} MB) — ${d.backups.length} backup${d.backups.length === 1 ? "" : "s"} kept`);
    } catch (e) { setBackupMsg(`Backup failed: ${e.message}`); }
    finally { setBackingUp(false); }
  };

  const [compacting, setCompacting] = useState(false);
  const compactDb = async () => {
    if (!window.confirm("Compact the database now? The app pauses while the file is rewritten (seconds to a minute on a large store).")) return;
    setCompacting(true); setBackupMsg(null);
    try {
      const res = await fetch("/api/admin/compact", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error?.message || `HTTP ${res.status}`);
      setBackupMsg(`Compacted: ${(d.beforeBytes / 1e6).toFixed(1)} MB → ${(d.afterBytes / 1e6).toFixed(1)} MB`);
      await loadStatus();
    } catch (e) { setBackupMsg(`Backup failed: compact — ${e.message}`); }
    finally { setCompacting(false); }
  };

  const clearCache = async () => {
    setCacheClearing(true);
    try {
      await fetch("/api/admin/clear-cache", { method: "POST" });
      await loadStatus();
    } finally { setCacheClearing(false); }
  };

  const [aiClearing, setAiClearing] = useState(false);
  const clearAi = async () => {
    if (!window.confirm("Delete all stored AI summaries? Each narrative will regenerate (slowly) the next time it's viewed.")) return;
    setAiClearing(true);
    try {
      await fetch("/api/admin/clear-ai", { method: "POST" });
      await loadStatus();
    } finally { setAiClearing(false); }
  };

  const [membersRefreshing, setMembersRefreshing] = useState(false);
  const [membersMsg, setMembersMsg] = useState(null);
  const refreshMembers = async () => {
    setMembersRefreshing(true); setMembersMsg(null);
    try {
      const res = await fetch("/api/congress/members?_refresh=1");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
      setMembersMsg(`Refreshed — ${data.length} members loaded.`);
      onMembersRefreshed?.();
    } catch (e) {
      setMembersMsg(`Failed: ${e.message}`);
    } finally { setMembersRefreshing(false); }
  };

  const fmtBytes = (b) => b == null ? "—" : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`;
  const fmtUptime = (s) => s == null ? "—" : s > 3600 ? `${(s / 3600).toFixed(1)}h` : `${Math.round(s / 60)}m`;

  return (
    <div style={{
      background: "var(--panel)", border: "1px solid var(--line)", borderTop: "2px solid var(--olive)",
      padding: "16px 20px", marginBottom: 16,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--muted)" }}>System Status</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }}
            onClick={runScript} disabled={scriptRunning}>
            {scriptRunning ? "⟳ Running…" : "↺ Run Download Script"}
          </button>
          <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }}
            onClick={refreshMembers} disabled={membersRefreshing}
            title="Re-read member data from disk and refresh map colors (run the download script first to update the data)">
            {membersRefreshing ? "Refreshing…" : "⟳ Refresh Map Colors"}
          </button>
          <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }}
            onClick={runBackup} disabled={backingUp}
            title="WAL-checkpoint + timestamped copy of the whole database into data/backups">
            {backingUp ? "Backing up…" : "💾 Backup DB"}
          </button>
          <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }}
            onClick={clearCache} disabled={cacheClearing}>
            {cacheClearing ? "Clearing…" : "🗑 Clear Cache"}
          </button>
          <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }}
            onClick={compactDb} disabled={compacting}
            title="Delete long-expired cache rows, reclaim free pages (VACUUM) and refresh query-planner statistics">
            {compacting ? "Compacting…" : "⇲ Compact DB"}
          </button>
          <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 12px" }}
            onClick={clearAi} disabled={aiClearing}
            title="Delete all stored AI narratives — they regenerate on next view">
            {aiClearing ? "Clearing…" : "🗑 Clear AI Summaries"}
          </button>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>✕</button>
        </div>
      </div>

      {membersMsg && <div style={{ fontSize: 11, color: membersMsg.startsWith("Failed") ? "var(--rose)" : "var(--olive)", marginBottom: 10 }}>{membersMsg}</div>}
      {backupMsg && <div style={{ fontSize: 11, color: backupMsg.startsWith("Backup failed") ? "var(--rose)" : "var(--olive)", marginBottom: 10 }}>{backupMsg}</div>}
      {statusLoading && <span className="fec-spin" style={{ fontSize: 11 }}>Loading…</span>}
      {status && !statusLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: scriptLog != null ? 14 : 0 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>Cache</div>
            <div style={{ fontSize: 13 }}>{status.cache?.count ?? "—"} entries</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>DB: {fmtBytes(status.cache?.dbSizeBytes)}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>{status.persistent ? "SQLite" : "In-memory"}</div>
            {status.storage && (
              <div style={{ fontSize: 11, color: "var(--muted)" }}
                title={`Expired responses are kept ${status.storage.staleGraceDays} days as a fallback for when the FEC or TREF is down`}>
                + {status.storage.cacheStale} stale fallback · {fmtBytes(status.storage.reclaimableBytes)} reclaimable
              </div>
            )}
          </div>
          {status.fecGateway && (
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>FEC calls saved</div>
              <div style={{ fontSize: 13 }}>
                {(() => { const g = status.fecGateway; const t = g.hits + g.misses + g.stale + g.coalesced; return t ? `${Math.round(((t - g.misses) / t) * 100)}% from cache` : "no calls yet"; })()}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{status.fecGateway.misses} live · {status.fecGateway.hits} cached · {status.fecGateway.coalesced} merged</div>
              <div style={{ fontSize: 11, color: status.fecGateway.blockedForSec ? "var(--rose)" : "var(--muted)" }}>
                {status.fecGateway.blockedForSec ? `rate-limited — resumes in ${status.fecGateway.blockedForSec}s` : `${status.fecGateway.stale} served stale on upstream errors`}
              </div>
            </div>
          )}
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>AI Summaries</div>
            <div style={{ fontSize: 13 }}>{status.ai?.count ?? "—"} stored</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>TN reports: {status.tnReports ?? "—"}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>refreshable per-item</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>Narrative AI</div>
            {oll?.status === "ok" ? (
              <>
                <select className="fec-modelsel" value={oll.configuredModel || ""} onChange={(e) => changeNarrModel(e.target.value)}
                  aria-label="Narrative AI model" title="Model for donor analyses, profiles, dossier narratives (saved permanently)" style={{ maxWidth: 150 }}>
                  {[...new Set([oll.configuredModel, ...(oll.models || [])])].filter(Boolean).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: oll.modelAvailable === false ? "#C8723A" : "var(--muted)" }}>
                  {oll.modelAvailable === false ? "not pulled — run ollama pull" : "narrative model"}
                  {narrSaved && <span style={{ color: "var(--olive)" }}> saved ✓</span>}
                </div>
              </>
            ) : <div style={{ fontSize: 13, color: "var(--rose)" }}>ollama offline</div>}
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>Ask AI agent</div>
            {oll?.status === "ok" ? (
              <>
                <select className="fec-modelsel" value={oll.agentModel || ""} onChange={(e) => changeAgentModel(e.target.value)}
                  aria-label="Ask-AI agent model" title="Tool-calling model for Ask AI (saved permanently)" style={{ maxWidth: 150 }}>
                  {[...new Set([oll.agentModel, ...(oll.models || [])])].filter(Boolean).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: oll.agentModelAvailable === false ? "#C8723A" : "var(--muted)" }}>
                  {oll.agentModelAvailable === false ? "not pulled — run ollama pull" : "tool-calling model"}
                  {agentSaved && <span style={{ color: "var(--olive)" }}> saved ✓</span>}
                </div>
              </>
            ) : <div style={{ fontSize: 13 }}>{oll?.agentModel || "—"}</div>}
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              web search: {oll?.search?.configured ? oll.search.provider : "off (local only)"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>Process</div>
            <div style={{ fontSize: 13 }}>Up {fmtUptime(status.uptime)}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Heap {status.memory?.heapUsedMB} MB · RSS {status.memory?.rssMB} MB</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>Districts</div>
            <div style={{ fontSize: 13 }}>{status.districts?.files ?? "—"} state files on disk</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>119th Congress</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--muted)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 4 }}>Runtime</div>
            <div style={{ fontSize: 13 }}>{status.node || "—"}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Node.js</div>
          </div>
        </div>
      )}

      {scriptLog != null && (
        <div style={{
          background: "var(--ink)", border: "1px solid var(--line)", padding: "10px 12px",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "var(--bone)",
          maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", lineHeight: 1.5,
          marginTop: 4,
        }} ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}>
          {scriptLog || (scriptRunning ? "Starting…" : "")}
          {scriptRunning && <span className="fec-spin"> ▌</span>}
        </div>
      )}

      <ConnectionsSection />
      <BulkImportSection />
    </div>
  );
}

// ---------- Ask AI: free-text agentic Q&A about one candidate ----------
function AskAI({ candidateId, committeeId, name, party, state, office, cycle, search }) {
  const [q, setQ] = useState("");
  const [lastQ, setLastQ] = useState("");
  const [st, setSt] = useState(null); // null | { loading, status, trace[], answer, citations[], model, at, cached, error }

  const SUGGESTIONS = [
    "Who are this candidate's biggest donors and what industries do they represent?",
    "How much outside money is being spent for or against this candidate?",
    "What has this candidate said about their top issues?",
    "How does their cash on hand compare to what they've raised?",
  ];

  const toolLabel = (t) => ({
    fec_finances: "FEC financials", fec_top_donors: "FEC donors", fec_spending: "FEC spending",
    fec_outside_money: "outside money (Sched. E)", committee_lookup: "committee record",
    tn_records: "TN registry", wikipedia: "Wikipedia", news: "news headlines", web_search: "web search",
  }[t] || t);

  const ask = async (forceRefresh = false) => {
    const question = (forceRefresh ? lastQ : q).trim();
    if (!question) return;
    setLastQ(question);
    setSt({ loading: true, status: "Starting…", trace: [], answer: "", citations: [], error: null });
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId, committeeId, name, party, state, office, cycle: String(cycle), question, forceRefresh }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(body)?.error?.message || msg; } catch { /* body wasn't JSON */ }
        setSt({ loading: false, error: msg, trace: [], answer: "", citations: [] });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const trace = [];
      const apply = (ev) => {
        if (ev.type === "status") setSt((s) => ({ ...s, status: ev.note }));
        else if (ev.type === "step") { trace.push({ tool: ev.tool, running: true }); setSt((s) => ({ ...s, status: `Checking ${toolLabel(ev.tool)}…`, trace: [...trace] })); }
        else if (ev.type === "tool_result") { for (let i = trace.length - 1; i >= 0; i--) if (trace[i].tool === ev.tool && trace[i].running) { trace[i].running = false; trace[i].summary = ev.summary; break; } setSt((s) => ({ ...s, trace: [...trace] })); }
        else if (ev.type === "answer") setSt((s) => ({ ...s, loading: false, status: null, answer: ev.answer, citations: ev.citations || [], sources: ev.sources || [], model: ev.model, at: ev.at, cached: ev.cached, trace: [...trace] }));
        else if (ev.type === "error") setSt((s) => ({ ...s, loading: false, status: null, error: ev.message, trace: [...trace] }));
      };
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          try { apply(JSON.parse(line)); } catch { /* ignore partial/garbage line */ }
        }
      }
      // flush a final event that arrived without a trailing newline
      if (buf.trim()) { try { apply(JSON.parse(buf.trim())); } catch { /* ignore partial line */ } }
      setSt((s) => (s && s.loading ? { ...s, loading: false, status: null } : s));
    } catch (e) {
      setSt((s) => ({ ...(s || {}), loading: false, status: null, error: e.message }));
    }
  };

  return (
    <div className="fec-ask">
      <div className="fec-ask-bar">
        <input
          className="fec-ask-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(false); }}
          placeholder={`Ask anything about ${name}…`}
          aria-label={`Ask AI about ${name}`}
          disabled={st?.loading}
        />
        <button className="fec-btn" onClick={() => ask(false)} disabled={st?.loading || !q.trim()}>
          {st?.loading ? "Researching…" : "Ask"}
        </button>
      </div>

      {search && (
        <div className="fec-ask-status" title={search.configured
          ? `Live web search is on (${search.provider}). Answers can draw on current web pages.`
          : "No web-search key configured — answers use FEC filings, Wikipedia, and news headlines only (no live web search)."}>
          {search.configured
            ? <><span className="fec-dot" style={{ background: "#8A9A5B" }} /> web search: {search.provider}</>
            : <><span className="fec-dot" style={{ background: "#C8723A" }} /> web search: off — FEC, Wikipedia &amp; news only</>}
        </div>
      )}

      {!st && (
        <div className="fec-ask-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="fec-chip" onClick={() => { setQ(s); }}>{s}</button>
          ))}
        </div>
      )}

      {(st?.loading || st?.trace?.length > 0) && (
        <div className="fec-ask-trace">
          {(st.trace || []).map((t, i) => (
            <div key={i} className="fec-ask-step">
              <span className="fec-ask-tool">{t.running ? "▸" : "✓"} {toolLabel(t.tool)}</span>
              {t.summary && <span className="fec-ask-sum"> — {t.summary}</span>}
            </div>
          ))}
          {st?.loading && <div className="fec-ask-step fec-spin">{st.status || "Working…"}</div>}
        </div>
      )}

      {st?.error && <div className="fec-error" style={{ marginTop: 10 }}>Ask AI failed: {st.error}</div>}

      {st?.answer && (
        <div className="fec-ai" style={{ marginTop: 10 }}>
          <AiMeta label="Ask AI" model={st.model} at={st.at} cached={st.cached}
            onRefresh={() => ask(true)} refreshing={st.loading} />
          <AiCaveat>AI-generated from FEC filings{state === "TN" ? ", TN registry" : ""} and live web search — it can be wrong or incomplete. Verify anything important against the cited sources before relying on it.</AiCaveat>
          <div className="fec-ai-text">{st.answer}</div>
          {st.sources?.length > 0 ? (
            <div className="fec-ask-sources">
              <div className="fec-ai-label" style={{ marginBottom: 6 }}>Sources used ({st.sources.length})</div>
              {st.sources.map((s, i) => (
                <div key={i} className="fec-ask-source">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="fec-src-title">
                    <span className="fec-src-kind">{s.kind}</span>{s.title} ↗
                  </a>
                  {s.snippet && <div className="fec-src-snip">{s.snippet}</div>}
                </div>
              ))}
            </div>
          ) : st.citations?.length > 0 ? (
            <div className="fec-profile-links" style={{ marginTop: 10 }}>
              {st.citations.map((c, i) => (
                <a key={i} href={c.url} target="_blank" rel="noopener noreferrer">{c.label} ↗</a>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------- Dossier: inline on-screen rendering ----------
function DossierSec({ title, children }) {
  return <div style={{ marginTop: 18 }}>
    <h3 style={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: 16, color: "var(--brass)", textTransform: "uppercase", letterSpacing: ".06em", borderTop: "1px solid var(--line)", paddingTop: 10, margin: "0 0 8px" }}>{title}</h3>
    {children}
  </div>;
}
function DossierStat({ n, l }) {
  return <div style={{ background: "var(--panel2)", borderRadius: 3, padding: "8px 12px" }}>
    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--brass)" }}>{n}</div>
    <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em", marginTop: 2 }}>{l}</div>
  </div>;
}
function DossierBar({ label, value, max }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, padding: "2px 0" }}>
    <span style={{ flex: "0 0 175px", color: "var(--bone)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    {max != null && <span style={{ flex: 1, background: "var(--ink)", height: 7, borderRadius: 2, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.round((value / (max || 1)) * 100)}%`, background: "var(--olive)" }} /></span>}
    <b style={{ flex: "0 0 56px", textAlign: "right", color: "var(--brass)" }}>{fmtUSDshort(value)}</b>
  </div>;
}
function DossierSources({ sources }) {
  if (!sources?.length) return null;
  return <div style={{ marginTop: 8 }}>{sources.map((s, i) => (
    <div key={i} style={{ fontSize: 11, marginBottom: 3 }}>
      <a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--olive)", textDecoration: "none" }}>[{s.kind}] {s.title} ↗</a>
    </div>))}</div>;
}

function DossierBody({ d }) {
  if (d.kind === "tn") {
    const m = d.money;
    return <>
      <DossierSec title="TN filing history">
        {d.reports?.length > 0
          ? <div className="fec-table-wrap"><table className="fec-table"><tbody>{d.reports.slice(0, 30).map((cells, i) => <tr key={i}>{cells.slice(0, 5).map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
          : <div className="sub">No TN filing history retrieved.</div>}
      </DossierSec>
      {m ? <DossierSec title="Money flows (itemized from filed reports)">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <DossierStat n={fmtUSDshort(m.totalReceived)} l="Received" />
          <DossierStat n={fmtUSDshort(m.totalSpent)} l="Spent" />
        </div>
        <div className="sub" style={{ marginTop: 6 }}>
          {m.reportsRead} of {m.reportsTotal} filed reports read{m.partial ? " (partial)" : ""}
          {m.conduitTotal ? ` · ${fmtUSDshort(m.conduitTotal)} via ${m.conduitCount} conduit gift${m.conduitCount === 1 ? "" : "s"} (WinRed/ActBlue/etc., excluded from donor totals)` : ""}
          {m.note ? ` · ${m.note}` : ""}
        </div>
        {m.analysis && <div className="fec-ai-text" style={{ marginTop: 8 }}>{m.analysis}</div>}
        {m.byTypeReceived?.length > 0 && <><div className="fec-ai-label" style={{ marginTop: 10 }}>Received by donor type</div>
          {m.byTypeReceived.map((t) => <DossierBar key={t.name} label={`${t.name} (${t.count})`} value={t.total} max={m.byTypeReceived[0].total} />)}</>}
        {m.topDonors?.length > 0 && <div className="fec-table-wrap" style={{ marginTop: 10 }}><table className="fec-table">
          <thead><tr><th>Donor</th><th>Gifts</th><th className="amt">Total</th></tr></thead>
          <tbody>{m.topDonors.map((x, i) => <tr key={i}><td>{x.name}</td><td>{x.count}</td><td className="amt">{fmtUSD(x.amount)}</td></tr>)}</tbody>
        </table></div>}
        {m.byTypeSpent?.length > 0 && <><div className="fec-ai-label" style={{ marginTop: 10 }}>Spent by vendor type</div>
          {m.byTypeSpent.map((t) => <DossierBar key={t.name} label={`${t.name} (${t.count})`} value={t.total} max={m.byTypeSpent[0].total} />)}</>}
        {m.topVendors?.length > 0 && <div className="fec-table-wrap" style={{ marginTop: 10 }}><table className="fec-table">
          <thead><tr><th>Vendor</th><th>Payments</th><th className="amt">Total</th></tr></thead>
          <tbody>{m.topVendors.map((x, i) => <tr key={i}><td>{x.name}</td><td>{x.count}</td><td className="amt">{fmtUSD(x.amount)}</td></tr>)}</tbody>
        </table></div>}
        {(m.topDonors?.length > 0 || m.topVendors?.length > 0) && <>
          <div className="fec-ai-label" style={{ marginTop: 12 }}>Money flow map</div>
          <div className="fec-flow-scroll" style={{ minWidth: 0 }}
            dangerouslySetInnerHTML={{ __html: _flowBubblesHTML(d.entity.name, m.topDonors, m.topVendors, { dark: true }) }} />
        </>}
      </DossierSec> : d.moneyError ? <DossierSec title="Money flows"><div className="sub">Money flows unavailable: {d.moneyError}</div></DossierSec> : null}
      <DossierSec title="Background & profile (AI web research)">
        {d.research?.available
          ? <><div className="fec-ai-text">{d.research.answer}</div><DossierSources sources={d.research.sources} /></>
          : <div className="sub">{d.research?.note || "Web research unavailable."}</div>}
      </DossierSec>
    </>;
  }
  const t = d.totals, dn = d.donors, agg = dn?.aggregates;
  return <>
    {t && <DossierSec title="Financial summary">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        <DossierStat n={fmtUSDshort(t.receipts_this_cycle)} l="Raised (cycle)" />
        <DossierStat n={fmtUSDshort(t.disbursements_this_cycle)} l="Spent (cycle)" />
        <DossierStat n={fmtUSDshort(t.cash_on_hand)} l="Cash on hand" />
        <DossierStat n={fmtUSDshort(t.debts_owed)} l="Debts" />
      </div>
      <div className="sub" style={{ marginTop: 6 }}>Receipts/disbursements are this cycle only; cash on hand is a running balance. Coverage through {t.coverage_end_date || "—"}.</div>
    </DossierSec>}
    {dn && <DossierSec title="Donor base">
      <div className="sub">{Number(dn.donorCount || 0).toLocaleString()} donors · {Number(dn.sampleSize || 0).toLocaleString()} of {dn.itemizedCount != null ? Number(dn.itemizedCount).toLocaleString() : "?"} itemized gifts (repeat gifts rolled up; WinRed/ActBlue conduit pass-throughs excluded{dn.conduitTotal ? `, ${fmtUSDshort(dn.conduitTotal)} routed via conduits` : ""}).</div>
      {dn.analysis && <div className="fec-ai-text" style={{ marginTop: 8 }}>{dn.analysis}</div>}
      {agg?.topEmployers?.length > 0 && <><div className="fec-ai-label" style={{ marginTop: 10 }}>Top employers</div>
        {agg.topEmployers.slice(0, 8).map((e) => <DossierBar key={e.name} label={e.name} value={e.amount} max={agg.topEmployers[0].amount} />)}</>}
      {agg && <><div className="fec-ai-label" style={{ marginTop: 10 }}>Geography</div>
        <div style={{ fontSize: 11 }}>In-state ({d.candidate.state || "?"}): <b style={{ color: "var(--brass)" }}>{fmtUSDshort(agg.inStateAmount)}</b> · Out-of-state: <b style={{ color: "var(--brass)" }}>{fmtUSDshort(agg.outOfStateAmount)}</b></div></>}
      {agg?.sizeBuckets && <><div className="fec-ai-label" style={{ marginTop: 10 }}>By check size</div>
        {Object.entries(agg.sizeBuckets).map(([k, v]) => <DossierBar key={k} label={k} value={v} />)}</>}
      {dn.topDonors?.length > 0 && <div className="fec-table-wrap" style={{ marginTop: 10 }}><table className="fec-table">
        <thead><tr><th>Donor</th><th>Employer</th><th>State</th><th>Gifts</th><th className="amt">Total</th></tr></thead>
        <tbody>{dn.topDonors.map((x, i) => <tr key={i}><td><a className="fec-extlink" href={`https://www.fec.gov/data/receipts/?contributor_name=${encodeURIComponent(x.name || "")}&two_year_transaction_period=${d.candidate.cycle}`} target="_blank" rel="noopener noreferrer" title="FEC receipts for this contributor">{x.name} ↗</a></td><td className="sub">{x.employer || ""}</td><td className="sub">{x.state || ""}</td><td>{x.count}</td><td className="amt">{fmtUSD(x.amount)}</td></tr>)}</tbody>
      </table></div>}
    </DossierSec>}
    {d.spending?.top_recipients?.length > 0 && <DossierSec title="Spending (Schedule B)">
      {d.spending.analysis && <div className="fec-ai-text">{d.spending.analysis}</div>}
      <div className="fec-table-wrap" style={{ marginTop: 8 }}><table className="fec-table"><thead><tr><th>Recipient</th><th className="amt">Amount</th></tr></thead>
        <tbody>{d.spending.top_recipients.slice(0, 10).map((r, i) => <tr key={i}><td>{r.name}</td><td className="amt">{fmtUSD(r.amount)}</td></tr>)}</tbody></table></div>
    </DossierSec>}
    {(dn?.topDonors?.length > 0 || d.spending?.top_recipients?.length > 0) && <DossierSec title="Money flow map">
      <div className="sub">Largest itemized donors (left) and largest expenditure recipients (right) — bubble size scales with dollars.</div>
      <div className="fec-flow-scroll" style={{ minWidth: 0, marginTop: 8 }}
        dangerouslySetInnerHTML={{ __html: _flowBubblesHTML(d.candidate.name, dn?.topDonors, d.spending?.top_recipients, { dark: true }) }} />
    </DossierSec>}
    {d.outside && (d.outside.total_spent_FOR_candidate || d.outside.total_spent_AGAINST_candidate)
      ? <DossierSec title="Outside money (Schedule E)">
        <div style={{ fontSize: 12 }}>Spent <b style={{ color: "var(--olive)" }}>FOR</b>: {fmtUSD(d.outside.total_spent_FOR_candidate)} · Spent <b style={{ color: "#C8723A" }}>AGAINST</b>: {fmtUSD(d.outside.total_spent_AGAINST_candidate)}</div>
        {d.outside.outside_spenders?.length > 0 && <div className="fec-table-wrap" style={{ marginTop: 8 }}><table className="fec-table"><thead><tr><th>Spender</th><th className="amt">For</th><th className="amt">Against</th></tr></thead>
          <tbody>{d.outside.outside_spenders.slice(0, 10).map((s, i) => <tr key={i}><td>{s.spender}</td><td className="amt">{fmtUSD(s.support_FOR)}</td><td className="amt">{fmtUSD(s.oppose_AGAINST)}</td></tr>)}</tbody></table></div>}
      </DossierSec> : null}
    <DossierSec title="Background & positions (AI web research)">
      {d.research?.available
        ? <><div className="fec-ai-text">{d.research.answer}</div><DossierSources sources={d.research.sources} /></>
        : <div className="sub">{d.research?.note || "Web research unavailable."}</div>}
    </DossierSec>
  </>;
}

function DossierRoster({ d }) {
  const c = d.candidate;
  const heading = c.office === "H" && c.district ? ` — ${c.state} District ${c.district}` : c.office === "S" ? ` — ${c.state} (Senate)` : "";
  return (
    <div style={{ flex: "1 1 260px", minWidth: 240 }}>
      <div className="fec-ai-label" style={{ marginTop: 0 }}>Candidates in this race{heading} ({d.race.length})</div>
      <div className="fec-table-wrap"><table className="fec-table">
        <thead><tr><th>Candidate</th><th>Party</th><th className="amt">Receipts</th></tr></thead>
        <tbody>{d.race.map((x, i) => (
          <tr key={i} style={x.isSubject ? { background: "var(--panel2)" } : undefined}>
            <td style={x.isSubject ? { color: "var(--brass)", fontWeight: 700 } : undefined}>{x.name}{x.isSubject ? " ◂" : ""}{x.incumbent ? " · INC" : ""}</td>
            <td className="sub">{x.party || ""}</td>
            <td className="amt">{fmtUSD(x.receipts)}</td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

function DossierModal({ dossier, cached, mapHtml, onClose, onRebuild }) {
  const d = dossier;
  const bodyRef = useRef(null);
  const heading = d.kind === "tn" ? d.entity.name : d.candidate.name;
  const metaLine = d.kind === "tn"
    ? "Tennessee Registry of Election Finance"
    : (() => {
        const c = d.candidate;
        if (c.office === "P") return `President · ${c.cycle} cycle`;
        const off = c.office === "H" ? "U.S. House" : c.office === "S" ? "U.S. Senate" : c.office;
        return `${c.party ? c.party + " · " : ""}${off} · ${c.state || ""}${c.office === "H" && c.district && c.district !== "00" ? ` District ${c.district}` : ""} · ${c.cycle} cycle`;
      })();

  // Print the SAME rendered view (dark theme, identical layout) rather than a re-built HTML
  // doc, so the PDF matches the screen exactly. print-color-adjust keeps the dark backgrounds.
  const printView = () => {
    const inner = bodyRef.current?.innerHTML;
    if (!inner) { printDocument(buildDossierHTML(d, mapHtml)); return; } // fallback
    const genDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Dossier — ${escHtml(heading)}</title>
<style>${css}</style>
<style>
  /* Print on white paper: re-map the app's dark theme variables to a light palette so the
     LAYOUT is identical to the on-screen view but ink-friendly. */
  html, body { margin:0; padding:0; background:#fff; }
  * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  .fec-print-wrap {
    --ink:#ECEAE0; --panel:#F7F7F2; --panel2:#EEF1E8; --line:#D6D6CC;
    --bone:#1A1A17; --muted:#666; --brass:#1A5C2E; --olive:#5F7D3A;
    background:#fff; color:#1A1A17;
    font-family:'IBM Plex Mono', ui-monospace, Menlo, monospace; font-size:12px; line-height:1.5;
    padding:22px 26px; max-width:980px; margin:0 auto;
  }
  .fec-print-wrap h1 { font-family:'IBM Plex Sans Condensed', sans-serif; font-weight:700; font-size:26px; margin:0 0 4px; color:#15170F; text-transform:uppercase; letter-spacing:.02em; }
  .fec-print-wrap .meta { color:#666; font-size:11px; margin-bottom:16px; }
  .fec-print-wrap .fec-table th { background:#EEF1E8 !important; color:#444 !important; border-bottom:2px solid #bbb !important; }
  .fec-print-wrap .fec-table td { border-bottom:1px solid #E2E2D8 !important; }
  .fec-print-wrap .fec-ai-text, .fec-print-wrap .sub { color:#333; }
  .fec-print-wrap .fec-table-wrap { overflow:visible !important; }
  .fec-print-wrap table.fec-table th { position:static !important; }
  @media print { .fec-print-wrap { max-width:none; padding:0; } }
</style></head>
<body><div class="fec-root"><div class="fec-print-wrap">
  <h1>${escHtml(heading)} · Dossier</h1>
  <div class="meta">${escHtml(metaLine)} · Generated ${genDate}</div>
  ${inner}
</div></div></body></html>`;
    printDocument(html);
  };

  // Close on Escape; lock background scroll while open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [onClose]);

  // Portal to <body> so position:fixed escapes any ancestor transform/overflow/stacking context.
  return createPortal(
    <div className="fec-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="fec-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fec-modal-head">
          <span className="fec-name">{heading} · Dossier{cached ? " (cached)" : ""}</span>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="fec-btn ghost sm" onClick={printView} title="Print or save the dossier as a PDF (matches this view)">🖨 Print / Save PDF</button>
            <button className="fec-btn ghost sm" onClick={onRebuild} title="Rebuild from fresh data (bypasses cache)">↺ Rebuild</button>
            <button className="fec-btn ghost sm" onClick={onClose}>✕ Close</button>
          </span>
        </div>
        <div className="fec-modal-body" ref={bodyRef}>
          {(mapHtml || d.race?.length > 0) && (
            <div className="fec-dossier-top">
              {mapHtml && <div dangerouslySetInnerHTML={{ __html: mapHtml }} />}
              {d.race?.length > 0 && <DossierRoster d={d} />}
            </div>
          )}
          <DossierBody d={d} />
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------- Print Dossier button ----------
// Streams a comprehensive report from the server, renders it inline (modal), and offers print.
function DossierButton({ endpoint, payload, sm }) {
  const [st, setSt] = useState(null); // null | {running,phase} | {error}
  const [doc, setDoc] = useState(null); // { dossier, cached } → inline modal
  const run = async (forceRefresh = false) => {
    setSt({ running: true, phase: "Starting…" });
    try {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, forceRefresh }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(body)?.error?.message || msg; } catch { /* body wasn't JSON */ }
        setSt({ error: msg });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", dossier = null, cached = false, error = null;
      const apply = (ev) => {
        if (ev.type === "phase" || ev.type === "status") setSt({ running: true, phase: ev.note });
        else if (ev.type === "step") setSt({ running: true, phase: `Researching: ${ev.tool}…` });
        else if (ev.type === "dossier") { dossier = ev.dossier; cached = ev.cached; }
        else if (ev.type === "error") error = ev.message;
      };
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (line) { try { apply(JSON.parse(line)); } catch { /* ignore */ } }
        }
      }
      // flush a final event that arrived without a trailing newline
      if (buf.trim()) { try { apply(JSON.parse(buf.trim())); } catch { /* ignore */ } }
      if (error) { setSt({ error }); return; }
      if (dossier) {
        // grab the on-screen district map (House races) while it's still visible behind the modal
        const c = dossier.candidate;
        const mapLabel = c ? `${c.state || ""}${c.office === "H" && c.district && c.district !== "00" ? ` · District ${c.district}` : ""}` : "";
        const mapHtml = dossier.kind === "federal" ? captureDistrictMapHtml(mapLabel) : "";
        setSt(null); setDoc({ dossier, cached, mapHtml }); // render inline; print is a button inside
      }
      else setSt({ error: "No dossier was produced." });
    } catch (e) { setSt({ error: e.message }); }
  };
  return (
    <span className="fec-dossier">
      <button className={`fec-btn ghost${sm ? " sm" : ""}`} onClick={() => run(false)} disabled={st?.running}
        title="Build a full dossier — financials, top-1,000 donors with charts, spending, outside money, and AI web research. Shows on screen and is printable. Cached after the first run.">
        {st?.running ? "Building…" : "🖨 Dossier"}
      </button>
      {st?.running && <span className="fec-dossier-msg fec-spin">{st.phase}</span>}
      {st?.error && <span className="fec-dossier-msg" style={{ color: "#C8723A" }}>Dossier failed: {st.error}</span>}
      {doc && <DossierModal dossier={doc.dossier} cached={doc.cached} mapHtml={doc.mapHtml} onClose={() => setDoc(null)}
        onRebuild={() => { setDoc(null); run(true); }} />}
    </span>
  );
}

// ---------- main app ----------
export default function App() {
  const [cycle, setCycle] = useState(2026);
  const [office, setOffice] = useState("H");
  const [state, setState] = useState("TN");
  const [district, setDistrict] = useState("01");
  const [party, setParty] = useState("");
  const [hidePaper, setHidePaper] = useState(true);
  const [view, setViewRaw] = useState("money");
  // Donors and Tennessee stay mounted once opened, so switching tabs no longer throws away a
  // search in progress (and no longer re-fetches everything when you come back).
  const [visited, setVisited] = useState({});
  const setView = (v) => { setViewRaw(v); setVisited((p) => (p[v] ? p : { ...p, [v]: true })); };
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("fec-theme") || ""; } catch { return ""; } });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    try { if (theme) localStorage.setItem("fec-theme", theme); else localStorage.removeItem("fec-theme"); } catch { /* private mode */ }
  }, [theme]);
  const isLight = theme ? theme === "light" : (typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches);
  const [tnSeed, setTnSeed] = useState(null); // Donors-tab drill-through: {name, t} → TN entity search
  const [donorSeed, setDonorSeed] = useState(null); // ledger drill-through: {name, t} → Donors-tab search
  const jumpToDonor = (nm) => { setDonorSeed({ name: nm, t: Date.now() }); setView("donors"); };

  const [showAdmin, setShowAdmin] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  useEffect(() => { // badge on load without opening the panel
    fetch("/api/alerts").then((r) => r.json()).then((d) => setAlertCount(d.unseen || 0)).catch(() => {});
  }, []);
  const [memberRefreshKey, setMemberRefreshKey] = useState(0);
  const [health, setHealth] = useState(null);
  const [ollama, setOllama] = useState(null);
  const [modelSaved, setModelSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const changeModel = async (model) => {
    setOllama((o) => ({ ...o, configuredModel: model, modelAvailable: (o?.models || []).includes(model) }));
    try {
      const res = await fetch("/api/settings/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (res.ok) {
        setModelSaved(true);
        setTimeout(() => setModelSaved(false), 2500);
      }
    } catch { /* header keeps optimistic value; next health poll corrects it */ }
  };

  const [candidates, setCandidates] = useState(null);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState({});
  const [totals, setTotals] = useState({});

  const [race, setRace] = useState(null);
  const [raceCachedAt, setRaceCachedAt] = useState(null); // epoch ms from x-cached-at header
  const [openLedgers, setOpenLedgers] = useState({}); // candidateId → target obj | {loading:true}
  const [askOpen, setAskOpen] = useState({}); // candidateId → bool (Ask-AI panel open)
  const [flowOpen, setFlowOpen] = useState({}); // candidateId → {committeeId} | {loading:true} (money-flow graph)
  const [patternOpen, setPatternOpen] = useState({}); // candidateId → {committeeId} | {loading:true} (timing clusters)
  const [compareSel, setCompareSel] = useState({}); // candidateId → target for ⇄ shared-donor comparison
  const [overlap, setOverlap] = useState(null); // null | {loading} | {data, allCycles} | {error}
  const [candWatch, setCandWatch] = useState({ loading: true, candidates: [] }); // tracked federal candidates
  const [cwOverride, setCwOverride] = useState({}); // candId -> bool, optimistic
  const [cwRefreshing, setCwRefreshing] = useState(false);
  const [candSeek, setCandSeek] = useState(null); // set after filter changes → auto-runs searchMoney
  const [candTrends, setCandTrends] = useState({}); // candId -> filing-period totals (sparklines)

  const loadCandWatch = async () => {
    try {
      const res = await fetch("/api/candidates/watchlist");
      const data = await res.json().catch(() => null);
      if (res.ok) { setCandWatch({ candidates: data?.candidates || [] }); setCwOverride({}); }
    } catch { /* section renders from last state */ }
  };
  useEffect(() => { loadCandWatch(); }, []);
  const cwIds = new Set((candWatch.candidates || []).map((w) => w.candId));
  const cwHas = (id) => (cwOverride[id] != null ? cwOverride[id] : cwIds.has(id));
  const trackCand = async (r) => {
    const cid = r.candidate_id;
    try {
      await fetch("/api/candidates/watch", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ candId: cid, name: r.candidate_name, party: r.party_full || "",
          state: office === "P" ? "" : state, office, district: office === "H" ? district : "", pcc: r.candidate_pcc_id || "" }) });
      setCwOverride((p) => ({ ...p, [cid]: true }));
      loadCandWatch();
    } catch { /* best-effort */ }
  };
  const untrackCand = async (cid) => {
    try { await fetch(`/api/candidates/watch?id=${encodeURIComponent(cid)}`, { method: "DELETE" }); } catch { /* reload corrects */ }
    setCwOverride((p) => ({ ...p, [cid]: false }));
    loadCandWatch();
  };
  const openTrackedCand = (w) => {
    if (w.office) setOffice(w.office);
    if (w.office !== "P" && w.state) setState(w.state);
    if (w.office === "H" && w.district) setDistrict(String(w.district).padStart(2, "0"));
    setView("money");
    fetch("/api/candidates/watch/seen", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ candId: w.candId }) }).then(() => loadCandWatch()).catch(() => { /* badge clears later */ });
    setCandSeek(Date.now()); // filters just changed — the effect below runs the search once they settle
  };
  const refreshCandWatch = async () => {
    setCwRefreshing(true);
    try {
      const res = await fetch("/api/candidates/watchlist/refresh", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.candidates) setCandWatch({ candidates: data.candidates });
    } finally { setCwRefreshing(false); }
  };
  // (candSeek + trends effects live below searchMoney's definition — it's a const, TDZ applies)

  const closeLedger = (candidateId) =>
    setOpenLedgers((prev) => { const n = { ...prev }; delete n[candidateId]; return n; });

  const openLedger = (candidateId, target) =>
    setOpenLedgers((prev) => ({ ...prev, [candidateId]: target }));

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ status: "down" }));
    fetch("/api/ollama/health").then((r) => r.json()).then(setOllama).catch(() => setOllama({ status: "down" }));
  }, []);

  // keep district valid when state or cycle changes the seat count
  useEffect(() => {
    if (district === "") return;
    const n = seatsFor(state, cycle);
    if (n <= 1) { if (district !== "00") setDistrict("00"); return; }
    if (district === "00" || Number(district) > n) setDistrict("01");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, cycle]);

  // keep the cycle valid for the chosen office (and state, for Senate) — e.g. President only
  // elects every 4 years, and a given state only elects a senator in its two class-years; snap
  // to the most recent valid "last known" cycle when the current one doesn't apply.
  useEffect(() => {
    const valid = cyclesForOffice(office, state);
    if (!valid.length || valid.includes(cycle)) return;
    setCycle(valid.find((y) => y <= cycle) ?? valid[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office, state]);

  const searchField = useCallback(async (pageNum = 1) => {
    setLoading(true); setError(null); setOpen({}); setTotals({}); setOpenLedgers({});
    const params = { election_year: String(cycle), office, sort: "name", per_page: "50", page: String(pageNum) };
    if (office !== "P") params.state = state;
    if (office === "H" && district) params.district = district;
    if (party) params.party = party;
    if (hidePaper) params.has_raised_funds = "true";
    try {
      const data = await fecGet("candidates/search/", params);
      setCandidates(data.results || []);
      setPagination(data.pagination || null);
      setPage(pageNum);
    } catch (e) {
      setError(e.message); setCandidates(null); setPagination(null);
    } finally { setLoading(false); }
  }, [cycle, office, state, district, party, hidePaper]);

  const searchMoney = useCallback(async (forceRefresh = false) => {
    if (office === "H" && !district) {
      setRace(null); setOpenLedgers({});
      setError("Money race needs a specific district — the FEC /elections/ endpoint reports one race per query, and pulling every district separately would burn through the API rate limit. Pick a district above, or switch to The Field tab, which supports all-district candidate listings statewide.");
      return;
    }
    setLoading(true); setError(null); setOpenLedgers({}); setRaceCachedAt(null);
    setFlowOpen({}); setPatternOpen({}); setCompareSel({}); setOverlap(null); // race is changing — stale comparisons/graphs would mislead
    const officeWord = { H: "house", S: "senate", P: "president" }[office];
    const params = { cycle: String(cycle), office: officeWord, per_page: "50", sort: "-total_receipts" };
    if (office !== "P") params.state = state;
    if (office === "H") params.district = district;
    if (forceRefresh) params._refresh = "1";
    try {
      const qs = new URLSearchParams(params);
      const res = await fetch(`/api/fec/elections/?${qs}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || data?.message || `Request failed (HTTP ${res.status}).`);
      // surface cache age so UI can show "as of X ago" + offer refresh
      const cachedAtHdr = res.headers.get("x-cached-at");
      setRaceCachedAt(cachedAtHdr ? Number(cachedAtHdr) : null);
      let rows = data.results || [];
      if (party) {
        const prefix = { DEM: "DEMOCRAT", REP: "REPUBLIC", IND: "INDEPEND", LIB: "LIBERTAR", GRE: "GREEN", CON: "CONSTITU", NPA: "NO PARTY" }[party] || party;
        rows = rows.filter((r) => (r.party_full || "").toUpperCase().startsWith(prefix));
      }
      if (hidePaper) rows = rows.filter((r) => (r.total_receipts || 0) > 0);
      setRace(rows);
    } catch (e) {
      setError(e.message); setRace(null);
    } finally { setLoading(false); }
  }, [cycle, office, state, district, party, hidePaper]);

  const run = (forceRefresh = false) => (view === "money" ? searchMoney(forceRefresh) : searchField(1));

  // Open ▸ on a tracked candidate: debounce until the filter state (and searchMoney's closure)
  // has settled, then run the race search once.
  useEffect(() => {
    if (!candSeek) return;
    const t = setTimeout(() => { setCandSeek(null); searchMoney(); }, 60);
    return () => clearTimeout(t);
  }, [candSeek, searchMoney]);

  // sparkline feed: filing-period totals for the visible race (accrues from every pull)
  useEffect(() => {
    if (!race?.length) { setCandTrends({}); return; }
    let live = true;
    (async () => {
      try {
        const ids = race.map((r) => r.candidate_id).join(",");
        const d = await fetch(`/api/candidates/trends?ids=${encodeURIComponent(ids)}`).then((r) => r.json());
        if (live) setCandTrends(d?.trends || {});
      } catch { /* sparklines just don't render */ }
    })();
    return () => { live = false; };
  }, [race]);

  const toggleTotals = async (cid) => {
    const nowOpen = !open[cid];
    setOpen((o) => ({ ...o, [cid]: nowOpen }));
    if (!nowOpen || totals[cid]?.data !== undefined || totals[cid]?.loading) return;
    setTotals((t) => ({ ...t, [cid]: { loading: true } }));
    try {
      const data = await fecGet(`candidate/${cid}/totals/`, { cycle: String(cycle) });
      setTotals((t) => ({ ...t, [cid]: { data: (data.results && data.results[0]) || false } }));
    } catch (e) {
      setTotals((t) => ({ ...t, [cid]: { error: e.message } }));
    }
  };

  // ⇄ shared-donor comparison: tick 2-6 race rows, then compare their donor lists
  const toggleCompare = (r) => {
    const cid = r.candidate_id;
    setCompareSel((p) => {
      const n = { ...p };
      if (n[cid]) delete n[cid];
      else if (Object.keys(n).length < 6) n[cid] = { name: r.candidate_name, candidateId: cid, committeeId: r.candidate_pcc_id || "" };
      return n;
    });
  };

  const runOverlap = async (allCycles = false, mode = "donors") => {
    const targets = Object.values(compareSel);
    if (targets.length < 2) return;
    setOverlap({ loading: true });
    try {
      // stored rows key on committee id — resolve any target that's missing its principal committee
      const resolved = await Promise.all(targets.map(async (t) => {
        if (t.committeeId) return t;
        try {
          const data = await fecGet("candidates/search/", { candidate_id: t.candidateId, per_page: "1" });
          return { ...t, committeeId: data.results?.[0]?.principal_committees?.[0]?.committee_id || "" };
        } catch { return t; }
      }));
      const res = await fetch("/api/donors/overlap", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ targets: resolved, cycle: allCycles ? "" : String(cycle), mode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || `Overlap failed (HTTP ${res.status})`);
      setOverlap({ data, allCycles, mode });
    } catch (e) { setOverlap({ error: e.message }); }
  };

  // Toggle a per-row committee panel (flow graph / timing patterns) — resolves the principal
  // committee via candidates/search when the elections row doesn't carry it.
  const toggleCommitteePanel = async (r, openMap, setOpenMap, what) => {
    const cid = r.candidate_id;
    if (openMap[cid]) { setOpenMap((p) => { const n = { ...p }; delete n[cid]; return n; }); return; }
    let committeeId = r.candidate_pcc_id;
    if (!committeeId) {
      setOpenMap((p) => ({ ...p, [cid]: { loading: true } }));
      try {
        const data = await fecGet("candidates/search/", { candidate_id: cid, per_page: "1" });
        committeeId = data.results?.[0]?.principal_committees?.[0]?.committee_id;
      } catch { /* fall through */ }
      if (!committeeId) {
        setOpenMap((p) => { const n = { ...p }; delete n[cid]; return n; });
        setError(`No principal committee on file for ${r.candidate_name} — ${what}.`);
        return;
      }
    }
    setOpenMap((p) => ({ ...p, [cid]: { committeeId } }));
  };
  const toggleFlows = (r) => toggleCommitteePanel(r, flowOpen, setFlowOpen, "no flows to draw");
  const togglePatterns = (r) => toggleCommitteePanel(r, patternOpen, setPatternOpen, "no giving patterns to scan");

  // Toggle inline donor ledger for a money-race row
  const openDonorsFromRace = async (r) => {
    const cid = r.candidate_id;
    if (openLedgers[cid]) { closeLedger(cid); return; }
    let committeeId = r.candidate_pcc_id;
    if (!committeeId) {
      openLedger(cid, { loading: true });
      try {
        const data = await fecGet("candidates/search/", { candidate_id: cid, per_page: "1" });
        committeeId = data.results?.[0]?.principal_committees?.[0]?.committee_id;
      } catch { /* fall through */ }
    }
    if (!committeeId) {
      closeLedger(cid);
      setError(`No principal committee on file for ${r.candidate_name} — nothing to itemize.`);
      return;
    }
    setError(null);
    openLedger(cid, { name: r.candidate_name, party: r.party_full, committeeId, candidateId: cid });
  };

  const exportRaceCSV = () => {
    downloadCSV(
      `money_race_${state}_${office}${office === "H" ? `-${district}` : ""}_${cycle}.csv`,
      ["candidate_name", "candidate_id", "party", "incumbent_challenge", "total_receipts", "total_disbursements", "cash_on_hand"],
      race.map((r) => [r.candidate_name, r.candidate_id, r.party_full, r.incumbent_challenge_full, r.total_receipts, r.total_disbursements, r.cash_on_hand_end_period])
    );
  };

  const exportRacePDF = () => {
    if (!race?.length) return;
    const officeWord = { H: "U.S. House", S: "U.S. Senate", P: "President" }[office];
    const fmtD = (n) => n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
    const where = office === "P" ? "national" : `${state}${office === "H" && district ? ` · district ${district}` : ""}`;
    const rowsHtml = race.map((r) => `
      <tr>
        <td><b>${escHtml(r.candidate_name)}</b><div class="sub">${escHtml(r.candidate_id)}${r.incumbent_challenge_full === "Incumbent" ? " · INC" : ""}</div></td>
        <td>${escHtml(r.party_full || "—")}</td>
        <td class="amt">${fmtD(r.total_receipts)}</td>
        <td class="amt">${fmtD(r.total_disbursements)}</td>
        <td class="amt">${fmtD(r.cash_on_hand_end_period)}</td>
      </tr>`).join("");
    const body = `
      <table>
        <thead><tr><th>Candidate</th><th>Party</th><th class="amt">Receipts</th><th class="amt">Disbursements</th><th class="amt">Cash on hand</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    printDocument(reportShell({
      title: `Money Race — ${where}`,
      metaLine: `${cycle} · ${officeWord} · ${race.length} funded candidate${race.length === 1 ? "" : "s"}`,
      bodyHtml: body,
    }));
  };

  const exportFieldCSV = () => {
    if (!candidates?.length) return;
    downloadCSV(
      `field_${state}_${office}${office === "H" && district ? `-${district}` : ""}_${cycle}.csv`,
      ["candidate_name", "candidate_id", "party", "incumbent_challenge", "principal_committee"],
      candidates.map((c) => [c.name, c.candidate_id, c.party_full || c.party, c.incumbent_challenge_full, c.principal_committees?.[0]?.name || ""])
    );
  };

  const officeLabel = { H: "U.S. House", S: "U.S. Senate", P: "President" }[office];
  const raceMax = race?.length
    ? Math.max(...race.flatMap((r) => [r.total_receipts || 0, r.cash_on_hand_end_period || 0]), 1)
    : 1;

  return (
    <div className="fec-root">
      <style>{css}</style>
      <header className="app-bar">
        <div className="app-bar-in">
          <a className="app-brand" href="/" onClick={(e) => { e.preventDefault(); setView("money"); }} title="FEC Records Terminal">
            <svg className="app-mark" viewBox="0 0 26 26" aria-hidden="true">
              <rect x="1" y="1" width="24" height="24" rx="6" fill="var(--brass)" />
              <path d="M7 18.5V7.5h9.5M7 13h7.5M19.5 12v7M16.8 16.3l2.7 2.7 2.7-2.7" fill="none" stroke="var(--brass-ink)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span><b>Records Terminal</b><small>FEC and Tennessee campaign money</small></span>
          </a>
          <nav className="app-nav" role="tablist" aria-label="Sections">
            <button role="tab" aria-selected={view === "money"} onClick={() => setView("money")}>Money race</button>
            <button role="tab" aria-selected={view === "field"} onClick={() => setView("field")}>The field</button>
            <button role="tab" aria-selected={view === "donors"} onClick={() => setView("donors")}>Donors</button>
            <button role="tab" aria-selected={view === "tn"} onClick={() => setView("tn")}>Tennessee</button>
          </nav>
          <div className="app-tools">
            <span className="status-pill" title={health?.status === "ok"
              ? `FEC proxy online · ${health.keyConfigured ? "custom key" : "DEMO_KEY — set FEC_API_KEY"} — details in Admin`
              : "FEC proxy unreachable — details in Admin"}>
              <span className="fec-dot" style={{ background: health?.status === "ok" ? "var(--olive)" : "var(--rose)" }} /><span className="lbl">FEC</span>
            </span>
            <span className="status-pill" title={ollama?.status === "ok"
              ? `Ollama online · ${ollama.configuredModel || ""} — change models in Admin`
              : "Ollama offline — AI analysis disabled"}>
              <span className="fec-dot" style={{ background: ollama?.status === "ok" ? "var(--olive)" : "var(--muted)" }} /><span className="lbl">AI</span>
            </span>
            <button className={`icon-btn${alertCount ? " on" : ""}`} onClick={() => setShowAlerts((v) => !v)}
              aria-label={alertCount ? `Alerts, ${alertCount} new` : "Alerts"} title="Alerts">🔔{alertCount ? ` ${alertCount}` : ""}</button>
            <button className="icon-btn" onClick={() => setTheme(isLight ? "dark" : "light")}
              aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"} title={isLight ? "Dark theme" : "Light theme"}>{isLight ? "☾" : "☀"}</button>
            <button className={`icon-btn${showAdmin ? " on" : ""}`} onClick={() => setShowAdmin((v) => !v)} title="Status, data sources, models, storage">⚙ Admin</button>
          </div>
        </div>
      </header>
      <div className="fec-wrap">

        {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} onMembersRefreshed={() => setMemberRefreshKey((k) => k + 1)} />}
        {showAlerts && <AlertsPanel onClose={() => setShowAlerts(false)} onCount={setAlertCount} />}

        <QuickFind
          onRace={(c) => {
            if (c.office) setOffice(c.office);
            if (c.office !== "P" && c.state) setState(c.state);
            if (c.office === "H" && c.district) setDistrict(String(c.district).padStart(2, "0"));
            setView("money");
            setCandSeek(Date.now());
          }}
          onDonorsTab={() => setView("donors")}
        />

        <section className="fec-controls" aria-label="Search filters" style={{ display: view === "tn" || view === "donors" ? "none" : undefined }}>
          <div className="fec-field">
            <label htmlFor="f-cycle">Cycle</label>
            <select id="f-cycle" value={cycle} onChange={(e) => setCycle(Number(e.target.value))}>
              {cyclesForOffice(office, state).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="f-office">Office</label>
            <select id="f-office" value={office} onChange={(e) => setOffice(e.target.value)}>
              <option value="H">U.S. House</option>
              <option value="S">U.S. Senate</option>
              <option value="P">President</option>
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="f-state">State</label>
            <select id="f-state" value={state} disabled={office === "P"} onChange={(e) => setState(e.target.value)}>
              {STATES.map(([ab, nm]) => <option key={ab} value={ab}>{ab} — {nm}</option>)}
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="f-district">District</label>
            <select id="f-district" value={district} disabled={office !== "H"} onChange={(e) => setDistrict(e.target.value)}>
              <option value="">All districts</option>
              {seatsFor(state, cycle) <= 1
                ? <option value="00">00 (at-large)</option>
                : Array.from({ length: seatsFor(state, cycle) }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
            </select>
          </div>
          <div className="fec-field">
            <label htmlFor="f-party">Party</label>
            <select id="f-party" value={party} onChange={(e) => setParty(e.target.value)}>
              {PARTIES.map(([v, nm]) => <option key={v || "all"} value={v}>{nm}</option>)}
            </select>
          </div>
          <div className="fec-actions">
            <button className="fec-btn" onClick={() => run()} disabled={loading}>
              {loading ? "Querying…" : "Pull records"}
            </button>
            <label className="fec-check">
              <input type="checkbox" checked={hidePaper} onChange={(e) => setHidePaper(e.target.checked)} />
              Hide paper candidates (no funds raised)
            </label>
          </div>
        </section>

        {view !== "tn" && view !== "donors" && office === "H" && (
          <DistrictMap
            state={state} district={district} cycle={cycle} office={office}
            onSelect={(cd) => setDistrict(cd.padStart(2, "0"))}
            memberRefreshKey={memberRefreshKey}
          />
        )}

        {visited.tn && (
          <div style={{ display: view === "tn" ? undefined : "none" }}>
            <TennesseeHub
              seed={tnSeed}
              registry={<TnPanel seed={tnSeed} />}
              onOpenEntity={(name) => setTnSeed({ name, t: Date.now() })}
              onOpenDonor={jumpToDonor}
              onOpenRace={({ office: o, district: d, cycle: cy }) => {
                setOffice(o); setState("TN"); if (cy) setCycle(cy);
                if (o === "H" && d) setDistrict(String(d).padStart(2, "0"));
                setView("money");
                setCandSeek(Date.now());
              }}
            />
          </div>
        )}

        {visited.donors && (
          <div style={{ display: view === "donors" ? undefined : "none" }}>
            <DonorsPanel seed={donorSeed} onDrillTn={(name) => { setTnSeed({ name, t: Date.now() }); setView("tn"); }} />
          </div>
        )}

        {view !== "tn" && view !== "donors" && error && <div className="fec-error" role="alert">{error}</div>}


        {/* ---------- tracked federal candidates ---------- */}
        {view === "money" && (candWatch.candidates || []).length > 0 && (
          <section className="fec-controls" style={{ marginTop: 16, display: "block" }} aria-label="Tracked candidates">
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="fec-ai-label" style={{ marginBottom: 0 }}>Tracked candidates</span>
              <span style={{ marginLeft: "auto" }}>
                <button className="fec-btn ghost sm" onClick={refreshCandWatch} disabled={cwRefreshing}
                  title="Pull fresh totals + top receipts for every tracked candidate">
                  {cwRefreshing ? "Checking…" : "↺ Check all tracked"}
                </button>
              </span>
            </div>
            <div className="fec-table-wrap" style={{ marginTop: 10 }}>
              <table className="fec-table">
                <thead><tr><th>Candidate</th><th>Race</th><th className="amt">Latest receipts</th><th>Changes</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {candWatch.candidates.map((w) => (
                    <tr key={w.candId}>
                      <td><b style={{ color: "var(--bone)" }}>{w.name}</b><div className="sub">{w.party || "—"}</div></td>
                      <td className="sub">{w.office === "P" ? "President" : w.office === "S" ? `${w.state} Senate` : `${w.state}-${w.district || "?"}`}</td>
                      <td className="amt">
                        {w.latest ? fmtUSDshort(w.latest.receipts || 0) : "—"}
                        {w.latest?.coverageEnd && <div className="sub">thru {w.latest.coverageEnd}</div>}
                      </td>
                      <td>
                        {w.deltaReceipts > 0 && <div style={{ color: "var(--brass)", fontWeight: 700 }}>▲ +{fmtUSDshort(w.deltaReceipts)} since last look</div>}
                        {w.newRows > 0 && <div style={{ color: "var(--brass)" }}>▲ {w.newRows} new gift{w.newRows === 1 ? "" : "s"} stored</div>}
                        {!(w.deltaReceipts > 0) && !(w.newRows > 0) && <span className="sub">—</span>}
                      </td>
                      <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                        <button className="fec-btn ghost sm" onClick={() => openTrackedCand(w)}
                          title="Load this candidate's race (marks changes as seen)">Open ▸</button>
                        {" "}
                        <button className="fec-btn ghost sm" onClick={() => untrackCand(w.candId)} title="Stop tracking">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ---------- MONEY RACE ---------- */}
        {view === "money" && race && !error && (
          <>
            <div className="fec-status">
              <span>
                {race.length} funded candidate{race.length === 1 ? "" : "s"} · {cycle} · {officeLabel}
                {office === "S" && ` · ${state} (state-wide)`}
                {office === "H" && ` · ${state}`}{office === "H" && district && ` · district ${district}`}
                {office === "P" && <span style={{ color: "var(--sub)", fontSize: 11 }}> · national totals — state filter not applied</span>}
                {raceCachedAt && (
                  <span style={{ color: "var(--muted)", fontSize: 11 }}> · cached {timeAgo(raceCachedAt)}</span>
                )}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {raceCachedAt && (
                  <button className="fec-btn ghost" style={{ fontSize: 11, padding: "3px 10px" }}
                    onClick={() => searchMoney(true)} disabled={loading} title="Bypass cache and pull fresh data from FEC">
                    ↺ Refresh
                  </button>
                )}
                <button className="fec-btn ghost" onClick={() => runOverlap(false)}
                  disabled={Object.keys(compareSel).length < 2 || overlap?.loading}
                  title="Tick ⇄ on two or more rows, then compare their donor lists — who funds both?">
                  {overlap?.loading ? "Comparing…" : `⇄ Shared donors${Object.keys(compareSel).length ? ` (${Object.keys(compareSel).length})` : ""}`}
                </button>
                <button className="fec-btn ghost" onClick={exportRaceCSV} disabled={!race.length}>Export CSV ({race.length})</button>
                <button className="fec-btn ghost" onClick={exportRacePDF} disabled={!race.length}
                  title="Export the race standings (with map) as a printable PDF">Export PDF</button>
              </span>
            </div>
            {(overlap?.data || overlap?.error) && (
              <OverlapPanel ov={overlap} onClose={() => setOverlap(null)} onRerun={runOverlap} />
            )}
            {race.length === 0 && <div className="fec-empty">No financial activity on file for this race yet.</div>}
            <div className="fec-race">
              {race.map((r) => {
                const cid = r.candidate_id;
                const ledger = openLedgers[cid];
                return (
                <Fragment key={cid}>
                  <div className="fec-race-row" style={{ "--pc": partyColor(r.party_full) }}>
                    <div className="fec-race-name">
                      {r.candidate_name}
                      {candTrends[cid]?.length > 1 && <span style={{ marginLeft: 8, verticalAlign: "middle" }}><Spark points={candTrends[cid]} /></span>}
                      <small>{r.party_full || "—"} · {cid}{r.incumbent_challenge_full === "Incumbent" ? " · INC" : ""}
                        {" · "}<a href={`https://www.fec.gov/data/candidate/${cid}/`} target="_blank" rel="noopener noreferrer" className="fec-extlink" title="FEC filings for this candidate">FEC ↗</a>
                      </small>
                    </div>
                    <div className="fec-bars">
                      <div className="fec-barline">
                        <div className="fec-bartrack">
                          <div className="fec-barfill rec" style={{ width: `${Math.min(((r.total_receipts || 0) / raceMax) * 100, 100)}%` }} />
                        </div>
                        <div className="fec-barval">{fmtUSDshort(r.total_receipts)}</div>
                      </div>
                      <div className="fec-barline">
                        <div className="fec-bartrack">
                          <div className="fec-barfill coh" style={{ width: `${Math.min(((r.cash_on_hand_end_period || 0) / raceMax) * 100, 100)}%` }} />
                        </div>
                        <div className="fec-barval">{fmtUSDshort(r.cash_on_hand_end_period)}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
                      {cwHas(cid)
                        ? <button className="fec-btn ghost sm" onClick={() => untrackCand(cid)} title="Stop tracking this candidate">★</button>
                        : <button className="fec-btn ghost sm" onClick={() => trackCand(r)} title="Track — new filings and gifts get flagged at the top of this tab">☆</button>}
                      <label className="fec-check" style={{ fontSize: 12, gap: 4 }}
                        title="Select for ⇄ shared-donor comparison (pick 2-6 rows, then hit ⇄ Shared donors above)">
                        <input type="checkbox" checked={!!compareSel[cid]} onChange={() => toggleCompare(r)} />⇄
                      </label>
                      <button className="fec-btn ghost" onClick={() => openDonorsFromRace(r)}
                        disabled={ledger?.loading}>
                        {ledger?.loading ? "…" : ledger ? "Close ▾" : "Donors ▸"}
                      </button>
                      <button className="fec-btn ghost" onClick={() => toggleFlows(r)} disabled={flowOpen[cid]?.loading}
                        title="Money-flow graph — who funds this committee, where its money goes, and where its donors also give">
                        {flowOpen[cid]?.loading ? "…" : flowOpen[cid] ? "Close ▾" : "Flows ▸"}
                      </button>
                      <button className="fec-btn ghost" onClick={() => togglePatterns(r)} disabled={patternOpen[cid]?.loading}
                        title="Same-day giving clusters — fundraiser events, workplace bundling, max-out days">
                        {patternOpen[cid]?.loading ? "…" : patternOpen[cid] ? "Close ▾" : "Patterns ▸"}
                      </button>
                      <button className="fec-btn ghost" onClick={() => setAskOpen((p) => ({ ...p, [cid]: !p[cid] }))}
                        aria-expanded={!!askOpen[cid]} title="Ask the AI a free-text question about this candidate">
                        {askOpen[cid] ? "Close ▾" : "Ask AI ▸"}
                      </button>
                      <DossierButton endpoint="/api/dossier" payload={{
                        candidateId: cid, committeeId: r.candidate_pcc_id || "", name: r.candidate_name,
                        party: r.party_full || "", state: office === "P" ? "" : state, office, cycle,
                        district: office === "H" ? district : "",
                      }} />
                    </div>
                  </div>
                  {askOpen[cid] && (
                    <AskAI
                      candidateId={cid}
                      committeeId={r.candidate_pcc_id || ""}
                      name={r.candidate_name}
                      party={r.party_full || ""}
                      state={office === "P" ? "" : state}
                      office={office}
                      cycle={cycle}
                      search={ollama?.search}
                    />
                  )}
                  {flowOpen[cid]?.committeeId && (
                    <FlowGraph key={`${cid}-${flowOpen[cid].committeeId}`}
                      committeeId={flowOpen[cid].committeeId} name={r.candidate_name} cycle={cycle} />
                  )}
                  {patternOpen[cid]?.committeeId && (
                    <PatternsPanel key={`pat-${cid}-${patternOpen[cid].committeeId}`}
                      committeeId={patternOpen[cid].committeeId} candidateId={cid}
                      name={r.candidate_name} cycle={cycle} raceState={office === "P" ? "" : state} />
                  )}
                  {ledger?.committeeId && (
                    <DonorLedger
                      target={ledger}
                      cycle={cycle}
                      raceState={office === "P" ? "" : state}
                      onClose={() => closeLedger(cid)}
                      onDonorInfo={jumpToDonor}
                    />
                  )}
                </Fragment>
              );})}
            </div>
            {race.length > 0 && (
              <div className="fec-legend">
                <span><span className="fec-sw" /> total receipts</span>
                <span><span className="fec-sw hatch" /> cash on hand (incl. carryover)</span>
                <span>bars scaled to largest value in race</span>
              </div>
            )}
          </>
        )}

        {/* ---------- THE FIELD ---------- */}
        {view === "field" && candidates && !error && (
          <>
            <div className="fec-status">
              <span>{pagination?.count ?? candidates.length} candidate{(pagination?.count ?? candidates.length) === 1 ? "" : "s"} · {cycle} · {officeLabel}
                {office === "S" && ` · ${state} (state-wide)`}
                {office === "H" && ` · ${state}`}{office === "H" && district && ` · district ${district}`}
                {office === "P" && <span style={{ color: "var(--sub)", fontSize: 11 }}> · national totals — state filter not applied</span>}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {pagination && pagination.pages > 1 && <span>page {pagination.page} of {pagination.pages}</span>}
                <button className="fec-btn ghost" onClick={exportFieldCSV} disabled={!candidates.length}>Export CSV ({candidates.length})</button>
              </span>
            </div>
            {candidates.length === 0 && <div className="fec-empty">No candidates on file for this combination.</div>}
            {candidates.map((c) => {
              const cid = c.candidate_id;
              const t = totals[cid];
              const isOpen = !!open[cid];
              const pcc = c.principal_committees?.[0];
              const ledger = openLedgers[cid];
              return (
                <Fragment key={cid}>
                  <div className="fec-card" style={{ "--pc": partyColor(c.party) }}>
                    <button className="fec-row-btn" onClick={() => toggleTotals(cid)} aria-expanded={isOpen}>
                      <span className="fec-name">{c.name}</span>
                      <span className="fec-tag">{c.party_full || c.party || "—"}</span>
                      {c.incumbent_challenge === "I" && <span className="fec-inc">Incumbent</span>}
                      {c.incumbent_challenge === "O" && <span className="fec-tag">Open seat</span>}
                      <span className="fec-id">{cid} {isOpen ? "▾" : "▸"}</span>
                    </button>
                    {isOpen && (
                      <div className="fec-drawer">
                        {t?.loading && <span className="fec-tag">Pulling totals…</span>}
                        {t?.error && <span className="fec-tag">Totals unavailable: {t.error}</span>}
                        {t?.data === false && <span className="fec-tag">No financial filings on record for this cycle.</span>}
                        {t?.data && (
                          <>
                            <div className="fec-stat"><b>Total receipts</b><span className="pos">{fmtUSD(t.data.receipts)}</span></div>
                            <div className="fec-stat"><b>Disbursements</b><span>{fmtUSD(t.data.disbursements)}</span></div>
                            <div className="fec-stat"><b>Cash on hand</b><span className="pos">{fmtUSD(t.data.cash_on_hand_end_period ?? t.data.last_cash_on_hand_end_period)}</span></div>
                            <div className="fec-stat"><b>Debts owed</b><span>{fmtUSD(t.data.debts_owed_by_committee ?? t.data.last_debts_owed_by_committee)}</span></div>
                            <div className="fec-stat"><b>Coverage through</b><span>{fmtDate(t.data.coverage_end_date)}</span></div>
                          </>
                        )}
                        <div className="fec-stat"><b>Principal committee</b><span>{pcc?.name || "None registered"}</span></div>
                        <div className="fec-stat"><b>FEC filings</b><span><a href={`https://www.fec.gov/data/candidate/${cid}/`} target="_blank" rel="noopener noreferrer" className="fec-extlink">View on FEC ↗</a></span></div>
                        {pcc && (
                          <div className="fec-drawer-actions">
                            <button
                              className="fec-btn ghost"
                              onClick={() => ledger
                                ? closeLedger(cid)
                                : openLedger(cid, { name: c.name, party: c.party_full, committeeId: pcc.committee_id, candidateId: cid })
                              }
                            >
                              {ledger ? "Close ▾" : "Donors ▸"}
                            </button>
                            <DossierButton endpoint="/api/dossier" payload={{
                              candidateId: cid, committeeId: pcc.committee_id, name: c.name,
                              party: c.party_full || c.party || "", state: office === "P" ? "" : state, office, cycle,
                              district: office === "H" ? district : "",
                            }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {ledger?.committeeId && (
                    <DonorLedger
                      target={ledger}
                      cycle={cycle}
                      raceState={office === "P" ? "" : state}
                      onClose={() => closeLedger(cid)}
                      onDonorInfo={jumpToDonor}
                    />
                  )}
                </Fragment>
              );
            })}
            {pagination && pagination.pages > 1 && (
              <div className="fec-pager">
                <button onClick={() => searchField(page - 1)} disabled={loading || page <= 1}>◂ Prev</button>
                <span className="fec-tag">page {page} / {pagination.pages}</span>
                <button onClick={() => searchField(page + 1)} disabled={loading || page >= pagination.pages}>Next ▸</button>
              </div>
            )}
          </>
        )}

        {view !== "tn" && view !== "donors" && !race && !candidates && !error && (
          <div className="fec-empty">Set your filters and pull records. Defaults are loaded for TN-01, 2026.</div>
        )}
      </div>
      <div style={{ position: "fixed", right: 10, bottom: 8, fontSize: 10, color: "var(--muted)",
        opacity: 0.75, pointerEvents: "none", fontFamily: "var(--font-num)", zIndex: 5 }}
        title="App version · build time">
        v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"} · {typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "dev build"}
      </div>
    </div>
  );
}
