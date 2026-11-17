// SQLite-backed cache + settings, using node:sqlite (built into Node >= 22.13 — no npm dep).
// Falls back to in-memory Maps if node:sqlite is unavailable so local dev on an older
// Node still works; the container always has it.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

let db = null;
let stmts = null;
// How long an expired cache row stays readable as a stale fallback before the sweep deletes it.
const STALE_GRACE_MS = Number(process.env.CACHE_STALE_GRACE_MS || 14 * 86_400_000);

try {
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "fec-terminal.db"));
  // Connection tuning. WAL + synchronous=NORMAL is the durable-enough/fast pairing for a cache-
  // heavy store (a power cut can lose the last few transactions, never corrupt the file).
  // journal_size_limit stops the -wal file ballooning after bulk imports; mmap + a 64 MB page
  // cache keep the hot B-tree pages for the 1M+ row ledger in memory.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 8000;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -65536;
    PRAGMA mmap_size = 268435456;
    PRAGMA journal_size_limit = 67108864;
  `);
  // Prepared-statement cache: the helpers below call db.prepare() on every invocation, which
  // re-parses and re-plans the SQL each time. Memoize by SQL text (capped, so the handful of
  // dynamically-built IN(...) statements can't grow it without bound).
  {
    const rawPrepare = db.prepare.bind(db);
    const stmtCache = new Map();
    db.prepare = (sql) => {
      let st = stmtCache.get(sql);
      if (!st) {
        st = rawPrepare(sql);
        if (stmtCache.size < 400) stmtCache.set(sql, st);
      }
      return st;
    };
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires_at);
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // migrate pre-existing DBs that lack created_at
  try { db.exec("ALTER TABLE cache ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0"); } catch { /* column already exists */ }

  // Persistent TN report storage — no TTL, older reports don't change.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tn_report_list (
      tn_id       TEXT NOT NULL,
      report_id   TEXT NOT NULL,
      election    TEXT,
      report_name TEXT,
      amended     TEXT,
      submitted   TEXT,
      fetched_at  INTEGER NOT NULL,
      PRIMARY KEY (tn_id, report_id)
    );
    CREATE TABLE IF NOT EXISTS tn_report_detail (
      report_id      TEXT PRIMARY KEY,
      tn_id          TEXT,
      totals_json    TEXT,
      contribs_json  TEXT,
      expend_json    TEXT,
      meta_json      TEXT,
      fetched_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tn_report_list_tn ON tn_report_list(tn_id);
    CREATE INDEX IF NOT EXISTS idx_tn_report_detail_tn ON tn_report_detail(tn_id);
  `);

  // Addressable AI-summary store — durable narratives keyed by (kind, entity, model).
  // Unlike the generic prompt-hash cache this is queryable by entity, carries timestamps
  // for "cached X ago" UI, survives rebuilds, and is force-refreshable from the web UI.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_summary (
      id          TEXT PRIMARY KEY,   -- kind:entityId:model
      kind        TEXT NOT NULL,      -- donor-analysis | donor-profile | spending | outside | tn-profile
      entity_id   TEXT NOT NULL,
      entity_name TEXT,
      model       TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,      -- regenerate when the underlying data (prompt) changes
      payload     TEXT NOT NULL,      -- JSON: { analysis, ... }
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_entity ON ai_summary(kind, entity_id);
  `);

  // TN search history — the entity searches the user has run, with last-refresh time, so the
  // TN tab can show a paginated "previous searches" list.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tn_search (
      id           TEXT PRIMARY KEY,   -- the search's cache key
      name         TEXT, office TEXT, year TEXT, type TEXT,
      count        INTEGER,
      last_refresh INTEGER NOT NULL,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tn_search_refresh ON tn_search(last_refresh);
  `);

  // Permanent contributions ledger — every itemized row the app pulls (FEC schedules, TN report
  // itemizations) is upserted here so donor giving can be tracked over time. PK (source, sub_id)
  // dedupes re-pulls (first occurrence keeps its first_seen, which powers "new gifts since last
  // check" on the donor watchlist). `date` is normalized YYYY-MM-DD at ingest so text sort = date sort.
  db.exec(`
    CREATE TABLE IF NOT EXISTS contributions (
      source         TEXT NOT NULL,               -- 'fec' | 'tn'
      sub_id         TEXT NOT NULL,               -- FEC sub_id, or TN synthetic reportId:cN/eN
      kind           TEXT NOT NULL DEFAULT 'contribution',  -- 'contribution' | 'disbursement'
      donor_key      TEXT NOT NULL,               -- normalized "NAME|ST" (payee key for disbursements)
      donor_name     TEXT,
      employer       TEXT,
      occupation     TEXT,
      city           TEXT,
      state          TEXT,
      entity_type    TEXT,
      recipient_id   TEXT,                        -- FEC committee id / TN entity id (spender, for disbursements)
      recipient_name TEXT,
      candidate_id   TEXT,
      cycle          TEXT,
      date           TEXT,                        -- YYYY-MM-DD (or '')
      amount         REAL,
      memo           INTEGER NOT NULL DEFAULT 0,
      report         TEXT,
      first_seen     INTEGER NOT NULL,
      fetched_at     INTEGER NOT NULL,
      PRIMARY KEY (source, sub_id)
    );
    CREATE INDEX IF NOT EXISTS idx_contrib_donor ON contributions(donor_key, kind);
    CREATE INDEX IF NOT EXISTS idx_contrib_recip ON contributions(recipient_id, cycle);
    CREATE INDEX IF NOT EXISTS idx_contrib_name ON contributions(donor_name);
    CREATE INDEX IF NOT EXISTS idx_contrib_cand ON contributions(candidate_id);
    CREATE INDEX IF NOT EXISTS idx_contrib_employer ON contributions(employer);
    CREATE INDEX IF NOT EXISTS idx_contrib_occupation ON contributions(occupation);
    CREATE TABLE IF NOT EXISTS donor_watch (
      donor_key    TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      employer     TEXT,
      state        TEXT,
      added_at     INTEGER NOT NULL,
      last_checked INTEGER,
      last_total   REAL DEFAULT 0,
      last_count   INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS probe (
      key        TEXT PRIMARY KEY,                -- e.g. fec:donorq:<KEY>:<cycle>
      signature  TEXT NOT NULL,                   -- cheap change signature (e.g. FEC pagination.count)
      payload    TEXT,
      checked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cand_watch (
      cand_id       TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      party TEXT, state TEXT, office TEXT, district TEXT, pcc TEXT,
      added_at      INTEGER NOT NULL,
      last_checked  INTEGER,
      last_receipts REAL
    );
    CREATE TABLE IF NOT EXISTS tn_watch (
      tn_id        TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      office       TEXT, party TEXT,
      added_at     INTEGER NOT NULL,
      last_checked INTEGER
    );
  `);

  // Permanent FEC reference + candidate-history tables. Fed from BOTH directions: every proxy
  // pull (candidate searches, totals, race standings, committee lookups) upserts here, and the
  // bulk importer (scripts/import-fec-bulk.js) loads the nationwide cm/cn masters. Nothing here
  // ever expires — candidate_totals keys on coverage period, so repeated pulls accumulate a
  // filing-to-filing financial history per candidate.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fec_committee (
      cmte_id       TEXT PRIMARY KEY,
      name          TEXT, type TEXT, designation TEXT, party TEXT, state TEXT,
      connected_org TEXT, cand_id TEXT, last_cycle TEXT,
      first_seen    INTEGER NOT NULL, fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fec_candidate (
      cand_id             TEXT PRIMARY KEY,
      name                TEXT, party TEXT, office TEXT, state TEXT, district TEXT, pcc TEXT,
      incumbent_challenge TEXT, status TEXT, last_cycle TEXT,
      first_seen          INTEGER NOT NULL, fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candidate_totals (
      cand_id       TEXT NOT NULL, cycle TEXT NOT NULL,
      coverage_end  TEXT NOT NULL DEFAULT '',     -- YYYY-MM-DD; one row per filing period
      receipts REAL, disbursements REAL, cash_on_hand REAL, debts REAL,
      source        TEXT,                          -- 'totals' | 'elections'
      first_seen    INTEGER NOT NULL, fetched_at INTEGER NOT NULL,
      PRIMARY KEY (cand_id, cycle, coverage_end)
    );
    CREATE INDEX IF NOT EXISTS idx_ct_cand ON candidate_totals(cand_id, cycle);
    CREATE INDEX IF NOT EXISTS idx_fc_state ON fec_candidate(state, office);
  `);

  // Distinct (donor_key, donor_name) pairs for contribution rows. Name search ("which donors match
  // these tokens?") used to LIKE-scan the whole contributions table (1M+ rows, ~600 ms per
  // keystroke); this dimension is ~50x smaller, so typeahead and quick-find answer in a few ms.
  // Maintained inside contribUpsertMany's transaction; deletes leave harmless orphans (a key with
  // no remaining rows simply aggregates to nothing).
  db.exec(`
    CREATE TABLE IF NOT EXISTS donor_names (
      donor_key  TEXT NOT NULL,
      donor_name TEXT NOT NULL,
      PRIMARY KEY (donor_key, donor_name)
    ) WITHOUT ROWID;
  `);

  // Contributor ZIP (5 digits). Added Nov 2026 for geography views and donor-identity matching;
  // rows stored before that have NULL until they are re-pulled. The partial index stays small.
  try { db.exec("ALTER TABLE contributions ADD COLUMN zip TEXT"); } catch { /* column already exists */ }
  db.exec("CREATE INDEX IF NOT EXISTS idx_contrib_zip ON contributions(zip) WHERE zip IS NOT NULL");

  // Tennessee directory: every candidate/PAC row TREF has ever returned to this app, keyed by
  // (tn_id, election year). Lets the TN tab search names, treasurers, cities, ZIPs and districts
  // locally (substring, instant, zero calls to apps.tn.gov) once the directory has been synced.
  db.exec(`
    CREATE TABLE IF NOT EXISTS tn_entity (
      tn_id      TEXT NOT NULL,
      year       TEXT NOT NULL DEFAULT '',
      kind       TEXT,                  -- 'candidate' | 'pac'
      name       TEXT NOT NULL,
      party TEXT, office TEXT, district TEXT,
      address TEXT, city TEXT, state TEXT, zip TEXT, phone TEXT, email TEXT,
      treasurer TEXT, treasurer_city TEXT,
      primary_result TEXT, general_result TEXT,
      committee TEXT, officers TEXT, responsible TEXT,
      created TEXT, closed TEXT,
      first_seen INTEGER NOT NULL, fetched_at INTEGER NOT NULL,
      PRIMARY KEY (tn_id, year)
    );
    CREATE INDEX IF NOT EXISTS idx_tn_entity_name ON tn_entity(name);
    CREATE INDEX IF NOT EXISTS idx_tn_entity_year ON tn_entity(year, office, district);
    CREATE TABLE IF NOT EXISTS tn_sync (
      scope      TEXT PRIMARY KEY,      -- e.g. 'year:234' | 'pacs'
      label      TEXT,
      count      INTEGER,
      synced_at  INTEGER NOT NULL
    );
  `);

  stmts = {
    get: db.prepare("SELECT value, expires_at, created_at FROM cache WHERE key = ?"),
    set: db.prepare("INSERT INTO cache (key, value, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at, created_at = excluded.created_at"),
    del: db.prepare("DELETE FROM cache WHERE key = ?"),
    sweep: db.prepare("DELETE FROM cache WHERE expires_at < ?"),
    count: db.prepare("SELECT COUNT(*) AS n FROM cache WHERE expires_at >= ?"),
    sGet: db.prepare("SELECT value FROM settings WHERE key = ?"),
    sSet: db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
  };
  // Hourly sweep. Expired rows are kept for a grace period so cacheGetStale() can serve the last
  // good copy when an upstream (FEC rate limit, TREF outage) is failing; they are only deleted once
  // they are older than the grace window. Also lets SQLite refresh planner stats and fold the WAL.
  setInterval(() => {
    try { stmts.sweep.run(Date.now() - STALE_GRACE_MS); } catch { /* sweep is best-effort */ }
    try { db.exec("PRAGMA optimize; PRAGMA wal_checkpoint(PASSIVE);"); } catch { /* best-effort */ }
  }, 3_600_000).unref();
  console.log(`SQLite cache at ${path.join(DATA_DIR, "fec-terminal.db")}`);
  // One-time backfill of the donor_names dimension for ledgers that predate it.
  try {
    const have = db.prepare("SELECT 1 AS x FROM donor_names LIMIT 1").get();
    const need = !have && db.prepare("SELECT 1 AS x FROM contributions LIMIT 1").get();
    if (need) {
      const t0 = Date.now();
      db.exec(`INSERT OR IGNORE INTO donor_names (donor_key, donor_name)
        SELECT DISTINCT donor_key, COALESCE(donor_name, '') FROM contributions WHERE kind = 'contribution'`);
      console.log(`donor_names backfilled in ${Date.now() - t0} ms`);
    }
  } catch (e) { console.warn("[donor_names backfill]", e.message); }
} catch (e) {
  console.warn(`node:sqlite unavailable (${e.message}) — falling back to in-memory cache (nothing persists).`);
}

// ---- in-memory fallback ----
const memCache = new Map();
const memSettings = new Map();
const memAi = new Map(); // id -> { promptHash, payload, createdAt }

export const persistent = Boolean(db);

export function cacheGet(key) {
  if (db) {
    const row = stmts.get.get(key);
    if (!row || Date.now() > Number(row.expires_at)) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }
  const hit = memCache.get(key);
  if (!hit || Date.now() > hit.expiresAt) { memCache.delete(key); return null; }
  return hit.value;
}

// Like cacheGet but also returns the creation timestamp — used by endpoints that surface cache age.
export function cacheGetWithAge(key) {
  if (db) {
    const row = stmts.get.get(key);
    if (!row || Date.now() > Number(row.expires_at)) return null;
    try { return { value: JSON.parse(row.value), createdAt: Number(row.created_at) || null }; } catch { return null; }
  }
  const hit = memCache.get(key);
  if (!hit || Date.now() > hit.expiresAt) { memCache.delete(key); return null; }
  return { value: hit.value, createdAt: hit.createdAt || null };
}

// Last stored copy regardless of expiry (until the sweep's grace window removes it). Callers use
// this ONLY as a fallback when the live upstream fetch failed — never as a normal cache hit.
export function cacheGetStale(key) {
  if (db) {
    try {
      const row = stmts.get.get(key);
      if (!row) return null;
      return { value: JSON.parse(row.value), createdAt: Number(row.created_at) || null,
        expired: Date.now() > Number(row.expires_at) };
    } catch { return null; }
  }
  const hit = memCache.get(key);
  return hit ? { value: hit.value, createdAt: hit.createdAt || null, expired: Date.now() > hit.expiresAt } : null;
}

// ---- version-aware memoization for expensive read aggregates ----
// Results are reused until the database changes. "Changed" = this process wrote (writeGen) or
// another connection did (PRAGMA data_version — the bulk importer runs as a separate process).
// Values are deep-cloned on the way out so callers can't mutate the memoized copy.
let writeGen = 0;
const bumpWrites = () => { writeGen++; };
const memo = new Map(); // key -> { ver, at, value }
function dbVersion() {
  if (!db) return `mem:${writeGen}`;
  try { return `${db.prepare("PRAGMA data_version").get().data_version}:${writeGen}`; } catch { return `x:${writeGen}`; }
}
function memoized(key, fn, { minFreshMs = 0 } = {}) {
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && (now - hit.at < minFreshMs || hit.ver === dbVersion())) {
    memo.delete(key); memo.set(key, hit); // LRU touch
    return structuredClone(hit.value);
  }
  const value = fn();
  memo.set(key, { ver: dbVersion(), at: now, value });
  if (memo.size > 300) memo.delete(memo.keys().next().value);
  return structuredClone(value);
}

export function cacheSet(key, value, ttlMs) {
  const now = Date.now();
  const expiresAt = now + ttlMs;
  if (db) {
    try { stmts.set.run(key, JSON.stringify(value), expiresAt, now); } catch { /* cache write is best-effort */ }
    return;
  }
  if (memCache.size > 500) memCache.delete(memCache.keys().next().value);
  memCache.set(key, { value, expiresAt, createdAt: now });
}

export function cacheFlush() {
  if (db) { try { db.exec("DELETE FROM cache"); return true; } catch { return false; } }
  memCache.clear();
  return true;
}

export function cacheCount() {
  if (db) {
    try { return Number(stmts.count.get(Date.now())?.n || 0); } catch { return 0; }
  }
  return memCache.size;
}

// Storage report for the Admin panel: file size, reclaimable free pages, live vs stale cache rows.
export function dbStorageStats() {
  if (!db) return null;
  try {
    const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a) || {})[0];
    const pageSize = Number(one("PRAGMA page_size")), pages = Number(one("PRAGMA page_count")), free = Number(one("PRAGMA freelist_count"));
    const now = Date.now();
    return {
      bytes: pageSize * pages, reclaimableBytes: pageSize * free,
      cacheLive: Number(one("SELECT COUNT(*) FROM cache WHERE expires_at >= ?", now)),
      cacheStale: Number(one("SELECT COUNT(*) FROM cache WHERE expires_at < ?", now)),
      cacheBytes: Number(one("SELECT COALESCE(SUM(LENGTH(value)),0) FROM cache")),
      staleGraceDays: Math.round(STALE_GRACE_MS / 86_400_000),
    };
  } catch { return null; }
}

// Reclaim free pages (VACUUM rewrites the file — seconds to a minute on a large store; the server
// is blocked while it runs, so it is only ever triggered by hand from Admin).
export function dbCompact() {
  if (!db) return { error: "No persistent database." };
  try {
    const before = dbStorageStats();
    stmts.sweep.run(Date.now() - STALE_GRACE_MS);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA optimize;");
    const after = dbStorageStats();
    return { beforeBytes: before?.bytes ?? null, afterBytes: after?.bytes ?? null };
  } catch (e) { return { error: e.message }; }
}

export function settingGet(key) {
  if (db) {
    try { return stmts.sGet.get(key)?.value ?? null; } catch { return null; }
  }
  return memSettings.get(key) ?? null;
}

export function settingSet(key, value) {
  if (db) {
    try { stmts.sSet.run(key, String(value)); return true; } catch { return false; }
  }
  memSettings.set(key, String(value));
  return true;
}

// ---- persistent TN report storage ----
// Falls back gracefully to null/no-op when SQLite isn't available.

export function tnReportListGet(tnId) {
  if (!db) return null;
  try {
    const rows = db.prepare(
      // `submitted` is MM/DD/YYYY text — rearrange to YYYYMMDD so DESC is truly newest-first
      // (plain `ORDER BY submitted DESC` sorted 12/01/2018 above 01/15/2026)
      "SELECT report_id, election, report_name, amended, submitted, fetched_at FROM tn_report_list WHERE tn_id = ? ORDER BY substr(submitted,7,4) || substr(submitted,1,2) || substr(submitted,4,2) DESC"
    ).all(String(tnId));
    if (!rows.length) return null;
    return { reports: rows, fetchedAt: rows[0]?.fetched_at };
  } catch { return null; }
}

export function tnReportListSave(tnId, reports) {
  if (!db) return;
  const stmt = db.prepare(`
    INSERT INTO tn_report_list (tn_id, report_id, election, report_name, amended, submitted, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tn_id, report_id) DO UPDATE SET
      election=excluded.election, report_name=excluded.report_name,
      amended=excluded.amended, submitted=excluded.submitted, fetched_at=excluded.fetched_at
  `);
  const now = Date.now();
  try {
    for (const r of reports) {
      stmt.run(String(tnId), String(r.reportId), r.election || null, r.reportName || null, r.amended || null, r.submitted || null, now);
    }
  } catch { /* best-effort */ }
}

export function tnReportDetailGet(reportId) {
  if (!db) return null;
  try {
    const row = db.prepare("SELECT * FROM tn_report_detail WHERE report_id = ?").get(String(reportId));
    if (!row) return null;
    return {
      reportId: row.report_id,
      tnId: row.tn_id,
      totals: JSON.parse(row.totals_json || "null"),
      contribs: JSON.parse(row.contribs_json || "null"),
      expenditures: JSON.parse(row.expend_json || "null"),
      meta: JSON.parse(row.meta_json || "null"),
      fetchedAt: row.fetched_at,
    };
  } catch { return null; }
}

export function tnReportDetailSave(reportId, tnId, { totals, contribs, expenditures, meta }) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO tn_report_detail (report_id, tn_id, totals_json, contribs_json, expend_json, meta_json, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_id) DO UPDATE SET
        tn_id=excluded.tn_id, totals_json=excluded.totals_json,
        contribs_json=excluded.contribs_json, expend_json=excluded.expend_json,
        meta_json=excluded.meta_json, fetched_at=excluded.fetched_at
    `).run(String(reportId), String(tnId), JSON.stringify(totals || {}), JSON.stringify(contribs || []),
           JSON.stringify(expenditures || []), JSON.stringify(meta || {}), Date.now());
  } catch { /* best-effort */ }
}

// How many TN reports are stored in the DB (for admin panel)
export function tnReportCount() {
  if (!db) return 0;
  try { return Number(db.prepare("SELECT COUNT(*) AS n FROM tn_report_detail").get()?.n || 0); } catch { return 0; }
}

// ---- addressable AI-summary store ----
// Keyed by (kind, entityId, model); falls back to an in-memory Map without SQLite.

const aiId = (kind, entityId, model) => `${kind}:${entityId}:${model}`;

export function aiSummaryGet(kind, entityId, model) {
  const id = aiId(kind, entityId, model);
  if (db) {
    try {
      const row = db.prepare("SELECT prompt_hash, payload, created_at FROM ai_summary WHERE id = ?").get(id);
      if (!row) return null;
      return { promptHash: row.prompt_hash, payload: JSON.parse(row.payload || "null"), createdAt: Number(row.created_at) || null };
    } catch { return null; }
  }
  return memAi.get(id) || null;
}

export function aiSummarySave(kind, entityId, model, { entityName = null, promptHash, payload }) {
  const id = aiId(kind, entityId, model);
  const now = Date.now();
  if (db) {
    try {
      db.prepare(`
        INSERT INTO ai_summary (id, kind, entity_id, entity_name, model, prompt_hash, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          entity_name=excluded.entity_name, prompt_hash=excluded.prompt_hash,
          payload=excluded.payload, created_at=excluded.created_at, updated_at=excluded.updated_at
      `).run(id, kind, String(entityId), entityName, model, promptHash, JSON.stringify(payload ?? {}), now, now);
    } catch { /* best-effort */ }
    return now;
  }
  if (memAi.size > 2000) memAi.delete(memAi.keys().next().value);
  memAi.set(id, { promptHash, payload, createdAt: now });
  return now;
}

export function aiSummaryDelete(kind, entityId, model) {
  const id = aiId(kind, entityId, model);
  if (db) { try { db.prepare("DELETE FROM ai_summary WHERE id = ?").run(id); } catch { /* best-effort */ } return; }
  memAi.delete(id);
}

export function aiSummaryCount() {
  if (db) { try { return Number(db.prepare("SELECT COUNT(*) AS n FROM ai_summary").get()?.n || 0); } catch { return 0; } }
  return memAi.size;
}

export function aiSummaryClear() {
  if (db) { try { db.exec("DELETE FROM ai_summary"); return true; } catch { return false; } }
  memAi.clear();
  return true;
}

// ---- TN search history ----
const memTnSearch = new Map();

export function tnSearchSave({ id, name = "", office = "", year = "", type = "", count = 0, lastRefresh }) {
  const now = Date.now();
  const ts = lastRefresh || now;
  if (db) {
    try {
      db.prepare(`
        INSERT INTO tn_search (id, name, office, year, type, count, last_refresh, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, office=excluded.office, year=excluded.year,
          type=excluded.type, count=excluded.count, last_refresh=excluded.last_refresh
      `).run(id, name, office, year, type, count, ts, now);
    } catch { /* best-effort */ }
    return;
  }
  const prev = memTnSearch.get(id);
  memTnSearch.set(id, { id, name, office, year, type, count, last_refresh: ts, created_at: prev?.created_at || now });
}

export function tnSearchList(limit = 10, offset = 0) {
  if (db) {
    try {
      const rows = db.prepare("SELECT id, name, office, year, type, count, last_refresh FROM tn_search ORDER BY last_refresh DESC LIMIT ? OFFSET ?").all(limit, offset);
      const total = Number(db.prepare("SELECT COUNT(*) AS n FROM tn_search").get()?.n || 0);
      return { rows, total };
    } catch { return { rows: [], total: 0 }; }
  }
  const all = [...memTnSearch.values()].sort((a, b) => b.last_refresh - a.last_refresh);
  return { rows: all.slice(offset, offset + limit), total: all.length };
}

// ---- permanent contributions ledger ----
// Everything itemized the app pulls (FEC schedule A/B, TN report itemizations) lands here via
// upsert, so donor giving is trackable over time. In-memory fallback mirrors semantics (no persist).

const memContrib = new Map(); // `${source}:${subId}` -> row (camelCase)
const memWatch = new Map();   // donorKey -> watch row
const memProbe = new Map();   // key -> { signature, payload, checkedAt }

// rows: [{ source, subId, kind, donorKey, donorName, employer, occupation, city, state,
//          entityType, recipientId, recipientName, candidateId, cycle, date, amount, memo, report }]
// `date` must already be normalized to YYYY-MM-DD (or ""). Returns rows written.
export function contribUpsertMany(rows) {
  if (!rows?.length) return 0;
  const now = Date.now();
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO contributions (source, sub_id, kind, donor_key, donor_name, employer, occupation,
        city, state, entity_type, recipient_id, recipient_name, candidate_id, cycle, date, amount,
        memo, report, first_seen, fetched_at, zip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, sub_id) DO UPDATE SET
        kind=excluded.kind, donor_key=excluded.donor_key,
        donor_name=COALESCE(excluded.donor_name, donor_name),
        employer=COALESCE(excluded.employer, employer),
        occupation=COALESCE(excluded.occupation, occupation),
        city=COALESCE(excluded.city, city),
        state=COALESCE(excluded.state, state),
        entity_type=COALESCE(excluded.entity_type, entity_type),
        recipient_id=COALESCE(excluded.recipient_id, recipient_id),
        recipient_name=COALESCE(excluded.recipient_name, recipient_name),
        candidate_id=COALESCE(excluded.candidate_id, candidate_id),
        cycle=COALESCE(excluded.cycle, cycle),
        date=CASE WHEN excluded.date != '' THEN excluded.date ELSE date END,
        amount=excluded.amount, memo=excluded.memo,
        report=COALESCE(excluded.report, report), fetched_at=excluded.fetched_at,
        zip=COALESCE(excluded.zip, zip)
    `); // first_seen deliberately NOT updated; sparse re-upserts must not blank out stored fields
    const nameStmt = db.prepare("INSERT OR IGNORE INTO donor_names (donor_key, donor_name) VALUES (?, ?)");
    let n = 0;
    try {
      db.exec("BEGIN");
      for (const r of rows) {
        if (!r?.source || !r?.subId || !r?.donorKey) continue;
        if ((r.kind || "contribution") === "contribution") nameStmt.run(String(r.donorKey), String(r.donorName ?? ""));
        stmt.run(String(r.source), String(r.subId), r.kind || "contribution", String(r.donorKey),
          r.donorName ?? null, r.employer ?? null, r.occupation ?? null, r.city ?? null,
          r.state ?? null, r.entityType ?? null, r.recipientId ?? null, r.recipientName ?? null,
          r.candidateId ?? null, r.cycle != null ? String(r.cycle) : null, r.date || "",
          Number(r.amount) || 0, r.memo ? 1 : 0, r.report ?? null, now, now,
          /^\d{5}/.test(String(r.zip || "")) ? String(r.zip).slice(0, 5) : null);
        n++;
      }
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      console.warn("[contribUpsertMany]", e.message);
    }
    bumpWrites();
    return n;
  }
  let n = 0;
  for (const r of rows) {
    if (!r?.source || !r?.subId || !r?.donorKey) continue;
    const k = `${r.source}:${r.subId}`;
    const prev = memContrib.get(k);
    memContrib.set(k, { ...r, memo: r.memo ? 1 : 0, amount: Number(r.amount) || 0,
      firstSeen: prev?.firstSeen || now, fetchedAt: now });
    n++;
  }
  return n;
}

// Replace-set for TN entities: an amended filing supersedes the original, so stored rows for the
// entity are cleared before the current collapsed set is re-inserted.
export function contribDeleteByRecipient(source, recipientId) {
  if (db) {
    try { db.prepare("DELETE FROM contributions WHERE source = ? AND recipient_id = ?").run(String(source), String(recipientId)); } catch { /* best-effort */ }
    bumpWrites();
    return;
  }
  for (const [k, v] of memContrib) if (v.source === source && String(v.recipientId) === String(recipientId)) memContrib.delete(k);
}

// Targeted purge for superseded TN filings: an amended report replaces the original, so the
// original's rows (sub_id = `${reportId}:cN` / `${reportId}:eN`) are deleted by reportId prefix —
// never the whole entity, so a partial budget-capped read can't wipe unrelated history.
export function contribDeleteBySubIdPrefix(source, prefix) {
  if (db) {
    // Range scan on the (source, sub_id) primary key. The old `sub_id LIKE prefix || '%'` could not
    // use the index (LIKE is case-insensitive), so every superseded report scanned the whole ledger.
    const lo = String(prefix);
    if (!lo) return;
    const hi = lo.slice(0, -1) + String.fromCharCode(lo.charCodeAt(lo.length - 1) + 1);
    try { db.prepare("DELETE FROM contributions WHERE source = ? AND sub_id >= ? AND sub_id < ?").run(String(source), lo, hi); } catch { /* best-effort */ }
    bumpWrites();
    return;
  }
  for (const [k, v] of memContrib) if (v.source === source && String(v.subId).startsWith(String(prefix))) memContrib.delete(k);
}

// Grouped donor search over the stored ledger (contributions only).
// MEMO rows are excluded from all sums: FEC memo entries (earmark details, conduit batch totals
// like AIPAC's "TOTAL EARMARKED THROUGH CONDUIT") are informational — their dollars are itemized
// under the actual donors, so counting them double-counts (verified live: a candidate's AIPAC memo
// lines "summed" to more than the campaign's entire receipts).
export function contribDonorGroups(opts = {}) {
  const { q = "", state = "", employer = "", limit = 50 } = opts;
  return memoized(`dg:${q}|${state}|${employer}|${limit}`, () => contribDonorGroupsRaw({ q, state, employer, limit }));
}
function contribDonorGroupsRaw({ q = "", state = "", employer = "", limit = 50 } = {}) {
  // Two-phase: first find donor_keys where ANY row matches the filters, then aggregate ALL of each
  // matched donor's rows. Filtering and grouping in one pass would silently drop a donor's
  // differently-formatted rows ("Jane Doe" vs "DOE, JANE") from the totals.
  if (db) {
    try {
      const conds = ["kind = 'contribution'"];
      const args = [];
      // Token matching: every token must appear somewhere in the name or key, in ANY order —
      // so "jane doe" finds "DOE, JANE" and "JANE R DOE" (a single LIKE on the whole phrase wouldn't).
      const toks = String(q).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
      for (const t of toks) {
        conds.push("(donor_name LIKE ? OR donor_key LIKE ?)");
        args.push(`%${t}%`, `%${t}%`);
      }
      // Name-only searches (typeahead, quick-find, donor search) resolve phase one against the small
      // donor_names dimension instead of scanning the ledger; phase two then aggregates only the
      // matched keys through idx_contrib_donor.
      if (toks.length && !state && !employer) {
        const nameConds = toks.map(() => "(donor_name LIKE ? OR donor_key LIKE ?)").join(" AND ");
        return db.prepare(`
          SELECT donor_key AS donorKey, MAX(donor_name) AS name, MAX(employer) AS employer,
                 MAX(occupation) AS occupation, MAX(city) AS city, MAX(state) AS state,
                 SUM(amount) AS total, COUNT(*) AS count,
                 COUNT(DISTINCT recipient_id) AS recipients,
                 MIN(NULLIF(date, '')) AS firstDate, MAX(date) AS lastDate,
                 GROUP_CONCAT(DISTINCT source) AS sources
          FROM contributions
          WHERE kind = 'contribution' AND memo = 0 AND donor_key IN (
            SELECT DISTINCT donor_key FROM donor_names WHERE ${nameConds}
          )
          GROUP BY donor_key ORDER BY total DESC LIMIT ?
        `).all(...args, limit);
      }
      if (state) { conds.push("UPPER(state) = ?"); args.push(state.toUpperCase()); }
      if (employer) { conds.push("employer LIKE ?"); args.push(`%${employer}%`); }
      return db.prepare(`
        SELECT donor_key AS donorKey, MAX(donor_name) AS name, MAX(employer) AS employer,
               MAX(occupation) AS occupation, MAX(city) AS city, MAX(state) AS state,
               SUM(amount) AS total, COUNT(*) AS count,
               COUNT(DISTINCT recipient_id) AS recipients,
               MIN(NULLIF(date, '')) AS firstDate, MAX(date) AS lastDate,
               GROUP_CONCAT(DISTINCT source) AS sources
        FROM contributions
        WHERE kind = 'contribution' AND memo = 0 AND donor_key IN (
          SELECT DISTINCT donor_key FROM contributions WHERE ${conds.join(" AND ")}
        )
        GROUP BY donor_key ORDER BY total DESC LIMIT ?
      `).all(...args, limit);
    } catch { return []; }
  }
  const matched = new Set();
  const qTokens = String(q || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  for (const v of memContrib.values()) {
    if (v.kind && v.kind !== "contribution") continue;
    const hay = `${(v.donorName || "").toUpperCase()} ${v.donorKey || ""}`;
    if (qTokens.length && !qTokens.every((t) => hay.includes(t))) continue;
    if (state && (v.state || "").toUpperCase() !== state.toUpperCase()) continue;
    if (employer && !(v.employer || "").toUpperCase().includes(employer.toUpperCase())) continue;
    matched.add(v.donorKey);
  }
  const map = new Map();
  for (const v of memContrib.values()) {
    if (v.kind && v.kind !== "contribution") continue;
    if (v.memo) continue; // memo entries are informational — never counted in totals
    if (!matched.has(v.donorKey)) continue;
    const g = map.get(v.donorKey) || { donorKey: v.donorKey, name: v.donorName, employer: v.employer,
      occupation: v.occupation, city: v.city, state: v.state, total: 0, count: 0,
      _recips: new Set(), firstDate: null, lastDate: null, _sources: new Set() };
    g.total += v.amount; g.count++; g._recips.add(v.recipientId); g._sources.add(v.source);
    if (v.employer && !g.employer) g.employer = v.employer;
    if (v.occupation && !g.occupation) g.occupation = v.occupation;
    if (v.date) { if (!g.firstDate || v.date < g.firstDate) g.firstDate = v.date; if (!g.lastDate || v.date > g.lastDate) g.lastDate = v.date; }
    map.set(v.donorKey, g);
  }
  return [...map.values()].map((g) => ({ ...g, recipients: g._recips.size, sources: [...g._sources].join(","), _recips: undefined, _sources: undefined }))
    .sort((a, b) => b.total - a.total).slice(0, limit);
}

// Candidate pool for "did you mean" — donors where ANY token matches (wide net; the caller ranks
// by string similarity). Returns light summary rows, biggest givers first.
export function contribDonorNamePool(tokens, limit = 200) {
  const toks = (tokens || []).map((t) => String(t).toUpperCase().replace(/[^A-Z0-9]/g, "")).filter((t) => t.length >= 2);
  if (!toks.length) return [];
  if (db) {
    return memoized(`np:${toks.join(" ")}|${limit}`, () => {
      try {
        // Phase one on the donor_names dimension (see contribDonorGroups), then aggregate by key.
        const ors = toks.map(() => "(donor_name LIKE ? OR donor_key LIKE ?)").join(" OR ");
        const args = toks.flatMap((t) => [`%${t}%`, `%${t}%`]);
        return db.prepare(`
          SELECT donor_key AS donorKey, MAX(donor_name) AS name, MAX(employer) AS employer,
                 MAX(state) AS state, SUM(amount) AS total, COUNT(*) AS count
          FROM contributions WHERE kind = 'contribution' AND memo = 0 AND donor_key IN (
            SELECT DISTINCT donor_key FROM donor_names WHERE ${ors}
          )
          GROUP BY donor_key ORDER BY total DESC LIMIT ?
        `).all(...args, limit);
      } catch { return []; }
    });
  }
  const map = new Map();
  for (const v of memContrib.values()) {
    if (v.kind && v.kind !== "contribution") continue;
    const hay = `${(v.donorName || "").toUpperCase()} ${v.donorKey || ""}`;
    if (!toks.some((t) => hay.includes(t))) continue;
    const g = map.get(v.donorKey) || { donorKey: v.donorKey, name: v.donorName, employer: v.employer, state: v.state, total: 0, count: 0 };
    g.total += v.amount; g.count++;
    map.set(v.donorKey, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

// Every stored gift for one donor, newest first.
export function contribDonorRows(donorKey, { limit = 2000 } = {}) {
  if (db) {
    try {
      return db.prepare(`
        SELECT source, sub_id AS subId, donor_name AS donorName, employer, occupation, city, state,
               entity_type AS entityType, recipient_id AS recipientId, recipient_name AS recipientName,
               candidate_id AS candidateId, cycle, date, amount, memo, report, first_seen AS firstSeen
        FROM contributions WHERE donor_key = ? AND kind = 'contribution'
        ORDER BY date DESC, amount DESC LIMIT ?
      `).all(String(donorKey), limit);
    } catch { return []; }
  }
  return [...memContrib.values()].filter((v) => v.donorKey === donorKey && (!v.kind || v.kind === "contribution"))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.amount - a.amount).slice(0, limit);
}

// Stored rows for a recipient (fallback when the FEC is unreachable / rate-limited).
export function contribRecipientRows(recipientId, cycle = "", { kind = "contribution", limit = 5000 } = {}) {
  if (db) {
    try {
      const conds = ["recipient_id = ?", "kind = ?"];
      const args = [String(recipientId), kind];
      if (cycle) { conds.push("cycle = ?"); args.push(String(cycle)); }
      const rows = db.prepare(`
        SELECT source, sub_id AS subId, donor_name AS donorName, employer, occupation, city, state,
               entity_type AS entityType, cycle, date, amount, memo, report, fetched_at AS fetchedAt
        FROM contributions WHERE ${conds.join(" AND ")} ORDER BY amount DESC LIMIT ?
      `).all(...args, limit);
      return rows;
    } catch { return []; }
  }
  return [...memContrib.values()].filter((v) => String(v.recipientId) === String(recipientId)
    && (v.kind || "contribution") === kind && (!cycle || String(v.cycle) === String(cycle)))
    .sort((a, b) => b.amount - a.amount).slice(0, limit);
}

// Slim edge rows for overlap/graph aggregation — filter by recipient/candidate ids and/or donor
// keys and kind, aggregation happens in index.js. Memo rows are excluded up front (FEC accounting
// rule: memo entries never count toward totals — earmark details/conduit batch lines double-count).
// recipientIds match recipient_id OR candidate_id, uppercased, so committee and candidate ids both work.
export function contribEdgeRows({ recipientIds = null, donorKeys = null, kind = null, limit = 20000 } = {}) {
  const rids = recipientIds ? [...new Set(recipientIds.map((s) => String(s).toUpperCase().trim()).filter(Boolean))] : null;
  const dks = donorKeys ? [...new Set(donorKeys.map((s) => String(s)).filter(Boolean))] : null;
  if (!rids?.length && !dks?.length) return [];
  if (db) {
    try {
      const conds = ["memo = 0"];
      const args = [];
      if (kind) { conds.push("kind = ?"); args.push(kind); }
      if (rids?.length) {
        const ph = rids.map(() => "?").join(",");
        conds.push(`(UPPER(recipient_id) IN (${ph}) OR UPPER(candidate_id) IN (${ph}))`);
        args.push(...rids, ...rids);
      }
      if (dks?.length) {
        conds.push(`donor_key IN (${dks.map(() => "?").join(",")})`);
        args.push(...dks);
      }
      // ORDER BY amount DESC so when a bulk-scale entity blows past the cap, the cap keeps the
      // BIGGEST flows (an arbitrary subset would silently distort every aggregation downstream)
      return db.prepare(`
        SELECT source, kind, donor_key AS donorKey, donor_name AS donorName, employer, occupation,
               city, state, entity_type AS entityType, recipient_id AS recipientId,
               recipient_name AS recipientName, candidate_id AS candidateId, cycle, date, amount, report
        FROM contributions WHERE ${conds.join(" AND ")} ORDER BY amount DESC LIMIT ?
      `).all(...args, limit);
    } catch { return []; }
  }
  const ridSet = rids ? new Set(rids) : null;
  const dkSet = dks ? new Set(dks) : null;
  const out = [];
  for (const v of memContrib.values()) {
    if (v.memo) continue;
    if (kind && (v.kind || "contribution") !== kind) continue;
    if (ridSet && !ridSet.has(String(v.recipientId || "").toUpperCase()) && !ridSet.has(String(v.candidateId || "").toUpperCase())) continue;
    if (dkSet && !dkSet.has(v.donorKey)) continue;
    out.push({ ...v, kind: v.kind || "contribution" });
    if (out.length >= limit) break;
  }
  return out;
}

// Aggregations for the employer/occupation reverse lookup: totals, per-recipient rollup,
// per-donor rollup, and the raw field-value variants (so the UI can show fragmentation like
// "FEDEX" / "FEDEX CORP" / "FEDEX EXPRESS"). LIKE-substring match, contributions only, memo excluded.
export function contribFieldAgg({ q = "", field = "employer", state = "", limit = 200 } = {}) {
  const col = field === "occupation" ? "occupation" : "employer";
  const empty = { totals: { total: 0, count: 0, donors: 0, recipients: 0 }, recipients: [], donors: [], variants: [] };
  const needle = String(q).toUpperCase().trim();
  if (!needle) return empty;
  if (db) {
    return memoized(`fa:${col}|${needle}|${state}|${limit}`, () => {
      try {
        // ONE scan of the ledger into a temp table, then the four rollups read that small set.
        // (Previously each rollup re-scanned all rows with UPPER(col) LIKE — four full passes.)
        // Plain LIKE is already case-insensitive for ASCII, which is what both sources file in.
        const conds = ["kind = 'contribution'", "memo = 0", `${col} LIKE ?`];
        const args = [`%${needle}%`];
        if (state) { conds.push("UPPER(state) = ?"); args.push(String(state).toUpperCase()); }
        db.exec(`CREATE TEMP TABLE IF NOT EXISTS field_hit (
          donor_key TEXT, donor_name TEXT, employer TEXT, occupation TEXT, city TEXT, state TEXT,
          recipient_id TEXT, recipient_name TEXT, source TEXT, date TEXT, amount REAL);
          DELETE FROM temp.field_hit;`);
        db.prepare(`INSERT INTO temp.field_hit
          SELECT donor_key, donor_name, employer, occupation, city, state, recipient_id, recipient_name, source, date, amount
          FROM contributions WHERE ${conds.join(" AND ")}`).run(...args);
        const totals = db.prepare(`
          SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count,
                 COUNT(DISTINCT donor_key) AS donors, COUNT(DISTINCT recipient_id) AS recipients
          FROM temp.field_hit`).get();
        const recipients = db.prepare(`
          SELECT recipient_id AS recipientId, MAX(recipient_name) AS recipientName, MAX(source) AS source,
                 SUM(amount) AS total, COUNT(*) AS count, COUNT(DISTINCT donor_key) AS donors,
                 MIN(NULLIF(date,'')) AS firstDate, MAX(date) AS lastDate
          FROM temp.field_hit GROUP BY recipient_id ORDER BY total DESC LIMIT ?`).all(limit);
        const donors = db.prepare(`
          SELECT donor_key AS donorKey, MAX(donor_name) AS name, MAX(employer) AS employer,
                 MAX(occupation) AS occupation, MAX(city) AS city, MAX(state) AS state,
                 SUM(amount) AS total, COUNT(*) AS count, COUNT(DISTINCT recipient_id) AS recipients
          FROM temp.field_hit GROUP BY donor_key ORDER BY total DESC LIMIT ?`).all(limit);
        const variants = db.prepare(`
          SELECT ${col} AS value, SUM(amount) AS total, COUNT(*) AS count
          FROM temp.field_hit GROUP BY ${col} ORDER BY total DESC LIMIT ?`).all(limit);
        db.exec("DELETE FROM temp.field_hit");
        return { totals, recipients, donors, variants };
      } catch { return empty; }
    });
  }
  const recipM = new Map(), donorM = new Map(), varM = new Map();
  const t = { total: 0, count: 0, _d: new Set(), _r: new Set() };
  for (const v of memContrib.values()) {
    if (v.memo || (v.kind && v.kind !== "contribution")) continue;
    const val = String(v[col] || "").toUpperCase();
    if (!val.includes(needle)) continue;
    if (state && String(v.state || "").toUpperCase() !== String(state).toUpperCase()) continue;
    const amt = Number(v.amount) || 0;
    t.total += amt; t.count++; t._d.add(v.donorKey); t._r.add(v.recipientId);
    const r = recipM.get(v.recipientId) || { recipientId: v.recipientId, recipientName: v.recipientName, source: v.source, total: 0, count: 0, _d: new Set(), firstDate: null, lastDate: null };
    r.total += amt; r.count++; r._d.add(v.donorKey);
    if (v.date) { if (!r.firstDate || v.date < r.firstDate) r.firstDate = v.date; if (!r.lastDate || v.date > r.lastDate) r.lastDate = v.date; }
    recipM.set(v.recipientId, r);
    const d = donorM.get(v.donorKey) || { donorKey: v.donorKey, name: v.donorName, employer: v.employer, occupation: v.occupation, city: v.city, state: v.state, total: 0, count: 0, _r: new Set() };
    d.total += amt; d.count++; d._r.add(v.recipientId);
    donorM.set(v.donorKey, d);
    const vk = v[col] || "";
    const vv = varM.get(vk) || { value: vk, total: 0, count: 0 };
    vv.total += amt; vv.count++;
    varM.set(vk, vv);
  }
  const top = (m, fix) => [...m.values()].map(fix).sort((a, b) => b.total - a.total).slice(0, limit);
  return {
    totals: { total: t.total, count: t.count, donors: t._d.size, recipients: t._r.size },
    recipients: top(recipM, (r) => ({ ...r, donors: r._d.size, _d: undefined })),
    donors: top(donorM, (d) => ({ ...d, recipients: d._r.size, _r: undefined })),
    variants: top(varM, (v) => v),
  };
}

export function contribStats() {
  if (db) {
    // Header counters — informational, so they are reused for up to a minute even while ingests
    // are landing. Each count is answered from a covering index (the combined
    // COUNT(DISTINCT a), COUNT(DISTINCT b) form forced a ~2 s full-table pass on every Donors-tab load).
    return memoized("stats:contrib", () => {
      try {
        const n = (sql) => Number(Object.values(db.prepare(sql).get() || {})[0] || 0);
        return {
          rows: n("SELECT COUNT(*) FROM contributions"),
          donors: n("SELECT COUNT(*) FROM (SELECT DISTINCT donor_key FROM contributions INDEXED BY idx_contrib_donor)"),
          recipients: n("SELECT COUNT(*) FROM (SELECT DISTINCT recipient_id FROM contributions INDEXED BY idx_contrib_recip)"),
        };
      } catch { return { rows: 0, donors: 0, recipients: 0 }; }
    }, { minFreshMs: 60_000 });
  }
  return { rows: memContrib.size, donors: new Set([...memContrib.values()].map((v) => v.donorKey)).size,
    recipients: new Set([...memContrib.values()].map((v) => v.recipientId)).size };
}

// ---- permanent FEC reference + candidate-history stores ----
// Sparse upserts COALESCE so a thin row (e.g. from an elections listing) never blanks fields a
// richer row (candidate search, bulk master) already filled. first_seen is preserved on conflict.

const memFecCommittee = new Map(), memFecCandidate = new Map(), memCandTotals = new Map();

export function fecCommitteeUpsertMany(rows) {
  if (!rows?.length) return 0;
  const now = Date.now();
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO fec_committee (cmte_id, name, type, designation, party, state, connected_org, cand_id, last_cycle, first_seen, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cmte_id) DO UPDATE SET
        name=COALESCE(excluded.name, name), type=COALESCE(excluded.type, type),
        designation=COALESCE(excluded.designation, designation), party=COALESCE(excluded.party, party),
        state=COALESCE(excluded.state, state), connected_org=COALESCE(excluded.connected_org, connected_org),
        cand_id=COALESCE(excluded.cand_id, cand_id), last_cycle=COALESCE(excluded.last_cycle, last_cycle),
        fetched_at=excluded.fetched_at`);
    let n = 0;
    try {
      db.exec("BEGIN");
      for (const r of rows) {
        if (!r?.cmteId) continue;
        stmt.run(String(r.cmteId), r.name ?? null, r.type ?? null, r.designation ?? null, r.party ?? null,
          r.state ?? null, r.connectedOrg ?? null, r.candId ?? null, r.lastCycle != null ? String(r.lastCycle) : null, now, now);
        n++;
      }
      db.exec("COMMIT");
    } catch (e) { try { db.exec("ROLLBACK"); } catch { /* rolled back */ } console.warn("[fecCommitteeUpsertMany]", e.message); }
    bumpWrites();
    return n;
  }
  let n = 0;
  for (const r of rows) if (r?.cmteId) { memFecCommittee.set(String(r.cmteId), { ...memFecCommittee.get(String(r.cmteId)), ...r }); n++; }
  return n;
}

export function fecCandidateUpsertMany(rows) {
  if (!rows?.length) return 0;
  const now = Date.now();
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO fec_candidate (cand_id, name, party, office, state, district, pcc, incumbent_challenge, status, last_cycle, first_seen, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cand_id) DO UPDATE SET
        name=COALESCE(excluded.name, name), party=COALESCE(excluded.party, party),
        office=COALESCE(excluded.office, office), state=COALESCE(excluded.state, state),
        district=COALESCE(excluded.district, district), pcc=COALESCE(excluded.pcc, pcc),
        incumbent_challenge=COALESCE(excluded.incumbent_challenge, incumbent_challenge),
        status=COALESCE(excluded.status, status), last_cycle=COALESCE(excluded.last_cycle, last_cycle),
        fetched_at=excluded.fetched_at`);
    let n = 0;
    try {
      db.exec("BEGIN");
      for (const r of rows) {
        if (!r?.candId) continue;
        stmt.run(String(r.candId), r.name ?? null, r.party ?? null, r.office ?? null, r.state ?? null,
          r.district ?? null, r.pcc ?? null, r.incumbentChallenge ?? null, r.status ?? null,
          r.lastCycle != null ? String(r.lastCycle) : null, now, now);
        n++;
      }
      db.exec("COMMIT");
    } catch (e) { try { db.exec("ROLLBACK"); } catch { /* rolled back */ } console.warn("[fecCandidateUpsertMany]", e.message); }
    bumpWrites();
    return n;
  }
  let n = 0;
  for (const r of rows) if (r?.candId) { memFecCandidate.set(String(r.candId), { ...memFecCandidate.get(String(r.candId)), ...r }); n++; }
  return n;
}

// One row per (candidate, cycle, coverage period) — repeated pulls build filing-to-filing history.
export function candidateTotalsUpsertMany(rows) {
  if (!rows?.length) return 0;
  const now = Date.now();
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO candidate_totals (cand_id, cycle, coverage_end, receipts, disbursements, cash_on_hand, debts, source, first_seen, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cand_id, cycle, coverage_end) DO UPDATE SET
        receipts=COALESCE(excluded.receipts, receipts),
        disbursements=COALESCE(excluded.disbursements, disbursements),
        cash_on_hand=COALESCE(excluded.cash_on_hand, cash_on_hand),
        debts=COALESCE(excluded.debts, debts),
        source=excluded.source, fetched_at=excluded.fetched_at`);
    let n = 0;
    try {
      db.exec("BEGIN");
      for (const r of rows) {
        if (!r?.candId || r?.cycle == null) continue;
        stmt.run(String(r.candId), String(r.cycle), r.coverageEnd || "", r.receipts ?? null,
          r.disbursements ?? null, r.cashOnHand ?? null, r.debts ?? null, r.source ?? null, now, now);
        n++;
      }
      db.exec("COMMIT");
    } catch (e) { try { db.exec("ROLLBACK"); } catch { /* rolled back */ } console.warn("[candidateTotalsUpsertMany]", e.message); }
    bumpWrites();
    return n;
  }
  let n = 0;
  for (const r of rows) {
    if (!r?.candId || r?.cycle == null) continue;
    memCandTotals.set(`${r.candId}|${r.cycle}|${r.coverageEnd || ""}`, r); n++;
  }
  return n;
}

export function fecCommitteeGet(cmteId) {
  if (db) { try { return db.prepare("SELECT * FROM fec_committee WHERE cmte_id = ?").get(String(cmteId)) || null; } catch { return null; } }
  return memFecCommittee.get(String(cmteId)) || null;
}

export function fecCandidateGet(candId) {
  if (db) { try { return db.prepare("SELECT * FROM fec_candidate WHERE cand_id = ?").get(String(candId)) || null; } catch { return null; } }
  return memFecCandidate.get(String(candId)) || null;
}

export function candidateTotalsList(candId) {
  if (db) {
    try {
      return db.prepare(`SELECT cand_id AS candId, cycle, coverage_end AS coverageEnd, receipts,
        disbursements, cash_on_hand AS cashOnHand, debts, source
        FROM candidate_totals WHERE cand_id = ? ORDER BY cycle DESC, coverage_end DESC`).all(String(candId));
    } catch { return []; }
  }
  return [...memCandTotals.values()].filter((r) => String(r.candId) === String(candId));
}

export function fecRefStats() {
  if (db) {
    return memoized("stats:fecref", () => {
      try {
        return {
          committees: Number(db.prepare("SELECT COUNT(*) AS n FROM fec_committee").get()?.n || 0),
          candidates: Number(db.prepare("SELECT COUNT(*) AS n FROM fec_candidate").get()?.n || 0),
          totalsRows: Number(db.prepare("SELECT COUNT(*) AS n FROM candidate_totals").get()?.n || 0),
        };
      } catch { return { committees: 0, candidates: 0, totalsRows: 0 }; }
    }, { minFreshMs: 60_000 });
  }
  return { committees: memFecCommittee.size, candidates: memFecCandidate.size, totalsRows: memCandTotals.size };
}

// ---- donor watchlist ----

export function watchAdd({ donorKey, displayName, employer = "", state = "" }) {
  const now = Date.now();
  if (db) {
    try {
      db.prepare(`
        INSERT INTO donor_watch (donor_key, display_name, employer, state, added_at, last_checked)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(donor_key) DO UPDATE SET display_name=excluded.display_name,
          employer=excluded.employer, state=excluded.state
      `).run(String(donorKey), String(displayName), employer || null, state || null, now, now);
    } catch { /* best-effort */ }
    return;
  }
  if (!memWatch.has(donorKey)) memWatch.set(donorKey, { donorKey, displayName, employer, state, addedAt: now, lastChecked: now, lastTotal: 0, lastCount: 0 });
}

export function watchRemove(donorKey) {
  if (db) { try { db.prepare("DELETE FROM donor_watch WHERE donor_key = ?").run(String(donorKey)); } catch { /* best-effort */ } return; }
  memWatch.delete(donorKey);
}

export function watchHas(donorKey) {
  if (db) { try { return Boolean(db.prepare("SELECT 1 FROM donor_watch WHERE donor_key = ?").get(String(donorKey))); } catch { return false; } }
  return memWatch.has(donorKey);
}

// Watchlist with live totals plus "new since last check" counts (first_seen > last_checked).
export function watchList() {
  if (db) {
    try {
      return db.prepare(`
        SELECT w.donor_key AS donorKey, w.display_name AS displayName, w.employer, w.state,
               w.added_at AS addedAt, w.last_checked AS lastChecked, w.last_total AS lastTotal, w.last_count AS lastCount,
               COALESCE(SUM(c.amount), 0) AS total, COUNT(c.sub_id) AS count,
               COALESCE(SUM(CASE WHEN c.first_seen > COALESCE(w.last_checked, w.added_at) THEN 1 ELSE 0 END), 0) AS newCount,
               COALESCE(SUM(CASE WHEN c.first_seen > COALESCE(w.last_checked, w.added_at) THEN c.amount ELSE 0 END), 0) AS newAmount
        FROM donor_watch w
        LEFT JOIN contributions c ON c.donor_key = w.donor_key AND c.kind = 'contribution' AND c.memo = 0
        GROUP BY w.donor_key ORDER BY w.added_at DESC
      `).all();
    } catch { return []; }
  }
  return [...memWatch.values()].map((w) => {
    const rows = [...memContrib.values()].filter((v) => v.donorKey === w.donorKey && (!v.kind || v.kind === "contribution"));
    const since = w.lastChecked || w.addedAt;
    const fresh = rows.filter((v) => (v.firstSeen || 0) > since);
    return { ...w, total: rows.reduce((a, v) => a + v.amount, 0), count: rows.length,
      newCount: fresh.length, newAmount: fresh.reduce((a, v) => a + v.amount, 0) };
  });
}

// Mark a watched donor "seen": baseline the new-gift detection at now.
export function watchMarkSeen(donorKey, { total = 0, count = 0 } = {}) {
  const now = Date.now();
  if (db) {
    try { db.prepare("UPDATE donor_watch SET last_checked = ?, last_total = ?, last_count = ? WHERE donor_key = ?").run(now, total, count, String(donorKey)); } catch { /* best-effort */ }
    return;
  }
  const w = memWatch.get(donorKey);
  if (w) { w.lastChecked = now; w.lastTotal = total; w.lastCount = count; }
}

// ---- TN entity watchlist (mirrors donor_watch) ----
// "New rows" = stored TN ledger rows (contributions, source 'tn') whose first_seen postdates
// the last time the user opened the entity — same detection the donor watchlist uses.

const memTnWatch = new Map();

export function tnWatchAdd({ tnId, name, office = "", party = "" }) {
  const now = Date.now();
  if (db) {
    try {
      db.prepare(`
        INSERT INTO tn_watch (tn_id, name, office, party, added_at, last_checked)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tn_id) DO UPDATE SET name=excluded.name,
          office=COALESCE(excluded.office, office), party=COALESCE(excluded.party, party)
      `).run(String(tnId), String(name), office || null, party || null, now, now);
    } catch { /* best-effort */ }
    return;
  }
  if (!memTnWatch.has(String(tnId))) memTnWatch.set(String(tnId), { tnId: String(tnId), name, office, party, addedAt: now, lastChecked: now });
}

export function tnWatchRemove(tnId) {
  if (db) { try { db.prepare("DELETE FROM tn_watch WHERE tn_id = ?").run(String(tnId)); } catch { /* best-effort */ } return; }
  memTnWatch.delete(String(tnId));
}

export function tnWatchHas(tnId) {
  if (db) { try { return Boolean(db.prepare("SELECT 1 FROM tn_watch WHERE tn_id = ?").get(String(tnId))); } catch { return false; } }
  return memTnWatch.has(String(tnId));
}

export function tnWatchList() {
  if (db) {
    try {
      return db.prepare(`
        SELECT w.tn_id AS tnId, w.name, w.office, w.party,
               w.added_at AS addedAt, w.last_checked AS lastChecked,
               COALESCE(SUM(CASE WHEN c.kind = 'contribution' THEN c.amount ELSE 0 END), 0) AS received,
               COALESCE(SUM(CASE WHEN c.kind = 'disbursement' THEN c.amount ELSE 0 END), 0) AS spent,
               COUNT(c.sub_id) AS rowCount,
               COALESCE(SUM(CASE WHEN c.first_seen > COALESCE(w.last_checked, w.added_at) THEN 1 ELSE 0 END), 0) AS newCount
        FROM tn_watch w
        LEFT JOIN contributions c ON c.source = 'tn' AND c.recipient_id = w.tn_id
        GROUP BY w.tn_id ORDER BY w.added_at DESC
      `).all();
    } catch { return []; }
  }
  return [...memTnWatch.values()].map((w) => ({ ...w, received: 0, spent: 0, rowCount: 0, newCount: 0 }));
}

export function tnWatchMarkSeen(tnId) {
  const now = Date.now();
  if (db) { try { db.prepare("UPDATE tn_watch SET last_checked = ? WHERE tn_id = ?").run(now, String(tnId)); } catch { /* best-effort */ } return; }
  const w = memTnWatch.get(String(tnId));
  if (w) w.lastChecked = now;
}

// ---- federal candidate watchlist ----
// Change detection is richer than the other trackers: candidate_totals stores filing-period
// history, so "new filing: +$X raised" comes from comparing latest receipts vs last_receipts.

const memCandWatch = new Map();

export function candWatchAdd({ candId, name, party = "", state = "", office = "", district = "", pcc = "" }) {
  const now = Date.now();
  if (db) {
    try {
      db.prepare(`
        INSERT INTO cand_watch (cand_id, name, party, state, office, district, pcc, added_at, last_checked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cand_id) DO UPDATE SET name=excluded.name,
          party=COALESCE(excluded.party, party), state=COALESCE(excluded.state, state),
          office=COALESCE(excluded.office, office), district=COALESCE(excluded.district, district),
          pcc=COALESCE(excluded.pcc, pcc)
      `).run(String(candId), String(name), party || null, state || null, office || null, district || null, pcc || null, now, now);
    } catch { /* best-effort */ }
    return;
  }
  if (!memCandWatch.has(String(candId))) memCandWatch.set(String(candId), { candId, name, party, state, office, district, pcc, addedAt: now, lastChecked: now });
}

export function candWatchRemove(candId) {
  if (db) { try { db.prepare("DELETE FROM cand_watch WHERE cand_id = ?").run(String(candId)); } catch { /* best-effort */ } return; }
  memCandWatch.delete(String(candId));
}

export function candWatchHas(candId) {
  if (db) { try { return Boolean(db.prepare("SELECT 1 FROM cand_watch WHERE cand_id = ?").get(String(candId))); } catch { return false; } }
  return memCandWatch.has(String(candId));
}

export function candWatchRows() {
  if (db) {
    try {
      return db.prepare(`
        SELECT w.cand_id AS candId, w.name, w.party, w.state, w.office, w.district, w.pcc,
               w.added_at AS addedAt, w.last_checked AS lastChecked, w.last_receipts AS lastReceipts,
               COALESCE(SUM(CASE WHEN c.first_seen > COALESCE(w.last_checked, w.added_at) THEN 1 ELSE 0 END), 0) AS newRows
        FROM cand_watch w
        LEFT JOIN contributions c ON c.recipient_id = w.pcc AND c.kind = 'contribution'
        GROUP BY w.cand_id ORDER BY w.added_at DESC
      `).all();
    } catch { return []; }
  }
  return [...memCandWatch.values()].map((w) => ({ ...w, newRows: 0 }));
}

export function candWatchMarkSeen(candId, latestReceipts = null) {
  const now = Date.now();
  if (db) {
    try { db.prepare("UPDATE cand_watch SET last_checked = ?, last_receipts = COALESCE(?, last_receipts) WHERE cand_id = ?").run(now, latestReceipts, String(candId)); } catch { /* best-effort */ }
    return;
  }
  const w = memCandWatch.get(String(candId));
  if (w) { w.lastChecked = now; if (latestReceipts != null) w.lastReceipts = latestReceipts; }
}

// ---- nationwide quick-find over the stored masters (zero FEC calls) ----
export function fecMasterFind(q, limit = 8) {
  const toks = String(q || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!toks.length || !db) return { candidates: [], committees: [] };
  try {
    const conds = toks.map(() => "name LIKE ?").join(" AND "); // LIKE is ASCII case-insensitive already
    const args = toks.map((t) => `%${t}%`);
    const candidates = db.prepare(`
      SELECT cand_id AS candId, name, party, office, state, district, pcc, last_cycle AS lastCycle
      FROM fec_candidate WHERE ${conds} ORDER BY last_cycle DESC LIMIT ?`).all(...args, limit);
    const committees = db.prepare(`
      SELECT cmte_id AS cmteId, name, type, party, state, cand_id AS candId
      FROM fec_committee WHERE ${conds} LIMIT ?`).all(...args, limit);
    return { candidates, committees };
  } catch { return { candidates: [], committees: [] }; }
}

// Filing-period totals for a set of candidates (sparkline feed).
export function candidateTotalsForMany(candIds) {
  const ids = (candIds || []).map(String).filter(Boolean);
  if (!ids.length || !db) return {};
  try {
    const rows = db.prepare(`
      SELECT cand_id AS candId, cycle, coverage_end AS coverageEnd, receipts, cash_on_hand AS cashOnHand
      FROM candidate_totals WHERE cand_id IN (${ids.map(() => "?").join(",")})
      ORDER BY cycle ASC, coverage_end ASC`).all(...ids);
    const out = {};
    for (const r of rows) (out[r.candId] = out[r.candId] || []).push(r);
    return out;
  } catch { return {}; }
}

// ---- alert feed + standing searches (the app's proactive layer) ----
if (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL,
      subject TEXT NOT NULL, detail TEXT, amount REAL, ref TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS standing_search (
      id TEXT PRIMARY KEY, q TEXT NOT NULL, field TEXT NOT NULL,
      added_at INTEGER NOT NULL, last_checked INTEGER
    );
  `);
}
const memAlerts = [], memSS = new Map();

export function alertAdd(list) { // ref-deduped: the same event never alerts twice
  let n = 0;
  for (const a of list || []) {
    if (db) {
      try { db.prepare("INSERT OR IGNORE INTO alert_feed (at, kind, subject, detail, amount, ref) VALUES (?, ?, ?, ?, ?, ?)")
        .run(Date.now(), a.kind, a.subject, a.detail ?? null, a.amount ?? null, a.ref ?? null); n++; } catch { /* dup */ }
    } else if (!memAlerts.some((x) => x.ref && x.ref === a.ref)) { memAlerts.push({ ...a, at: Date.now() }); n++; }
  }
  return n;
}
export function alertList(limit = 80) {
  if (db) { try { return db.prepare("SELECT * FROM alert_feed ORDER BY id DESC LIMIT ?").all(limit); } catch { return []; } }
  return memAlerts.slice(-limit).reverse();
}
export function ssAdd({ q, field }) {
  const id = `${field}:${String(q).toUpperCase().trim()}`;
  const now = Date.now();
  if (db) { try { db.prepare("INSERT OR IGNORE INTO standing_search (id, q, field, added_at, last_checked) VALUES (?, ?, ?, ?, ?)").run(id, q, field, now, now); } catch { /* dup */ } return; }
  if (!memSS.has(id)) memSS.set(id, { id, q, field, addedAt: now, lastChecked: now });
}
export function ssRemove(id) {
  if (db) { try { db.prepare("DELETE FROM standing_search WHERE id = ?").run(String(id)); } catch { /* best-effort */ } return; }
  memSS.delete(id);
}
export function ssList() {
  if (db) { try { return db.prepare("SELECT id, q, field, added_at AS addedAt, last_checked AS lastChecked FROM standing_search ORDER BY added_at DESC").all(); } catch { return []; } }
  return [...memSS.values()];
}
export function ssMarkSeen(id) {
  if (db) { try { db.prepare("UPDATE standing_search SET last_checked = ? WHERE id = ?").run(Date.now(), String(id)); } catch { /* best-effort */ } return; }
  const s = memSS.get(id); if (s) s.lastChecked = Date.now();
}
// change queries for the scan (all first_seen-based, all read the permanent ledger)
export function ieNewSince(candId, since) {
  if (!db) return { forN: 0, forAmt: 0, againstN: 0, againstAmt: 0 };
  try {
    const r = db.prepare(`
      SELECT SUM(CASE WHEN report LIKE 'IE FOR%' THEN amount ELSE 0 END) AS forAmt,
             SUM(CASE WHEN report LIKE 'IE FOR%' THEN 1 ELSE 0 END) AS forN,
             SUM(CASE WHEN report LIKE 'IE AGAINST%' THEN amount ELSE 0 END) AS againstAmt,
             SUM(CASE WHEN report LIKE 'IE AGAINST%' THEN 1 ELSE 0 END) AS againstN
      FROM contributions WHERE kind = 'ie' AND candidate_id = ? AND first_seen > ?`).get(String(candId), since);
    return { forN: r?.forN || 0, forAmt: r?.forAmt || 0, againstN: r?.againstN || 0, againstAmt: r?.againstAmt || 0 };
  } catch { return { forN: 0, forAmt: 0, againstN: 0, againstAmt: 0 }; }
}
export function donorNewRecipSince(donorKey, since, limit = 6) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT COALESCE(recipient_name, recipient_id) AS name, SUM(amount) AS total, COUNT(*) AS n
      FROM contributions WHERE donor_key = ? AND kind = 'contribution' AND memo = 0 AND first_seen > ?
      GROUP BY COALESCE(recipient_name, recipient_id) ORDER BY total DESC LIMIT ?`).all(String(donorKey), since, limit);
  } catch { return []; }
}
export function fieldNewSince(q, field, since) {
  if (!db) return { n: 0, amt: 0 };
  try {
    const col = field === "occupation" ? "occupation" : "employer";
    const r = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM contributions
      WHERE kind='contribution' AND memo=0 AND UPPER(${col}) LIKE ? AND first_seen > ?`).get(`%${String(q).toUpperCase()}%`, since);
    return { n: r?.n || 0, amt: r?.amt || 0 };
  } catch { return { n: 0, amt: 0 }; }
}

// ---- maintenance ----
// WAL-checkpoint then copy the db file — a consistent snapshot without stopping the server.
export function dbBackup() {
  if (!db) return { error: "No persistent database to back up." };
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const src = path.join(DATA_DIR, "fec-terminal.db");
    const dir = path.join(DATA_DIR, "backups");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
    const dest = path.join(dir, `fec-terminal-${stamp}.db`);
    fs.copyFileSync(src, dest);
    const bytes = fs.statSync(dest).size;
    const list = fs.readdirSync(dir).filter((f) => f.endsWith(".db")).sort().reverse();
    return { file: path.basename(dest), bytes, backups: list.slice(0, 10) };
  } catch (e) { return { error: e.message }; }
}

export function dbAnalyze() {
  if (!db) return false;
  try { db.exec("ANALYZE"); return true; } catch { return false; }
}

// ---- change probes (cheap "did anything change?" signatures) ----

export function probeGet(key) {
  if (db) {
    try {
      const row = db.prepare("SELECT signature, payload, checked_at FROM probe WHERE key = ?").get(String(key));
      if (!row) return null;
      return { signature: row.signature, payload: row.payload ? JSON.parse(row.payload) : null, checkedAt: Number(row.checked_at) };
    } catch { return null; }
  }
  return memProbe.get(key) || null;
}

export function probeSet(key, signature, payload = null) {
  const now = Date.now();
  if (db) {
    try {
      db.prepare(`INSERT INTO probe (key, signature, payload, checked_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET signature=excluded.signature, payload=excluded.payload, checked_at=excluded.checked_at`)
        .run(String(key), String(signature), payload != null ? JSON.stringify(payload) : null, now);
    } catch { /* best-effort */ }
    return;
  }
  memProbe.set(key, { signature: String(signature), payload, checkedAt: now });
}

// ---- Tennessee directory (tn_entity) ----
// Rows come from TREF candidate/PAC searches (server/tn.js entity rows). Upserts COALESCE so a
// thin row from a narrow search never blanks fields a full-column sync already stored.
const memTnEntity = new Map();
const TN_ENTITY_COLS = ["kind", "name", "party", "office", "district", "address", "city", "state", "zip", "phone",
  "email", "treasurer", "treasurer_city", "primary_result", "general_result", "committee", "officers",
  "responsible", "created", "closed"];
const TN_ENTITY_FIELDS = { kind: "kind", name: "name", party: "party", office: "office", district: "district",
  address: "address", city: "city", state: "state", zip: "zip", phone: "phone", email: "email",
  treasurer: "treasurer", treasurer_city: "treasurerCity", primary_result: "primaryResult",
  general_result: "generalResult", committee: "committee", officers: "officers", responsible: "responsible",
  created: "created", closed: "closed" };

export function tnEntityUpsertMany(rows) {
  if (!rows?.length) return 0;
  const now = Date.now();
  if (!db) {
    let n = 0;
    for (const r of rows) {
      if (!r?.tnId || !r?.name) continue;
      const k = `${r.tnId}|${r.year || ""}`;
      memTnEntity.set(k, { ...memTnEntity.get(k), ...r, year: r.year || "", fetchedAt: now });
      n++;
    }
    return n;
  }
  const stmt = db.prepare(`
    INSERT INTO tn_entity (tn_id, year, ${TN_ENTITY_COLS.join(", ")}, first_seen, fetched_at)
    VALUES (?, ?, ${TN_ENTITY_COLS.map(() => "?").join(", ")}, ?, ?)
    ON CONFLICT(tn_id, year) DO UPDATE SET
      ${TN_ENTITY_COLS.map((c) => `${c}=COALESCE(NULLIF(excluded.${c}, ''), ${c})`).join(", ")},
      fetched_at=excluded.fetched_at`);
  let n = 0;
  try {
    db.exec("BEGIN");
    for (const r of rows) {
      if (!r?.tnId || !r?.name) continue;
      stmt.run(String(r.tnId), String(r.year || ""),
        ...TN_ENTITY_COLS.map((c) => { const v = r[TN_ENTITY_FIELDS[c]]; return v == null || v === "" ? null : String(v); }),
        now, now);
      n++;
    }
    db.exec("COMMIT");
  } catch (e) { try { db.exec("ROLLBACK"); } catch { /* rolled back */ } console.warn("[tnEntityUpsertMany]", e.message); }
  return n;
}

const tnEntityOut = (r) => ({ tnId: r.tn_id, year: r.year, kind: r.kind, name: r.name, party: r.party, office: r.office,
  district: r.district, address: r.address, city: r.city, state: r.state, zip: r.zip, phone: r.phone, email: r.email,
  treasurer: r.treasurer, treasurerCity: r.treasurer_city, primaryResult: r.primary_result,
  generalResult: r.general_result, committee: r.committee, officers: r.officers, responsible: r.responsible,
  created: r.created, closed: r.closed, fetchedAt: Number(r.fetched_at) });

// Local directory search. `q` tokens must all appear (any order) across name / treasurer /
// officers / city / zip / email / committee — substring, case-insensitive. Structured filters are
// exact. Returns { rows, total }.
export function tnEntitySearch({ q = "", kind = "", office = "", district = "", party = "", year = "",
  city = "", zip = "", winner = "", openOnly = false, limit = 200, offset = 0 } = {}) {
  const toks = String(q).trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!db) {
    const hay = (r) => [r.name, r.treasurer, r.officers, r.city, r.zip, r.email, r.committee, r.responsible].join(" ").toLowerCase();
    let rows = [...memTnEntity.values()].filter((r) =>
      toks.every((t) => hay(r).includes(t.toLowerCase())) &&
      (!kind || r.kind === kind) && (!office || r.office === office) && (!district || String(r.district) === String(district)) &&
      (!party || r.party === party) && (!year || String(r.year) === String(year)) &&
      (!city || String(r.city || "").toLowerCase() === city.toLowerCase()) && (!zip || String(r.zip || "").startsWith(zip)));
    const total = rows.length;
    rows = rows.sort((a, b) => String(b.year).localeCompare(String(a.year)) || String(a.name).localeCompare(String(b.name)))
      .slice(offset, offset + limit).map((r) => ({ ...r }));
    return { rows, total };
  }
  try {
    const conds = [], args = [];
    for (const t of toks) {
      conds.push(`(name LIKE ? OR treasurer LIKE ? OR officers LIKE ? OR city LIKE ? OR zip LIKE ? OR email LIKE ? OR committee LIKE ? OR responsible LIKE ?)`);
      for (let i = 0; i < 8; i++) args.push(`%${t}%`);
    }
    const eq = (col, v) => { if (v) { conds.push(`${col} = ? COLLATE NOCASE`); args.push(String(v)); } };
    eq("kind", kind); eq("office", office); eq("party", party); eq("year", year); eq("city", city);
    if (district) { conds.push("CAST(district AS INTEGER) = CAST(? AS INTEGER)"); args.push(String(district)); }
    if (zip) { conds.push("zip LIKE ?"); args.push(`${zip}%`); }
    if (winner === "general") conds.push("general_result LIKE '%(W)%'");
    if (winner === "primary") conds.push("primary_result LIKE '%(W)%'");
    if (openOnly) conds.push("(closed IS NULL OR closed = '')");
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM tn_entity ${where}`).get(...args)?.n || 0);
    const rows = db.prepare(`SELECT * FROM tn_entity ${where}
      ORDER BY year DESC, name ASC LIMIT ? OFFSET ?`).all(...args, limit, offset).map(tnEntityOut);
    return { rows, total };
  } catch (e) { console.warn("[tnEntitySearch]", e.message); return { rows: [], total: 0 }; }
}

export function tnEntityStats() {
  if (!db) return { rows: memTnEntity.size, entities: new Set([...memTnEntity.values()].map((r) => r.tnId)).size, scopes: [] };
  try {
    const r = db.prepare("SELECT COUNT(*) AS rows, COUNT(DISTINCT tn_id) AS entities FROM tn_entity").get();
    const scopes = db.prepare("SELECT scope, label, count, synced_at AS syncedAt FROM tn_sync ORDER BY synced_at DESC").all()
      .map((x) => ({ ...x, count: Number(x.count), syncedAt: Number(x.syncedAt) }));
    return { rows: Number(r?.rows || 0), entities: Number(r?.entities || 0), scopes };
  } catch { return { rows: 0, entities: 0, scopes: [] }; }
}

// Distinct values for the directory's filter dropdowns (cities, offices, years actually stored).
export function tnEntityFacets() {
  if (!db) return { cities: [], years: [], offices: [] };
  try {
    const col = (c, lim) => db.prepare(`SELECT ${c} AS v, COUNT(*) AS n FROM tn_entity WHERE ${c} IS NOT NULL AND ${c} != ''
      GROUP BY ${c} COLLATE NOCASE ORDER BY n DESC LIMIT ?`).all(lim).map((x) => ({ value: x.v, count: Number(x.n) }));
    return { cities: col("city", 400), years: col("year", 80), offices: col("office", 40) };
  } catch { return { cities: [], years: [], offices: [] }; }
}

export function tnSyncMark(scope, label, count) {
  if (!db) return;
  try {
    db.prepare(`INSERT INTO tn_sync (scope, label, count, synced_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET label=excluded.label, count=excluded.count, synced_at=excluded.synced_at`)
      .run(String(scope), String(label || ""), Number(count) || 0, Date.now());
  } catch { /* best-effort */ }
}
export function tnSyncGet(scope) {
  if (!db) return null;
  try {
    const r = db.prepare("SELECT count, synced_at AS syncedAt FROM tn_sync WHERE scope = ?").get(String(scope));
    return r ? { count: Number(r.count), syncedAt: Number(r.syncedAt) } : null;
  } catch { return null; }
}

// ---- candidate donor roll-up: every stored donor of a set of recipient committees ----
// One row per donor_key across the given committees (and optionally two-year periods). Memo rows
// are excluded (FEC accounting: they never count toward totals). Index: idx_contrib_recip.
export function contribRecipientDonorGroups(recipientIds, { cycles = [], source = "fec", limit = 25000 } = {}) {
  const ids = (recipientIds || []).map(String).filter(Boolean);
  if (!ids.length) return [];
  const cys = (cycles || []).map(String).filter(Boolean);
  if (!db) {
    const m = new Map();
    for (const v of memContrib.values()) {
      if (v.source !== source || (v.kind || "contribution") !== "contribution" || v.memo) continue;
      if (!ids.includes(String(v.recipientId)) || (cys.length && !cys.includes(String(v.cycle)))) continue;
      const g = m.get(v.donorKey) || { donorKey: v.donorKey, name: v.donorName, employer: v.employer, occupation: v.occupation,
        city: v.city, state: v.state, entityType: v.entityType, zip: v.zip || null, total: 0, count: 0, firstDate: null, lastDate: null };
      g.total += Number(v.amount) || 0; g.count++;
      if (v.date) { if (!g.firstDate || v.date < g.firstDate) g.firstDate = v.date; if (!g.lastDate || v.date > g.lastDate) g.lastDate = v.date; }
      m.set(v.donorKey, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total).slice(0, limit);
  }
  return memoized(`rdg:${source}|${ids.join(",")}|${cys.join(",")}|${limit}`, () => {
    try {
      const conds = [`recipient_id IN (${ids.map(() => "?").join(",")})`, "source = ?", "kind = 'contribution'", "memo = 0"];
      const args = [...ids, source];
      if (cys.length) { conds.push(`cycle IN (${cys.map(() => "?").join(",")})`); args.push(...cys); }
      return db.prepare(`
        SELECT donor_key AS donorKey, MAX(donor_name) AS name, MAX(employer) AS employer, MAX(occupation) AS occupation,
               MAX(city) AS city, MAX(state) AS state, MAX(entity_type) AS entityType, MAX(zip) AS zip,
               SUM(amount) AS total, COUNT(*) AS count, MIN(NULLIF(date, '')) AS firstDate, MAX(date) AS lastDate
        FROM contributions WHERE ${conds.join(" AND ")}
        GROUP BY donor_key ORDER BY total DESC LIMIT ?`).all(...args, limit);
    } catch (e) { console.warn("[contribRecipientDonorGroups]", e.message); return []; }
  });
}

// Stored itemized rows for one committee + two-year period (memo rows included — it is a row count).
export function contribRecipientRowCount(recipientId, cycle = "", source = "fec") {
  if (!db) return [...memContrib.values()].filter((v) => v.source === source && String(v.recipientId) === String(recipientId) && (!cycle || String(v.cycle) === String(cycle))).length;
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM contributions WHERE recipient_id = ? AND source = ? AND kind = 'contribution'${cycle ? " AND cycle = ?" : ""}`)
      .get(...(cycle ? [String(recipientId), source, String(cycle)] : [String(recipientId), source]))?.n || 0);
  } catch { return 0; }
}

// How many of these sub_ids are already stored (used to stop an incremental pull once it reaches known rows).
export function contribExistingCount(source, subIds) {
  const ids = (subIds || []).map(String).filter(Boolean);
  if (!ids.length) return 0;
  if (!db) return ids.filter((id) => memContrib.has(`${source}:${id}`)).length;
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM contributions WHERE source = ? AND sub_id IN (${ids.map(() => "?").join(",")})`).get(String(source), ...ids)?.n || 0);
  } catch { return 0; }
}

// ---- place lookups (who gives from a ZIP / city, and to whom) ----
// zips: array of 5-digit ZIPs (a county is passed as its ZIP list); city+state as the fallback for
// rows stored before ZIPs were captured. Contributions only, memo rows excluded.
export function contribPlace({ zips = [], city = "", state = "", limit = 100 } = {}) {
  const empty = { totals: { total: 0, count: 0, donors: 0, recipients: 0 }, donors: [], recipients: [], bySource: [] };
  const zl = (zips || []).map(String).filter((z) => /^\d{5}$/.test(z)).slice(0, 400);
  if (!db || (!zl.length && !city)) return empty;
  return memoized(`place:${zl.join(",")}|${city}|${state}|${limit}`, () => {
    try {
      const conds = ["kind = 'contribution'", "memo = 0"], args = [];
      if (zl.length) { conds.push(`zip IN (${zl.map(() => "?").join(",")})`); args.push(...zl); }
      else { conds.push("city = ? COLLATE NOCASE"); args.push(city); if (state) { conds.push("state = ? COLLATE NOCASE"); args.push(state); } }
      db.exec(`CREATE TEMP TABLE IF NOT EXISTS place_hit (
        donor_key TEXT, donor_name TEXT, employer TEXT, occupation TEXT, city TEXT, zip TEXT,
        recipient_id TEXT, recipient_name TEXT, source TEXT, date TEXT, amount REAL);
        DELETE FROM temp.place_hit;`);
      db.prepare(`INSERT INTO temp.place_hit
        SELECT donor_key, donor_name, employer, occupation, city, zip, recipient_id, recipient_name, source, date, amount
        FROM contributions WHERE ${conds.join(" AND ")}`).run(...args);
      const totals = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count,
        COUNT(DISTINCT donor_key) AS donors, COUNT(DISTINCT recipient_id || source) AS recipients FROM temp.place_hit`).get();
      const donors = db.prepare(`SELECT donor_key AS donorKey, MAX(donor_name) AS name, MAX(employer) AS employer, MAX(occupation) AS occupation,
        MAX(city) AS city, MAX(zip) AS zip, SUM(amount) AS total, COUNT(*) AS count, COUNT(DISTINCT recipient_id || source) AS recipients, MAX(date) AS lastDate
        FROM temp.place_hit GROUP BY donor_key ORDER BY total DESC LIMIT ?`).all(limit);
      const recipients = db.prepare(`SELECT recipient_id AS recipientId, MAX(recipient_name) AS name, source, SUM(amount) AS total, COUNT(*) AS count,
        COUNT(DISTINCT donor_key) AS donors, MAX(date) AS lastDate
        FROM temp.place_hit GROUP BY recipient_id, source ORDER BY total DESC LIMIT ?`).all(limit);
      const bySource = db.prepare("SELECT source, SUM(amount) AS total, COUNT(*) AS count FROM temp.place_hit GROUP BY source").all();
      db.exec("DELETE FROM temp.place_hit");
      return { totals, donors, recipients, bySource };
    } catch (e) { console.warn("[contribPlace]", e.message); return empty; }
  });
}

// Sibling donor_keys for identity merging: every stored key whose normalized name starts with the
// same surname and contains the same first name (cheap pre-filter on the small donor_names table;
// the caller applies the real matching rule).
export function donorKeyCandidates(surname, first, limit = 200) {
  if (!db || !surname) return [];
  try {
    return db.prepare(`SELECT DISTINCT donor_key AS donorKey, donor_name AS name FROM donor_names
      WHERE donor_key LIKE ? AND donor_key LIKE ? LIMIT ?`).all(`${surname} %`, `%${first}%`, limit);
  } catch { return []; }
}
// One location hint per donor key (latest non-null zip / state / employer).
export function donorKeyFacts(keys) {
  const ks = (keys || []).map(String).filter(Boolean).slice(0, 300);
  if (!db || !ks.length) return [];
  try {
    return db.prepare(`SELECT donor_key AS donorKey, MAX(donor_name) AS name, MAX(zip) AS zip, MAX(state) AS state, MAX(employer) AS employer,
      MAX(entity_type) AS entityType, SUM(CASE WHEN memo = 0 AND kind = 'contribution' THEN amount ELSE 0 END) AS total, COUNT(*) AS count
      FROM contributions WHERE donor_key IN (${ks.map(() => "?").join(",")}) GROUP BY donor_key`).all(...ks);
  } catch { return []; }
}

// Exact committee lookup by name (used to resolve "X VICTORY FUND" transfer lines to a committee id).
export function fecCommitteeByName(name) {
  if (!db || !name) return null;
  try {
    const r = db.prepare(`SELECT cmte_id AS cmteId, name, type, designation, state FROM fec_committee WHERE name = ? COLLATE NOCASE
      ORDER BY last_cycle DESC LIMIT 1`).get(String(name).trim());
    return r || null;
  } catch { return null; }
}
export function fecCommitteesIn(state) {
  if (!db) return [];
  try { return db.prepare("SELECT cmte_id AS cmteId FROM fec_committee WHERE state = ?").all(String(state)).map((r) => r.cmteId); } catch { return []; }
}

// Directory rows first stored after `since` (new registrations seen by a sync).
export function tnEntityNewSince(since, limit = 200) {
  if (!db) return [];
  try {
    return db.prepare("SELECT * FROM tn_entity WHERE first_seen > ? ORDER BY first_seen DESC LIMIT ?").all(Number(since) || 0, limit).map(tnEntityOut);
  } catch { return []; }
}

// Raw handle for feature modules that own their own tables (server/statehouse.js). null when
// node:sqlite is unavailable — those modules then keep their data in memory only.
export const rawDb = () => db;
