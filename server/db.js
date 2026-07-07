// SQLite-backed cache + settings, using node:sqlite (built into Node >= 22.13 — no npm dep).
// Falls back to in-memory Maps if node:sqlite is unavailable so local dev on an older
// Node still works; the container always has it.

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

let db = null;
let stmts = null;

try {
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "fec-terminal.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
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
  // hourly sweep of expired rows
  setInterval(() => { try { stmts.sweep.run(Date.now()); } catch { /* sweep is best-effort */ } }, 3_600_000).unref();
  console.log(`SQLite cache at ${path.join(DATA_DIR, "fec-terminal.db")}`);
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
        memo, report, first_seen, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        report=COALESCE(excluded.report, report), fetched_at=excluded.fetched_at
    `); // first_seen deliberately NOT updated; sparse re-upserts must not blank out stored fields
    let n = 0;
    try {
      db.exec("BEGIN");
      for (const r of rows) {
        if (!r?.source || !r?.subId || !r?.donorKey) continue;
        stmt.run(String(r.source), String(r.subId), r.kind || "contribution", String(r.donorKey),
          r.donorName ?? null, r.employer ?? null, r.occupation ?? null, r.city ?? null,
          r.state ?? null, r.entityType ?? null, r.recipientId ?? null, r.recipientName ?? null,
          r.candidateId ?? null, r.cycle != null ? String(r.cycle) : null, r.date || "",
          Number(r.amount) || 0, r.memo ? 1 : 0, r.report ?? null, now, now);
        n++;
      }
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      console.warn("[contribUpsertMany]", e.message);
    }
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
    return;
  }
  for (const [k, v] of memContrib) if (v.source === source && String(v.recipientId) === String(recipientId)) memContrib.delete(k);
}

// Targeted purge for superseded TN filings: an amended report replaces the original, so the
// original's rows (sub_id = `${reportId}:cN` / `${reportId}:eN`) are deleted by reportId prefix —
// never the whole entity, so a partial budget-capped read can't wipe unrelated history.
export function contribDeleteBySubIdPrefix(source, prefix) {
  if (db) {
    try { db.prepare("DELETE FROM contributions WHERE source = ? AND sub_id LIKE ? || '%'").run(String(source), String(prefix)); } catch { /* best-effort */ }
    return;
  }
  for (const [k, v] of memContrib) if (v.source === source && String(v.subId).startsWith(String(prefix))) memContrib.delete(k);
}

// Grouped donor search over the stored ledger (contributions only).
// MEMO rows are excluded from all sums: FEC memo entries (earmark details, conduit batch totals
// like AIPAC's "TOTAL EARMARKED THROUGH CONDUIT") are informational — their dollars are itemized
// under the actual donors, so counting them double-counts (verified live: a candidate's AIPAC memo
// lines "summed" to more than the campaign's entire receipts).
export function contribDonorGroups({ q = "", state = "", employer = "", limit = 50 } = {}) {
  // Two-phase: first find donor_keys where ANY row matches the filters, then aggregate ALL of each
  // matched donor's rows. Filtering and grouping in one pass would silently drop a donor's
  // differently-formatted rows ("Jane Doe" vs "DOE, JANE") from the totals.
  if (db) {
    try {
      const conds = ["kind = 'contribution'"];
      const args = [];
      // Token matching: every token must appear somewhere in the name or key, in ANY order —
      // so "jane doe" finds "DOE, JANE" and "JANE R DOE" (a single LIKE on the whole phrase wouldn't).
      for (const t of String(q).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean)) {
        conds.push("(donor_name LIKE ? OR donor_key LIKE ?)");
        args.push(`%${t}%`, `%${t}%`);
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
    try {
      const ors = toks.map(() => "(donor_name LIKE ? OR donor_key LIKE ?)").join(" OR ");
      const args = toks.flatMap((t) => [`%${t}%`, `%${t}%`]);
      return db.prepare(`
        SELECT donor_key AS donorKey, MAX(donor_name) AS name, MAX(employer) AS employer,
               MAX(state) AS state, SUM(amount) AS total, COUNT(*) AS count
        FROM contributions WHERE kind = 'contribution' AND memo = 0 AND (${ors})
        GROUP BY donor_key ORDER BY total DESC LIMIT ?
      `).all(...args, limit);
    } catch { return []; }
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

export function contribStats() {
  if (db) {
    try {
      const r = db.prepare(`SELECT COUNT(*) AS rows, COUNT(DISTINCT donor_key) AS donors,
        COUNT(DISTINCT recipient_id) AS recipients FROM contributions`).get();
      return { rows: Number(r?.rows || 0), donors: Number(r?.donors || 0), recipients: Number(r?.recipients || 0) };
    } catch { return { rows: 0, donors: 0, recipients: 0 }; }
  }
  return { rows: memContrib.size, donors: new Set([...memContrib.values()].map((v) => v.donorKey)).size,
    recipients: new Set([...memContrib.values()].map((v) => v.recipientId)).size };
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
