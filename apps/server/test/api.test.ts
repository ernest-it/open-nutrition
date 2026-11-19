import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorage, N, NutritionStore, type Food } from '@open-nutrition/shared';
import { injectFetch, register, startApp, tokenFor, type App } from './helpers';

let app: App;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => app.close());

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('auth', () => {
  it('first user becomes admin, then registration closes', async () => {
    expect((await app.inject('/api/v1/server-info')).json().registrationOpen).toBe(true);
    const r = await register(app);
    expect(r.statusCode).toBe(201);
    expect(r.json().user.isAdmin).toBe(true);
    expect(r.json().token).toMatch(/^on_/);
    const info = (await app.inject('/api/v1/server-info')).json();
    expect(info.registrationOpen).toBe(false);
    expect(info.foodDb).toBe(true);
    expect((await register(app, 'bob')).statusCode).toBe(403);
  });

  it('logs in and rejects bad passwords', async () => {
    await register(app);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alice', password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'ALICE', password: 'correct horse' } });
    expect(ok.statusCode).toBe(200);
    const me = await app.inject({ url: '/api/v1/me', headers: auth(ok.json().token) });
    expect(me.json().username).toBe('alice');
    expect((await app.inject('/api/v1/me')).statusCode).toBe(401);
  });
});

describe('sync', () => {
  const yogurt = {
    name: 'Greek yogurt, plain',
    brand: 'Test Dairy',
    barcode: '5000112637922',
    source: 'off' as const,
    sourceId: '5000112637922',
    servings: [
      { label: '100 g', grams: 100 },
      { label: '1 pot', grams: 170 },
    ],
    nutrients: { [N.energy]: 97, [N.protein]: 9, [N.fat]: 5, [N.carbs]: 3.6, [N.calcium]: 100 },
    favorite: true,
  };

  it('round-trips JSON columns (servings, nutrients) between devices with last-write-wins', async () => {
    const token = await tokenFor(app);
    const server = { baseUrl: 'http://test', token };
    const phone = new NutritionStore(new MemoryStorage(), { fetch: injectFetch(app) });
    const laptop = new NutritionStore(new MemoryStorage(), { fetch: injectFetch(app) });
    await phone.init();
    await laptop.init();
    phone.server = laptop.server = server;

    const food = phone.upsertFood(yogurt);
    const entry = phone.logFood({ day: '2026-11-19', meal: 'breakfast', food, grams: 170, servingLabel: '1 pot', quantity: 1 });
    phone.setTargets({ [N.energy]: 2000, [N.protein]: 120 }, 2500, '2026-11-01');
    await phone.sync();
    expect(phone.pendingCount()).toBe(0);

    await laptop.sync();
    const got = laptop.get('foods', food.id) as Food;
    expect(got).toEqual(food);
    expect(got.servings).toEqual(yogurt.servings);
    expect(got.nutrients[N.protein]).toBe(9);
    expect(got.favorite).toBe(true);
    expect(laptop.entriesOn('2026-11-19')[0]!.nutrients[N.energy]).toBeCloseTo(97 * 1.7);
    expect(laptop.targetsOn('2026-11-19')?.nutrients[N.protein]).toBe(120);

    // concurrent edits: the later one wins everywhere
    laptop.update('foods', food.id, { name: 'Laptop edit' });
    await new Promise((r) => setTimeout(r, 5));
    phone.update('foods', food.id, { name: 'Phone edit (later)', servings: [{ label: '100 g', grams: 100 }] });
    await laptop.sync();
    await phone.sync();
    await laptop.sync();
    expect(laptop.get('foods', food.id)?.name).toBe('Phone edit (later)');
    expect((laptop.get('foods', food.id) as Food).servings).toHaveLength(1);

    // deletes propagate
    phone.remove('diaryEntries', entry.id);
    await phone.sync();
    await laptop.sync();
    expect(laptop.entriesOn('2026-11-19')).toHaveLength(0);
  });

  it('stores unknown JSON (AI responses) and returns it intact', async () => {
    const token = await tokenFor(app);
    const response = { items: [{ name: 'Toast', grams: 30, nutrients: { '208': 80 } }], assumptions: ['one slice'] };
    const row = {
      id: 'ai1', date: '2026-11-19', meal: 'lunch', photoHash: null, description: 'toast', model: 'claude-opus-5-5',
      response, accepted: null, inputTokens: 10, outputTokens: 20, createdAt: 1, updatedAt: 1, deletedAt: null,
    };
    const res = await app.inject({ method: 'POST', url: '/api/v1/sync', headers: auth(token), payload: { since: 0, changes: { aiEstimates: [row] } } });
    expect(res.json().rejected).toEqual([]);
    expect(res.json().changes.aiEstimates[0]).toEqual(row);
  });

  it('rejects usda: ids, invalid rows, and isolates users', async () => {
    const a = await tokenFor(app, 'alice');
    const base = { createdAt: 1, updatedAt: 1, deletedAt: null };
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: auth(a),
      payload: {
        since: 0,
        changes: {
          measurements: [
            { id: 'm1', kind: 'body_weight', value: 80, takenAt: 1, note: null, ...base },
            { id: 'm2', kind: 'not_a_kind', value: 1 },
          ],
          foods: [{ ...yogurt, id: 'usda:171287', ...base }],
        },
      },
    });
    const body = res.json();
    expect(body.changes.measurements).toHaveLength(1);
    expect(body.changes.foods).toBeUndefined();
    expect(body.rejected.map((r: { id: string }) => r.id).sort()).toEqual(['m2', 'usda:171287']);

    // a second user sees nothing of alice's
    await app.close();
    app = await startApp({ ALLOW_REGISTRATION: 'true' });
    await tokenFor(app, 'alice');
    const b = await tokenFor(app, 'bob');
    const pulled = await app.inject({ method: 'POST', url: '/api/v1/sync', headers: auth(b), payload: { since: 0, changes: {} } });
    expect(pulled.json().changes).toEqual({});
  });

  it('paginates large pulls', async () => {
    const token = await tokenFor(app);
    const rows = Array.from({ length: 12_000 }, (_, i) => ({
      id: `m${i}`, kind: 'body_weight', value: 80, takenAt: i, note: null, createdAt: 1, updatedAt: 1, deletedAt: null,
    }));
    await app.inject({ method: 'POST', url: '/api/v1/sync', headers: auth(token), payload: { since: 0, changes: { measurements: rows } } });
    const fresh = new NutritionStore(new MemoryStorage(), { fetch: injectFetch(app) });
    await fresh.init();
    fresh.server = { baseUrl: 'http://test', token };
    await fresh.sync();
    expect(fresh.list('measurements')).toHaveLength(12_000);
  });
});

describe('food database', () => {
  it('requires auth', async () => {
    expect((await app.inject('/api/v1/foods/search?q=banana')).statusCode).toBe(401);
    expect((await app.inject('/api/v1/foods/usda:173944')).statusCode).toBe(401);
  });

  it('returns ranked results from the bundled DB', async () => {
    const token = await tokenFor(app);
    const search = async (q: string, limit = 10) =>
      (await app.inject({ url: `/api/v1/foods/search?q=${encodeURIComponent(q)}&limit=${limit}`, headers: auth(token) })).json().foods as Food[];

    const bananas = await search('banana');
    expect(bananas.length).toBeGreaterThan(1);
    expect(bananas[0]!.name).toBe('Bananas, raw');
    expect(bananas[0]!.id).toMatch(/^usda:\d+$/);
    expect(bananas[0]!.source).toBe('usda');
    expect(bananas[0]!.servings[0]).toEqual({ label: '100 g', grams: 100 });
    expect(bananas[0]!.nutrients[N.energy]).toBeGreaterThan(50);

    // bm25 alone would put "Strudel, apple" first
    expect((await search('apple'))[0]!.name).toMatch(/^Apples?\b/);
    expect(await search('chicken breast', 3)).toHaveLength(3);
    expect(await search('"*)(')).toEqual([]);

    const one = await app.inject({ url: `/api/v1/foods/${bananas[0]!.id}`, headers: auth(token) });
    expect(one.json().food).toEqual(bananas[0]);
    expect((await app.inject({ url: '/api/v1/foods/usda:1', headers: auth(token) })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/v1/foods/nope', headers: auth(token) })).statusCode).toBe(404);
  });

  it('returns 503 when the DB is missing', async () => {
    await app.close();
    app = await startApp({ FOOD_DB_PATH: 'does/not/exist.db' });
    const token = await tokenFor(app);
    expect((await app.inject({ url: '/api/v1/foods/search?q=banana', headers: auth(token) })).statusCode).toBe(503);
  });
});

describe('export', () => {
  it('exports the diary as CSV and JSON', async () => {
    const token = await tokenFor(app);
    const store = new NutritionStore(new MemoryStorage(), { fetch: injectFetch(app) });
    await store.init();
    store.server = { baseUrl: 'http://test', token };
    store.quickAdd({ day: '2026-11-19', meal: 'snack', name: 'Cookie', nutrients: { [N.energy]: 150 } });
    await store.sync();
    const csv = await app.inject({ url: '/api/v1/export/diary.csv', headers: auth(token) });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Cookie');
    const json = await app.inject({ url: '/api/v1/export/json', headers: auth(token) });
    expect(json.json().data.diaryEntries).toHaveLength(1);
  });
});
