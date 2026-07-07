# FEC Records Terminal v4

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
- **TN State tab** — searches the Tennessee Registry of Election Finance (apps.tn.gov/tncamp)
  for state candidates, PACs, and judicial races the FEC never sees, with per-entity report
  lists. Requests are serialized and rate-spaced to be polite to the state site.

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
| `TN_CACHE_TTL_MS` | `86400000` (24h) | TN registry cache lifetime |
| `DATA_DIR` | `./data` | SQLite cache + settings location |
| `FEC_FETCH_TIMEOUT_MS` | `20000` | Upstream FEC request timeout |

## Caching & settings

All upstream responses (FEC, TN registry, Wikipedia, news, federal cross-refs) are cached in
SQLite at `DATA_DIR/fec-terminal.db`, checked before every API call. The cache and the model
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
