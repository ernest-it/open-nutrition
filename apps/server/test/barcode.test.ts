import { afterEach, describe, expect, it } from 'vitest';
import { N, OFF_ATTRIBUTION, OFF_USER_AGENT, USDA_ATTRIBUTION } from '@open-nutrition/shared';
import { HIT_TTL_MS, MISS_TTL_MS } from '../src/barcode';
import { startApp, tokenFor, type App } from './helpers';

let app: App;
afterEach(async () => app?.close());

const NUTELLA = '3017620422003'; // valid EAN-13
const UNKNOWN = '4006381333931'; // valid EAN-13
const UPC = '012000161155'; // valid UPC-A

const offProduct = {
  code: NUTELLA,
  status: 1,
  product: {
    code: NUTELLA,
    product_name: 'Hazelnut spread',
    brands: 'Some Brand, Other',
    serving_size: '15 g',
    serving_quantity: 15,
    nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, sodium_100g: 0.0428 },
  },
};

const fdcHit = {
  foods: [
    {
      fdcId: 999001,
      description: 'COLA, ORIGINAL',
      brandOwner: 'Example Beverages',
      gtinUpc: '00012000161155',
      servingSize: 355,
      servingSizeUnit: 'ml',
      householdServingFullText: '1 can',
      foodNutrients: [
        { nutrientNumber: '208', unitName: 'KCAL', value: 42 },
        { nutrientNumber: '205', unitName: 'G', value: 10.6 },
        { nutrientNumber: '307', unitName: 'MG', value: 4 },
      ],
    },
  ],
};

interface Call {
  url: string;
  headers: Record<string, string>;
}

function mockFetch() {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    const json = (status: number, body: unknown) =>
      ({ ok: status < 300, status, json: async () => body }) as Response;
    if (url.startsWith('https://world.openfoodfacts.org/')) {
      if (url.includes(NUTELLA)) return json(200, offProduct);
      return json(404, { status: 0, status_verbose: 'product not found' });
    }
    if (url.startsWith('https://api.nal.usda.gov/')) return json(200, url.includes(UPC) ? fdcHit : { foods: [] });
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function setup(env: NodeJS.ProcessEnv = {}, offPerMinute?: number) {
  const f = mockFetch();
  let now = Date.UTC(2026, 10, 19);
  app = await startApp(env, { fetchImpl: f.impl, now: () => now, offPerMinute });
  const token = await tokenFor(app);
  const get = (code: string) => app.inject({ url: `/api/v1/foods/barcode/${code}`, headers: { authorization: `Bearer ${token}` } });
  return { ...f, get, advance: (ms: number) => (now += ms) };
}

describe('barcode lookup', () => {
  it('maps an Open Food Facts product, sends the User-Agent and caches it', async () => {
    const t = await setup();
    const r = await t.get(NUTELLA);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.source).toBe('off');
    expect(body.attribution).toBe(OFF_ATTRIBUTION);
    expect(body.food).toMatchObject({ name: 'Hazelnut spread', brand: 'Some Brand', barcode: NUTELLA, source: 'off' });
    expect(body.food.nutrients[N.energy]).toBe(539);
    expect(body.food.nutrients[N.sodium]).toBeCloseTo(42.8);
    expect(body.food.servings).toContainEqual({ label: '15 g', grams: 15 });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.headers['User-Agent']).toBe(OFF_USER_AGENT);

    // cached for 30 days
    t.advance(HIT_TTL_MS - 1000);
    expect((await t.get(NUTELLA)).json().food.name).toBe('Hazelnut spread');
    expect(t.calls).toHaveLength(1);
    t.advance(2000);
    await t.get(NUTELLA);
    expect(t.calls).toHaveLength(2);
  });

  it('caches misses for a day', async () => {
    const t = await setup();
    expect((await t.get(UNKNOWN)).json()).toEqual({ food: null, source: null, attribution: null });
    await t.get(UNKNOWN);
    expect(t.calls).toHaveLength(1);
    t.advance(MISS_TTL_MS + 1000);
    await t.get(UNKNOWN);
    expect(t.calls).toHaveLength(2);
  });

  it('rejects invalid barcodes and requires auth', async () => {
    const t = await setup();
    expect((await t.get('12345')).statusCode).toBe(400);
    expect((await t.get('3017620422004')).statusCode).toBe(400); // bad check digit
    expect((await app.inject(`/api/v1/foods/barcode/${NUTELLA}`)).statusCode).toBe(401);
    expect(t.calls).toHaveLength(0);
  });

  it('rate-limits outbound calls', async () => {
    const t = await setup({}, 2);
    expect((await t.get(NUTELLA)).statusCode).toBe(200);
    expect((await t.get(UNKNOWN)).statusCode).toBe(200);
    const limited = await t.get(UPC);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    // cache hits are not limited
    expect((await t.get(NUTELLA)).statusCode).toBe(200);
    t.advance(61_000);
    expect((await t.get(UPC)).statusCode).toBe(200);
  });

  it('falls back to USDA Branded when USDA_API_KEY is set', async () => {
    const t = await setup({ USDA_API_KEY: 'test-key' });
    const body = (await t.get(UPC)).json();
    expect(body.source).toBe('usda_branded');
    expect(body.attribution).toBe(USDA_ATTRIBUTION);
    expect(body.food).toMatchObject({ name: 'Cola, Original', brand: 'Example Beverages', barcode: UPC, source: 'usda', sourceId: '999001' });
    expect(body.food.nutrients).toEqual({ [N.energy]: 42, [N.carbs]: 10.6, [N.sodium]: 4 });
    expect(body.food.servings).toContainEqual({ label: '1 can (355 ml)', grams: 355 });
    const usda = t.calls.find((c) => c.url.startsWith('https://api.nal.usda.gov/'))!;
    expect(usda.headers['X-Api-Key']).toBe('test-key');
    expect(usda.url).not.toContain('test-key');
  });

  it('does not call USDA without a key', async () => {
    const t = await setup();
    expect((await t.get(UPC)).json().food).toBeNull();
    expect(t.calls.every((c) => c.url.startsWith('https://world.openfoodfacts.org/'))).toBe(true);
  });
});
