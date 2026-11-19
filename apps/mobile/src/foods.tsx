// Bundled USDA food database (assets/foods.db) and food lookups.
//
// The database is opened with expo-sqlite's documented asset import: <SQLiteProvider
// assetSource={{ assetId: require('../assets/foods.db') }}> copies the bundled file into the
// app's SQLite directory on first launch and opens it. The copy is named after the asset's
// content hash, so an app update that ships a new foods.db opens the new file (older copies are
// removed). The connection is switched to `PRAGMA query_only` so nothing can write to it.

import { useEffect } from 'react';
import { Asset } from 'expo-asset';
import { Directory } from 'expo-file-system';
import { SQLiteProvider, defaultDatabaseDirectory, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import {
  FOOD_BY_ID_SQL,
  FOOD_SEARCH_CANDIDATES,
  FOOD_SEARCH_SQL,
  OFF_USER_AGENT,
  builtinFdcId,
  ftsQuery,
  isValidBarcode,
  mapOffProduct,
  offProductUrl,
  rankFoods,
  rowToFood,
  type Food,
  type FoodData,
  type FoodDbRow,
  type NutritionStore,
} from '@open-nutrition/shared';
import { serverFetch, type Account } from './state';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FOODS_DB_ASSET = require('../assets/foods.db') as number;

function dbFileName(): string {
  let hash: string | null = null;
  try {
    hash = Asset.fromModule(FOODS_DB_ASSET).hash;
  } catch {
    hash = null;
  }
  return `foods-${(hash ?? 'v1').slice(0, 12)}.db`;
}
export const FOODS_DB_NAME = dbFileName();

let resolveDb!: (db: SQLiteDatabase) => void;
let rejectDb!: (e: Error) => void;
const dbReady = new Promise<SQLiteDatabase>((res, rej) => {
  resolveDb = res;
  rejectDb = rej;
});
// Avoid an unhandled-rejection warning; callers see the error when they await.
dbReady.catch(() => {});
let dbError: string | null = null;
export const foodDbError = () => dbError;

async function onInit(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA query_only = ON;');
}

function Binder() {
  const db = useSQLiteContext();
  useEffect(() => {
    resolveDb(db);
    removeOldCopies();
  }, [db]);
  return null;
}

/** Mount once near the root. Renders nothing; the rest of the app does not wait for it. */
export function FoodDbLoader() {
  return (
    <SQLiteProvider databaseName={FOODS_DB_NAME} assetSource={{ assetId: FOODS_DB_ASSET }} onInit={onInit} onError={onDbError}>
      <Binder />
    </SQLiteProvider>
  );
}

function onDbError(e: Error) {
  dbError = e.message || String(e);
  console.warn('Could not open the food database', dbError);
  rejectDb(e);
}

/** Delete copies of earlier foods.db versions (best effort; the directory may not be listable). */
function removeOldCopies() {
  try {
    const raw = String(defaultDatabaseDirectory ?? '');
    if (!raw) return;
    const dir = new Directory(raw.startsWith('file:') ? raw : `file://${raw}`);
    for (const item of dir.list()) {
      const name = item.name;
      if (/^foods-[\w-]+\.db(-wal|-shm|-journal)?$/.test(name) && !name.startsWith(FOODS_DB_NAME)) item.delete();
    }
  } catch {
    /* ignore: cleanup is optional */
  }
}

// ---- search ---------------------------------------------------------------------------------------

/** Search the bundled USDA foods (offline). Follows the shared search recipe. */
export async function searchBuiltinFoods(text: string, limit = 30): Promise<Food[]> {
  const q = ftsQuery(text);
  if (!q) return [];
  const db = await dbReady;
  const rows = await db.getAllAsync<FoodDbRow>(FOOD_SEARCH_SQL, [q, FOOD_SEARCH_CANDIDATES]);
  return rankFoods(text, rows).slice(0, limit).map(rowToFood);
}

export async function builtinFoodById(id: string): Promise<Food | null> {
  const fdcId = builtinFdcId(id);
  if (fdcId == null) return null;
  const db = await dbReady;
  const row = await db.getFirstAsync<FoodDbRow>(FOOD_BY_ID_SQL, [fdcId]);
  return row ? rowToFood(row) : null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/** The user's own foods (custom, scanned, cached copies) whose name or brand matches every word. */
export function searchStoredFoods(store: NutritionStore, text: string, limit = 20): Food[] {
  const words = norm(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = store.all('foods').filter((f) => {
    const hay = norm(`${f.name} ${f.brand ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
  // Custom and favourite foods first, then by name length (shorter = closer match).
  return hits
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(b.source === 'custom') - Number(a.source === 'custom') || a.name.length - b.name.length)
    .slice(0, limit);
}

/**
 * Combined search: the user's foods first, then bundled USDA foods. A USDA food the user has
 * already logged appears once (as the stored copy, which carries the favourite flag).
 */
export async function searchFoods(store: NutritionStore, text: string, limit = 40): Promise<Food[]> {
  const mine = searchStoredFoods(store, text, 15);
  let builtin: Food[] = [];
  try {
    builtin = await searchBuiltinFoods(text, limit);
  } catch {
    builtin = [];
  }
  const usdaIds = new Set(mine.filter((f) => f.source === 'usda').map((f) => f.sourceId));
  return [...mine, ...builtin.filter((f) => !usdaIds.has(f.sourceId))].slice(0, limit);
}

/** The stored copy of a food (for builtin foods: the copy made when it was logged), if any. */
export function storedCopy(store: NutritionStore, food: Food | FoodData): Food | undefined {
  const id = (food as Food).id;
  if (id && !id.startsWith('usda:')) return store.get('foods', id);
  if (food.sourceId == null) return undefined;
  return store.all('foods').find((f) => f.source === food.source && f.sourceId === food.sourceId);
}

export function toggleFavorite(store: NutritionStore, food: Food): Food {
  const copy = storedCopy(store, food) ?? store.ensureFood(food);
  return store.update('foods', copy.id, { favorite: !copy.favorite })!;
}

// ---- barcodes ---------------------------------------------------------------------------------------

export type BarcodeResult =
  | { kind: 'found'; food: Food | FoodData; source: 'mine' | 'off' | 'usda_branded' }
  | { kind: 'not_found' }
  | { kind: 'invalid' };

const OFF_CACHE_PREFIX = 'off_cache:';
const OFF_CACHE_TTL_MS = 30 * 86_400_000;

/**
 * Look a barcode up: the user's own foods first, then the server (server mode) or Open Food
 * Facts directly (local mode). Products fetched from Open Food Facts are cached in a separate,
 * unsynced key/value table (never merged into the user's data until they log one).
 */
export async function lookupBarcode(store: NutritionStore, account: Account, raw: string): Promise<BarcodeResult> {
  const code = raw.trim();
  if (!isValidBarcode(code)) return { kind: 'invalid' };
  const mine = store.foodByBarcode(code) ?? (code.length === 12 ? store.foodByBarcode(`0${code}`) : undefined);
  if (mine) return { kind: 'found', food: mine, source: 'mine' };

  if (account.server) {
    const res = await serverFetch(account, `/api/v1/foods/barcode/${encodeURIComponent(code)}`);
    if (res.status === 404) return { kind: 'not_found' };
    if (!res.ok) throw new Error(`Barcode lookup failed (HTTP ${res.status})`);
    const body = (await res.json()) as { food: FoodData | null; source: 'off' | 'usda_branded' | null; attribution?: string | null };
    if (!body.food) return { kind: 'not_found' };
    return { kind: 'found', food: { ...body.food, barcode: body.food.barcode ?? code }, source: body.source ?? 'off' };
  }

  const cached = await readOffCache(code);
  if (cached !== undefined) return cached ? { kind: 'found', food: cached, source: 'off' } : { kind: 'not_found' };
  const res = await fetch(offProductUrl(code), { headers: { 'User-Agent': OFF_USER_AGENT, Accept: 'application/json' } });
  if (res.status === 404) {
    await writeOffCache(code, null);
    return { kind: 'not_found' };
  }
  if (!res.ok) throw new Error(`Open Food Facts is not reachable right now (HTTP ${res.status}).`);
  const food = mapOffProduct(await res.json());
  const withCode = food ? { ...food, barcode: food.barcode ?? code } : null;
  await writeOffCache(code, withCode);
  return withCode ? { kind: 'found', food: withCode, source: 'off' } : { kind: 'not_found' };
}

/** undefined = not cached; null = cached "not found" (kept for a day only). */
async function readOffCache(code: string): Promise<FoodData | null | undefined> {
  try {
    const raw = await Storage.getItemAsync(OFF_CACHE_PREFIX + code);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as { at: number; food: FoodData | null };
    const ttl = entry.food ? OFF_CACHE_TTL_MS : 86_400_000;
    if (Date.now() - entry.at > ttl) return undefined;
    return entry.food;
  } catch {
    return undefined;
  }
}

async function writeOffCache(code: string, food: FoodData | null) {
  try {
    await Storage.setItemAsync(OFF_CACHE_PREFIX + code, JSON.stringify({ at: Date.now(), food }));
  } catch {
    /* cache is optional */
  }
}

/** Page where anyone can add a missing product to Open Food Facts. */
export const offContributeUrl = (code: string) => `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}`;
