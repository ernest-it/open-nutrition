import { describe, expect, it } from 'vitest';
import {
  COLLECTION_NAMES,
  DEFAULT_PREFS,
  MemoryStorage,
  N,
  NutritionStore,
  diaryToCsv,
  parseCsv,
  type ChangeSet,
  type Food,
  type SyncResponse,
} from '../src';

const rice: Food = {
  id: 'usda:169704',
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  name: 'Rice, white, long-grain, regular, cooked',
  brand: null,
  barcode: null,
  source: 'usda',
  sourceId: '169704',
  servings: [
    { label: '100 g', grams: 100 },
    { label: '1 cup', grams: 158 },
  ],
  nutrients: { [N.energy]: 130, [N.protein]: 2.69, [N.carbs]: 28.2, [N.fat]: 0.28 },
  favorite: false,
};

async function newStore(start = new Date(2026, 10, 19, 8).getTime()) {
  let t = start;
  const store = new NutritionStore(new MemoryStorage(), { now: () => (t += 1000) });
  await store.init();
  return store;
}

describe('NutritionStore diary', () => {
  it('logs a builtin food, caching it once in foods', async () => {
    const s = await newStore();
    const day = s.today();
    const e1 = s.logFood({ day, meal: 'lunch', food: rice, grams: 158, servingLabel: '1 cup' });
    const e2 = s.logFood({ day, meal: 'dinner', food: rice, grams: 79, servingLabel: '1 cup', quantity: 0.5 });
    const foods = s.all('foods');
    expect(foods).toHaveLength(1);
    expect(foods[0]!.id).not.toMatch(/^usda:/);
    expect(foods[0]!.source).toBe('usda');
    expect(foods[0]!.sourceId).toBe('169704');
    expect(e1.foodId).toBe(foods[0]!.id);
    expect(e2.foodId).toBe(foods[0]!.id);
    expect(e1.nutrients[N.energy]).toBeCloseTo(205.4, 1);
    expect(e2.quantity).toBe(0.5);
    // logging the stored copy reuses it
    s.logFood({ day, meal: 'snack', food: foods[0]!, grams: 100 });
    expect(s.all('foods')).toHaveLength(1);
    expect(s.dayTotals(day)[N.energy]).toBeCloseTo(205.4 + 102.7 + 130, 1);
    expect(s.mealTotals(day, 'dinner')[N.energy]).toBeCloseTo(102.7, 1);
    expect(s.recentFoods().map((f) => f.id)).toEqual([foods[0]!.id]);
  });

  it('orders entries by meal then position, and moves entries', async () => {
    const s = await newStore();
    const day = '2026-11-19';
    const d = s.quickAdd({ day, meal: 'dinner', nutrients: { [N.energy]: 600 } });
    const b1 = s.quickAdd({ day, meal: 'breakfast', name: 'Coffee', nutrients: { [N.energy]: 5 } });
    const b2 = s.quickAdd({ day, meal: 'breakfast', nutrients: { [N.energy]: 300 } });
    expect(s.entriesOn(day).map((e) => e.id)).toEqual([b1.id, b2.id, d.id]);
    expect(b2.name).toBe('Quick add');
    expect(b2.source).toBe('quick');
    expect(b2.foodId).toBeNull();
    s.moveEntry(b1.id, { meal: 'dinner' });
    expect(s.entriesOn(day).map((e) => e.id)).toEqual([b2.id, d.id, b1.id]);
    s.moveEntry(d.id, { day: '2026-11-20' });
    expect(s.entriesOn('2026-11-20')).toHaveLength(1);
  });

  it('copies a meal and logs saved meals', async () => {
    const s = await newStore();
    s.logFood({ day: '2026-11-18', meal: 'breakfast', food: rice, grams: 100 });
    s.quickAdd({ day: '2026-11-18', meal: 'breakfast', name: 'Juice', nutrients: { [N.energy]: 110 } });
    s.quickAdd({ day: '2026-11-18', meal: 'lunch', nutrients: { [N.energy]: 500 } });
    const copied = s.copyMeal('2026-11-18', 'breakfast', '2026-11-19');
    expect(copied).toHaveLength(2);
    expect(s.entriesOn('2026-11-19').map((e) => e.name)).toEqual([rice.name, 'Juice']);
    expect(s.entriesOn('2026-11-18')).toHaveLength(3); // originals untouched
    const toSnack = s.copyMealFromYesterday('2026-11-19', 'lunch');
    expect(toSnack).toHaveLength(1);

    const sm = s.saveMealFromEntries('Usual breakfast', copied.map((e) => e.id));
    expect(sm.meal).toBe('breakfast');
    expect(sm.items).toHaveLength(2);
    const logged = s.logSavedMeal(sm.id, '2026-11-21', 'snack');
    expect(logged.map((e) => e.position)).toEqual([0, 1]);
    expect(s.dayTotals('2026-11-21')[N.energy]).toBeCloseTo(240, 5);
  });

  it('logs recipes by portion and by grams', async () => {
    const s = await newStore();
    const r = s.insert('recipes', {
      name: 'Rice pot',
      ingredients: [{ foodId: null, name: 'Rice', grams: 400, nutrients: rice.nutrients }],
      portions: 4,
      cookedGrams: null,
      notes: null,
      favorite: false,
    });
    const e = s.logRecipe({ day: '2026-11-19', meal: 'dinner', recipeId: r.id, portions: 2 });
    expect(e.grams).toBe(200);
    expect(e.nutrients[N.energy]).toBeCloseTo(260, 5);
    const g = s.logRecipe({ day: '2026-11-19', meal: 'dinner', recipeId: r.id, grams: 50 });
    expect(g.quantity).toBeCloseTo(0.5, 5);
    expect(g.source).toBe('recipe');
  });

  it('dedupes OFF/AI foods and finds by barcode', async () => {
    const s = await newStore();
    const off = {
      name: 'Oat drink',
      brand: 'Oatly',
      barcode: '7394376616228',
      source: 'off' as const,
      sourceId: '7394376616228',
      servings: [{ label: '100 g', grams: 100 }],
      nutrients: { [N.energy]: 46 },
      favorite: false,
    };
    s.logFood({ day: '2026-11-19', meal: 'breakfast', food: off, grams: 250 });
    s.logFood({ day: '2026-11-19', meal: 'snack', food: { ...off, id: 'whatever' }, grams: 250 });
    expect(s.all('foods')).toHaveLength(1);
    expect(s.foodByBarcode('7394376616228')?.name).toBe('Oat drink');
    const ai = { ...off, name: 'Mystery stew', brand: null, barcode: null, source: 'ai' as const, sourceId: null };
    s.logFood({ day: '2026-11-19', meal: 'dinner', food: ai, grams: 300, nutrients: { [N.energy]: 420 } });
    expect(s.all('foods')).toHaveLength(2);
    expect(s.mealTotals('2026-11-19', 'dinner')[N.energy]).toBe(420);

    const custom = s.upsertFood({ ...ai, name: 'My bar', source: 'custom', favorite: true });
    expect(s.favoriteFoods().map((f) => f.id)).toEqual([custom.id]);
    s.upsertFood({ ...custom, name: 'My protein bar' });
    expect(s.get('foods', custom.id)?.name).toBe('My protein bar');
  });
});

describe('NutritionStore targets, water, measurements, settings', () => {
  it('finds the targets in effect on a day and updates same-day rows', async () => {
    const s = await newStore();
    s.setTargets({ [N.energy]: 2000 }, 2000, '2026-01-01');
    s.setTargets({ [N.energy]: 1800 }, 2500, '2026-06-01');
    expect(s.targetsOn('2025-12-31')).toBeUndefined();
    expect(s.targetsOn('2026-03-15')?.nutrients[N.energy]).toBe(2000);
    expect(s.targetsOn('2026-06-01')?.nutrients[N.energy]).toBe(1800);
    s.setTargets({ [N.energy]: 1900 }, null, '2026-06-01');
    expect(s.all('targets')).toHaveLength(2);
    expect(s.targetsOn('2026-12-01')?.nutrients[N.energy]).toBe(1900);
    // default effectiveFrom is today
    s.setTargets({ [N.energy]: 1700 }, null);
    expect(s.targetsOn(s.today())?.nutrients[N.energy]).toBe(1700);
  });

  it('tracks water and weight', async () => {
    const s = await newStore();
    s.addWater(250);
    s.addWater(500);
    s.addWater(300, '2026-11-10');
    expect(s.waterOn(s.today())).toBe(750);
    expect(s.waterOn('2026-11-10')).toBe(300);
    expect(s.latestWeightKg()).toBeNull();
    s.addMeasurement('body_weight', 81, 1000);
    s.addMeasurement('body_weight', 80.2, 5000);
    expect(s.latestWeightKg()).toBe(80.2);
    expect(s.measurementsOf('body_weight')).toHaveLength(2);
  });

  it('stores prefs merged with defaults and AI estimates', async () => {
    const s = await newStore();
    expect(s.prefs()).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.aiEnabled).toBe(false);
    s.setSetting('prefs', { weightUnit: 'lb' });
    expect(s.prefs().weightUnit).toBe('lb');
    expect(s.prefs().aiModel).toBe('claude-opus-5-5');
    const row = s.recordAiEstimate({
      date: '2026-11-19',
      meal: 'lunch',
      photoHash: null,
      description: 'toast',
      model: 'claude-opus-5-5',
      response: { items: [], assumptions: [] },
      accepted: null,
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(s.get('aiEstimates', row.id)?.model).toBe('claude-opus-5-5');
  });

  it('exports the diary as CSV', async () => {
    const s = await newStore();
    s.logFood({ day: '2026-11-19', meal: 'lunch', food: rice, grams: 158, servingLabel: '1 cup' });
    s.quickAdd({ day: '2026-11-18', meal: 'snack', name: 'Cookie, "big"', nutrients: { [N.energy]: 200 } });
    const rows = parseCsv(diaryToCsv(s.all('diaryEntries')));
    expect(rows[0]!.slice(0, 8)).toEqual(['Date', 'Meal', 'Food', 'Source', 'Grams', 'Serving', 'Quantity', 'Calories (kcal)']);
    expect(rows[1]!.slice(0, 3)).toEqual(['2026-11-18', 'snack', 'Cookie, "big"']);
    expect(rows[2]![7]).toBe('205');
    expect(rows[1]![8]).toBe(''); // unknown protein stays empty
  });
});

describe('NutritionStore persistence and sync', () => {
  it('persists and reloads', async () => {
    const storage = new MemoryStorage();
    const a = new NutritionStore(storage);
    await a.init();
    a.insert('measurements', { kind: 'body_weight', value: 80, takenAt: 1, note: null });
    await a.persist();
    const b = new NutritionStore(storage);
    await b.init();
    expect(b.all('measurements')).toHaveLength(1);
    expect(b.pendingCount()).toBe(1);
  });

  it('round-trips through a fake sync server', async () => {
    // Minimal in-memory server: stores rows by collection/id with a revision counter (LWW).
    let rev = 0;
    const rows = new Map<string, { rev: number; c: string; row: { id: string; updatedAt: number } }>();
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      if ((init.headers as Record<string, string>).authorization !== 'Bearer tok') return new Response('', { status: 401 });
      const body = JSON.parse(init.body as string) as { since: number; changes: ChangeSet };
      for (const [c, list] of Object.entries(body.changes)) {
        for (const r of list as { id: string; updatedAt: number }[]) {
          const key = `${c}/${r.id}`;
          const cur = rows.get(key);
          if (!cur || cur.row.updatedAt < r.updatedAt) rows.set(key, { rev: ++rev, c, row: r });
        }
      }
      const changes: Record<string, unknown[]> = {};
      for (const v of rows.values()) if (v.rev > body.since) (changes[v.c] ??= []).push(v.row);
      const res: SyncResponse = { rev, changes: changes as ChangeSet, rejected: [] };
      return new Response(JSON.stringify(res), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const phone = new NutritionStore(new MemoryStorage(), { fetch: fakeFetch });
    await phone.init();
    phone.server = { baseUrl: 'https://n.example.com/', token: 'tok' };
    const entry = phone.logFood({ day: '2026-11-19', meal: 'lunch', food: rice, grams: 100 });
    phone.setSetting('prefs', { aiEnabled: true });
    expect(phone.pendingCount()).toBe(3); // food + entry + setting
    await phone.sync();
    expect(phone.pendingCount()).toBe(0);
    expect(phone.lastSyncError).toBeNull();

    const laptop = new NutritionStore(new MemoryStorage(), { fetch: fakeFetch });
    await laptop.init();
    laptop.server = { baseUrl: 'https://n.example.com', token: 'tok' };
    await laptop.sync();
    expect(laptop.entriesOn('2026-11-19').map((e) => e.id)).toEqual([entry.id]);
    expect(laptop.prefs().aiEnabled).toBe(true);
    expect(laptop.all('foods')).toHaveLength(1);

    // delete on laptop propagates to phone
    laptop.remove('diaryEntries', entry.id);
    await laptop.sync();
    await phone.sync();
    expect(phone.entriesOn('2026-11-19')).toHaveLength(0);
    expect(COLLECTION_NAMES).toContain('diaryEntries');

    // bad token surfaces an error
    phone.server = { baseUrl: 'https://n.example.com', token: 'nope' };
    await expect(phone.sync()).rejects.toThrow(/401/);
    expect(phone.lastSyncError).toMatch(/401/);
  });
});
