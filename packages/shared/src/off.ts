// Open Food Facts (barcode lookups). Data © Open Food Facts contributors, ODbL 1.0;
// contents DbCL 1.0. Every request must send OFF_USER_AGENT; keep fetched products in
// a separate cache (never merged into user data); do not store product images.

import { N, type NutrientMap } from './nutrients';
import type { Food, Serving } from './schema';

export const OFF_USER_AGENT = 'OpenNutrition/0.1 (https://github.com/ernest-it/open-nutrition)';

export const OFF_ATTRIBUTION =
  'Product data from Open Food Facts (openfoodfacts.org), made available under the Open Database License (ODbL 1.0); individual contents under the Database Contents License (DbCL 1.0).';
export const USDA_ATTRIBUTION =
  'Generic food data from USDA FoodData Central (fdc.nal.usda.gov): Foundation Foods and SR Legacy, U.S. Department of Agriculture, Agricultural Research Service. Public domain (CC0 1.0).';

const OFF_FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'generic_name',
  'generic_name_en',
  'brands',
  'quantity',
  'serving_size',
  'serving_quantity',
  'nutriments',
  'nutrition_data_per',
].join(',');

/** Product lookup URL (API v2, only the fields we map). */
export function offProductUrl(barcode: string): string {
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode.trim())}.json?fields=${OFF_FIELDS}`;
}

// ---- barcodes ----------------------------------------------------------------

function gs1CheckOk(digits: string): boolean {
  let sum = 0;
  const body = digits.slice(0, -1);
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** Expand an 8-digit UPC-E code to its 12-digit UPC-A form (null if not UPC-E). */
export function upcEToUpcA(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0]!;
  const d = code.slice(1, 7);
  const check = code[7]!;
  const last = d[5]!;
  let mfr: string;
  let prod: string;
  if ('012'.includes(last)) {
    mfr = `${d[0]}${d[1]}${last}00`;
    prod = `00${d[2]}${d[3]}${d[4]}`;
  } else if (last === '3') {
    mfr = `${d[0]}${d[1]}${d[2]}00`;
    prod = `000${d[3]}${d[4]}`;
  } else if (last === '4') {
    mfr = `${d[0]}${d[1]}${d[2]}${d[3]}0`;
    prod = `0000${d[4]}`;
  } else {
    mfr = d.slice(0, 5);
    prod = `0000${last}`;
  }
  return `${ns}${mfr}${prod}${check}`;
}

/** EAN-8, UPC-E, UPC-A (12), EAN-13 or GTIN-14 with a valid check digit. */
export function isValidBarcode(code: string): boolean {
  const c = code.trim();
  if (!/^\d+$/.test(c)) return false;
  if (c.length === 8) {
    if (gs1CheckOk(c)) return true;
    const a = upcEToUpcA(c);
    return a != null && gs1CheckOk(a);
  }
  if (c.length === 12 || c.length === 13 || c.length === 14) return gs1CheckOk(c);
  return false;
}

// ---- product mapping ----------------------------------------------------------

/** OFF nutriment key (per 100 g, in grams unless noted) → [our key, factor to our unit]. */
const NUTRIMENT_MAP: [string, string, number][] = [
  ['proteins', N.protein, 1],
  ['carbohydrates', N.carbs, 1],
  ['fat', N.fat, 1],
  ['fiber', N.fiber, 1],
  ['sugars', N.sugar, 1],
  ['added-sugars', N.addedSugar, 1],
  ['saturated-fat', N.satFat, 1],
  ['trans-fat', N.transFat, 1],
  ['monounsaturated-fat', N.monoFat, 1],
  ['polyunsaturated-fat', N.polyFat, 1],
  ['cholesterol', N.cholesterol, 1000],
  ['sodium', N.sodium, 1000],
  ['potassium', N.potassium, 1000],
  ['calcium', N.calcium, 1000],
  ['iron', N.iron, 1000],
  ['magnesium', N.magnesium, 1000],
  ['phosphorus', N.phosphorus, 1000],
  ['zinc', N.zinc, 1000],
  ['copper', N.copper, 1000],
  ['manganese', N.manganese, 1000],
  ['selenium', N.selenium, 1e6],
  ['vitamin-a', N.vitA, 1e6],
  ['vitamin-c', N.vitC, 1000],
  ['vitamin-d', N.vitD, 1e6],
  ['vitamin-e', N.vitE, 1000],
  ['vitamin-k', N.vitK, 1e6],
  ['vitamin-b1', N.thiamin, 1000],
  ['vitamin-b2', N.riboflavin, 1000],
  ['vitamin-pp', N.niacin, 1000],
  ['pantothenic-acid', N.pantothenic, 1000],
  ['vitamin-b6', N.vitB6, 1000],
  ['vitamin-b9', N.folate, 1e6],
  ['folates', N.folate, 1e6],
  ['vitamin-b12', N.vitB12, 1e6],
  ['choline', N.choline, 1000],
  ['caffeine', N.caffeine, 1000],
];

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Grams for a serving_size string like "30 g", "1 cup (240 ml)", "2 biscuits (25g)". */
export function parseServingGrams(s: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(g|gr|grams?|ml|mL|millilit(?:er|re)s?)\b/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  return n > 0 ? n : null;
}

type OffFood = Omit<Food, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/**
 * Map an OFF API response (`{ status, product }`) or a bare product to a Food
 * (nutrients per 100 g). Null when the product is missing, unnamed, or has no
 * usable nutrition data. Note OFF stores liquids per 100 ml; we treat 1 ml ≈ 1 g.
 */
export function mapOffProduct(json: unknown): OffFood | null {
  if (!json || typeof json !== 'object') return null;
  const wrapper = json as { status?: unknown; product?: unknown };
  if (wrapper.status === 0 || wrapper.status === 'failure') return null;
  const p = (wrapper.product && typeof wrapper.product === 'object' ? wrapper.product : json) as Record<string, unknown>;
  const name = str(p.product_name_en) ?? str(p.product_name) ?? str(p.generic_name_en) ?? str(p.generic_name);
  if (!name) return null;
  const nm = (p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {}) as Record<string, unknown>;
  const per100 = (k: string) => num(nm[`${k}_100g`]);

  const nutrients: NutrientMap = {};
  for (const [offKey, key, factor] of NUTRIMENT_MAP) {
    if (nutrients[key] != null) continue;
    const v = per100(offKey);
    if (v != null) nutrients[key] = round(v * factor);
  }
  if (nutrients[N.sodium] == null) {
    const salt = per100('salt');
    if (salt != null) nutrients[N.sodium] = round((salt / 2.5) * 1000); // salt = sodium × 2.5
  }
  let kcal = per100('energy-kcal');
  if (kcal == null) {
    const kj = per100('energy-kj') ?? (nm['energy_unit'] === 'kcal' ? null : per100('energy'));
    if (kj != null) kcal = kj / 4.184;
    else if (nm['energy_unit'] === 'kcal') kcal = per100('energy');
  }
  if (kcal != null) nutrients[N.energy] = Math.round(kcal);
  const hasCore = [N.energy, N.protein, N.carbs, N.fat].some((k) => nutrients[k] != null);
  if (!hasCore) return null;

  const servings: Serving[] = [{ label: '100 g', grams: 100 }];
  const servingSize = str(p.serving_size);
  const servingQty = num(p.serving_quantity);
  const grams = servingQty && servingQty > 0 ? servingQty : servingSize ? parseServingGrams(servingSize) : null;
  if (grams && grams > 0 && grams !== 100) servings.push({ label: (servingSize ?? `${grams} g`).slice(0, 100), grams });
  else if (grams === 100 && servingSize) servings[0] = { label: servingSize.slice(0, 100), grams: 100 };

  const code = str(p.code) ?? str((json as { code?: unknown }).code);
  const brand = str(p.brands)?.split(',')[0]?.trim() || null;
  return {
    name: name.slice(0, 300),
    brand: brand ? brand.slice(0, 200) : null,
    barcode: code ? code.slice(0, 32) : null,
    source: 'off',
    sourceId: code ? code.slice(0, 64) : null,
    servings,
    nutrients,
    favorite: false,
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;
