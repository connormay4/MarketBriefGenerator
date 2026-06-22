const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

// ─── Connection ──────────────────────────────────────────────────────────────
// We use libSQL (@libsql/client), which speaks BOTH a hosted Turso database and
// a plain local SQLite file behind the same async API. That lets the exact same
// code run two ways with zero branching beyond the URL:
//   • Production (Vercel): TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) → hosted Turso,
//     which PERSISTS across serverless invocations (the old node:sqlite path
//     wrote to /tmp on Vercel and was wiped every cold start).
//   • Local dev / fallback: a `file:` URL under ./data (or DATA_DIR).
// Everything downstream is async (await db.execute(...)), unlike the old
// synchronous node:sqlite prepare().run/get/all calls.
function resolveConfig() {
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    return { url, authToken: process.env.TURSO_AUTH_TOKEN };
  }
  // No Turso configured → local file. On Vercel /tmp is the only writable dir
  // (ephemeral); production is expected to set TURSO_DATABASE_URL.
  const dir =
    process.env.DATA_DIR ||
    (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data'));
  // libSQL won't create a missing parent dir for a file: URL — do it ourselves.
  fs.mkdirSync(dir, { recursive: true });
  return { url: `file:${path.join(dir, 'briefs.db')}` };
}

let _client = null;
let _ready = null;

function rawClient() {
  if (!_client) _client = createClient(resolveConfig());
  return _client;
}

// getDb() resolves once the schema has been initialized. The init promise is
// memoized so concurrent callers (e.g. parallel route handlers in one cold
// function) share a single initialization rather than racing.
async function getDb() {
  if (!_ready) _ready = initSchema(rawClient());
  await _ready;
  return rawClient();
}

// ─── Schema ──────────────────────────────────────────────────────────────────
async function initSchema(db) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      location TEXT NOT NULL,
      content TEXT NOT NULL,
      ratings_snapshot TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1
    );

    -- Operator-maintained price seed (source of truth). One row per competitor.
    -- price_cents avoids float rounding; source/confidence/last_verified make
    -- trust explicit so the brief never shows a fabricated price as fact.
    CREATE TABLE IF NOT EXISTS competitor_prices (
      competitor    TEXT PRIMARY KEY,
      item_label    TEXT,
      price_cents   INTEGER,
      source        TEXT,                -- 'operator' | 'delivery' | 'llm'
      confidence    TEXT,                -- 'high' | 'medium' | 'low'
      last_verified TEXT,                -- ISO date (YYYY-MM-DD)
      notes         TEXT
    );

    -- Cron idempotency + resumability. run_key (e.g. '2026-W25') dedupes a week;
    -- cursor holds JSON fan-out state so the heavy job can resume mid-run.
    CREATE TABLE IF NOT EXISTS job_runs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job        TEXT NOT NULL,
      run_key    TEXT NOT NULL UNIQUE,
      status     TEXT NOT NULL,          -- 'running' | 'done' | 'error'
      cursor     TEXT,
      result     TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    -- Weekly metric snapshots for trend lines (ratings now; rankings in Phase 2).
    CREATE TABLE IF NOT EXISTS snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      kind       TEXT NOT NULL,          -- 'ratings' | 'ranking'
      payload    TEXT NOT NULL
    );

    -- The 25-CFA set: Jack's store (is_self=1) + the 24 nearest other CFAs.
    CREATE TABLE IF NOT EXISTS cfa_locations (
      place_id     TEXT PRIMARY KEY,
      name         TEXT,
      address      TEXT,
      lat          REAL,
      lng          REAL,
      distance_m   REAL,
      is_self      INTEGER NOT NULL DEFAULT 0,
      rating       REAL,
      review_count INTEGER,
      updated_at   TEXT
    );

    -- Reviews pulled per location (Outscraper, or Places fallback). aspects is a
    -- JSON array [{aspect, sentiment}] from LLM classification. UNIQUE(place_id,
    -- review_uid) dedupes across incremental weekly pulls.
    CREATE TABLE IF NOT EXISTS reviews (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id     TEXT NOT NULL,
      review_uid   TEXT,
      author       TEXT,
      rating       INTEGER,
      text         TEXT,
      published_at TEXT,
      aspects      TEXT,
      source       TEXT,
      fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(place_id, review_uid)
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_place ON reviews(place_id);
  `);

  // Per-brief structured side-data (pricing, own-store highlight, breakfast
  // ideas, rankings) lives in a JSON `extras` column so the web UI and the
  // email render from the same source. Guarded ALTER for already-created DBs.
  try {
    await db.execute('ALTER TABLE briefs ADD COLUMN extras TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }

  const defaultCompetitors = [
    "McDonald's",
    'Popeyes',
    "Wendy's",
    'Slim Chickens',
    'Taco Bell',
  ];
  for (const name of defaultCompetitors) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO competitors (name, active) VALUES (?, 1)',
      args: [name],
    });
  }

  // sections: only seed on first run
  await db.execute({
    sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
    args: ['sections', JSON.stringify(['ratings', 'news', 'recommendations'])],
  });

  // location: if LOCATION is set in env it always wins (env is the source of
  // truth); otherwise keep whatever is stored, seeding a default on a fresh DB.
  const envLocation = process.env.LOCATION;
  if (envLocation) {
    await db.execute({
      sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      args: ['location', envLocation],
    });
    console.log(`[db] location synced from env → "${envLocation}"`);
  } else {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      args: ['location', 'Atlanta, GA 30301'],
    });
  }
}

// ─── Query helpers ───────────────────────────────────────────────────────────
// Thin wrappers so call sites read close to the old prepare().all/get/run, but
// async. `args` defaults to [] because libSQL rejects undefined args.
async function all(sql, args = []) {
  const db = await getDb();
  const res = await db.execute({ sql, args });
  return res.rows;
}

async function one(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0];
}

// run() returns the raw ResultSet so callers can read lastInsertRowid /
// rowsAffected (lastInsertRowid is a BigInt — wrap in Number() when needed).
async function run(sql, args = []) {
  const db = await getDb();
  return db.execute({ sql, args });
}

module.exports = { getDb, all, one, run };
