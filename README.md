# FEC Records Terminal v4.2

Self-hosted explorer for the OpenFEC API with local-AI donor analysis and Tennessee
state-records search.

## Features

- **Donor ledger** — drill into any candidate from either view to see itemized Schedule A
  contributions: contributor name, city/state, employer, occupation, entity type, date, amount.
  Sorted largest-check-first with keyset "Load 100 more" pagination. "Individuals only" toggle
  filters out PAC/committee transfers. "Group by donor" rolls up repeat gifts, dedupes memo
  lines, and separates WinRed/ActBlue conduit pass-throughs from real donors.
- **Per-donor profiling** — resolves PAC/committee donors against FEC committee records
  (type, designation, connected org, treasurer, who funds *them* this cycle) and writes a
  short AI profile, with links out to FEC, OpenSecrets, and web search.
- **CSV export** — export loaded donor rows (raw or grouped), the money-race summary, or TN
  results. Exports are guarded against spreadsheet formula injection.
- **Local AI analysis** — sends loaded contributions to your Ollama instance. The server computes
  the numbers deterministically (top employers, occupations, in-state vs out-of-state, check-size
  buckets); the model writes the narrative on top of those numbers. qwen3 thinking blocks are
  stripped automatically.
- **Ask AI (agentic Q&A)** — a free-text box on each money-race candidate. Ask anything; an Ollama
  tool-calling loop pulls the candidate's FEC filings (totals, donors, spending, outside money),
  committee identity, TN records, and live web search, then answers with inline citations and a
  streamed "what I'm checking" trace. Numbers are computed server-side (the model never does the
  math), tool output is treated as untrusted data, the loop is iteration/quota-capped, and answers
  are cached + force-refreshable. Needs a tool-capable model (`OLLAMA_TOOL_MODEL`, default
  `mistral-small3.2:latest`, selectable in Admin); web search is optional (`SEARCH_API_KEY`) and
  degrades to FEC/TN/Wikipedia/news when unset.
- **Tennessee tab** — eleven ways into Tennessee money, all sharing one cache:
  - *Candidate* — type a name, pick the matching federal committees (principal, joint
    fundraising, leadership PAC) and state account, and open one page: merged donor list
    (federal $ / state $ / total, identities merged, CSV), where the money comes from (state,
    Tennessee county, ZIP, city), donors' employers matched to federal award recipients and to
    the state lobbying roster, spending and outside money, and — for sitting legislators —
    committee seats and sponsored bills. State rows come from the account's filed reports
    (TREF's own contribution search stops at 500 rows).
  - *Outside spending* — state independent expenditures by candidate, for and against.
  - *By place* — pick a ZIP, county or city: who there gives, and to whom (state + federal).
  - *Lobbying* — the Ethics Commission roster: employers of lobbyists, lobbyists, who lobbies
    for whom by year.
  - *Legislature* — General Assembly members, committee assignments, sponsored bills.
  - *Registry* — per-entity workspace on the Tennessee Registry of Election Finance (TREF,
    apps.tn.gov/tncamp): report lists, itemized ledgers, money flows, AI profiles, tracking.
    Name search is a single `%wildcard` contains-match; filters for office, district, party,
    election year and primary/general winners.
  - *Directory* — a local index of every candidate and PAC TREF returns (name, treasurer,
    officers, address, results, open/closed). Substring search with zero calls to the state
    site. "Sync current cycles" / "Sync every year since 2002" fill it; closed years are
    fetched once and never again.
  - *Money search* — the full TREF contributions/expenditures form: contributor, recipient,
    employer, occupation, ZIP, vendor, purpose, amount, type (incl. independent expenditures),
    report type, several report years at once, with top-contributor/recipient/vendor rollups.
  - *Filings* — TREF's report search: every filing of a type/year by office, district or party.
  - *Federal races* — FEC totals for every Tennessee U.S. Senate/House candidate in one call.
  - *Federal dollars* — USAspending.gov contracts, grants, loans and direct payments by
    Tennessee county or congressional district: recipients, agencies, programs, largest awards.
  Requests to the state site are serialized and rate-spaced.

## Getting every federal donor: the bulk load

Admin → *Load bulk data* with **TN individual donors (indiv)** ticked streams the FEC's
nationwide individual-contributions file for each cycle (1–2 GB compressed; only the first zip
entry is requested, nothing is written to disk) and keeps two slices: gifts to committees based
in or linked to Tennessee, and gifts from Tennessee residents to anyone. A cycle takes a few
minutes and adds roughly a million rows. The file contains donors whose giving passed $200; the
smaller earmarked gifts some committees also itemize are only available through the API pull on
the Candidate page. CLI: `node scripts/import-fec-bulk.js --cycles 2026,2024 --indiv`.

## Automatic Tennessee check

Tennessee → Directory → *Automatic check* (off by default). Each run re-syncs the current
cycles, then re-reads the report list of every tracked (★) state entity and raises alerts under
the bell for new registrations, new filings, and gifts over the chosen threshold.

## Deploy

```bash
cp .env.example .env     # FEC key + Ollama model
docker compose up -d --build
```

Open http://localhost:3210.

## Ollama integration

The container reaches Ollama on the host at `http://host.docker.internal:11434`
(`extra_hosts: host-gateway` is set for engines that need it; OrbStack resolves it natively).

If the header shows "ollama offline":

1. Native Ollama binds to loopback by default. Launch it with `OLLAMA_HOST=0.0.0.0`
   (`launchctl setenv OLLAMA_HOST 0.0.0.0` then restart Ollama, or set it in the app's plist).
   OrbStack can usually reach host loopback regardless — test before changing anything.
2. Verify from inside the container:
   `docker exec fec-terminal wget -qO- http://host.docker.internal:11434/api/tags`
3. Header shows "(not pulled!)" → `ollama pull qwen3:8b` or change `OLLAMA_MODEL` in `.env`.

`GET /api/ollama/health` reports reachability and available models.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `FEC_API_KEY` | `DEMO_KEY` | api.data.gov key (free signup, 1,000 req/hr) |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `qwen3:8b` | Model for donor narratives/profiles |
| `OLLAMA_TOOL_MODEL` | `mistral-small3.2:latest` | Tool-calling model for Ask AI (needs tool support) |
| `SEARCH_PROVIDER` | `tavily` | Web-search provider for Ask AI: `tavily`, `brave`, or `serpapi` |
| `SEARCH_API_KEY` | _(empty)_ | Web-search key; blank = Ask AI runs on FEC/TN/wiki/news only |
| `OLLAMA_TIMEOUT_MS` | `600000` | Analysis timeout (cold model loads are slow) |
| `PORT` | `3000` | Container listen port |
| `CACHE_TTL_MS` | `21600000` (6h) | FEC response cache lifetime |
| `TN_CACHE_TTL_MS` | `86400000` (24h) | TN registry cache lifetime (open report years) |
| `CACHE_STALE_GRACE_MS` | `1209600000` (14d) | How long expired responses stay available as an outage fallback |
| `TN_SESSION_TTL_MS` | `480000` (8m) | How long a warm TREF session is reused |
| `DATA_DIR` | `./data` | SQLite cache + settings location |
| `FEC_FETCH_TIMEOUT_MS` | `20000` | Upstream FEC request timeout |

## Caching & settings

Every upstream call goes through a cached gateway — nothing is fetched twice while a good copy
exists:

- **One key per logical request** (path + sorted params, API key excluded), shared by the
  browser proxy and the server-side tools.
- **Cycle-aware lifetimes** — current-cycle FEC data 6 h, the previous cycle 3 days, older
  cycles 14 days; TREF searches 1 day for open report years, 30 days for closed ones.
- **Coalescing** — identical requests already in flight share a single upstream call.
- **Stale-if-error** — expired rows are kept 14 days (`CACHE_STALE_GRACE_MS`) and served,
  flagged, when the FEC or TREF is down or rate-limiting. After an FEC 429 the gateway waits
  out `Retry-After` instead of hammering the API.
- **↺ Refresh** bypasses the cache, but only for data that can still change.
- TREF report details are stored permanently; a warm TREF session is reused across report
  fetches (one request per report instead of four).
- Responses are compressed (brotli/gzip), hashed assets are cached for a year, district
  GeoJSON is streamed from disk with ETags, and fonts are bundled (no Google Fonts request).

Admin shows cache hit rate, stale-fallback rows, reclaimable space, and has **Compact DB**
(VACUUM). `npm test` runs the storage/search tests against a throwaway database.

All of it lives in SQLite at `DATA_DIR/fec-terminal.db`. The cache and the model
setting survive container rebuilds via the `./data` volume mount. Wikipedia entries live 7 days,
news 1 hour, federal lookups 1 day. The AI model is selectable from the dropdown in the page
header — the choice is stored in SQLite and persists until changed (`OLLAMA_MODEL` env is just
the initial default).

## Endpoints

- `/api/fec/*` — allowlisted FEC proxy: `candidates/search/`, `candidate/{id}/totals/`,
  `elections/`, `elections/search/`, `schedules/schedule_a/` (money in), `schedules/schedule_b/`
  (money out), `schedules/schedule_e/` (independent expenditures), `committee/{id}/`, `committees/`
- `POST /api/analyze` — `{donors, candidate, party, cycle, raceState}` → narrative + aggregates
- `POST /api/analyze-donor` — `{donor, candidate, candidateParty, cycle}` → committee identity,
  top funders, links, AI profile (HTTP 207 with identity data if Ollama is down)
- `POST /api/ask` — `{candidateId, committeeId, name, party, state, office, cycle, question, forceRefresh}`
  → streamed NDJSON: `status`/`step`/`tool_result` events as the agent works, then a final
  `answer` event with `{answer, citations, trace, model, cached, at}`. Tools: FEC totals/donors/
  spending/outside, committee lookup, TN records, web search. Cached per candidate+question+model.
- `/api/tn/candidates`, `/api/tn/reports`, `/api/tn/meta`, `/api/tn/health` — TN state records.
  Name searches fan out over "Tennessee/TN/Tennesseans for" prefixes and merge results.
- `POST /api/tn/profile` — `{name, fields, tnId}` → AI profile of a TN candidate/PAC plus
  filing history and research links (HTTP 207 with links if Ollama is down)
- `/api/tn/money?name=&electionYear=&reportYear=` — three TREF ledger searches per entity:
  contributions received (who funds them), contributions given (who they fund), and
  expenditures (vendors & purposes), sorted by amount, capped at 300 rows per section
- `/api/tn/meta` (live election years/offices/parties/report types), `/api/tn/districts?office=`
- `/api/tn/directory?q=&kind=&office=&district=&party=&year=&city=&zip=&winner=&open=` — local
  directory search; `GET|POST /api/tn/directory/sync` — status / start a sync (`{scope: "current"|"all"}`)
- `/api/tn/explore/money?kind=&years=2026,2025&contributor=&recipient=&employer=&occupation=&zip=&by=&vendor=&vendorZip=&purpose=&typeOf=&amountOp=&amount=&reportTypes=`
- `/api/tn/explore/reports?reportYear=&name=&for=&office=&district=&party=&electionYear=&reportTypes=`
- `/api/tn/candidate/find?q=`, `POST /api/tn/candidate/donors|geo|employers|spending`
  (`{committees, cycles, state: [{tnId, name}], candIds}`), `GET|POST /api/tn/candidate/pull`
- `/api/tn/place?zip=|county=|city=`, `/api/tn/ie?year=`
- `/api/tn/lobby?q=`, `/api/tn/lobby/employer/:id`, `/api/tn/lobby/lobbyist/:id`
- `/api/tn/legislature`, `/api/tn/legislature/member?chamber=H|S&district=`
- `GET|POST /api/tn/auto`, `POST /api/tn/auto/run`
- `/api/tn/federal/races?cycle=` — FEC totals for every TN federal candidate, grouped by race
- `/api/tn/federal/spending/geo|summary|awards?fy=&county=&district=&group=&q=` — USAspending
- `/api/health`, `/api/ollama/health` — Homepage-widget friendly

Analyze endpoints are rate-limited to 10 req/min per IP; the FEC proxy to 120 req/min.

## Security posture

Built for trusted local/LAN use: there is no authentication. The server holds your FEC key
server-side, allowlists which FEC endpoints can be proxied, rate-limits per IP, and never
serves HTML error pages on `/api/*` — but if you expose it to the internet, put it behind a
reverse proxy with auth (or Tailscale/VPN), since anyone who can reach it can spend your FEC
quota and drive your Ollama instance.

Ask AI keeps the model on a short leash: it can only call the fixed server tools (it cannot fetch
arbitrary URLs, so no SSRF), tool output is fed back as data with an explicit instruction to ignore
embedded commands (prompt-injection defense), and the loop is capped on iterations and tool calls.
Note that with a `SEARCH_API_KEY` set, the user's questions/queries are sent to the configured
web-search provider — leave it blank to keep Ask AI fully on-box (FEC/TN/Wikipedia/news only).

## Notes on Schedule A

Itemized data only covers contributions over $200 (plus itemized smaller ones some committees
report). Unitemized small-dollar money appears in totals but has no donor rows — so the ledger
sum will be less than total receipts, by design. Schedule A uses keyset pagination, which is why
the ledger has "Load more" instead of numbered pages.
