import { z } from 'zod';

/**
 * Data model for Open Nutrition.
 *
 * Every user-owned entity is a flat "row" that syncs independently using
 * last-write-wins on `updatedAt`. Deletes are soft (`deletedAt`) so that they
 * propagate to every device.
 *
 * Units: food masses in GRAMS, body weight in KILOGRAMS, lengths in
 * CENTIMETRES, water in MILLILITRES, energy in KCAL. Nutrient maps are keyed by
 * USDA nutrient number (see nutrients.ts). Calendar days are local
 * `YYYY-MM-DD` strings. Conversion happens only at the UI edge.
 *
 * Columns whose zod type is an object, array, record or unknown are stored as
 * JSON text in SQL (see `jsonColumnsOf`).
 */

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];

/** Where a food's nutrient data came from. */
export const FOOD_SOURCES = ['usda', 'off', 'custom', 'ai'] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

/** How a diary entry was created. */
export const ENTRY_SOURCES = ['usda', 'off', 'custom', 'ai', 'quick', 'recipe'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const MEASUREMENT_KINDS = [
  'body_weight', // kg
  'body_fat', // %
  'water', // ml (one row per drink; the day's total is the sum)
  'neck', // cm (all circumferences)
  'chest',
  'waist',
  'hips',
  'left_bicep',
  'right_bicep',
  'left_thigh',
  'right_thigh',
] as const;
export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number];

const id = z.string().min(1).max(64);
const ts = z.number().int().nonnegative(); // epoch milliseconds
export const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); // local calendar date
const grams = z.number().finite().nonnegative();
export const nutrientMapSchema = z.record(z.string().max(8), z.number().finite());

/** Fields every syncable row has. */
export const baseRow = z.object({
  id,
  createdAt: ts,
  updatedAt: ts,
  deletedAt: ts.nullable(),
});

export const servingSchema = z.object({
  label: z.string().min(1).max(100), // "1 cup", "1 slice", "100 g"
  grams: z.number().finite().positive(),
});
export type Serving = z.infer<typeof servingSchema>;

/** A user's custom food, or a cached copy of a USDA / Open Food Facts / AI food they used. */
export const foodSchema = baseRow.extend({
  name: z.string().min(1).max(300),
  brand: z.string().max(200).nullable(),
  barcode: z.string().max(32).nullable(),
  source: z.enum(FOOD_SOURCES),
  /** FDC id for USDA, barcode for Open Food Facts, null otherwise. */
  sourceId: z.string().max(64).nullable(),
  servings: z.array(servingSchema).max(50),
  /** Nutrients per 100 g. */
  nutrients: nutrientMapSchema,
  favorite: z.boolean(),
});

export const diaryEntrySchema = baseRow.extend({
  date: daySchema,
  meal: z.enum(MEALS),
  /** Null for quick-add entries. */
  foodId: id.nullable(),
  recipeId: id.nullable(),
  /** Display name, snapshotted at logging time. */
  name: z.string().min(1).max(300),
  source: z.enum(ENTRY_SOURCES),
  /** Total grams eaten (null for quick add). */
  grams: grams.nullable(),
  servingLabel: z.string().max(100).nullable(),
  quantity: z.number().finite().nonnegative(),
  /** Nutrient TOTALS for this entry (not per 100 g), snapshotted so editing a food never rewrites history. */
  nutrients: nutrientMapSchema,
  aiEstimateId: id.nullable(),
  /** Ordering within the meal. */
  position: z.number().int(),
  loggedAt: ts,
});

export const recipeIngredientSchema = z.object({
  foodId: id.nullable(),
  name: z.string().min(1).max(300),
  grams: z.number().finite().positive(),
  /** Per 100 g of the ingredient, snapshotted. */
  nutrients: nutrientMapSchema,
});

export const recipeSchema = baseRow.extend({
  name: z.string().min(1).max(300),
  ingredients: z.array(recipeIngredientSchema).max(200),
  /** Number of portions the recipe makes. */
  portions: z.number().finite().positive(),
  /** Cooked weight in grams, if weighed (lets you log by grams). */
  cookedGrams: z.number().finite().positive().nullable(),
  notes: z.string().max(10_000).nullable(),
  favorite: z.boolean(),
});

export const savedMealItemSchema = z.object({
  foodId: id.nullable(),
  recipeId: id.nullable(),
  name: z.string().min(1).max(300),
  source: z.enum(ENTRY_SOURCES),
  grams: grams.nullable(),
  servingLabel: z.string().max(100).nullable(),
  quantity: z.number().finite().nonnegative(),
  /** Totals for this item. */
  nutrients: nutrientMapSchema,
});

export const savedMealSchema = baseRow.extend({
  name: z.string().min(1).max(200),
  meal: z.enum(MEALS).nullable(),
  items: z.array(savedMealItemSchema).max(100),
});

export const measurementSchema = baseRow.extend({
  kind: z.enum(MEASUREMENT_KINDS),
  value: z.number().finite(),
  takenAt: ts,
  note: z.string().max(2000).nullable(),
});

/**
 * Daily targets, effective from `effectiveFrom` until the next row's date.
 * Changing targets adds a new row so past days keep the targets they had.
 */
export const targetSchema = baseRow.extend({
  effectiveFrom: daySchema,
  /** Daily targets keyed by nutrient number. "208" (kcal) is the calorie budget. */
  nutrients: nutrientMapSchema,
  waterMl: z.number().finite().nonnegative().nullable(),
});

/** One AI meal estimate: what was asked, what the model said, and what the user accepted. */
export const aiEstimateSchema = baseRow.extend({
  date: daySchema,
  meal: z.enum(MEALS),
  /** SHA-256 of the resized photo (the photo itself is never synced). */
  photoHash: z.string().max(128).nullable(),
  description: z.string().max(4000).nullable(),
  model: z.string().max(100),
  /** The model's raw structured response (MealEstimate, see ai.ts). */
  response: z.unknown(),
  /** The items the user accepted after review (null = discarded). */
  accepted: z.unknown(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});

/** Per-user key/value settings; `id` is the setting key. */
export const settingSchema = baseRow.extend({
  value: z.string().max(100_000), // JSON-encoded
});

export type Food = z.infer<typeof foodSchema>;
export type DiaryEntry = z.infer<typeof diaryEntrySchema>;
export type RecipeIngredient = z.infer<typeof recipeIngredientSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type SavedMealItem = z.infer<typeof savedMealItemSchema>;
export type SavedMeal = z.infer<typeof savedMealSchema>;
export type Measurement = z.infer<typeof measurementSchema>;
export type Target = z.infer<typeof targetSchema>;
export type AiEstimateRow = z.infer<typeof aiEstimateSchema>;
export type Setting = z.infer<typeof settingSchema>;

/** Registry of syncable collections (parents before children). */
export const COLLECTIONS = {
  foods: foodSchema,
  recipes: recipeSchema,
  savedMeals: savedMealSchema,
  aiEstimates: aiEstimateSchema,
  diaryEntries: diaryEntrySchema,
  measurements: measurementSchema,
  targets: targetSchema,
  settings: settingSchema,
} as const;

export type CollectionName = keyof typeof COLLECTIONS;
export const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];

export interface RowTypes {
  foods: Food;
  recipes: Recipe;
  savedMeals: SavedMeal;
  aiEstimates: AiEstimateRow;
  diaryEntries: DiaryEntry;
  measurements: Measurement;
  targets: Target;
  settings: Setting;
}

export type AnyRow = RowTypes[CollectionName];

/** Column names for a collection (derived from the zod schema). */
export function columnsOf(name: CollectionName): string[] {
  return Object.keys(COLLECTIONS[name].shape);
}

/** Columns whose zod type is boolean (stored as INTEGER 0/1 in SQL). */
export function booleanColumnsOf(name: CollectionName): string[] {
  const shape = COLLECTIONS[name].shape as Record<string, z.ZodType>;
  return Object.entries(shape)
    .filter(([, t]) => unwrap(t) instanceof z.ZodBoolean)
    .map(([k]) => k);
}

/** Columns that are numeric (used for SQL column affinity). */
export function numericColumnsOf(name: CollectionName): string[] {
  const shape = COLLECTIONS[name].shape as Record<string, z.ZodType>;
  return Object.entries(shape)
    .filter(([, t]) => unwrap(t) instanceof z.ZodNumber)
    .map(([k]) => k);
}

/** Columns stored as JSON text in SQL (objects, arrays, records, unknown). */
export function jsonColumnsOf(name: CollectionName): string[] {
  const shape = COLLECTIONS[name].shape as Record<string, z.ZodType>;
  return Object.entries(shape)
    .filter(([, t]) => {
      const u = unwrap(t);
      return u instanceof z.ZodObject || u instanceof z.ZodArray || u instanceof z.ZodRecord || u instanceof z.ZodUnknown;
    })
    .map(([k]) => k);
}

function unwrap(t: z.ZodType): z.ZodType {
  let cur: z.ZodType = t;
  // zod v4: nullable/optional wrap the inner type in `.unwrap()`
  while (cur instanceof z.ZodNullable || cur instanceof z.ZodOptional) {
    cur = cur.unwrap() as z.ZodType;
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Sync protocol
// ---------------------------------------------------------------------------

export type ChangeSet = { [K in CollectionName]?: RowTypes[K][] };

export const syncRequestSchema = z.object({
  /** Highest server revision the client has already seen (0 = full pull). */
  since: z.number().int().nonnegative(),
  /** Rows changed locally since the last successful sync. */
  changes: z.record(z.string(), z.array(z.unknown())).default({}),
});
export type SyncRequest = { since: number; changes: ChangeSet };

export interface SyncResponse {
  /** New cursor to send as `since` next time. */
  rev: number;
  /** Rows changed on the server after `since` (including ones just pushed). */
  changes: ChangeSet;
  /** Rows the server refused, with a reason (validation errors etc.). */
  rejected: { collection: string; id: string | null; error: string }[];
}

/**
 * Ids of bundled (read-only) USDA foods are `usda:<fdcId>`. They live in the
 * bundled food database, not in the synced `foods` collection; logging one
 * copies it into `foods` under a fresh id with `source: 'usda'`.
 */
export const BUILTIN_PREFIX = 'usda:';
/** Ids of packaged-food search results from the server (USDA Branded); never stored as such. */
export const BRANDED_PREFIX = 'fdc:';
/** True for ids that name a row in the user's `foods` (not a bundled food or a search result). */
export const isStoredFoodId = (id: string | null | undefined): boolean => !!id && !id.startsWith(BUILTIN_PREFIX) && !id.startsWith(BRANDED_PREFIX);
