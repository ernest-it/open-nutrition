// Canonical nutrient list. Every nutrient value in the app (foods, diary
// entries, targets, AI estimates) is a map keyed by the USDA FoodData Central
// nutrient NUMBER (e.g. "208" = energy in kcal). Every data source (USDA,
// Open Food Facts, AI, manual entry) maps onto these keys and units.

export type NutrientKey = string;
/** Nutrient amounts keyed by USDA nutrient number. Units are those in NUTRIENTS. */
export type NutrientMap = Record<NutrientKey, number>;

export type NutrientGroup = 'energy' | 'macro' | 'carb' | 'fat' | 'mineral' | 'vitamin' | 'other';

export interface NutrientDef {
  /** USDA nutrient number, used as the key everywhere. */
  key: NutrientKey;
  name: string;
  unit: 'kcal' | 'g' | 'mg' | 'µg';
  group: NutrientGroup;
  /** Shown by default in v1 (the rest are stored but hidden unless enabled). */
  core: boolean;
  /** Is a target a ceiling (sodium, sugar, sat fat) rather than a floor? */
  limit?: boolean;
}

export const N = {
  energy: '208',
  protein: '203',
  fat: '204',
  carbs: '205',
  fiber: '291',
  sugar: '269',
  addedSugar: '539',
  satFat: '606',
  transFat: '605',
  monoFat: '645',
  polyFat: '646',
  cholesterol: '601',
  sodium: '307',
  potassium: '306',
  calcium: '301',
  iron: '303',
  magnesium: '304',
  phosphorus: '305',
  zinc: '309',
  copper: '312',
  manganese: '315',
  selenium: '317',
  vitA: '320', // RAE, µg
  vitC: '401',
  vitD: '328', // D2 + D3, µg
  vitE: '323', // alpha-tocopherol, mg
  vitK: '430', // phylloquinone, µg
  thiamin: '404',
  riboflavin: '405',
  niacin: '406',
  pantothenic: '410',
  vitB6: '415',
  folate: '435', // DFE, µg
  vitB12: '418',
  choline: '421',
  caffeine: '262',
  alcohol: '221',
  water: '255',
} as const;

export const NUTRIENTS: NutrientDef[] = [
  { key: N.energy, name: 'Calories', unit: 'kcal', group: 'energy', core: true },
  { key: N.protein, name: 'Protein', unit: 'g', group: 'macro', core: true },
  { key: N.carbs, name: 'Carbohydrates', unit: 'g', group: 'macro', core: true },
  { key: N.fat, name: 'Fat', unit: 'g', group: 'macro', core: true },
  { key: N.fiber, name: 'Fibre', unit: 'g', group: 'carb', core: true },
  { key: N.sugar, name: 'Sugars', unit: 'g', group: 'carb', core: true, limit: true },
  { key: N.addedSugar, name: 'Added sugars', unit: 'g', group: 'carb', core: true, limit: true },
  { key: N.satFat, name: 'Saturated fat', unit: 'g', group: 'fat', core: true, limit: true },
  { key: N.transFat, name: 'Trans fat', unit: 'g', group: 'fat', core: false, limit: true },
  { key: N.monoFat, name: 'Monounsaturated fat', unit: 'g', group: 'fat', core: false },
  { key: N.polyFat, name: 'Polyunsaturated fat', unit: 'g', group: 'fat', core: false },
  { key: N.cholesterol, name: 'Cholesterol', unit: 'mg', group: 'fat', core: false, limit: true },
  { key: N.sodium, name: 'Sodium', unit: 'mg', group: 'mineral', core: true, limit: true },
  { key: N.potassium, name: 'Potassium', unit: 'mg', group: 'mineral', core: true },
  { key: N.calcium, name: 'Calcium', unit: 'mg', group: 'mineral', core: true },
  { key: N.iron, name: 'Iron', unit: 'mg', group: 'mineral', core: true },
  { key: N.magnesium, name: 'Magnesium', unit: 'mg', group: 'mineral', core: true },
  { key: N.zinc, name: 'Zinc', unit: 'mg', group: 'mineral', core: true },
  { key: N.phosphorus, name: 'Phosphorus', unit: 'mg', group: 'mineral', core: false },
  { key: N.copper, name: 'Copper', unit: 'mg', group: 'mineral', core: false },
  { key: N.manganese, name: 'Manganese', unit: 'mg', group: 'mineral', core: false },
  { key: N.selenium, name: 'Selenium', unit: 'µg', group: 'mineral', core: false },
  { key: N.vitA, name: 'Vitamin A', unit: 'µg', group: 'vitamin', core: true },
  { key: N.vitC, name: 'Vitamin C', unit: 'mg', group: 'vitamin', core: true },
  { key: N.vitD, name: 'Vitamin D', unit: 'µg', group: 'vitamin', core: true },
  { key: N.vitE, name: 'Vitamin E', unit: 'mg', group: 'vitamin', core: true },
  { key: N.vitK, name: 'Vitamin K', unit: 'µg', group: 'vitamin', core: true },
  { key: N.vitB12, name: 'Vitamin B12', unit: 'µg', group: 'vitamin', core: true },
  { key: N.folate, name: 'Folate', unit: 'µg', group: 'vitamin', core: true },
  { key: N.thiamin, name: 'Thiamin (B1)', unit: 'mg', group: 'vitamin', core: false },
  { key: N.riboflavin, name: 'Riboflavin (B2)', unit: 'mg', group: 'vitamin', core: false },
  { key: N.niacin, name: 'Niacin (B3)', unit: 'mg', group: 'vitamin', core: false },
  { key: N.pantothenic, name: 'Pantothenic acid (B5)', unit: 'mg', group: 'vitamin', core: false },
  { key: N.vitB6, name: 'Vitamin B6', unit: 'mg', group: 'vitamin', core: false },
  { key: N.choline, name: 'Choline', unit: 'mg', group: 'vitamin', core: false },
  { key: N.caffeine, name: 'Caffeine', unit: 'mg', group: 'other', core: false, limit: true },
  { key: N.alcohol, name: 'Alcohol', unit: 'g', group: 'other', core: false },
  { key: N.water, name: 'Water', unit: 'g', group: 'other', core: false },
];

export const NUTRIENT_BY_KEY: Record<NutrientKey, NutrientDef> = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n]));
export const NUTRIENT_KEYS: NutrientKey[] = NUTRIENTS.map((n) => n.key);
