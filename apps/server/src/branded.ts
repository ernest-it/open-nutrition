// Text search over USDA FoodData Central "Branded" foods (packaged grocery products), for
// when the bundled database has no good match. Only enabled when USDA_API_KEY is set.
//
// * Public-domain US government data; the key is sent in a header, never in a URL.
// * Results are cached per normalised query in `branded_cache` (shared by all users and never
//   merged into user data) for a week; a failed upstream call serves an expired entry if any.
// * Outbound calls are rate-limited globally (api.data.gov allows 1,000/hour per key) and
//   concurrent searches for the same text share one request.

import type { Food } from '@open-nutrition/shared';
import { BarcodeError, OutboundLimiter, mapFdcBranded, type FdcBrandedFood } from './barcode';
import type { DB } from './db';

export const BRANDED_TTL_MS = 7 * 86_400_000;
/** "Nothing found" is rechecked sooner (new products appear). */
export const BRANDED_EMPTY_TTL_MS = 86_400_000;
export const BRANDED_PAGE = 25;
/** Bump when the mapping (names, servings, nutrients) changes so old cache entries are refetched. */
const CACHE_VERSION = 3;
const TIMEOUT_MS = 8000;

/** Ids for branded search results (not stored; logging one copies it into the user's foods). */
export const BRANDED_ID_PREFIX = 'fdc:';

export interface BrandedDeps {
  db: DB;
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Outbound USDA calls per hour (default 600). */
  perHour?: number;
}

export const normalizeQuery = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 100);

export class BrandedSearch {
  private inflight = new Map<string, Promise<Food[]>>();
  private limiter: OutboundLimiter;
  private now: () => number;
  private fetchImpl: typeof fetch;

  constructor(private deps: BrandedDeps) {
    this.now = deps.now ?? Date.now;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.limiter = new OutboundLimiter(deps.perHour ?? 600, 3_600_000, this.now);
  }

  search(text: string): Promise<Food[]> {
    const plain = normalizeQuery(text);
    if (plain.length < 3) return Promise.resolve([]);
    // The cache holds mapped foods: a new mapping version must not be served old entries.
    const q = `${CACHE_VERSION}|${plain}`;
    const cached = this.readCache(q);
    if (cached && !cached.stale) return Promise.resolve(cached.foods);
    let p = this.inflight.get(q);
    if (!p) {
      p = this.fetchAndCache(q, cached?.foods ?? null).finally(() => this.inflight.delete(q));
      this.inflight.set(q, p);
    }
    return p;
  }

  private readCache(q: string): { foods: Food[]; stale: boolean } | null {
    const row = this.deps.db.prepare('SELECT json, fetchedAt FROM branded_cache WHERE query = ?').get(q) as { json: string; fetchedAt: number } | undefined;
    if (!row) return null;
    try {
      const foods = JSON.parse(row.json) as Food[];
      return { foods, stale: this.now() - row.fetchedAt > (foods.length ? BRANDED_TTL_MS : BRANDED_EMPTY_TTL_MS) };
    } catch {
      return null;
    }
  }

  private async fetchAndCache(q: string, stale: Food[] | null): Promise<Food[]> {
    try {
      const foods = await this.fetchUsda(q.slice(q.indexOf('|') + 1));
      this.deps.db
        .prepare(
          `INSERT INTO branded_cache (query, json, fetchedAt) VALUES (?, ?, ?)
           ON CONFLICT (query) DO UPDATE SET json = excluded.json, fetchedAt = excluded.fetchedAt`,
        )
        .run(q, JSON.stringify(foods), this.now());
      return foods;
    } catch (e) {
      if (stale) return stale;
      throw e;
    }
  }

  /** Every word first (tighter matches); when that finds nothing, any word (USDA ranks them). */
  private async fetchUsda(q: string): Promise<Food[]> {
    const strict = await this.fetchPage(q, true);
    return rankBranded(q, strict.length ? strict : await this.fetchPage(q, false));
  }

  private async fetchPage(q: string, allWords: boolean): Promise<Food[]> {
    const wait = this.limiter.take();
    if (wait) throw new BarcodeError(429, 'Too many packaged-food searches right now. Try again shortly.', wait);
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&dataType=Branded&pageSize=${BRANDED_PAGE}&requireAllWords=${allWords}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { 'X-Api-Key': this.deps.apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new BarcodeError(502, `USDA FoodData Central is unreachable (${(e as Error).name})`);
    }
    if (res.status === 429) throw new BarcodeError(429, 'USDA FoodData Central is rate-limiting searches. Try again later.', 60);
    if (!res.ok) throw new BarcodeError(502, `USDA FoodData Central returned HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { foods?: FdcBrandedFood[] } | null;
    const out: Food[] = [];
    const seen = new Set<string>();
    for (const f of body?.foods ?? []) {
      if (typeof f?.fdcId !== 'number') continue;
      const gtin = f.gtinUpc?.trim().replace(/^0+(?=\d{12,})/, '') || null;
      const mapped = mapFdcBranded(f, gtin && /^\d{8,14}$/.test(gtin) ? gtin : null);
      if (!mapped) continue;
      // The same product is often listed several times (package sizes, re-submissions).
      const key = `${mapped.brand ?? ''}|${mapped.name}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...mapped, id: `${BRANDED_ID_PREFIX}${f.fdcId}`, createdAt: 0, updatedAt: 0, deletedAt: null });
    }
    return out;
  }
}

/**
 * USDA's ranking ignores the brand, so "clif bar chocolate chip" can put the actual Clif
 * chocolate chip bar tenth. Re-order by how many query words appear in brand + name (stable,
 * so USDA's order breaks ties).
 */
export function rankBranded(q: string, foods: Food[]): Food[] {
  const words = [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))];
  const score = (f: Food) => {
    const hay = `${f.brand ?? ''} ${f.name}`.toLowerCase();
    return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
  };
  return foods
    .map((f, i) => ({ f, i, s: score(f) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.f);
}
