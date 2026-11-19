// Bundled USDA food database (apps/mobile/assets/foods.db, built by data/build-foods-db.mjs).
//
//   CREATE TABLE foods (fdcId INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, dataType TEXT NOT NULL,
//     servings TEXT NOT NULL,   -- JSON [{label, grams}]
//     nutrients TEXT NOT NULL); -- JSON {"208": 52, ...} per 100 g
//   CREATE VIRTUAL TABLE foods_fts USING fts5(name, category, content='foods', content_rowid='fdcId', ...);
//
// Search recipe (server and mobile):
//   const q = ftsQuery(userText); if (!q) return [];
//   const rows = db.prepare(FOOD_SEARCH_SQL).all(q, FOOD_SEARCH_CANDIDATES) as FoodDbRow[];
//   return rankFoods(userText, rows).slice(0, limit).map(rowToFood);
// bm25 alone ranks single words badly ("apple" → "Strudel, apple"), so always re-rank ~100 hits.

import { BUILTIN_PREFIX, type Food, type Serving } from './schema';
import type { NutrientMap } from './nutrients';

export interface FoodDbRow {
  fdcId: number;
  name: string;
  category: string | null;
  dataType: string;
  /** JSON array of {label, grams}. */
  servings: string;
  /** JSON object keyed by nutrient number, per 100 g. */
  nutrients: string;
}

/** Params: [ftsQuery, limit]. */
export const FOOD_SEARCH_SQL =
  'SELECT f.* FROM foods_fts JOIN foods f ON f.fdcId = foods_fts.rowid WHERE foods_fts MATCH ? ORDER BY bm25(foods_fts, 10.0, 1.0), length(f.name) LIMIT ?';
/** Params: [fdcId]. */
export const FOOD_BY_ID_SQL = 'SELECT * FROM foods WHERE fdcId = ?';
/** How many FTS hits to fetch before `rankFoods`. */
export const FOOD_SEARCH_CANDIDATES = 100;

export const builtinFoodId = (fdcId: number) => `${BUILTIN_PREFIX}${fdcId}`;

/** `usda:123` → 123, anything else → null. */
export function builtinFdcId(id: string): number | null {
  if (!id.startsWith(BUILTIN_PREFIX)) return null;
  const n = Number(id.slice(BUILTIN_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseJson<T>(s: string, fallback: T): T {
  try {
    return (JSON.parse(s) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function rowToFood(row: FoodDbRow): Food {
  const raw = parseJson<unknown[]>(row.servings, []);
  const servings: Serving[] = [{ label: '100 g', grams: 100 }];
  if (Array.isArray(raw)) {
    for (const s of raw as { label?: unknown; grams?: unknown }[]) {
      if (typeof s?.label !== 'string' || !s.label.trim() || typeof s.grams !== 'number' || !(s.grams > 0)) continue;
      if (s.label.trim().toLowerCase() === '100 g') continue;
      servings.push({ label: s.label.trim().slice(0, 100), grams: s.grams });
      if (servings.length >= 50) break;
    }
  }
  const n = parseJson<Record<string, unknown>>(row.nutrients, {});
  const nutrients: NutrientMap = {};
  for (const [k, v] of Object.entries(n)) if (typeof v === 'number' && Number.isFinite(v)) nutrients[k] = v;
  return {
    id: builtinFoodId(row.fdcId),
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    name: row.name.slice(0, 300),
    brand: null,
    barcode: null,
    source: 'usda',
    sourceId: String(row.fdcId),
    servings,
    nutrients,
    favorite: false,
  };
}

/**
 * Sanitise free text into an FTS5 query: every word becomes a quoted prefix
 * term (`"chick"* "brea"*`), implicitly AND-ed. Strips FTS syntax (quotes,
 * operators, parentheses, column filters). Null if nothing searchable remains.
 */
export function ftsQuery(userText: string): string | null {
  const words = userText
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w}"*`).join(' ');
}

// ---------------------------------------------------------------------------
// Re-ranking
// ---------------------------------------------------------------------------

/** Leading segments that name a category, not the food ("Beverages, coffee, brewed"). */
const CATEGORY_HEADS = new Set([
  'beverages',
  'alcoholic beverage',
  'alcoholic beverages',
  'fish',
  'spices',
  'cereals',
  'cereals ready-to-eat',
  'snacks',
  'candies',
  'sweeteners',
  'babyfood',
  'fast foods',
  'restaurant',
  'nuts',
  'seeds',
  'mollusks',
  'crustaceans',
  'game meat',
]);

const EVERYDAY = new Set(['whole', 'brewed', 'plain', 'regular', 'fluid']);
const PROCESSED = new Set(['roll', 'sliced', 'fat-free', 'free', 'deli', 'luncheon', 'flavor', 'flavored', 'canned', 'smoked', 'dried', 'dehydrated', 'powder', 'frozen', 'instant', 'imitation']);

/** Crude singular form: berries → berry, tomatoes → tomato, apples → apple, glass stays. */
export function singular(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/'s\b/g, '')
    .split(/[^a-z0-9%]+/)
    .filter(Boolean);

/** Relevance of one food name for a query (higher is better). Exported for tests. */
export function foodNameScore(userText: string, name: string): number {
  const q = [...new Set(words(userText).map(singular))];
  if (!q.length) return 0;
  const rawSegments = name.split(',').map((s) => s.trim()).filter(Boolean);
  const segs = rawSegments.map((s) => words(s).map(singular));
  if (!segs.length) return 0;
  // Head = first segment; when the first segment is only a category ("Beverages",
  // "Fish"), the second segment is the food and counts as the head (slightly less).
  const category = CATEGORY_HEADS.has(rawSegments[0]!.toLowerCase()) && segs.length > 1;
  const head = category ? segs[1]! : segs[0]!;
  const categoryWords = category ? segs[0]! : [];
  const rest = segs.slice(category ? 2 : 1).flat();
  const all = segs.flat();
  const headHit = q.filter((t) => head.includes(t) || categoryWords.includes(t));
  let score = 0;
  for (const t of q) {
    if (head.includes(t)) score += category ? 9 : 10;
    else if (categoryWords.includes(t)) score += 6;
    else if (rest.includes(t)) score += headHit.length ? 3 : -1; // a qualifier, or only a modifier ("Strudel, apple")
    else if (all.some((w) => w.startsWith(t))) score += t.length >= 3 ? 1 : 0; // partial typing, or "egg" in "eggnog"
    else score -= 2;
    const idx = all.findIndex((w) => w === t || w.startsWith(t));
    if (idx >= 0) score -= 0.2 * idx;
  }
  // The head is exactly what was asked for ("Bananas" for "banana", not "Banana chips").
  if (head.length && head.every((w) => q.includes(w))) score += category ? 3 : 4;
  else score -= 0.5 * head.filter((w) => !q.includes(w)).length;
  // Brand/restaurant names in capitals ("APPLEBEE'S, ...").
  const s0 = rawSegments[0]!;
  if (/[A-Z]{3,}/.test(s0) && s0 === s0.toUpperCase()) score -= 3;
  // Plain forms first.
  if (all.includes('raw') || all.includes('fresh')) score += 1.5;
  // Everyday forms over processed ones, unless the user asked for them.
  const qualifier = segs[category ? 2 : 1] ?? [];
  if (qualifier.some((w) => EVERYDAY.has(w))) score += 0.7;
  const processed = all.filter((w) => PROCESSED.has(w) && !q.includes(w)).length;
  score -= Math.min(2, processed);
  score -= 0.3 * (segs.length - 1);
  score -= 0.01 * name.length;
  return score;
}

/** Re-rank FTS hits for a user query (stable: bm25 order breaks ties). */
export function rankFoods<T extends { name: string }>(userText: string, rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i, s: foodNameScore(userText, r.name) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}
