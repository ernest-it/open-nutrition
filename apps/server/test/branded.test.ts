import { afterEach, describe, expect, it } from 'vitest';
import { N, USDA_ATTRIBUTION } from '@open-nutrition/shared';
import { BRANDED_TTL_MS } from '../src/branded';
import { startApp, tokenFor, type App } from './helpers';

let app: App;
afterEach(async () => app?.close());

const hit = (fdcId: number, description: string, extra: Record<string, unknown> = {}) => ({
  fdcId,
  description,
  brandOwner: 'Example Foods Inc.',
  brandName: 'EXAMPLE',
  gtinUpc: '00012345678905',
  servingSize: 40,
  servingSizeUnit: 'g',
  householdServingFullText: '2 bars',
  foodNutrients: [
    { nutrientNumber: '208', unitName: 'KCAL', value: 450 },
    { nutrientNumber: '203', unitName: 'G', value: 10 },
    { nutrientNumber: '205', unitName: 'G', value: 60 },
    { nutrientNumber: '204', unitName: 'G', value: 18 },
  ],
  ...extra,
});

async function setup(env: NodeJS.ProcessEnv = { USDA_API_KEY: 'test-key' }, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    if (url.includes('query=loose') && url.includes('requireAllWords=true')) return { ok: true, status: 200, json: async () => ({ foods: [] }) } as Response;
    const body = {
      foods: [
        hit(1, 'GRANOLA BARS, OATS & HONEY'),
        hit(2, 'GRANOLA BARS, OATS & HONEY'), // same product listed twice
        hit(3, 'GRANOLA BARS, PEANUT BUTTER', { gtinUpc: '' }),
        hit(4, 'NO NUTRIENTS', { foodNutrients: [] }),
      ],
    };
    return { ok: status < 300, status, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  let now = Date.UTC(2026, 10, 21);
  app = await startApp(env, { fetchImpl, now: () => now });
  const token = await tokenFor(app);
  const search = (q: string) => app.inject({ url: `/api/v1/foods/branded?q=${encodeURIComponent(q)}`, headers: { authorization: `Bearer ${token}` } });
  return { calls, search, advance: (ms: number) => (now += ms) };
}

describe('packaged-food (USDA Branded) search', () => {
  it('maps, de-duplicates and caches results; the key stays out of the URL', async () => {
    const t = await setup();
    const r = await t.search('Granola  Bars');
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.attribution).toBe(USDA_ATTRIBUTION);
    expect(body.foods.map((f: { name: string }) => f.name)).toEqual(['Granola Bars, Oats & Honey', 'Granola Bars, Peanut Butter']);
    const [first, second] = body.foods;
    expect(first).toMatchObject({ id: 'fdc:1', source: 'usda', sourceId: '1', brand: 'Example', barcode: '012345678905' });
    expect(first.nutrients[N.energy]).toBe(450);
    expect(first.servings).toContainEqual({ label: '2 bars (40 g)', grams: 40 });
    expect(second.barcode).toBeNull();

    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.url).toContain('dataType=Branded');
    expect(t.calls[0]!.url).toContain('query=granola%20bars&');
    expect(t.calls[0]!.url).not.toContain('test-key');
    expect(t.calls[0]!.headers['X-Api-Key']).toBe('test-key');

    // Same query (any spacing/case) is served from the cache until it expires.
    await t.search('granola bars');
    expect(t.calls).toHaveLength(1);
    t.advance(BRANDED_TTL_MS + 1);
    await t.search('granola bars');
    expect(t.calls).toHaveLength(2);
  });

  it('falls back to any-word matching when every-word finds nothing', async () => {
    const t = await setup();
    expect((await t.search('loose words')).json().foods).toHaveLength(2);
    expect(t.calls.map((c) => /requireAllWords=(true|false)/.exec(c.url)?.[1])).toEqual(['true', 'false']);
  });

  it('ignores very short queries and is reported in server-info', async () => {
    const t = await setup();
    expect((await t.search('ab')).json().foods).toEqual([]);
    expect(t.calls).toHaveLength(0);
    expect((await app.inject({ url: '/api/v1/server-info' })).json().brandedSearch).toBe(true);
  });

  it('is off without a USDA key', async () => {
    const t = await setup({});
    expect((await t.search('granola')).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/v1/server-info' })).json().brandedSearch).toBe(false);
  });

  it('surfaces upstream errors as 502', async () => {
    const t = await setup(undefined, 500);
    expect((await t.search('granola')).statusCode).toBe(502);
  });

  it('requires sign-in', async () => {
    await setup();
    expect((await app.inject({ url: '/api/v1/foods/branded?q=granola' })).statusCode).toBe(401);
  });
});

describe('branded names', () => {
  it('drops repeats and a leading brand, and title-cases without "Kit\'S"', async () => {
    const { cleanBrandedName, titleCase } = await import('../src/barcode');
    expect(titleCase(cleanBrandedName("CLIF BAR, CLIF KIT'S ORGANIC, FRUIT + NUT BAR, CASHEW, CLIF BAR, CLIF KIT'S ORGANIC, FRUIT + NUT BAR, CASHEW", 'CLIF BAR'))).toBe(
      "Clif Kit's Organic, Fruit + Nut Bar, Cashew",
    );
    expect(cleanBrandedName('WILD BLUEBERRY ALMOND, WILD BLUEBERRY ALMOND', 'CLIF BAR')).toBe('WILD BLUEBERRY ALMOND');
    expect(cleanBrandedName('CLIF BAR', 'CLIF BAR')).toBe('CLIF BAR');
    expect(titleCase('Already Mixed case')).toBe('Already Mixed case');
  });
});

describe('branded ranking', () => {
  it('puts items matching more query words (brand included) first, keeping USDA order for ties', async () => {
    const { rankBranded } = await import('../src/branded');
    const food = (name: string, brand: string | null) => ({ name, brand }) as never;
    const ranked = rankBranded('clif bar chocolate chip', [
      food("Clif Kit's Organic, Fruit + Nut Bar, Cashew", 'Clif Bar'),
      food('Bars, Chocolate Chip', 'This Saves Lives'),
      food('Chocolate Chip Energy Bar', 'Clif Bar'),
      food('Fruit + Nut Bar, Peanut Butter', 'Clif Bar'),
    ]) as unknown as { name: string }[];
    expect(ranked.map((f) => f.name)).toEqual([
      'Chocolate Chip Energy Bar',
      'Bars, Chocolate Chip',
      "Clif Kit's Organic, Fruit + Nut Bar, Cashew",
      'Fruit + Nut Bar, Peanut Butter',
    ]);
  });
});
