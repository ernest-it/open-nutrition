import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  COLLECTION_NAMES,
  booleanColumnsOf,
  columnsOf,
  jsonColumnsOf,
  numericColumnsOf,
  type CollectionName,
} from '@open-nutrition/shared';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/** Quote an identifier for SQLite. Column names come from our own schema only. */
export const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', '0');

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passwordHash TEXT NOT NULL,
      isAdmin INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tokenHash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      lastUsedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(userId);

    -- Open Food Facts / USDA Branded barcode cache. Shared by all users and never
    -- merged into user data. json = mapped Food JSON, or NULL for a cached miss.
    -- USDA Branded text-search cache (packaged foods), keyed by normalised query. Shared by
    -- all users and never merged into user data. json = array of mapped foods.
    CREATE TABLE IF NOT EXISTS branded_cache (
      query TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      fetchedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS off_cache (
      barcode TEXT PRIMARY KEY,
      json TEXT,
      source TEXT,
      fetchedAt INTEGER NOT NULL,
      attribution TEXT
    );

    -- AI meal estimates per user per calendar month (UTC, 'YYYY-MM').
    CREATE TABLE IF NOT EXISTS ai_usage (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      inputTokens INTEGER NOT NULL DEFAULT 0,
      outputTokens INTEGER NOT NULL DEFAULT 0,
      costUsd REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (userId, month)
    );

    -- AI requests per user per day (UTC, 'YYYY-MM-DD'), for the daily cap.
    CREATE TABLE IF NOT EXISTS ai_daily (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (userId, day)
    );
  `);

  // One table per syncable collection, derived from the shared zod schemas.
  // New columns added to the schema are added automatically (additive migrations).
  for (const c of COLLECTION_NAMES) ensureCollectionTable(db, c);
}

function sqlType(c: CollectionName, col: string): string {
  if (jsonColumnsOf(c).includes(col)) return 'TEXT'; // JSON-encoded
  if (booleanColumnsOf(c).includes(col)) return 'INTEGER';
  if (numericColumnsOf(c).includes(col)) return 'REAL';
  return 'TEXT';
}

function ensureCollectionTable(db: DB, c: CollectionName) {
  const cols = columnsOf(c).filter((x) => x !== 'id');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${q(c)} (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      rev INTEGER NOT NULL,
      ${cols.map((col) => `${q(col)} ${sqlType(c, col)}`).join(',\n      ')},
      PRIMARY KEY (userId, id)
    );
    CREATE INDEX IF NOT EXISTS ${q(`${c}_rev`)} ON ${q(c)}(userId, rev);
  `);
  const existing = new Set((db.prepare(`PRAGMA table_info(${q(c)})`).all() as { name: string }[]).map((r) => r.name));
  for (const col of cols) {
    if (!existing.has(col)) db.exec(`ALTER TABLE ${q(c)} ADD COLUMN ${q(col)} ${sqlType(c, col)}`);
  }
}

export function nextRev(db: DB): number {
  const row = db.prepare(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev' RETURNING value`).get() as {
    value: string | number;
  };
  return Number(row.value);
}

export function currentRev(db: DB): number {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'rev'`).get() as { value: string };
  return Number(row.value);
}
