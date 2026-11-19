// Pure nutrition math: dates, units, nutrient maps, energy and nutrient targets,
// weight trends. No I/O, no clocks except where a `now` can be injected.

import { MEALS, type DiaryEntry, type Recipe } from './schema';
import { N, NUTRIENT_BY_KEY, NUTRIENTS, type NutrientKey, type NutrientMap } from './nutrients';

// ---------------------------------------------------------------------------
// Calendar days (local time, `YYYY-MM-DD`)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's local calendar day. */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Parse a `YYYY-MM-DD` day as local midnight. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Shift a local day by `n` days (DST-safe: works on calendar fields). */
export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  return todayLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** The local day an epoch-ms timestamp falls on. */
export function dayOf(ts: number): string {
  return todayLocal(new Date(ts));
}

/** Whole years between a birth year and `now` (birthday assumed mid-year is not tracked). */
export function ageFrom(birthYear: number, now: Date = new Date()): number {
  return Math.max(0, now.getFullYear() - birthYear);
}

// ---------------------------------------------------------------------------
// Nutrient maps
// ---------------------------------------------------------------------------

/** Totals for `grams` of a food given its per-100 g nutrients. */
export function scaleNutrients(per100g: NutrientMap, grams: number): NutrientMap {
  const f = grams / 100;
  const out: NutrientMap = {};
  for (const [k, v] of Object.entries(per100g)) if (Number.isFinite(v)) out[k] = v * f;
  return out;
}

/** Multiply every value by `factor`. */
export function multiplyNutrients(m: NutrientMap, factor: number): NutrientMap {
  const out: NutrientMap = {};
  for (const [k, v] of Object.entries(m)) if (Number.isFinite(v)) out[k] = v * factor;
  return out;
}

/** Key-wise sum. A key missing from every map stays missing (unknown ≠ 0). */
export function sumNutrients(maps: NutrientMap[]): NutrientMap {
  const out: NutrientMap = {};
  for (const m of maps) for (const [k, v] of Object.entries(m)) if (Number.isFinite(v)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/** Round for display/storage: kcal to 1, everything else to 0.1 (µg/mg/g), tiny values to 0.01. */
export function roundNutrients(m: NutrientMap): NutrientMap {
  const out: NutrientMap = {};
  for (const [k, v] of Object.entries(m)) out[k] = roundNutrient(k, v);
  return out;
}

export function roundNutrient(key: NutrientKey, v: number): number {
  const unit = NUTRIENT_BY_KEY[key]?.unit;
  if (unit === 'kcal') return Math.round(v);
  if (Math.abs(v) < 1) return Math.round(v * 100) / 100;
  return Math.round(v * 10) / 10;
}

/** Atwater energy from macros (4/4/9, alcohol 7). */
export function kcalFromMacros(m: NutrientMap): number {
  return 4 * (m[N.protein] ?? 0) + 4 * (m[N.carbs] ?? 0) + 9 * (m[N.fat] ?? 0) + 7 * (m[N.alcohol] ?? 0);
}

/** Raw weight of all ingredients. */
function ingredientGrams(recipe: Recipe): number {
  return recipe.ingredients.reduce((a, i) => a + i.grams, 0);
}

/** Nutrients per 100 g of the finished recipe (cooked weight if weighed, else raw ingredient weight). */
export function recipePer100g(recipe: Recipe): NutrientMap {
  const total = sumNutrients(recipe.ingredients.map((i) => scaleNutrients(i.nutrients, i.grams)));
  const grams = recipe.cookedGrams ?? ingredientGrams(recipe);
  if (!(grams > 0)) return {};
  return multiplyNutrients(total, 100 / grams);
}

/** Grams in one portion of a recipe. */
export function recipePortionGrams(recipe: Recipe): number {
  const grams = recipe.cookedGrams ?? ingredientGrams(recipe);
  return recipe.portions > 0 ? grams / recipe.portions : grams;
}

// ---------------------------------------------------------------------------
// Units (storage is kg / cm / ml / g; conversion only at the UI edge)
// ---------------------------------------------------------------------------

export type WeightUnit = 'kg' | 'lb';
export type LengthUnit = 'cm' | 'in';
export type WaterUnit = 'ml' | 'floz';

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const ML_PER_FLOZ = 29.5735295625; // US fluid ounce

export const toKg = (v: number, unit: WeightUnit) => (unit === 'kg' ? v : v * KG_PER_LB);
export const fromKg = (kg: number, unit: WeightUnit) => (unit === 'kg' ? kg : kg / KG_PER_LB);
export const toCm = (v: number, unit: LengthUnit) => (unit === 'cm' ? v : v * CM_PER_IN);
export const fromCm = (cm: number, unit: LengthUnit) => (unit === 'cm' ? cm : cm / CM_PER_IN);
export const toMl = (v: number, unit: WaterUnit) => (unit === 'ml' ? v : v * ML_PER_FLOZ);
export const fromMl = (ml: number, unit: WaterUnit) => (unit === 'ml' ? ml : ml / ML_PER_FLOZ);

const trim = (v: number, digits: number) => `${+v.toFixed(digits)}`;

/** "80.5" (no unit suffix; callers add the unit label). */
export function formatWeight(kg: number | null | undefined, unit: WeightUnit): string {
  return kg == null ? '' : trim(fromKg(kg, unit), 1);
}
export function formatLength(cm: number | null | undefined, unit: LengthUnit): string {
  return cm == null ? '' : trim(fromCm(cm, unit), 1);
}
export function formatWater(ml: number | null | undefined, unit: WaterUnit): string {
  return ml == null ? '' : trim(fromMl(ml, unit), unit === 'ml' ? 0 : 1);
}
/** "1,850 kcal"-style number without the unit. */
export function formatKcal(kcal: number | null | undefined): string {
  return kcal == null ? '' : Math.round(kcal).toLocaleString('en-US');
}
/** "12.3 g", "450 mg", "15 µg", "520 kcal". */
export function formatNutrient(key: NutrientKey, value: number | null | undefined): string {
  if (value == null) return '';
  const def = NUTRIENT_BY_KEY[key];
  const v = roundNutrient(key, value);
  return def ? `${v} ${def.unit}` : `${v}`;
}

// ---------------------------------------------------------------------------
// Energy & targets
// ---------------------------------------------------------------------------

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export interface Profile {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  activity: ActivityLevel;
  /** Negative to lose, positive to gain (kg per week). */
  goalKgPerWeek: number;
  /** If set, protein = this × body weight and the split applies to carbs/fat only. */
  proteinGPerKg: number | null;
  /** Percent of calories; sums to 100. */
  macroSplit: { protein: number; carbs: number; fat: number };
}

/** Standard physical-activity multipliers applied to BMR. */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** ≈ energy in 1 kg of body-weight change. */
export const KCAL_PER_KG = 7700;
/** Floors below which the app will not set a calorie budget without supervision. */
export const MIN_KCAL: Record<Sex, number> = { female: 1200, male: 1500 };

/**
 * Mifflin-St Jeor resting energy expenditure (Mifflin et al., Am J Clin Nutr 1990;51:241-7):
 * 10·kg + 6.25·cm − 5·age + 5 (men) / − 161 (women).
 */
export function bmrMifflinStJeor(p: Pick<Profile, 'sex' | 'heightCm'>, weightKg: number, age: number): number {
  return 10 * weightKg + 6.25 * p.heightCm - 5 * age + (p.sex === 'male' ? 5 : -161);
}

export function tdee(p: Pick<Profile, 'sex' | 'heightCm' | 'activity'>, weightKg: number, age: number): number {
  return bmrMifflinStJeor(p, weightKg, age) * ACTIVITY_FACTORS[p.activity];
}

/** Daily calorie budget: TDEE ± goal × 7700/7, floored at MIN_KCAL, rounded to 10 kcal. */
export function calorieTarget(p: Profile, weightKg: number, age: number): number {
  const raw = tdee(p, weightKg, age) + (p.goalKgPerWeek * KCAL_PER_KG) / 7;
  return Math.round(Math.max(MIN_KCAL[p.sex], raw) / 10) * 10;
}

/** Protein / carbs / fat grams for a calorie budget. */
export function macroTargets(p: Profile, kcal: number, weightKg: number): NutrientMap {
  const s = p.macroSplit;
  let protein: number;
  let carbs: number;
  let fat: number;
  if (p.proteinGPerKg != null && p.proteinGPerKg > 0) {
    protein = p.proteinGPerKg * weightKg;
    const rest = Math.max(0, kcal - protein * 4);
    const cf = s.carbs + s.fat || 1;
    carbs = (rest * (s.carbs / cf)) / 4;
    fat = (rest * (s.fat / cf)) / 9;
  } else {
    const total = s.protein + s.carbs + s.fat || 100;
    protein = (kcal * (s.protein / total)) / 4;
    carbs = (kcal * (s.carbs / total)) / 4;
    fat = (kcal * (s.fat / total)) / 9;
  }
  return { [N.protein]: Math.round(protein), [N.carbs]: Math.round(carbs), [N.fat]: Math.round(fat) };
}

/**
 * Default daily nutrient targets from the US Dietary Reference Intakes
 * (National Academies of Sciences, Engineering, and Medicine; summary tables
 * "Recommended Dietary Allowances and Adequate Intakes, Vitamins / Elements",
 * NIH ODS DRI tables, and the 2019 Sodium & Potassium DRI report). Values are the
 * RDA where one exists, otherwise the AI. Age bands 19–30, 31–50, 51–70, 71+;
 * ages under 19 use the 19–30 values (the app is for adults).
 *
 * Limits (`limit: true` nutrients): sodium 2,300 mg (CDRR, 2019); added sugars
 * and saturated fat < 10 % of energy (Dietary Guidelines for Americans
 * 2020–2025). These depend on `kcal` (default 2,000). Total sugars have no DRI
 * and get no default target.
 */
export function driDefaults(sex: Sex, age: number, kcal = 2000): NutrientMap {
  const m = sex === 'male';
  const a = Math.max(19, age);
  const over50 = a > 50;
  const over70 = a > 70;
  return {
    // Fibre AI (14 g/1000 kcal, expressed per age/sex): M 38/30, F 25/21 g
    [N.fiber]: m ? (over50 ? 30 : 38) : over50 ? 21 : 25,
    // Minerals
    [N.calcium]: over70 ? 1200 : m ? 1000 : over50 ? 1200 : 1000, // RDA mg
    [N.iron]: m ? 8 : over50 ? 8 : 18, // RDA mg
    [N.magnesium]: m ? (a <= 30 ? 400 : 420) : a <= 30 ? 310 : 320, // RDA mg
    [N.zinc]: m ? 11 : 8, // RDA mg
    [N.potassium]: m ? 3400 : 2600, // AI mg (2019)
    [N.phosphorus]: 700, // RDA mg
    [N.copper]: 0.9, // RDA mg
    [N.manganese]: m ? 2.3 : 1.8, // AI mg
    [N.selenium]: 55, // RDA µg
    // Vitamins
    [N.vitA]: m ? 900 : 700, // RDA µg RAE
    [N.vitC]: m ? 90 : 75, // RDA mg
    [N.vitD]: over70 ? 20 : 15, // RDA µg (600 / 800 IU)
    [N.vitE]: 15, // RDA mg alpha-tocopherol
    [N.vitK]: m ? 120 : 90, // AI µg
    [N.thiamin]: m ? 1.2 : 1.1, // RDA mg
    [N.riboflavin]: m ? 1.3 : 1.1, // RDA mg
    [N.niacin]: m ? 16 : 14, // RDA mg NE
    [N.pantothenic]: 5, // AI mg
    [N.vitB6]: over50 ? (m ? 1.7 : 1.5) : 1.3, // RDA mg
    [N.folate]: 400, // RDA µg DFE
    [N.vitB12]: 2.4, // RDA µg
    [N.choline]: m ? 550 : 425, // AI mg
    // Limits
    [N.sodium]: 2300, // CDRR mg
    [N.addedSugar]: Math.round((kcal * 0.1) / 4), // < 10 % kcal
    [N.satFat]: Math.round((kcal * 0.1) / 9), // < 10 % kcal
  };
}

/** Everything: calories, macros, fibre (14 g / 1000 kcal), DRIs and limits. */
export function computeTargets(p: Profile, weightKg: number, now: Date = new Date()): NutrientMap {
  const age = ageFrom(p.birthYear, now);
  const kcal = calorieTarget(p, weightKg, age);
  return {
    ...driDefaults(p.sex, age, kcal),
    ...macroTargets(p, kcal, weightKg),
    [N.energy]: kcal,
    [N.fiber]: Math.round((14 * kcal) / 1000),
  };
}

export type NutrientStatus = 'under' | 'ok' | 'over';

/**
 * Status of an intake against its target. For a limit (sodium, added sugar,
 * sat fat — and calories, if the UI treats the budget as a ceiling): above the
 * target is 'over'. For a floor: below `(1 − tolerance) × target` is 'under';
 * floors are never 'over'.
 */
export function nutrientStatus(value: number, target: number, limit: boolean, tolerance = 0.1): NutrientStatus {
  if (!(target > 0)) return 'ok';
  if (limit) return value > target ? 'over' : 'ok';
  return value < target * (1 - tolerance) ? 'under' : 'ok';
}

/** Whether a nutrient's target is a ceiling, from NUTRIENTS. */
export const isLimit = (key: NutrientKey) => NUTRIENT_BY_KEY[key]?.limit === true;

/**
 * Status of any nutrient against its target, used by every UI so web and
 * mobile agree. Calories are a band: under 80% is 'under', over 110% is
 * 'over'. Other nutrients use `nutrientStatus` with their limit flag.
 * Returns null when there is no target (draw an empty track, not a bar).
 */
export function statusFor(key: NutrientKey, value: number, target: number | null | undefined): NutrientStatus | null {
  if (!(target != null && target > 0)) return null;
  if (key === '208') return value > target * 1.1 ? 'over' : value < target * 0.8 ? 'under' : 'ok';
  return nutrientStatus(value, target, isLimit(key));
}

/**
 * Days to average over for a period report: days with entries, leaving out
 * today when it is still in progress (unless it's the only logged day), so a
 * half-logged day doesn't drag every average down.
 */
export function daysForAverage(loggedDays: string[], today: string): string[] {
  const done = loggedDays.filter((d) => d !== today);
  return done.length > 0 ? done : loggedDays;
}

export const CORE_NUTRIENTS = NUTRIENTS.filter((n) => n.core);

// ---------------------------------------------------------------------------
// Weight trend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  takenAt: number;
  value: number;
  /** Mean of all points in the trailing `days` window ending at this point. */
  trend: number;
}

const DAY_MS = 86_400_000;

/** Trailing moving average over `days` calendar-time (not point count). */
export function weightTrend(points: { takenAt: number; value: number }[], days = 7): TrendPoint[] {
  const sorted = [...points].sort((a, b) => a.takenAt - b.takenAt);
  const out: TrendPoint[] = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!;
    sum += p.value;
    while (sorted[start]!.takenAt <= p.takenAt - days * DAY_MS) sum -= sorted[start++]!.value;
    out.push({ takenAt: p.takenAt, value: p.value, trend: sum / (i - start + 1) });
  }
  return out;
}

/**
 * Least-squares slope in kg/week. Null with fewer than two points or a span
 * under one day.
 */
export function weeklyRate(points: { takenAt: number; value: number }[]): number | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.takenAt / DAY_MS);
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < 1) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = points.reduce((a, p) => a + p.value, 0) / points.length;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (xs[i]! - mx) * (p.value - my);
    den += (xs[i]! - mx) ** 2;
  });
  return den === 0 ? null : (num / den) * 7;
}

// ---------------------------------------------------------------------------
// Diary analysis
// ---------------------------------------------------------------------------

/** Foods contributing most of `key` across `entries` (grouped by display name). */
export function topFoodsFor(
  entries: DiaryEntry[],
  key: NutrientKey,
  n = 10,
): { name: string; amount: number; share: number }[] {
  const by = new Map<string, number>();
  let total = 0;
  for (const e of entries) {
    const v = e.nutrients[key];
    if (!v || !(v > 0)) continue;
    by.set(e.name, (by.get(e.name) ?? 0) + v);
    total += v;
  }
  return [...by.entries()]
    .map(([name, amount]) => ({ name, amount, share: total > 0 ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

/** Sort key for meals. */
export const mealIndex = (meal: DiaryEntry['meal']) => MEALS.indexOf(meal);
