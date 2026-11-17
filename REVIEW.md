# FEC Terminal — Code Review & Holistic Roadmap

_Review date: June 18, 2026 · against v4.0.0_

This covers (1) what changed in this pass, (2) an architecture assessment, and (3) a
prioritized roadmap toward a holistic FEC‑finance tool. It is written to be read top‑to‑bottom
by whoever maintains the app next.

---

## 1. What changed in this pass

### Backend AI‑summary storage (durable + addressable)
AI narratives were already cached, but only in the generic key/value `cache` table under a
prompt‑hash key with a 30‑day TTL — not queryable by entity, not surfaced anywhere, and with
no way to bust a single stale summary. Added a dedicated store:

- New SQLite table `ai_summary` (`server/db.js`): keyed by `kind:entity_id:model`, carrying
  `prompt_hash`, `payload` JSON, and `created_at` / `updated_at`. CRUD helpers
  `aiSummaryGet/Save/Delete/Count/Clear`, with an in‑memory fallback when `node:sqlite` is
  unavailable.
- New server helper `ollamaSummary({ kind, entityId, prompt, forceRefresh })` replaces
  `ollamaChatCached` across all four LLM endpoints (`/api/analyze`, `/api/analyze-donor`,
  `/api/ai/spending`, `/api/tn/profile`). It returns the stored narrative when the entity,
  model, **and** underlying data (prompt hash) all match; regenerates when the data changes or
  `forceRefresh` is set. Responses now include `analysisAt` (timestamp) alongside
  `analysisCached`.

Why this design: keying by entity makes summaries inspectable and individually refreshable,
while the prompt‑hash check preserves the old guarantee that stale narratives can't survive new
underlying data.

### Force‑refresh buttons + "cached X ago" across the UI
Every AI block now renders a shared `<AiMeta>` header — model name, a `cached <relative time>`
label (using the existing `timeAgo`), and a `↺ Refresh` button that re‑requests with
`forceRefresh: true`. Wired into all six AI surfaces: overall donor analysis, per‑donor profile,
spending analysis, per‑recipient spending profile, outside‑spender profile, and the TN entity
profile.

### PDF export — fixed
The old path opened a popup (`window.open("", "_blank")`), wrote HTML into it, and relied on an
inline `window.onload → window.print()`. It silently no‑opped whenever a popup blocker was
active, and the `onload`‑after‑`document.write` trigger is unreliable. Replaced with
`printDocument(html)`, which renders into a **hidden iframe** and calls
`iframe.contentWindow.print()` directly, with layered fallbacks so the print dialog always
fires, plus cleanup on `afterprint`. A panned/zoomed district map is now reset to its default
view before capture so the PDF isn't a cropped close‑up.

### Look/feel + button‑name harmonization
- Canonical labels everywhere: **Pull records** (primary fetch on all tabs), **Export CSV (n)**,
  **Export PDF**, **↺ Refresh**, and **Donors ▸ / Close ▾** for inline drill‑downs.
- Money Race summary gained an **Export PDF** (standings + map) to match the donor ledger.
- The Field gained **Export CSV**; TN gained **Export PDF**, a **↺ Refresh** button, and a
  `cached X ago` label — bringing both tabs to parity with Money Race's status‑bar pattern.
- TN money sub‑tabs (Received / Top Donors / By Employer / Gave / Spent / Trend) now use the
  app‑wide `.fec-tab` styling instead of bespoke inline styles.
- A shared `reportShell()` + `escHtml()` give every tab's PDF the same typography and
  HTML‑escaping (important: FEC/TN data is third‑party input).

### Admin
`/api/admin/status` now reports stored AI‑summary and TN‑report counts; new
`/api/admin/clear-ai` endpoint and an Admin **🗑 Clear AI Summaries** button (with a confirm)
let you wipe narratives without nuking the whole data cache.

**To deploy:** rebuild so the bundle in `dist/` reflects the source — `docker compose up -d
--build` (the image's build stage runs `npm run build`), or `npm run build` locally. `npm run
dev` hot‑reloads during development.

---

## 2. Architecture assessment

**Strengths.** The server is a clean, well‑commented allowlisted proxy with sensible per‑type
cache TTLs, per‑IP rate limiting, graceful LLM‑down degradation (deterministic aggregates still
return), and a CSV formula‑injection guard. The deterministic‑aggregates‑then‑narrative split
for AI is the right pattern — numbers are computed in code, the model only writes prose over
them. SQLite via the built‑in `node:sqlite` keeps the dependency surface tiny.

**The main structural risk: `src/App.jsx` is ~3,900 lines in one file.** Everything —
`DonorLedger`, `TnPanel`, `DistrictMap`, `AdminPanel`, the main `App`, all helpers and the
entire CSS string — lives together. It works, but it raises the cost and risk of every change
(line numbers move constantly; related logic is far apart). The highest‑leverage refactor is to
split into modules without changing behavior:

```
src/
  App.jsx            (shell, nav, shared state)
  components/        DonorLedger, TnPanel, DistrictMap, AdminPanel, AiMeta, OrgIntel
  lib/               format.js (fmtUSD…), csv.js, print.js (printDocument/reportShell), api.js
  styles.js          the css string
```

This is mechanical and testable. Doing it before the next feature push will pay for itself.

**Other observations.**
- No automated tests. A few unit tests around the pure helpers (`aggregateDonors`, the
  conduit/dedup logic, `classifySector`, CSV escaping) would lock in the trickiest behavior.
- The client keeps its own in‑memory `LEDGER_CACHE` / `SPEND_CACHE` Maps on top of the server
  cache. Fine, but worth a comment on intended lifetime (they reset on reload).
- `TTL.ai` in `server/index.js` is now unused (the dedicated store supersedes it) — harmless,
  but can be removed.
- `dist/assets/` has ~22 stale hashed bundles accumulated from past builds. Clearing it before a
  build keeps the image lean.

---

## 3. Holistic FEC‑finance roadmap

Ordered roughly by value‑to‑effort.

**A. Time‑series & filing‑to‑filing deltas (high value).** The richest FEC story is change over
time. You already pull `candidate/{id}/totals`; add a periodic‑totals view
(`/candidate/{id}/totals/` by period, or the filings endpoint) so a candidate's quarter‑over‑
quarter receipts, burn rate, and cash‑on‑hand trend render as a sparkline next to each race row.
This turns a snapshot into a trajectory.

**B. Head‑to‑head + historical context.** In a race, compute and show each candidate's share of
total receipts, in‑state %, small‑dollar %, and burn rate side‑by‑side. Add prior‑cycle totals
for the same seat so "is this a lot?" has an answer.

**C. Independent expenditures as a first‑class view (Schedule E).** You fetch Schedule E for the
outside‑money panel; promote it. Aggregate IE by committee and by support/oppose at the race
level — outside money often dwarfs the candidate's own committee and is the real story in
competitive seats.

**D. Scheduled refresh + alerts (you already have the harness).** A nightly job that refreshes
the watched races and flags material changes ("Candidate X reported a new quarter: +$420k,
cash‑on‑hand now $1.1M") would make this a monitoring tool, not just a lookup. Pairs naturally
with the new addressable cache (diff today's pull against the stored one).

**E. Committee network / money‑flow graph.** You already resolve who funds a committee and who
it funds (the PAC cross‑reference). Persisting those edges enables a small graph view —
PAC → candidate → vendor — which is where pass‑through and coordination patterns become visible.

**F. Donor de‑anonymization quality.** The conduit (WinRed/ActBlue) handling and donor
roll‑ups are the app's sharpest feature. Invest there: fuzzy name+ZIP+employer clustering to
merge "JOHN SMITH" / "SMITH, JOHN J" / "John Smith" across filings, and an employer normalizer
(canonicalize "Self", "Self‑Employed", "Retired", "None"). Small wins compound across thousands
of rows.

**G. AI quality.** Now that summaries are addressable, consider (1) storing the aggregates in
the payload too, so a cached summary is fully self‑contained for the PDF; (2) a "compare these
two candidates" prompt; (3) recording the model + token/latency for each summary to spot slow or
low‑quality models.

---

## 4. Security & operational notes

- The README is candid that there's no auth — correct for LAN use. If it ever faces the
  internet, the rate limiter alone won't protect your FEC quota or Ollama; put it behind
  Tailscale or an authenticating reverse proxy. Worth restating in the UI, not just the README.
- The TN scraper depends on the TREF site's HTML/CSV export structure and a hand‑synced election
  year list (`server/tn.js`). Add a lightweight health assertion that fails loudly when the page
  shape changes, so silent breakage is caught early.
- `escHtml` now guards the PDF HTML; keep using it for any new third‑party text injected into
  generated HTML.
- Consider a `Content-Security-Policy` header on the static app — cheap defense‑in‑depth.

---

## 4b. Connections & persistence audit (July 11, 2026)

Every external feed, its cache semantics, and what persists permanently:

| Feed | Freshness mechanism | Permanent storage |
|---|---|---|
| FEC API (proxy `/api/fec/*`) | 6h TTL cache, `x-cached-at` surfaced, `_refresh=1` bypass | Schedule A/B itemized → `contributions`; Schedule E → `contributions` (kind `ie`, never in contribution sums); candidates/committees/totals/elections → `fec_candidate` / `fec_committee` / `candidate_totals` (totals keyed by coverage period = filing history) |
| FEC bulk files | 20h mtime window + `--fresh`; Admin shows FEC `Last-Modified` vs local copy ("new data available" is measured) | masters + PAC→candidate/PAC→PAC → same permanent tables; SUB_ID dedupes vs API rows |
| TN TREF scraper | 1d TTL, 5min negative-cache on bounces/zero-results, `_refresh=1` | report lists/details verbatim (`tn_report_*`), itemizations → `contributions`. **Deliberate non-ingest:** cesearch rows (would double-count the same gifts already parsed from reports) |
| Ollama narratives | prompt-hash invalidation + ↺ Refresh | `ai_summary` (addressable, permanent) |
| Web search / wiki / news | per-call, embedded in agent answers | persists inside stored ask/dossier payloads |
| Org enrichment (lobbying/nonprofit/contracts) | TTL cache only | not persisted (recomputable; low value) — accepted |
| Congress members / districts | on-disk files + admin refresh | disk |

Failure posture everywhere: loud errors surfaced in UI status, additive-only writes (a failed
refresh can never corrupt or erase stored history). Admin panel is now the single status hub:
Connections grid (FEC key, TREF, web search), bulk-source freshness table, import job + schedule,
models, system stats.

## 5. Quick wins checklist

- [ ] Split `App.jsx` into modules (no behavior change).
- [ ] Unit tests for `aggregateDonors`, dedup/conduit logic, CSV escaping.
- [ ] Remove unused `TTL.ai`; clear stale `dist/assets/` bundles.
- [ ] Add quarter‑over‑quarter sparklines to race rows (roadmap A).
- [ ] Persist nightly race snapshots → change alerts (roadmap D).

---

## 6. November 2026 pass (v4.1.0)

**Storage & web calls.** Measured on the live 1.77M-row store before/after: donor typeahead
616 ms → 9 ms, quick-find 564 → 18 ms, Donors-tab counters 1.9 s → 0.17 s (4 ms repeat),
employer lookup 4.0 s → 0.5 s; TN district GeoJSON 4.7 MB → 1.7 MB on the wire; JS bundle
473 KB → 144 KB. How: `donor_names` dimension for name search, version-aware memoization
(`PRAGMA data_version` + a write counter), one-scan employer rollups, index-covered counts,
prepared-statement cache, WAL/mmap/page-cache pragmas, compression, static caching. Upstream:
single cached FEC gateway (shared keys, cycle-aware TTLs, coalescing, stale-if-error, 429
back-off); cached TREF C&E search with 30-day retention for closed years; shared warm TREF
session (4 requests per report → 1); the TN results table no longer scrapes a report list per
row for big result sets (`/api/tn/reports?live=0`).

**Tennessee coverage.** Verified against the live TREF forms (field names in `server/tn.js`):
`%` works as a wildcard (one contains-search replaces the four-prefix fan-out — "health" 1 PAC
vs "%health" 42); a C&E search needs only a report year, not an election year; result ids are
now collected for every page (rows 51+ used to lose their id); district/party/winner filters;
all result columns; the report search and the districts endpoint; election years are read from
the live form (fixes the hand-synced list flagged in §4). New: Directory, Money search, Filings,
Federal races, Federal dollars — see README.

**Look & feel.** New token-based stylesheet in `src/styles.js` (dark + light, follows the OS,
toggle in the header), IBM Plex Sans / Sans Condensed / Mono bundled locally, sticky app bar with
navigation, Donors and Tennessee stay mounted between tab switches.

**Not done / candidates for next pass.**
- `src/App.jsx` is still one ~8,300-line file; new code went into `Tennessee.jsx`, `lib.js`,
  `styles.js`, `server/tnx.js`. The split in §2 is still the highest-leverage refactor.
- ~650 inline `style={{}}` blocks in App.jsx still carry small uppercase label styling.
- Tennessee sources not covered: Ethics Commission lobbyist registrations, county/municipal
  campaign filings (each county election commission publishes separately), the state checkbook.
- A scheduled nightly "sync current cycles" + TREF new-filing alerts would pair with §3-D.

---

## 7. November 2026, second pass (v4.2.0)

Built, in order: bulk individual-donor load; donor identity merging; donors' employers joined to
federal award recipients; affiliated-committee roll-up; Registry views protected against TREF's
500-row search cap; scheduled Tennessee check with alerts; geography (candidate and by-place);
state independent expenditures by race; the single candidate page; the Ethics Commission lobbying
roster; General Assembly members/committees/bills.

**Facts established against the live sources (worth knowing before changing this code).**
- `indivYY.zip` holds `itcont.txt` as its FIRST entry, followed by the same rows split by date.
  The importer range-requests only that entry. 2026: 1.3 GB compressed, read and filtered in
  ~2 minutes, ~1M Tennessee rows.
- The bulk indiv file is donors past $200. A committee's Schedule A on the API can be far larger
  (Marsha for Senate 2025-26: 6,239 bulk rows vs 279,135 itemized lines) because committees
  itemize small earmarked gifts too. Coverage on the Candidate page says which of the two it has.
- TREF's contribution search silently stops at 500 rows (one account: 500 rows / $57K from the
  search vs 52,890 gifts / $13.7M in its filed reports). `moneySearchAll` splits a capped search
  by report type and flags `truncated` when a slice is still capped. Expenditure searches did
  not show the cap in testing (777 independent-expenditure rows for 2026).
- Joint fundraising committees are often not linked to the candidate record; they are found from
  transfers into the principal committee.
- capitol.tn.gov quotes hrefs with single quotes; a newly seated General Assembly has no bills,
  so the member card falls back to the previous one.

**Identity rules** (`server/identity.js`): strict = same surname + given names once courtesy
titles are dropped + state; loose = same first and last name, suffix and ZIP with non-conflicting
middle initials. Applied on the Candidate page only — the Donors tab still groups by the stored
`donor_key`.

**Not built.** The Donors tab does not yet use identity merging. `App.jsx` is still one file.

## 8. Local filings (v4.3.0)

A common source does exist for part of the state: 14 county election commissions use EasyVote's
portal (`<county>countytn.easyvotecampaignfinance.com`, API `ecf-api.easyvoteapp.com`).

**Facts established against the live portal.**
- The API picks the county from the request's `Origin` header, not from the path. With no Origin
  it answers for whichever site was last served. Every call sets Origin explicitly.
- `filer/documentsearch/<customer>` returns every filer with every document; `advancedsearch/
  contributions|distributions/<customer>?minAmount=1` returns every itemized row of reports filed
  online (name, date, amount — no address or employer; expenditures carry no date).
  `documents/<id>/viewfinalredactedpdf` is the public PDF. A contribution's `DocumentFilingId`
  (minus `_Redacted`) is the document id.
- Only about a third of financial reports have structured rows (Washington: 217 of 655). The rest
  are PDFs: some generated by the portal with a text layer, some scans of handwritten paper.
- Several form revisions are in circulation (SS-1109/1133/1131/1137, 2002–2023), which is why the
  text pages are arranged by a model and then checked, not parsed by fixed positions.
- On a handwritten cover page, `gemma4:31b` read every figure correctly while `mistral-small3.2`
  invented a receipts figure. Hence two readers and the arithmetic check; a single reader is never
  trusted on a scan.
- Alpine's poppler needs `fontconfig` + a font package or rendered pages lose their printed labels.

**Design.** `server/local.js` (sync, store, routes, review) and `server/localread.js` (reading and
the checks; pure functions are unit-tested). Portal rows are replaced on each sync; rows read from a
PDF never override them — for a report that has both, the PDF only supplies address, employer,
purpose and a missing date. A person's review decisions survive re-reading.

## 9. State money out, votes, disclosures, results (v4.4.0)

`server/tnstate.js`, `server/xlsx.js`, `src/State.jsx`. Each source below was fetched and its
structure checked, Nov 2026.

| What | Source | How it is read |
|---|---|---|
| FastTrack grants | tn.gov/ecd OpenECD | dated `.xlsx` linked from the page (contracted) + HTML table (pending) |
| State contracts | Central Procurement Office "All Contracts" | Tableau view exported as CSV: `data.tn.gov/t/Public/views/CPOContractDetails/CPOContracts-ADACompliant.csv?:maxrows=0` |
| Election results | sos.tn.gov/elections/results | `YYYYMMDDAllbyPrecinct.xlsx`, wide format (RNAME1..n / PVTALLY1..n), summed to county |
| Bill votes | wapp.capitol.tn.gov BillInfo | the Votes tab text ("Representatives voting Aye were: …") |
| Disclosures of interests | conflict.app.tn.gov | form POST (a report year is required) then `view_form_8004/8005.htm`, split on `<h2>` |
| Nonprofit filings | ProPublica Nonprofit Explorer API v2 | JSON |

**Tried and not usable.**
- Searchable Checkbook (vendor payments): the Tableau workbook only exports agency-level summaries
  (`Agency.csv`, `Vendor.csv`); the payee drill-down is not reachable by URL, and the agency total
  it returned for the current fiscal year ($715M) is too small to be all payments, so nothing from
  it is shown. Contracts carry the vendor names instead, as ceilings rather than payments.
- `cached()` in tnx.js spreads its value into an object: cache objects, not bare arrays.

**Organization matching** is by `normalizeEmployerName` (suffixes dropped). It misses subsidiaries
and PACs whose name does not start with the company's (EASTMANPAC vs Eastman Chemical) and merges
unrelated organizations that share a name.

**Not built:** vendor-level state payments; county and city government spending and Comptroller
audit findings; federal earmarks; a member's full voting record across bills (votes are per bill);
state-office cost per vote; identity merging on the Donors tab; a faster model for typed pages.
