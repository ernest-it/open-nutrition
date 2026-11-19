import { NUTRIENT_BY_KEY, formatWater, type NutrientKey, type WaterUnit } from '@open-nutrition/shared';

/**
 * Number formatting used everywhere in the app, so lists never mix "0.24 g", "1 g" and "494.5 mg":
 * - thousands separators always ("1,809");
 * - g (and other units): 1 decimal under 10, whole numbers from 10;
 * - mg / µg: whole numbers, 1 decimal under 10;
 * - kcal and ml: whole numbers.
 * Exactly zero prints as "0".
 */
export function formatNumber(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const rounded = Number(v.toFixed(decimals));
  // Something tiny that rounds to 0 (0.03 g) is shown as "<0.1" rather than a misleading "0.0".
  if (rounded === 0 && decimals > 0) return `<${(1 / 10 ** decimals).toFixed(decimals)}`;
  return rounded.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Decimals for a value in a unit: one under 10 for g / mg / µg, none for kcal, kJ and ml. */
export function decimalsFor(unit: string | undefined, v: number): number {
  if (unit === 'kcal' || unit === 'kJ' || unit === 'ml') return 0;
  return Math.abs(v) < 10 ? 1 : 0;
}

/** A value in a unit, without the unit: "1,809", "12", "4.5". */
export function formatAmount(v: number | null | undefined, unit?: string): string {
  if (v == null) return '—';
  return formatNumber(v, decimalsFor(unit, v));
}

/** A nutrient amount with its unit: "1,809 kcal", "12 g", "4.5 mg", "350 µg". */
export function fmtNutrient(key: NutrientKey, v: number | null | undefined): string {
  if (v == null) return '—';
  const unit = NUTRIENT_BY_KEY[key]?.unit;
  return unit ? `${formatAmount(v, unit)} ${unit}` : formatAmount(v);
}

/** Water in the chosen unit, with separators but without the unit: "1,250" ml, "42.3" fl oz. */
export function fmtWater(ml: number | null | undefined, unit: WaterUnit): string {
  if (ml == null) return '';
  const v = Number(formatWater(ml, unit));
  return formatNumber(v, unit === 'ml' ? 0 : 1).replace(/\.0$/, '');
}

/** Grams: "1.5", "12", "1,250". */
export const fmtGrams = (v: number | null | undefined) => formatAmount(v ?? 0, 'g');
