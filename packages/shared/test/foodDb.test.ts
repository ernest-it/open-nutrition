import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FOOD_BY_ID_SQL,
  FOOD_SEARCH_CANDIDATES,
  FOOD_SEARCH_SQL,
  N,
  builtinFdcId,
  ftsQuery,
  rankFoods,
  rowToFood,
  type FoodDbRow,
} from '../src';

describe('ftsQuery', () => {
  it('sanitises user text into quoted prefix terms', () => {
    expect(ftsQuery('chicken breast')).toBe('"chicken"* "breast"*');
    expect(ftsQuery('  "rice" AND (white) OR name:beans* -NOT ')).toBe('"rice"* "and"* "white"* "or"* "name"* "beans"* "not"*');
    expect(ftsQuery('Crème brûlée')).toBe('"creme"* "brulee"*');
    expect(ftsQuery('2% milk')).toBe('"2"* "milk"*');
    expect(ftsQuery('"*^:()')).toBeNull();
    expect(ftsQuery('')).toBeNull();
    expect(ftsQuery('a b c d e f g h i j')!.split(' ')).toHaveLength(8);
  });
});

describe('rowToFood', () => {
  it('maps a DB row to a builtin food with a 100 g serving', () => {
    const f = rowToFood({
      fdcId: 171688,
      name: 'Apples, raw, with skin (Includes foods for USDA\'s Food Distribution Program)',
      category: 'Fruits and Fruit Juices',
      dataType: 'sr_legacy_food',
      servings: JSON.stringify([
        { label: '1 cup, sliced', grams: 109 },
        { label: '1 medium (3" dia)', grams: 182 },
        { label: 'bad', grams: 0 },
      ]),
      nutrients: JSON.stringify({ '208': 52, '203': 0.26, '401': 4.6 }),
    });
    expect(f.id).toBe('usda:171688');
    expect(f.source).toBe('usda');
    expect(f.sourceId).toBe('171688');
    expect(f.servings.map((s) => s.label)).toEqual(['100 g', '1 cup, sliced', '1 medium (3" dia)']);
    expect(f.nutrients[N.energy]).toBe(52);
    expect(builtinFdcId(f.id)).toBe(171688);
    expect(builtinFdcId('abc')).toBeNull();
    expect(rowToFood({ fdcId: 1, name: 'X', category: null, dataType: 'x', servings: 'oops', nutrients: '{}' }).servings).toEqual([
      { label: '100 g', grams: 100 },
    ]);
    expect(FOOD_SEARCH_SQL).toContain('MATCH ?');
    expect(FOOD_BY_ID_SQL).toContain('fdcId = ?');
  });
});

const names = (q: string, list: string[]) => rankFoods(q, list.map((name) => ({ name }))).map((r) => r.name);

describe('rankFoods', () => {
  it('puts the plain food before dishes that only mention it', () => {
    const r = names('apple', [
      'Strudel, apple',
      'Croissants, apple',
      "APPLEBEE'S, chicken tenders platter",
      'Apple juice, canned or bottled, unsweetened, without added ascorbic acid',
      'Apples, raw, with skin (Includes foods for USDA\'s Food Distribution Program)',
      'Apples, raw, without skin',
      'Pie, apple, commercially prepared, enriched flour',
    ]);
    expect(r[0]).toMatch(/^Apples, raw/);
    expect(r[1]).toMatch(/^Apples, raw/);
    expect(r.indexOf('Strudel, apple')).toBeGreaterThan(r.findIndex((n) => n.startsWith('Apple juice')));
    expect(r.indexOf("APPLEBEE'S, chicken tenders platter")).toBeGreaterThan(3);
  });

  it('handles egg vs eggnog/eggplant and banana forms', () => {
    const r = names('egg', ['Eggnog', 'Eggplant, raw', 'Egg, whole, raw, fresh', 'Egg, whole, cooked, hard-boiled', 'Noodles, egg, cooked, enriched']);
    expect(r.slice(0, 2)).toEqual(['Egg, whole, raw, fresh', 'Egg, whole, cooked, hard-boiled']);
    const b = names('banana', ['Bananas, dehydrated, or banana powder', 'Banana chips', 'Bananas, raw', 'Bread, banana, prepared from recipe, made with margarine']);
    expect(b[0]).toBe('Bananas, raw');
  });

  it('handles category-headed names (coffee, salmon, milk)', () => {
    const c = names('coffee', [
      'Ice creams, coffee',
      'Candies, coffee-flavored',
      'Beverages, coffee, brewed, prepared with tap water',
      'Beverages, coffee, instant, regular, powder',
    ]);
    expect(c[0]).toBe('Beverages, coffee, brewed, prepared with tap water');
    const s = names('salmon', ['Fish oil, salmon', 'Fish, salmon, Atlantic, farmed, raw', 'Fish, salmon, pink, canned, drained solids']);
    expect(s[0]).toBe('Fish, salmon, Atlantic, farmed, raw');
    expect(s[2]).toBe('Fish oil, salmon');
    const m = names('milk', [
      'Puddings, chocolate, ready-to-eat',
      'Milk shakes, thick chocolate',
      'Candies, milk chocolate',
      'Milk, whole, 3.25% milkfat, with added vitamin D',
      'Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D',
    ]);
    expect(m[0]).toMatch(/^Milk, /);
    expect(m[1]).toMatch(/^Milk, /);
  });

  it('handles multi-word queries', () => {
    const r = names('chicken breast', [
      'Chicken, broilers or fryers, wing, meat and skin, raw',
      'Chicken, broilers or fryers, breast, meat only, cooked, roasted',
      'Soup, chicken noodle, canned',
    ]);
    expect(r[0]).toBe('Chicken, broilers or fryers, breast, meat only, cooked, roasted');
    const w = names('white rice', ['Rice, white, long-grain, regular, cooked', 'Rice, brown, long-grain, cooked', 'Rice crackers']);
    expect(w[0]).toBe('Rice, white, long-grain, regular, cooked');
  });
});

// Sanity check against the real bundled DB when it is present (node:sqlite, Node >= 22.5).
const dbPath = fileURLToPath(new URL('../../../apps/mobile/assets/foods.db', import.meta.url));
describe.skipIf(!existsSync(dbPath))('rankFoods on the bundled foods.db', () => {
  it('ranks common single-word searches sensibly', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const top = (q: string) =>
      rankFoods(q, db.prepare(FOOD_SEARCH_SQL).all(ftsQuery(q)!, FOOD_SEARCH_CANDIDATES) as unknown as FoodDbRow[])
        .slice(0, 3)
        .map((r) => r.name);
    const results = Object.fromEntries(['apple', 'banana', 'egg', 'milk', 'coffee', 'salmon', 'rice', 'chicken breast', 'oats'].map((q) => [q, top(q)]));
    console.log(JSON.stringify(results, null, 1));
    expect(results.apple![0]).toMatch(/^Apples?\b/);
    expect(results.banana![0]).toMatch(/^Bananas?, raw/);
    expect(results.egg![0]).toMatch(/^Eggs?,/);
    expect(results.milk![0]).toMatch(/^Milk\b/);
    expect(results.salmon![0]).toMatch(/salmon/i);
    expect(results.salmon![0]).not.toMatch(/oil/i);
    expect(results.coffee![0]).toMatch(/coffee/i);
    db.close();
  });
});
