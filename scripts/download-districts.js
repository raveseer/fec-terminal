#!/usr/bin/env node
/**
 * download-districts.js
 *
 * Downloads 119th Congress district boundaries from the Census TIGERweb
 * ArcGIS REST API (per-state queries → GeoJSON), writing one file per state
 * to ./data/districts/{fips}.json.
 *
 * Run ONCE on your Mac (not inside Docker):
 *   node scripts/download-districts.js
 *
 * After this, `docker compose up -d --build` — maps load from disk, no network needed.
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env so FEC_API_KEY is available when run from the Mac terminal
try {
  const envPath = path.join(__dirname, "..", ".env");
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file — that's fine */ }
const OUT_DIR = path.join(__dirname, "..", "data", "districts");
fs.mkdirSync(OUT_DIR, { recursive: true });

// All 50 states + DC (territories excluded — no seats in TIGERweb Legislative layer)
const STATE_FIPS = [
  "01","02","04","05","06","08","09","10","11","12","13","15","16","17","18",
  "19","20","21","22","23","24","25","26","27","28","29","30","31","32","33",
  "34","35","36","37","38","39","40","41","42","44","45","46","47","48","49",
  "50","51","53","54","55","56",
];

// TIGERweb ArcGIS REST API — Layer 8 = 119th Congressional Districts
const BASE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/8/query";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => {
    const opts = { timeout: 30_000, headers: { "user-agent": "fec-terminal/1.0 (github.com)" } };
    const req = https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timed out")); });
  });
}

async function fetchState(fips) {
  const params = new URLSearchParams({
    where: `STATE='${fips}'`,
    outFields: "*",
    returnGeometry: "true",
    f: "geojson",
  });
  const url = `${BASE}?${params}`;
  const body = await get(url);
  const data = JSON.parse(body);
  if (data.error) {
    const msg = data.error.message || data.error.details?.[0] || JSON.stringify(data.error);
    throw new Error(`ArcGIS error: ${msg}`);
  }
  if (!data.features) throw new Error(`Unexpected response: ${body.slice(0, 200)}`);
  return data;
}

let ok = 0, skipped = 0, failed = 0;

for (const fips of STATE_FIPS) {
  const dest = path.join(OUT_DIR, `${fips}.json`);

  // Skip if already downloaded
  if (fs.existsSync(dest)) {
    const existing = JSON.parse(fs.readFileSync(dest, "utf8"));
    if (existing?.features?.length > 0) {
      process.stdout.write(`  ${fips} already exists (${existing.features.length} districts) — skipping\n`);
      skipped++;
      continue;
    }
  }

  try {
    process.stdout.write(`  Fetching FIPS ${fips} … `);
    const geo = await fetchState(fips);
    const count = geo.features?.length ?? 0;
    if (count === 0) {
      process.stdout.write(`no districts (territory/at-large?)\n`);
      // Still write an empty FeatureCollection so server doesn't re-fetch
      fs.writeFileSync(dest, JSON.stringify({ type: "FeatureCollection", features: [] }));
    } else {
      fs.writeFileSync(dest, JSON.stringify(geo));
      process.stdout.write(`${count} districts saved\n`);
    }
    ok++;
  } catch (e) {
    process.stdout.write(`FAILED: ${e.message}\n`);
    failed++;
  }
}

console.log(`\nDone — ${ok} states written, ${skipped} skipped (cached), ${failed} failed.`);
if (failed > 0) console.log("Re-run the script to retry failed states.");

// ---- Download current House member party data ----
// Two-source strategy:
//   1. unitedstates/congress-legislators (GitHub) — authoritative, works on Mac
//   2. FEC API cycle=2024 fallback — works in Docker but has edge-case errors
//      (primary upsets like McGuire/Good in VA-05 show the loser as "incumbent")
//
// For best results, run this script from your Mac terminal:
//   cd ~/Desktop/fec-terminal && node scripts/download-districts.js
// The GitHub source gives perfect data. The FEC fallback is used when Docker
// runs this script via the Admin panel (GitHub is unreachable from Docker).
console.log("\nFetching current House member party data…");
const legDest = path.join(__dirname, "..", "data", "legislators-current.json");
const FEC_KEY = process.env.FEC_API_KEY || "DEMO_KEY";
const FEC_PARTY_MAP = {
  REP: "Republican", DEM: "Democrat", IND: "Independent",
  GRE: "Green Party", LIB: "Libertarian", UNK: "Unknown",
};
const MAJOR_PARTIES = new Set(["REP", "DEM"]);

// Source 1: unitedstates/congress-legislators (authoritative)
let legSuccess = false;
try {
  process.stdout.write("  Trying unitedstates/congress-legislators (GitHub)… ");
  const today = new Date().toISOString().slice(0, 10);
  const body = await get("https://unitedstates.github.io/congress-legislators/legislators-current.json");
  const allLeg = JSON.parse(body);
  const house = [];
  for (const m of allLeg) {
    const repTerms = (m.terms || []).filter((t) => t.type === "rep");
    if (!repTerms.length) continue;
    const term = repTerms[repTerms.length - 1];
    if (term.end && term.end < today) continue;
    house.push({
      state: term.state,
      district: String(term.district ?? 0).padStart(2, "0"),
      party: term.party || "Unknown",
      name: m.name?.official_full || `${m.name?.last}, ${m.name?.first}`,
    });
  }
  if (house.length > 400) {
    fs.writeFileSync(legDest, JSON.stringify(house));
    console.log(`${house.length} members written (authoritative ✓)`);
    legSuccess = true;
  } else {
    throw new Error(`Only ${house.length} members parsed — unexpected`);
  }
} catch (e) {
  console.log(`failed (${e.message})`);
}

// Source 2: FEC API cycle=2024 (fallback for Docker environment)
if (!legSuccess) {
  console.log("  Falling back to FEC API cycle=2024…");
  console.log("  Note: primary upsets (e.g. VA-05) may show the wrong member.");
  console.log("  Run this script from your Mac terminal for accurate data.");
  try {
    const allCandidates = [];
    let page = 1;
    process.stdout.write("  Pages: ");
    while (true) {
      process.stdout.write(`${page} `);
      const params = new URLSearchParams({
        office: "H", cycle: "2024", incumbent_challenge: "I",
        per_page: "100", page: String(page), api_key: FEC_KEY,
      });
      const body = await get(`https://api.open.fec.gov/v1/candidates/totals/?${params}`);
      const data = JSON.parse(body);
      if (data.error) throw new Error(JSON.stringify(data.error));
      allCandidates.push(...(data.results || []));
      if (page >= (data.pagination?.pages ?? 1)) break;
      page++;
      await sleep(2200); // stay under DEMO_KEY 30 req/hr limit
    }
    process.stdout.write("\n");

    const byDistrict = {};
    for (const c of allCandidates) {
      const key = `${c.state}-${String(c.district || "0").padStart(2, "0")}`;
      if (!byDistrict[key]) byDistrict[key] = [];
      byDistrict[key].push(c);
    }
    const house = [];
    for (const candidates of Object.values(byDistrict)) {
      const major = candidates.filter((c) => MAJOR_PARTIES.has(c.party));
      const pool = major.length > 0 ? major : candidates;
      pool.sort((a, b) => (b.receipts || 0) - (a.receipts || 0));
      const best = pool[0];
      house.push({
        state: best.state,
        district: String(best.district || "0").padStart(2, "0"),
        party: FEC_PARTY_MAP[best.party] || best.party || "Unknown",
        name: best.name,
      });
    }
    fs.writeFileSync(legDest, JSON.stringify(house));
    console.log(`  Wrote ${house.length} House members (FEC fallback — may have edge-case errors)`);
  } catch (e) {
    console.log(`  Warning: could not fetch legislator data (${e.message})`);
    console.log("  Party colors on the district map will not be available until this succeeds.");
  }
}

// ---- Download 2024 House contest data (contested = both R and D candidates ran) ----
console.log("\nFetching 2024 House candidates for contested-district analysis…");
try {
  const allCands = [];
  let page = 1;
  process.stdout.write("  Pages: ");
  while (true) {
    process.stdout.write(`${page} `);
    const params = new URLSearchParams({
      office: "H", cycle: "2024", per_page: "100", page: String(page), api_key: FEC_KEY,
    });
    const body = await get(`https://api.open.fec.gov/v1/candidates/totals/?${params}`);
    const data = JSON.parse(body);
    if (data.error) throw new Error(JSON.stringify(data.error));
    allCands.push(...(data.results || []));
    if (page >= (data.pagination?.pages ?? 1)) break;
    page++;
    await sleep(2200);
  }
  process.stdout.write("\n");
  const byDistrict = {};
  for (const c of allCands) {
    const key = `${c.state}-${String(c.district || "0").padStart(2, "0")}`;
    if (!byDistrict[key]) byDistrict[key] = new Set();
    if (c.party === "REP" || c.party === "DEM") byDistrict[key].add(c.party);
  }
  const competitive = {};
  for (const [key, parties] of Object.entries(byDistrict)) {
    if (parties.has("REP") && parties.has("DEM")) {
      const [st, dist] = key.split("-");
      if (!competitive[st]) competitive[st] = {};
      competitive[st][dist] = true;
    }
  }
  const compDest = path.join(__dirname, "..", "data", "competitive-districts.json");
  fs.writeFileSync(compDest, JSON.stringify(competitive));
  const total = Object.values(competitive).reduce((a, v) => a + Object.keys(v).length, 0);
  console.log(`  Wrote ${total} contested districts to competitive-districts.json`);
} catch (e) {
  console.log(`  Warning: could not fetch contest data (${e.message})`);
}

console.log("\nRebuild Docker: docker compose up -d --build");
