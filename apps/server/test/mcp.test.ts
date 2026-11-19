import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorage, N, NutritionStore, addDays, todayLocal } from '@open-nutrition/shared';
import { injectFetch, startApp, tokenFor, type App } from './helpers';

let app: App;
let token: string;
const today = todayLocal();

beforeEach(async () => {
  app = await startApp();
  token = await tokenFor(app);
  const store = new NutritionStore(new MemoryStorage(), { fetch: injectFetch(app) });
  await store.init();
  store.server = { baseUrl: 'http://test', token };
  const oats = store.upsertFood({
    name: 'Rolled oats', brand: null, barcode: null, source: 'custom', sourceId: null,
    servings: [{ label: '100 g', grams: 100 }, { label: '1 cup', grams: 80 }],
    nutrients: { [N.energy]: 380, [N.protein]: 13, [N.carbs]: 67, [N.fat]: 7 }, favorite: true,
  });
  store.setTargets({ [N.energy]: 2000, [N.protein]: 100 }, 2000, addDays(today, -30));
  store.logFood({ day: today, meal: 'breakfast', food: oats, grams: 80, servingLabel: '1 cup', quantity: 1 });
  store.quickAdd({ day: today, meal: 'snack', name: 'Protein bar', nutrients: { [N.energy]: 200, [N.protein]: 20 } });
  store.quickAdd({ day: addDays(today, -1), meal: 'dinner', name: 'Pasta', nutrients: { [N.energy]: 600, [N.protein]: 20 } });
  const day = 86_400_000;
  for (let i = 0; i < 10; i++) store.addMeasurement('body_weight', 80 - i * 0.1, Date.now() - (9 - i) * day);
  await store.sync();
});
afterEach(async () => app.close());

let id = 0;
async function rpc(method: string, params?: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${token}` },
    payload: { jsonrpc: '2.0', id: ++id, method, params },
  });
  return res.json();
}
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  expect(r.result.isError).toBe(false);
  return r.result.content[0].text as string;
};

describe('MCP', () => {
  it('requires a token and lists nutrition tools', async () => {
    const anon = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(anon.statusCode).toBe(401);
    const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const tools = (await rpc('tools/list')).result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(['get_day', 'get_range_summary', 'search_foods', 'get_weight_trend']);
  });

  it('get_day shows entries and totals versus targets', async () => {
    const text = await call('get_day', { date: today });
    expect(text).toContain('Rolled oats · 1 × 1 cup · 304 kcal');
    expect(text).toContain('Protein bar');
    expect(text).toMatch(/Calories: 504 kcal of 2000 kcal target \(25%\)/);
    expect(text).toMatch(/Protein: 30.4 g of 100 g target \(30%\)/);
  });

  it('get_range_summary averages logged days', async () => {
    const text = await call('get_range_summary', { from: addDays(today, -6), to: today, nutrients: ['protein', 'calories'] });
    expect(text).toContain('Days in range: 7; days with food logged: 2.');
    expect(text).toMatch(/Protein: 25.2 g of 100 g target/); // (30.4 + 20) / 2
    expect(text).toContain('Top sources of protein');
  });

  it('search_foods covers the user foods and the USDA database', async () => {
    const text = await call('search_foods', { query: 'oats' });
    expect(text).toContain("## User's foods");
    expect(text).toContain('Rolled oats');
    expect(text).toContain('## USDA database');
    expect(text).toMatch(/\[id: usda:\d+\]/);
  });

  it('get_weight_trend reports the rate', async () => {
    const text = await call('get_weight_trend', { days: 30 });
    expect(text).toContain('10 weigh-ins');
    expect(text).toMatch(/Rate: -0.7 kg per week/);
  });

  it('rejects bad arguments', async () => {
    const r = await rpc('tools/call', { name: 'get_day', arguments: { date: 'yesterday' } });
    expect(r.result.isError).toBe(true);
  });
});
