// Tamago Brain storage: one local SQLite file (node:sqlite, no npm deps).
// Lives in the owner's state directory, never in the repository.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MIGRATIONS = [
  // v1 — sessions, messages, memories (+FTS5), relationship, world events, traces
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    closed_at INTEGER,
    turns INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    at INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'tamago')),
    text TEXT NOT NULL,
    meta TEXT
  );
  CREATE INDEX messages_session ON messages(session_id, at);
  CREATE TABLE memories (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('semantic', 'preference', 'episodic', 'procedural')),
    key TEXT,
    subject TEXT,
    relation TEXT,
    value TEXT,
    text TEXT NOT NULL,
    confidence REAL NOT NULL,
    importance REAL NOT NULL,
    strength INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER,
    superseded_by INTEGER REFERENCES memories(id)
  );
  CREATE INDEX memories_key ON memories(key) WHERE superseded_by IS NULL;
  CREATE VIRTUAL TABLE memories_fts USING fts5(text, content='memories', content_rowid='id', tokenize='porter unicode61');
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER memories_au AFTER UPDATE OF text ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO memories_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TABLE relationship (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    credits REAL NOT NULL DEFAULT 0,
    credit_day TEXT,
    day_interactions INTEGER NOT NULL DEFAULT 0,
    day_quality REAL NOT NULL DEFAULT 0,
    meaningful_interactions INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE world_events (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data TEXT
  );
  CREATE TABLE traces (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    request_id TEXT,
    trace TEXT NOT NULL
  );
  `,
];

export function defaultBrainPath(stateDir) {
  return join(stateDir, 'brain.sqlite');
}

/**
 * Opens (creating if needed) the brain database and applies migrations.
 * `path` may be ':memory:' for tests.
 */
export async function openBrainDb(path) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new Error('The Tamago brain needs Node 22.13+ (built-in node:sqlite). Current: ' + process.version);
  }
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

/** Runs fn inside a transaction (node:sqlite has no helper). */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
