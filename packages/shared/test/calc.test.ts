import { describe, expect, it } from 'vitest';
import {
  N,
  addDays,
  bmrMifflinStJeor,
  calorieTarget,
  computeTargets,
  dayOf,
  driDefaults,
  formatNutrient,
  fromKg,
  kcalFromMacros,
  macroTargets,
  nutrientStatus,
  recipePer100g,
  recipePortionGrams,
  roundNutrients,
  scaleNutrients,
  sumNutrients,
  tdee,
  toKg,
  toMl,
  todayLocal,
  topFoodsFor,
  weeklyRate,
  weightTrend,
  type DiaryEntry,
  type Profile,
  type Recipe,
} from '../src';

const DAY = 86_400_000;

const profile: Profile = {
  sex: 'male',
  birthYear: 1996,
  heightCm: 180,
  activity: 'moderate',
  goalKgPerWeek: -0.5,
  proteinGPerKg: null,
  macroSplit: { protein: 30, carbs: 40, fat: 30 },
};

describe('days', () => {
  it('formats and shifts local days', () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(dayOf(new Date(2026, 10, 19, 0, 30).getTime())).toBe('2026-11-19');
  });
});

describe('nutrient maps', () => {
  it('scales, sums, rounds', () => {
    const per100 = { [N.energy]: 130, [N.protein]: 2.69 };
    const s = scaleNutrients(per100, 150);
    expect(s[N.energy]).toBeCloseTo(195);
    expect(s[N.protein]).toBeCloseTo(4.035);
    const sum = sumNutrients([s, { [N.energy]: 5, [N.fiber]: 1 }]);
    expect(sum[N.energy]).toBeCloseTo(200);
    expect(sum[N.fiber]).toBe(1);
    expect(sum[N.fat]).toBeUndefined();
    expect(roundNutrients({ [N.energy]: 199.6, [N.protein]: 4.035, [N.sodium]: 123.456 })).toEqual({
      [N.energy]: 200,
      [N.protein]: 4.0,
      [N.sodium]: 123.5,
    });
    expect(kcalFromMacros({ [N.protein]: 10, [N.carbs]: 20, [N.fat]: 5 })).toBe(165);
    expect(formatNutrient(N.vitD, 15)).toBe('15 µg');
  });

  it('computes recipe nutrients per 100 g and portions', () => {
    const r = {
      ingredients: [
        { foodId: null, name: 'Oats', grams: 100, nutrients: { [N.energy]: 380 } },
        { foodId: null, name: 'Milk', grams: 300, nutrients: { [N.energy]: 60 } },
      ],
      portions: 2,
      cookedGrams: null,
    } as unknown as Recipe;
    expect(recipePer100g(r)[N.energy]).toBeCloseTo(560 / 4);
    expect(recipePortionGrams(r)).toBe(200);
    const cooked = { ...r, cookedGrams: 350 } as Recipe;
    expect(recipePer100g(cooked)[N.energy]).toBeCloseTo(160);
    expect(recipePortionGrams(cooked)).toBe(175);
  });

  it('converts units', () => {
    expect(toKg(100, 'lb')).toBeCloseTo(45.359237);
    expect(fromKg(45.359237, 'lb')).toBeCloseTo(100);
    expect(toMl(8, 'floz')).toBeCloseTo(236.588, 2);
  });
});

describe('energy', () => {
  it('matches known Mifflin-St Jeor values', () => {
    // 80 kg, 180 cm, 30 y man: 800 + 1125 - 150 + 5 = 1780
    expect(bmrMifflinStJeor({ sex: 'male', heightCm: 180 }, 80, 30)).toBe(1780);
    // 60 kg, 165 cm, 40 y woman: 600 + 1031.25 - 200 - 161 = 1270.25
    expect(bmrMifflinStJeor({ sex: 'female', heightCm: 165 }, 60, 40)).toBeCloseTo(1270.25);
    expect(tdee(profile, 80, 30)).toBeCloseTo(1780 * 1.55);
  });

  it('computes a calorie budget with deficit and floor', () => {
    // 2759 - 550 = 2209 → 2210
    expect(calorieTarget(profile, 80, 30)).toBe(2210);
    const tiny: Profile = { ...profile, sex: 'female', heightCm: 150, activity: 'sedentary', goalKgPerWeek: -1 };
    expect(calorieTarget(tiny, 45, 60)).toBe(1200);
  });

  it('splits macros by percent or by protein per kg', () => {
    expect(macroTargets(profile, 2000, 80)).toEqual({ [N.protein]: 150, [N.carbs]: 200, [N.fat]: 67 });
    const m = macroTargets({ ...profile, proteinGPerKg: 2 }, 2000, 80);
    expect(m[N.protein]).toBe(160);
    // remaining 1360 kcal split 40:30 between carbs and fat
    expect(m[N.carbs]).toBe(Math.round((1360 * (40 / 70)) / 4));
    expect(m[N.fat]).toBe(Math.round((1360 * (30 / 70)) / 9));
  });

  it('uses DRI values by sex and age', () => {
    const f30 = driDefaults('female', 30);
    const f55 = driDefaults('female', 55);
    const m40 = driDefaults('male', 40);
    expect(f30[N.iron]).toBe(18);
    expect(f55[N.iron]).toBe(8);
    expect(f55[N.calcium]).toBe(1200);
    expect(m40[N.calcium]).toBe(1000);
    expect(m40[N.magnesium]).toBe(420);
    expect(driDefaults('male', 25)[N.magnesium]).toBe(400);
    expect(m40[N.vitC]).toBe(90);
    expect(f30[N.vitC]).toBe(75);
    expect(driDefaults('male', 75)[N.vitD]).toBe(20);
    expect(m40[N.sodium]).toBe(2300);
    expect(driDefaults('male', 40, 2000)[N.satFat]).toBe(22);
    expect(driDefaults('male', 40, 2000)[N.addedSugar]).toBe(50);
  });

  it('computeTargets is internally consistent', () => {
    const t = computeTargets(profile, 80, new Date(2026, 5, 1));
    expect(t[N.energy]).toBe(2210);
    expect(t[N.fiber]).toBe(31); // 14 g / 1000 kcal
    expect(t[N.addedSugar]).toBe(Math.round(221 / 4));
    expect(kcalFromMacros(t)).toBeGreaterThan(2150);
    expect(kcalFromMacros(t)).toBeLessThan(2270);
    expect(t[N.vitB12]).toBe(2.4);
  });
});

describe('status, trends, top foods', () => {
  it('classifies nutrient status', () => {
    expect(nutrientStatus(2500, 2300, true)).toBe('over');
    expect(nutrientStatus(2300, 2300, true)).toBe('ok');
    expect(nutrientStatus(50, 90, false)).toBe('under');
    expect(nutrientStatus(85, 90, false)).toBe('ok');
    expect(nutrientStatus(500, 90, false)).toBe('ok');
    expect(nutrientStatus(5, 0, false)).toBe('ok');
  });

  it('computes a trailing weight trend and weekly rate', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const pts = Array.from({ length: 15 }, (_, i) => ({ takenAt: t0 + i * DAY, value: 80 - i * 0.1 }));
    const trend = weightTrend(pts, 7);
    expect(trend).toHaveLength(15);
    expect(trend[0]!.trend).toBe(80);
    // last point averages days 8..14
    expect(trend[14]!.trend).toBeCloseTo(80 - 1.1, 5);
    expect(weeklyRate(pts)).toBeCloseTo(-0.7, 5);
    expect(weeklyRate(pts.slice(0, 1))).toBeNull();
    // unsorted input is fine
    expect(weightTrend([...pts].reverse(), 7)[14]!.trend).toBeCloseTo(80 - 1.1, 5);
  });

  it('ranks top foods for a nutrient', () => {
    const e = (name: string, sodium: number) => ({ name, nutrients: { [N.sodium]: sodium } }) as unknown as DiaryEntry;
    const top = topFoodsFor([e('Soup', 800), e('Bread', 200), e('Soup', 400), e('Apple', 0)], N.sodium);
    expect(top.map((x) => x.name)).toEqual(['Soup', 'Bread']);
    expect(top[0]!.amount).toBe(1200);
    expect(top[0]!.share).toBeCloseTo(1200 / 1400);
  });
});

import { daysForAverage, statusFor } from '../src';

describe('statusFor', () => {
  it('treats calories as an 80–110% band', () => {
    expect(statusFor('208', 1500, 2000)).toBe('under');
    expect(statusFor('208', 1800, 2000)).toBe('ok');
    expect(statusFor('208', 2300, 2000)).toBe('over');
  });
  it('uses limits and floors for other nutrients, null without a target', () => {
    expect(statusFor('307', 2500, 2300)).toBe('over');
    expect(statusFor('203', 100, 150)).toBe('under');
    expect(statusFor('269', 50, null)).toBeNull();
  });
  it('leaves an in-progress today out of averages', () => {
    expect(daysForAverage(['2026-11-17', '2026-11-18', '2026-11-19'], '2026-11-19')).toEqual(['2026-11-17', '2026-11-18']);
    expect(daysForAverage(['2026-11-19'], '2026-11-19')).toEqual(['2026-11-19']);
  });
});
