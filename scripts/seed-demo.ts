// Seeds a demo account with ~2 weeks of realistic data for screenshots.
// Usage (server running, fresh data dir): npx tsx scripts/seed-demo.ts [baseUrl] [foods.db]
// Creates user "alex" / "demo-password-123". Used for the screenshots in docs/SCREENSHOTS.md.
import { DatabaseSync } from 'node:sqlite';
import {
  FOOD_SEARCH_CANDIDATES,
  FOOD_SEARCH_SQL,
  MemoryStorage,
  NutritionStore,
  addDays,
  computeTargets,
  ftsQuery,
  rankFoods,
  rowToFood,
  type Food,
  type FoodDbRow,
  type Meal,
  type Profile,
} from '@open-nutrition/shared';

const [baseUrl = 'http://127.0.0.1:8080', dbPath = 'apps/mobile/assets/foods.db'] = process.argv.slice(2);
const db = new DatabaseSync(dbPath!, { readOnly: true });

function find(q: string): Food {
  const rows = db.prepare(FOOD_SEARCH_SQL).all(ftsQuery(q)!, FOOD_SEARCH_CANDIDATES) as unknown as FoodDbRow[];
  const r = rankFoods(q, rows)[0];
  if (!r) throw new Error(`no food for ${q}`);
  return rowToFood(r);
}

async function main() {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'alex', password: 'demo-password-123', deviceName: 'seed' }),
  });
  if (!res.ok) throw new Error(`register: ${res.status} ${await res.text()}`);
  const { token } = (await res.json()) as { token: string };

  const DAY = 86_400_000;
  let clock = Date.now() - 62 * DAY;
  const store = new NutritionStore(new MemoryStorage(), { now: () => clock });
  await store.init();
  store.server = { baseUrl, token };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const profile: Profile = {
    sex: 'male',
    birthYear: 1992,
    heightCm: 180,
    activity: 'moderate',
    goalKgPerWeek: -0.4,
    proteinGPerKg: 1.8,
    macroSplit: { protein: 30, carbs: 40, fat: 30 },
  } as Profile;
  store.setSetting('profile', profile);
  store.setSetting('prefs', { ...store.prefs(), weightUnit: 'kg', lengthUnit: 'cm', waterUnit: 'ml', aiEnabled: true });
  store.setSetting('goalWeightKg', 78);

  // Weigh-ins over ~9 weeks, trending down with noise.
  for (let d = 60; d >= 0; d--) {
    if (d % 7 === 3 || d % 11 === 5) continue; // skip a few days
    const base = 85.2 - (60 - d) * 0.05;
    const noise = Math.sin(d * 1.7) * 0.35 + Math.cos(d * 0.9) * 0.2;
    store.addMeasurement('body_weight', +(base + noise).toFixed(1), Date.now() - d * DAY - 3 * 3600_000);
  }
  store.addMeasurement('body_fat', 21.5, Date.now() - 40 * DAY);
  store.addMeasurement('body_fat', 20.4, Date.now() - 5 * DAY);
  store.addMeasurement('waist', 89, Date.now() - 40 * DAY);
  store.addMeasurement('waist', 86.5, Date.now() - 5 * DAY);

  const weight = store.latestWeightKg() ?? 82.5;
  store.setTargets(computeTargets(profile, weight), 2500, addDays(todayStr, -30));

  const F = {
    oats: find('oats rolled'),
    milk: find('milk reduced fat 2%'),
    banana: find('banana raw'),
    blueberries: find('blueberries raw'),
    egg: find('egg whole raw'),
    toast: find('bread whole wheat'),
    butter: find('butter salted'),
    coffee: find('coffee brewed'),
    yogurt: find('yogurt greek plain nonfat'),
    chicken: find('chicken breast roasted'),
    rice: find('rice white cooked'),
    broccoli: find('broccoli cooked boiled drained without salt'),
    oliveOil: find('olive oil'),
    salmon: find('salmon atlantic cooked'),
    potato: find('potato baked flesh skin'),
    salad: find('lettuce romaine raw'),
    tomato: find('tomatoes red raw'),
    apple: find('apples raw'),
    almonds: find('almonds'),
    pasta: find('pasta cooked enriched'),
    beef: find('beef ground 90% lean cooked'),
    cheddar: find('cheese cheddar'),
    peanutButter: find('peanut butter smooth'),
    avocado: find('avocados raw'),
  };

  const protein = store.upsertFood({
    name: 'Whey protein, vanilla',
    brand: 'Home pantry',
    barcode: null,
    source: 'custom',
    sourceId: null,
    servings: [{ label: '1 scoop', grams: 31 }],
    nutrients: { '208': 387, '203': 77, '205': 9.7, '204': 4.8, '269': 3.2, '307': 323, '301': 516 },
    favorite: true,
  });

  type Item = [Food, number];
  const breakfasts: Item[][] = [
    [[F.oats, 50], [F.milk, 240], [F.banana, 118], [F.coffee, 240]],
    [[F.egg, 100], [F.toast, 64], [F.butter, 7], [F.coffee, 240]],
    [[F.yogurt, 200], [F.blueberries, 75], [F.almonds, 20], [F.coffee, 240]],
  ];
  const lunches: Item[][] = [
    [[F.chicken, 150], [F.rice, 180], [F.broccoli, 120], [F.oliveOil, 7]],
    [[F.salad, 120], [F.tomato, 100], [F.chicken, 120], [F.avocado, 70], [F.oliveOil, 10]],
    [[F.pasta, 200], [F.beef, 110], [F.tomato, 120], [F.cheddar, 20]],
  ];
  const dinners: Item[][] = [
    [[F.salmon, 160], [F.potato, 200], [F.broccoli, 100], [F.butter, 5]],
    [[F.beef, 140], [F.rice, 160], [F.salad, 80], [F.oliveOil, 8]],
    [[F.chicken, 170], [F.potato, 180], [F.tomato, 100]],
  ];
  const snacks: Item[][] = [
    [[F.apple, 180], [F.peanutButter, 32]],
    [[protein, 31], [F.banana, 100]],
    [[F.yogurt, 170], [F.almonds, 25]],
  ];

  const log = (day: string, meal: Meal, items: Item[]) => {
    for (const [food, g] of items) {
      const grams = Math.round(g * (meal === 'snack' ? 1 : 1.3));
      const s = food.servings.find((x) => Math.abs(x.grams - grams) < 0.5);
      store.logFood({ day, meal, food, grams, servingLabel: s?.label ?? null, quantity: s ? 1 : grams });
    }
  };

  for (let d = 14; d >= 0; d--) {
    const day = addDays(todayStr, -d);
    clock = Date.now() - d * DAY;
    log(day, 'breakfast', breakfasts[d % 3]!);
    log(day, 'lunch', lunches[(d + 1) % 3]!);
    if (d > 0) {
      log(day, 'dinner', dinners[(d + 2) % 3]!);
      log(day, 'snack', snacks[d % 3]!);
      store.addWater(2000 + (d % 4) * 250, day);
    } else {
      log(day, 'snack', snacks[1]!);
      store.addWater(1250, day);
    }
    if (d === 9) store.quickAdd({ day, meal: 'snack', name: 'Office birthday cake', nutrients: { '208': 350, '203': 4, '205': 48, '204': 16 } });
  }
  clock = Date.now();

  const firstBreakfast = store.entriesOn(addDays(todayStr, -1)).filter((e) => e.meal === 'breakfast');
  store.saveMealFromEntries('Usual oat breakfast', store.entriesOn(addDays(todayStr, -3)).filter((e) => e.meal === 'breakfast').map((e) => e.id));
  store.saveMealFromEntries('Eggs on toast', firstBreakfast.map((e) => e.id));

  store.insert('recipes', {
    name: 'Chicken burrito bowl',
    ingredients: [F.chicken, F.rice, F.avocado, F.tomato].map((f, i) => ({
      foodId: null,
      name: f.name,
      grams: [450, 600, 150, 300][i]!,
      nutrients: f.nutrients,
    })),
    portions: 4,
    cookedGrams: 1500,
    notes: 'Meal prep for the week.',
    favorite: true,
  } as never);

  for (const f of [F.oats, F.chicken, F.banana]) {
    const cached = store.recentFoods(100).find((x) => x.sourceId === f.sourceId);
    if (cached) store.update('foods', cached.id, { favorite: true });
  }

  let r = await store.sync();
  while (store.pendingCount() > 0 && r) r = await store.sync();
  console.log('seeded; pending', store.pendingCount(), 'error', store.lastSyncError);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
