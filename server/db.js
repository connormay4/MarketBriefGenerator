const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'briefs.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
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
    "Popeyes",
    "Wendy's",
    "Slim Chickens",
    "Taco Bell"
  ];

  const insert = db.prepare('INSERT OR IGNORE INTO competitors (name, active) VALUES (?, 1)');
  for (const name of defaultCompetitors) {
    insert.run(name);
  }

  // sections: only seed on first run
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    .run('sections', JSON.stringify(['ratings', 'news', 'recommendations']));

  // location: if LOCATION is set in .env, it always wins — overwrite whatever
  // the DB currently holds so the env file is the reliable source of truth.
  // If LOCATION is absent from .env, fall back to whatever is already stored
  // (or seed the hardcoded default on a brand-new DB).
  const envLocation = process.env.LOCATION;
  if (envLocation) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('location', envLocation);
    console.log(`[db] location synced from .env → "${envLocation}"`);
  } else {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
      .run('location', 'Atlanta, GA 30301');
  }
}

module.exports = { getDb };
