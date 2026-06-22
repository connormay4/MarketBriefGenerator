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
  `);

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
