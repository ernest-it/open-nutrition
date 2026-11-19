import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { NutritionStore, SETTING_PREFS, todayLocal, type CollectionName, type Prefs, type Snapshot, type StorageAdapter } from '@open-nutrition/shared';

/** Snapshot persisted in on-device SQLite (no size limit, unlike AsyncStorage on Android). */
class SqliteKvStorage implements StorageAdapter {
  constructor(private key: string) {}
  async load() {
    const raw = await Storage.getItemAsync(this.key);
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  }
  async save(s: Snapshot) {
    await Storage.setItemAsync(this.key, JSON.stringify(s));
  }
  async clear() {
    await Storage.removeItemAsync(this.key);
  }
}

/** Where the data lives. `server: null` = local-only mode (no account needed). */
export interface Account {
  server: { baseUrl: string; token: string; username: string } | null;
}

const ACCOUNT_KEY = 'on.account';

/**
 * Never throws: if the keychain is unavailable (e.g. read before first unlock, missing
 * entitlement, corrupt entry) the app falls back to the connect screen instead of hanging.
 */
export async function loadAccount(): Promise<Account | null> {
  try {
    const raw = await SecureStore.getItemAsync(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch (e) {
    console.warn('Could not read the saved account', e);
    return null;
  }
}

/** Best effort: if the keychain write fails the session still works, it just isn't remembered. */
export async function saveAccount(a: Account | null) {
  try {
    if (a) await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(a));
    else await SecureStore.deleteItemAsync(ACCOUNT_KEY);
  } catch (e) {
    console.warn('Could not save the account', e);
  }
}

export let store: NutritionStore;
let cleanup: (() => void) | null = null;

/** Set once the first sync attempt after start-up has finished (or immediately in local mode). */
let firstSyncDone = false;
const firstSyncListeners = new Set<() => void>();
function markFirstSync() {
  firstSyncDone = true;
  for (const l of firstSyncListeners) l();
}

export async function initStore(account: Account) {
  cleanup?.();
  firstSyncDone = false;
  const key = account.server ? `snapshot:${account.server.username}@${account.server.baseUrl}` : 'snapshot:local';
  store = new NutritionStore(new SqliteKvStorage(key));
  await store.init();
  if (!account.server) {
    markFirstSync();
    return store;
  }
  store.server = { baseUrl: account.server.baseUrl, token: account.server.token };
  const trySync = () =>
    void store
      .sync()
      .catch(() => {})
      .finally(() => {
        if (!firstSyncDone) markFirstSync();
      });
  trySync();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPending = store.pendingCount();
  const unsub = store.subscribe(() => {
    const p = store.pendingCount();
    if (p > 0 && p !== lastPending) {
      clearTimeout(timer);
      timer = setTimeout(trySync, 2000);
    }
    lastPending = p;
  });
  const interval = setInterval(trySync, 60_000);
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') trySync();
    if (s === 'background') void store.persist();
  });
  cleanup = () => {
    unsub();
    clearInterval(interval);
    clearTimeout(timer);
    appState.remove();
  };
  return store;
}

export function useStore(): NutritionStore {
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.version,
  );
  return store;
}

/** True once the first sync after start-up has been attempted (always true in local mode). */
export function useFirstSyncDone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      firstSyncListeners.add(cb);
      return () => firstSyncListeners.delete(cb);
    },
    () => firstSyncDone,
  );
}

/** Today's local day; refreshes when the app returns to the foreground and once a minute. */
export function useToday(): string {
  const [day, setDay] = useState(() => todayLocal());
  useEffect(() => {
    const check = () => setDay(todayLocal());
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    const timer = setInterval(check, 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);
  return day;
}

export function usePrefs(): Prefs {
  return useStore().prefs();
}

export function setPrefs(patch: Partial<Prefs>) {
  store.setSetting(SETTING_PREFS, { ...store.prefs(), ...patch });
}

export const AccountContext = createContext<Account>({ server: null });
export const useAccount = () => useContext(AccountContext);

/** Authenticated JSON request to the user's server (server mode only). */
export async function serverFetch(account: Account, path: string, init: RequestInit = {}): Promise<Response> {
  if (!account.server) throw new Error('Not connected to a server');
  return fetch(`${account.server.baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${account.server.token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

export function normalizeServerUrl(input: string): string {
  let u = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) {
    // No scheme typed: LAN addresses (IPs, localhost, mDNS/home names) are almost always plain
    // HTTP; public domains are expected to be behind HTTPS.
    const host = u.split(/[/:]/)[0]!.toLowerCase();
    const local = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === 'localhost' || /\.(local|lan|home|internal|home\.arpa)$/.test(host) || !host.includes('.');
    u = `${local ? 'http' : 'https'}://${u}`;
  }
  return u;
}

/**
 * Undo a delete. Deletes are soft (`deletedAt`) and sync is last-write-wins on `updatedAt`, so
 * clearing `deletedAt` with a fresh update restores the row here and on the server.
 */
export function restoreRows(collection: CollectionName, ids: string[]) {
  for (const id of ids) store.update(collection, id, { deletedAt: null } as never);
}

/** Delete rows and return an undo function (for "Deleted · Undo" snackbars). */
export function removeWithUndo(collection: CollectionName, ids: string[]): () => void {
  for (const id of ids) store.remove(collection, id);
  return () => restoreRows(collection, ids);
}
