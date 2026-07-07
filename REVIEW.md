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

## 5. Quick wins checklist

- [ ] Split `App.jsx` into modules (no behavior change).
- [ ] Unit tests for `aggregateDonors`, dedup/conduit logic, CSV escaping.
- [ ] Remove unused `TTL.ai`; clear stale `dist/assets/` bundles.
- [ ] Add quarter‑over‑quarter sparklines to race rows (roadmap A).
- [ ] Persist nightly race snapshots → change alerts (roadmap D).
