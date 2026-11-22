// Barcode lookups: Open Food Facts proxy with a shared cache, plus an optional
// USDA FoodData Central "Branded" fallback when USDA_API_KEY is set.
//
// * Every OFF request sends OFF_USER_AGENT.
// * Results (hits and misses) are cached in `off_cache`, a table of its own that
//   is never merged into user data. Hits are kept 30 days, misses 1 day.
// * Outbound calls are rate-limited globally (OFF allows ~15 product reads/min
//   per IP for apps; we stay well below that) and concurrent lookups of the same
//   code share one request.

import {
  N,
  NUTRIENT_BY_KEY,
  OFF_ATTRIBUTION,
  OFF_USER_AGENT,
  USDA_ATTRIBUTION,
  isValidBarcode,
  mapOffProduct,
  offProductUrl,
  type Food,
  type NutrientMap,
  type Serving,
} from '@open-nutrition/shared';
import type { DB } from './db';

export type BarcodeFood = Omit<Food, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
export type BarcodeSource = 'off' | 'usda_branded';

export interface BarcodeResult {
  food: BarcodeFood | null;
  source: BarcodeSource | null;
  attribution: string | null;
  cached: boolean;
}

export const HIT_TTL_MS = 30 * 86_400_000;
export const MISS_TTL_MS = 86_400_000;
const TIMEOUT_MS = 8000;

export class BarcodeError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** Sliding-window limiter for outbound calls (shared by all users). */
export class OutboundLimiter {
  private times: number[] = [];
  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}
  /** Seconds to wait, or 0 if a call may be made now (and records it). */
  take(): number {
    const t = this.now();
    while (this.times.length && this.times[0]! <= t - this.windowMs) this.times.shift();
    if (this.times.length >= this.limit) return Math.max(1, Math.ceil((this.times[0]! + this.windowMs - t) / 1000));
    this.times.push(t);
    return 0;
  }
}

export interface BarcodeDeps {
  db: DB;
  fetchImpl?: typeof fetch;
  usdaApiKey?: string | null;
  now?: () => number;
  /** Outbound OFF calls per minute (default 10). */
  offPerMinute?: number;
  log?: { warn: (msg: string) => void };
}

export class BarcodeService {
  private inflight = new Map<string, Promise<BarcodeResult>>();
  private offLimiter: OutboundLimiter;
  private usdaLimiter: OutboundLimiter;
  private now: () => number;
  private fetchImpl: typeof fetch;

  constructor(private deps: BarcodeDeps) {
    this.now = deps.now ?? Date.now;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.offLimiter = new OutboundLimiter(deps.offPerMinute ?? 10, 60_000, this.now);
    // api.data.gov allows 1000/hour per key; keep a modest cap anyway.
    this.usdaLimiter = new OutboundLimiter(20, 60_000, this.now);
  }

  lookup(rawCode: string): Promise<BarcodeResult> {
    const code = rawCode.trim();
    if (!isValidBarcode(code)) return Promise.reject(new BarcodeError(400, 'not a valid EAN/UPC barcode'));
    const cached = this.readCache(code);
    if (cached && !cached.stale) return Promise.resolve(cached.result);
    let p = this.inflight.get(code);
    if (!p) {
      p = this.fetchAndCache(code, cached?.result ?? null).finally(() => this.inflight.delete(code));
      this.inflight.set(code, p);
    }
    return p;
  }

  private readCache(code: string): { result: BarcodeResult; stale: boolean } | null {
    const row = this.deps.db.prepare('SELECT json, source, fetchedAt, attribution FROM off_cache WHERE barcode = ?').get(code) as
      | { json: string | null; source: string | null; fetchedAt: number; attribution: string | null }
      | undefined;
    if (!row) return null;
    let food: BarcodeFood | null = null;
    try {
      food = row.json ? (JSON.parse(row.json) as BarcodeFood) : null;
    } catch {
      return null;
    }
    const ttl = food ? HIT_TTL_MS : MISS_TTL_MS;
    return {
      result: { food, source: food ? (row.source as BarcodeSource) : null, attribution: food ? row.attribution : null, cached: true },
      stale: this.now() - row.fetchedAt > ttl,
    };
  }

  private writeCache(code: string, r: BarcodeResult) {
    this.deps.db
      .prepare(
        `INSERT INTO off_cache (barcode, json, source, fetchedAt, attribution) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (barcode) DO UPDATE SET json = excluded.json, source = excluded.source,
           fetchedAt = excluded.fetchedAt, attribution = excluded.attribution`,
      )
      .run(code, r.food ? JSON.stringify(r.food) : null, r.source, this.now(), r.attribution);
  }

  private async fetchAndCache(code: string, stale: BarcodeResult | null): Promise<BarcodeResult> {
    try {
      let food = await this.fetchOff(code);
      let source: BarcodeSource | null = food ? 'off' : null;
      if (!food && this.deps.usdaApiKey) {
        food = await this.fetchUsdaBranded(code).catch((e) => {
          this.deps.log?.warn(`USDA branded lookup failed: ${(e as Error).message}`);
          return null;
        });
        if (food) source = 'usda_branded';
      }
      const result: BarcodeResult = {
        food,
        source,
        attribution: source === 'off' ? OFF_ATTRIBUTION : source === 'usda_branded' ? USDA_ATTRIBUTION : null,
        cached: false,
      };
      this.writeCache(code, result);
      return result;
    } catch (e) {
      // Upstream trouble: serve an expired cache entry rather than nothing.
      if (stale) return stale;
      throw e;
    }
  }

  private async fetchOff(code: string): Promise<BarcodeFood | null> {
    const wait = this.offLimiter.take();
    if (wait) throw new BarcodeError(429, 'Too many barcode lookups right now. Try again in a minute.', wait);
    let res: Response;
    try {
      res = await this.fetchImpl(offProductUrl(code), {
        headers: { 'User-Agent': OFF_USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new BarcodeError(502, `Open Food Facts is unreachable (${(e as Error).name})`);
    }
    if (res.status === 404) return null; // unknown product
    if (res.status === 429) throw new BarcodeError(429, 'Open Food Facts is rate-limiting lookups. Try again in a minute.', 60);
    if (!res.ok) throw new BarcodeError(502, `Open Food Facts returned HTTP ${res.status}`);
    const json = (await res.json().catch(() => null)) as unknown;
    return mapOffProduct(json);
  }

  private async fetchUsdaBranded(code: string): Promise<BarcodeFood | null> {
    if (this.usdaLimiter.take()) return null;
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(code)}&dataType=Branded&pageSize=10`;
    // The key goes in a header so it never appears in URLs or logs.
    const res = await this.fetchImpl(url, {
      headers: { 'X-Api-Key': this.deps.usdaApiKey!, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { foods?: FdcBrandedFood[] };
    const match = (body.foods ?? []).find((f) => f.gtinUpc && sameGtin(f.gtinUpc, code));
    return match ? mapFdcBranded(match, code) : null;
  }
}

// ---- USDA FoodData Central (Branded) -----------------------------------------

export interface FdcBrandedFood {
  fdcId: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: { nutrientNumber?: string; unitName?: string; value?: number }[];
}

const stripZeros = (s: string) => s.trim().replace(/^0+/, '');
export const sameGtin = (a: string, b: string) => stripZeros(a) === stripZeros(b) && stripZeros(a) !== '';

const UNIT_FACTOR: Record<string, Record<string, number>> = {
  kcal: { kcal: 1 },
  g: { g: 1, mg: 0.001 },
  mg: { mg: 1, g: 1000, ug: 0.001, µg: 0.001 },
  µg: { ug: 1, µg: 1, mg: 1000 },
};

/** "KIT'S ORGANIC BAR" → "Kit's Organic Bar" (only ALL-CAPS text; a letter after an apostrophe stays small). */
export const titleCase = (s: string) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_m, pre: string, c: string) => pre + c.toUpperCase()) : s;

/**
 * Tidy a branded description: drop repeated comma-separated parts (USDA descriptions often
 * repeat themselves, "BAR, CASHEW, BAR, CASHEW") and a leading copy of the brand.
 */
export function cleanBrandedName(description: string, brand: string | null): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of description.split(',').map((x) => x.trim()).filter(Boolean)) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(p);
  }
  if (brand && parts.length > 1 && parts[0]!.toLowerCase() === brand.toLowerCase()) parts.shift();
  return parts.join(', ');
}

/** Map an FDC branded search hit (nutrients per 100 g/ml) to a Food. */
export function mapFdcBranded(f: FdcBrandedFood, code: string | null): BarcodeFood | null {
  const nutrients: NutrientMap = {};
  let kj: number | null = null;
  for (const n of f.foodNutrients ?? []) {
    if (!n.nutrientNumber || typeof n.value !== 'number' || !Number.isFinite(n.value) || n.value < 0) continue;
    const unit = (n.unitName ?? '').toLowerCase();
    if (n.nutrientNumber === '268' && unit === 'kj') kj = n.value;
    const def = NUTRIENT_BY_KEY[n.nutrientNumber];
    if (!def) continue;
    const factor = UNIT_FACTOR[def.unit]?.[unit];
    if (factor == null) continue;
    nutrients[def.key] = Math.round(n.value * factor * 1000) / 1000;
  }
  if (nutrients[N.energy] == null && kj != null) nutrients[N.energy] = Math.round(kj / 4.184);
  if (![N.energy, N.protein, N.carbs, N.fat].some((k) => nutrients[k] != null)) return null;
  const name = f.description?.trim();
  if (!name) return null;
  const servings: Serving[] = [{ label: '100 g', grams: 100 }];
  const unit = (f.servingSizeUnit ?? '').toLowerCase();
  if (f.servingSize && f.servingSize > 0 && (unit === 'g' || unit === 'grm' || unit === 'ml' || unit === 'mlt') && f.servingSize !== 100) {
    const label = f.householdServingFullText?.trim() ? `${f.householdServingFullText.trim()} (${f.servingSize} ${unit.startsWith('m') ? 'ml' : 'g'})` : `${f.servingSize} g`;
    servings.push({ label: label.slice(0, 100), grams: f.servingSize });
  }
  const brand = (f.brandName || f.brandOwner || '').trim();
  return {
    name: titleCase(cleanBrandedName(name, brand || null)).slice(0, 300),
    brand: brand ? titleCase(brand).slice(0, 200) : null,
    barcode: code ? code.slice(0, 32) : null,
    source: 'usda',
    sourceId: String(f.fdcId),
    servings,
    nutrients,
    favorite: false,
  };
}
