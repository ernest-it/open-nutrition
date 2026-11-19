import {
  BUILTIN_PREFIX,
  COLLECTIONS,
  COLLECTION_NAMES,
  booleanColumnsOf,
  columnsOf,
  jsonColumnsOf,
  type ChangeSet,
  type CollectionName,
  type SyncResponse,
} from '@open-nutrition/shared';
import type Database from 'better-sqlite3';
import { currentRev, nextRev, q, type DB } from './db';

const MAX_PULL = 5000;

/** Clients may not write timestamps far in the future (protects LWW from clock abuse). */
const MAX_CLOCK_SKEW_MS = 24 * 3600 * 1000;

type ColKind = 'bool' | 'json' | 'plain';
const kindCache = new Map<CollectionName, [string, ColKind][]>();
/** Column names with their SQL encoding (booleans as 0/1, objects/arrays as JSON text). */
function colKinds(c: CollectionName): [string, ColKind][] {
  let k = kindCache.get(c);
  if (!k) {
    const bools = new Set(booleanColumnsOf(c));
    const json = new Set(jsonColumnsOf(c));
    k = columnsOf(c).map((col) => [col, bools.has(col) ? 'bool' : json.has(col) ? 'json' : 'plain']);
    kindCache.set(c, k);
  }
  return k;
}

export function toSql(c: CollectionName, row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [col, kind] of colKinds(c)) {
    const v = row[col];
    if (kind === 'bool') out[col] = v ? 1 : 0;
    else if (kind === 'json') out[col] = v === undefined || v === null ? null : JSON.stringify(v);
    else out[col] = v === undefined ? null : v;
  }
  return out;
}

export function fromSql(c: CollectionName, row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [col, kind] of colKinds(c)) {
    const v = row[col];
    if (kind === 'bool') out[col] = v === 1;
    else if (kind === 'json') out[col] = typeof v === 'string' ? safeJson(v) : null;
    else out[col] = v;
  }
  return out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

type Stmt = Database.Statement<unknown[]>;
const stmtCache = new WeakMap<DB, Map<string, Stmt>>();
function stmt(db: DB, sql: string): Stmt {
  let m = stmtCache.get(db);
  if (!m) stmtCache.set(db, (m = new Map()));
  let s = m.get(sql);
  if (!s) m.set(sql, (s = db.prepare<unknown[]>(sql)));
  return s;
}

export interface ApplyResult {
  applied: number;
  rejected: SyncResponse['rejected'];
}

/** Apply client changes using last-write-wins on `updatedAt`. Runs in one transaction. */
export function applyChanges(db: DB, userId: string, changes: Record<string, unknown[]>): ApplyResult {
  const rejected: SyncResponse['rejected'] = [];
  let applied = 0;
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const c of COLLECTION_NAMES) {
      const rows = changes[c];
      if (!Array.isArray(rows)) continue;
      const cols = columnsOf(c);
      const select = stmt(db, `SELECT updatedAt FROM ${q(c)} WHERE userId = ? AND id = ?`);
      const upsert = stmt(
        db,
        `INSERT INTO ${q(c)} (userId, rev, ${cols.map(q).join(', ')})
         VALUES (@userId, @rev, ${cols.map((x) => `@${x}`).join(', ')})
         ON CONFLICT (userId, id) DO UPDATE SET rev = excluded.rev, ${cols
           .filter((x) => x !== 'id')
           .map((x) => `${q(x)} = excluded.${q(x)}`)
           .join(', ')}`,
      );
      for (const raw of rows) {
        const parsed = COLLECTIONS[c].safeParse(raw);
        const rawId = (raw as { id?: unknown })?.id;
        if (!parsed.success) {
          rejected.push({ collection: c, id: typeof rawId === 'string' ? rawId : null, error: parsed.error.message });
          continue;
        }
        const row = parsed.data as Record<string, unknown> & { id: string; updatedAt: number };
        if (row.id.startsWith(BUILTIN_PREFIX)) {
          rejected.push({ collection: c, id: row.id, error: 'built-in ids are read-only' });
          continue;
        }
        if (row.updatedAt > now + MAX_CLOCK_SKEW_MS) {
          rejected.push({ collection: c, id: row.id, error: 'updatedAt is in the future' });
          continue;
        }
        const existing = select.get(userId, row.id) as { updatedAt: number } | undefined;
        if (existing && existing.updatedAt > row.updatedAt) continue; // server copy is newer
        upsert.run({ ...toSql(c, row), userId, rev: nextRev(db) });
        applied++;
      }
    }
  });
  tx();
  return { applied, rejected };
}

/** Rows changed after `since`, ordered by revision, at most MAX_PULL rows. */
export function pullChanges(db: DB, userId: string, since: number, limit = MAX_PULL) {
  type Tagged = { c: CollectionName; rev: number; row: Record<string, unknown> };
  const all: Tagged[] = [];
  for (const c of COLLECTION_NAMES) {
    const rows = stmt(db, `SELECT * FROM ${q(c)} WHERE userId = ? AND rev > ? ORDER BY rev LIMIT ?`).all(
      userId,
      since,
      limit + 1,
    ) as Record<string, unknown>[];
    for (const r of rows) all.push({ c, rev: r.rev as number, row: fromSql(c, r) });
  }
  all.sort((a, b) => a.rev - b.rev);
  const more = all.length > limit;
  const page = all.slice(0, limit);
  const changes: ChangeSet = {};
  for (const t of page) ((changes as Record<string, unknown[]>)[t.c] ??= []).push(t.row);
  const rev = more ? page[page.length - 1]!.rev : Math.max(since, currentRev(db));
  return { changes, rev, more };
}

export function allRows(db: DB, userId: string, c: CollectionName) {
  return (stmt(db, `SELECT * FROM ${q(c)} WHERE userId = ? AND deletedAt IS NULL`).all(userId) as Record<string, unknown>[]).map(
    (r) => fromSql(c, r),
  );
}
