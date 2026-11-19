import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { NutritionStore, type CollectionName, type Prefs, type Snapshot, type StorageAdapter } from '@open-nutrition/shared';

/** IndexedDB-backed snapshot storage (one record per user), with a localStorage fallback. */
class IdbStorage implements StorageAdapter {
  constructor(private key: string) {}
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('open-nutrition', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const r = fn(db.transaction('kv', mode).objectStore('kv'));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async load() {
    try {
      return ((await this.tx('readonly', (s) => s.get(this.key))) as Snapshot | undefined) ?? null;
    } catch {
      try {
        return JSON.parse(localStorage.getItem(`on.${this.key}`) ?? 'null') as Snapshot | null;
      } catch {
        return null;
      }
    }
  }
  async save(snap: Snapshot) {
    try {
      await this.tx('readwrite', (s) => s.put(snap, this.key));
    } catch {
      try {
        localStorage.setItem(`on.${this.key}`, JSON.stringify(snap));
      } catch {
        /* storage full or blocked: data stays in memory and on the server */
      }
    }
  }
  async clear() {
    try {
      localStorage.removeItem(`on.${this.key}`);
    } catch {
      /* ignore */
    }
    await this.tx('readwrite', (s) => s.delete(this.key)).catch(() => {});
  }
}

const AUTH_KEY = 'on.auth';
export interface Auth {
  token: string;
  username: string;
  baseUrl: string;
}

export function loadAuth(): Auth | null {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as Auth | null;
  } catch {
    return null;
  }
}

export function saveAuth(a: Auth | null) {
  if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
  else localStorage.removeItem(AUTH_KEY);
}

export let store: NutritionStore;
let cleanup: (() => void) | null = null;

export async function initStore(auth: Auth) {
  cleanup?.();
  store = new NutritionStore(new IdbStorage(`snapshot:${auth.username}`));
  await store.init();
  store.server = { baseUrl: auth.baseUrl, token: auth.token };
  const sync = () => void store.sync().catch(() => {});
  sync();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPending = store.pendingCount();
  const unsub = store.subscribe(() => {
    const p = store.pendingCount();
    if (p > 0 && p !== lastPending) {
      clearTimeout(timer);
      timer = setTimeout(sync, 1500);
    }
    lastPending = p;
  });
  const interval = setInterval(sync, 60_000);
  const onVis = () => document.visibilityState === 'visible' && sync();
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', sync);
  cleanup = () => {
    unsub();
    clearInterval(interval);
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', sync);
  };
  return store;
}

/** Re-render whenever the store changes. */
export function useStore(): NutritionStore {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.version,
  );
  return store;
}

export function usePrefs(): Prefs {
  return useStore().prefs();
}

export function setPrefs(patch: Partial<Prefs>) {
  store.setSetting('prefs', { ...store.prefs(), ...patch });
}

/**
 * Undo a soft delete (rows are tombstoned with `deletedAt`, so restoring is a newer write that
 * clears it; last-write-wins sync carries it to the server).
 */
export function restoreRows(c: CollectionName, ids: string[]) {
  for (const id of ids) store.update(c, id, { deletedAt: null } as never);
}

/** Soft-delete rows and return their ids (for an Undo toast). */
export function removeRows(c: CollectionName, ids: string[]): string[] {
  for (const id of ids) store.remove(c, id);
  return ids;
}

/** Days that have at least one diary entry (calendar dots). */
export function useLoggedDays(): Set<string> {
  const s = useStore();
  const version = s.version;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Set(s.all('diaryEntries').map((e) => e.date)), [version]);
}

/** Web-only setting: the goal weight drawn on the weight chart. */
export const SETTING_GOAL_WEIGHT = 'goalWeightKg';

// ---------------------------------------------------------------------------
// Server API
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = loadAuth();
  let res: Response;
  try {
    res = await fetch(`${auth?.baseUrl ?? ''}${path}`, {
      ...init,
      headers: {
        ...(init.body && typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
        ...(auth ? { authorization: `Bearer ${auth.token}` } : {}),
        ...(init.headers as Record<string, string>),
      },
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }
  const ct = res.headers.get('content-type') ?? '';
  const body: unknown = ct.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
  if (!res.ok) {
    const b = body as { error?: string; message?: string } | null;
    const msg = (typeof b === 'object' && b && (b.message || b.error)) || `Request failed (HTTP ${res.status})`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// Breakpoints (shared with styles.css: compact < 600, medium 600–899, expanded >= 900)
// ---------------------------------------------------------------------------

export type Breakpoint = 'compact' | 'medium' | 'expanded';
export const breakpointOf = (width: number): Breakpoint => (width < 600 ? 'compact' : width < 900 ? 'medium' : 'expanded');

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => breakpointOf(window.innerWidth));
  useEffect(() => {
    const on = () => setBp(breakpointOf(window.innerWidth));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return bp;
}
