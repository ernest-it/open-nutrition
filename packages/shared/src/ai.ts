// AI meal estimation with Claude (Messages API), without an SDK dependency.
//
// The request body built here is plain JSON. Two ways to send it:
//
// 1. Server (option A/C), with @anthropic-ai/sdk:
//      const body = buildMealEstimateRequest({...});
//      const betas = mealEstimateBetas(body);           // ['server-side-fallback-2026-07-01'] or []
//      const msg = betas.length
//        ? await client.beta.messages.create({ ...body, betas })
//        : await client.messages.create(body);
//      const result = parseMealEstimateResponse(msg);
//
// 2. Phone, bring-your-own-key (option B), plain fetch:
//      const res = await fetch(ANTHROPIC_MESSAGES_URL, {
//        method: 'POST',
//        headers: anthropicHeaders(apiKey, body),          // see below
//        body: JSON.stringify(body),
//      });
//      if (!res.ok) throw aiErrorFromHttp(res.status, await res.text());
//      const result = parseMealEstimateResponse(await res.json());
//
//    Headers: `content-type: application/json`, `x-api-key: <key>`,
//    `anthropic-version: 2026-10-21`, and `anthropic-beta: server-side-fallback-2026-07-01`
//    when the body carries `fallbacks`. From a browser-like runtime (web, or any
//    fetch that sends an Origin header and enforces CORS) Anthropic also requires
//    `anthropic-dangerous-direct-browser-access: true`; React Native's fetch does
//    not enforce CORS, but sending the header is harmless — pass `{ browser: true }`.
//    Never send a user's key from the web UI (use the server instead).
//
// API facts this relies on (Messages API, late 2026):
// * image block: { type: 'image', source: { type: 'base64', media_type, data } } placed before the text.
// * structured output: output_config.format = { type: 'json_schema', schema } — every object needs
//   additionalProperties: false; no min/max/length constraints.
// * output_config.effort: 'low' | 'medium' | 'high' (Opus 5.5 / Haiku 5.5 default to medium; thinking is
//   always on for Opus 5.5, so `thinking` is omitted).
// * cache_control: { type: 'ephemeral' } on the stable system block.
// * stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal'
//   (refusal comes with stop_details { category, explanation }).
// * usage: input_tokens (uncached), cache_creation_input_tokens, cache_read_input_tokens, output_tokens.
// * server-side fallbacks: `fallbacks: 'default'` + beta header server-side-fallback-2026-07-01 re-runs a
//   declined request on a fallback model inside the same call (Opus 5.5 / Sonnet 5.5; not Haiku 5.5;
//   not on Bedrock/Vertex/Foundry). Content then may contain a `fallback` block; text after it is the answer.

import { z } from 'zod';
import { kcalFromMacros, multiplyNutrients, scaleNutrients } from './calc';
import { N, NUTRIENT_BY_KEY, NUTRIENTS, type NutrientMap } from './nutrients';
import type { Food } from './schema';

// ---------------------------------------------------------------------------
// Models & pricing
// ---------------------------------------------------------------------------

export interface AiModel {
  id: string;
  label: string;
  /** USD per million input tokens (uncached). */
  inputPerMTok: number;
  outputPerMTok: number;
  /** USD per million cache-read input tokens. Cache writes cost 1.25 × input. */
  cacheReadPerMTok: number;
  /** Supports server-side refusal fallbacks (`fallbacks: 'default'`). */
  fallbacks: boolean;
}

export const AI_MODELS: AiModel[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5 — most accurate',
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    fallbacks: true,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5 — balanced',
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.1,
    fallbacks: true,
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5 — cheapest',
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    fallbacks: false,
  },
];

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
export const CHEAP_AI_MODEL = 'claude-haiku-5-5';
export type AiEffort = 'low' | 'medium' | 'high';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2026-10-21';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const modelInfo = (id: string) =>
  AI_MODELS.find((m) => m.id === id) ??
  // Fallback-served responses report the serving model (e.g. claude-opus-4-8); price unknown ids as the default.
  AI_MODELS.find((m) => m.id === DEFAULT_AI_MODEL)!;

/**
 * Cost of one call in USD. `inputTokens` is the TOTAL input (as returned by
 * parseMealEstimateResponse); pass the cache split to price it exactly.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache: { readTokens?: number; writeTokens?: number } = {},
): number {
  const m = modelInfo(model);
  const read = cache.readTokens ?? 0;
  const write = cache.writeTokens ?? 0;
  const plain = Math.max(0, inputTokens - read - write);
  return (plain * m.inputPerMTok + write * m.inputPerMTok * 1.25 + read * m.cacheReadPerMTok + outputTokens * m.outputPerMTok) / 1e6;
}

/**
 * Rough cost of a typical photo log, for the "≈3¢ per photo" notice: one
 * ~1024 px photo (~1.5k tokens), ~2k prompt tokens (uncached, worst case) and
 * ~1.5k output tokens including thinking.
 */
export function typicalMealCostUsd(model: string): number {
  return estimateCostUsd(model, 3500, 1500);
}

/** `sk-ant-…a1b2` (never show or log a full key). */
export function maskApiKey(key: string): string {
  const k = key.trim();
  if (k.length < 12) return '…';
  const prefix = k.startsWith('sk-ant-') ? 'sk-ant-' : k.slice(0, 3);
  return `${prefix}…${k.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------

export const CONFIDENCE = ['high', 'medium', 'low'] as const;

export const MealEstimateItem = z.object({
  /** "Grilled chicken breast" */
  name: z.string().min(1),
  /** USDA SR Legacy–style search term: "Chicken, broilers or fryers, breast, meat only, cooked, roasted" */
  usdaQuery: z.string(),
  grams: z.number().nonnegative(),
  confidence: z.enum(CONFIDENCE),
  /** Totals for this item (not per 100 g), keyed by USDA nutrient number. */
  nutrients: z.record(z.string(), z.number()),
  /** "assumed ~1 tbsp oil" */
  notes: z.string().nullable(),
});

export const MealEstimate = z.object({
  items: z.array(MealEstimateItem),
  /** Shown to the user. */
  assumptions: z.array(z.string()),
});
export type MealEstimate = z.infer<typeof MealEstimate>;
export type MealEstimateItem = z.infer<typeof MealEstimateItem>;

/** Nutrients the model must estimate for every item (the v1 core list). */
export const AI_NUTRIENT_KEYS = NUTRIENTS.filter((n) => n.core).map((n) => n.key);

/** JSON schema for `output_config.format` (structured-output subset: no numeric/length constraints). */
export const mealEstimateJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'assumptions'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'usdaQuery', 'grams', 'confidence', 'nutrients', 'notes'],
        properties: {
          name: { type: 'string', description: 'Short display name of the food as eaten.' },
          usdaQuery: { type: 'string', description: 'USDA SR Legacy style description to search for.' },
          grams: { type: 'number', description: 'Estimated edible weight eaten, in grams.' },
          confidence: { type: 'string', enum: [...CONFIDENCE] },
          nutrients: {
            type: 'object',
            additionalProperties: false,
            required: AI_NUTRIENT_KEYS,
            properties: Object.fromEntries(
              AI_NUTRIENT_KEYS.map((k) => {
                const d = NUTRIENT_BY_KEY[k]!;
                return [k, { type: 'number', description: `${d.name} (${d.unit}) for the whole item` }];
              }),
            ),
          },
          notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
} as const;

// ---------------------------------------------------------------------------
// Prompt & request
// ---------------------------------------------------------------------------

const nutrientList = AI_NUTRIENT_KEYS.map((k) => {
  const d = NUTRIENT_BY_KEY[k]!;
  return `- "${k}": ${d.name} (${d.unit})`;
}).join('\n');

/** Stable system prompt (kept byte-identical across calls so it can be cached). */
export const MEAL_ESTIMATE_SYSTEM_PROMPT = `You are the meal-logging assistant in Open Nutrition, a food diary app. The user sends a photo of food, a text description, or both. Identify each food item they ate, estimate how much of it there is, and estimate its nutrients. The app shows your estimate on a review screen where the user corrects it before anything is saved, so give your best single estimate for every item rather than asking questions.

How to read the input:
- The user's text is ground truth. If the text and the photo disagree (for example "half the rice", "no sour cream", "this is oat milk", "I only ate one of these"), follow the text and adjust the photo-based estimate accordingly. If the text names foods that are not visible, include them.
- With only a photo, estimate from what is visible. With only text, estimate typical portions for what is described (for example a restaurant portion when a restaurant dish is named).
- Ordinary food and drink, including alcohol, desserts, fast food, supplements and baby food, is always fine to estimate. Never refuse or lecture; if something in the photo is not food, ignore it. If there is no food at all, return an empty items list and say why in assumptions.

How to split items:
- One item per distinct food the user would log separately: for a burrito bowl list rice, beans, chicken, salsa, cheese and so on; for a sandwich either the components or the whole sandwich when components cannot be seen. Combine trivial garnishes into a nearby item.
- Count visible cooking fat, dressings, sauces and spreads as their own items when they contribute meaningful energy (for example "Oil, olive, salad or cooking", about 5 g per teaspoon). Note hidden fats you assumed.
- Drinks are items too (weigh 1 ml as about 1 g unless clearly denser).

For each item give:
- name: a short, friendly display name ("Grilled chicken breast").
- usdaQuery: a search term written the way USDA SR Legacy / Foundation food descriptions are written: main food first, then comma-separated qualifiers, including the cooking state, for example "Rice, white, long-grain, regular, cooked", "Chicken, broilers or fryers, breast, meat only, cooked, roasted", "Beans, black, mature seeds, cooked, boiled, without salt", "Bread, whole-wheat, commercially prepared", "Milk, reduced fat, fluid, 2% milkfat". Use generic foods, not brands. Say "cooked" or "raw" whenever it applies, matching how the food was eaten.
- grams: the estimated edible weight actually eaten, in grams (cooked weight for cooked foods, no bones, peel or packaging). Use plate size, utensils, hands and packaging as scale references.
- confidence: "high" when the food and amount are clear (or stated by the user), "medium" for a reasonable guess, "low" when the food or portion is hard to judge.
- nutrients: your best estimate of the TOTAL amount in this item (not per 100 g), keyed by these nutrient numbers, in these units:
${nutrientList}
  Use USDA-typical values for the food as prepared. Every key is required; use 0 only when the food truly contains none. Keep energy consistent with the macronutrients (about 4 kcal/g protein and carbohydrate, 9 kcal/g fat, 7 kcal/g alcohol).
- notes: a short note on anything assumed for this item ("assumed ~1 tbsp oil", "portion looks like ~1.5 cups"), or null.

Finally, list in assumptions the few assumptions that matter most for the total (portion sizes, preparation, hidden ingredients), each as a short sentence the user can check. Answer only with the JSON object that matches the schema.`;

export interface MealEstimateInput {
  model?: string;
  effort?: AiEffort;
  /** Base64 JPEG/PNG/WebP/GIF without the data: prefix (resize to ~1024 px long side first). */
  imageBase64?: string | null;
  mediaType?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | string | null;
  description?: string | null;
  /** Add server-side refusal fallbacks where the model supports them (default true). */
  fallbacks?: boolean;
  maxTokens?: number;
}

export interface MessagesRequestBody {
  model: string;
  max_tokens: number;
  system: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[];
  messages: { role: 'user'; content: unknown[] }[];
  output_config: { effort: AiEffort; format: { type: 'json_schema'; schema: typeof mealEstimateJsonSchema } };
  fallbacks?: 'default';
}

/** Build the Messages API JSON body for one meal estimate. */
export function buildMealEstimateRequest(input: MealEstimateInput): MessagesRequestBody {
  const model = input.model || DEFAULT_AI_MODEL;
  const description = input.description?.trim() || null;
  const image = input.imageBase64 ? input.imageBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '') : null;
  if (!image && !description) throw new AiError('no_input', 'Add a photo or describe what you ate.');
  const content: unknown[] = [];
  if (image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: input.mediaType || 'image/jpeg', data: image } });
  }
  const text = description
    ? `${image ? 'Photo attached. ' : 'No photo. '}The user's description (treat it as ground truth over the photo):\n"""\n${description.slice(0, 4000)}\n"""`
    : 'No description was given; estimate from the photo.';
  content.push({ type: 'text', text });
  const body: MessagesRequestBody = {
    model,
    max_tokens: input.maxTokens ?? 16000,
    system: [{ type: 'text', text: MEAL_ESTIMATE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    output_config: { effort: input.effort ?? 'low', format: { type: 'json_schema', schema: mealEstimateJsonSchema } },
  };
  if (input.fallbacks !== false && AI_MODELS.find((m) => m.id === model)?.fallbacks) body.fallbacks = 'default';
  return body;
}

/** Beta flags the body needs (pass as `betas` to client.beta.messages.create). */
export function mealEstimateBetas(body: { fallbacks?: unknown }): string[] {
  return body.fallbacks ? [FALLBACK_BETA] : [];
}

/** Headers for calling api.anthropic.com directly with fetch. */
export function anthropicHeaders(
  apiKey: string,
  body: { fallbacks?: unknown },
  opts: { browser?: boolean } = {},
): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  const betas = mealEstimateBetas(body);
  if (betas.length) h['anthropic-beta'] = betas.join(',');
  if (opts.browser) h['anthropic-dangerous-direct-browser-access'] = 'true';
  return h;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export type AiErrorCode =
  | 'no_input'
  | 'refusal'
  | 'max_tokens'
  | 'invalid_response'
  | 'auth'
  | 'rate_limit'
  | 'overloaded'
  | 'api_error'
  | 'not_configured'
  | 'limit_reached';

/** An error whose `message` is safe to show the user. */
export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Map an HTTP error from api.anthropic.com to an AiError. */
export function aiErrorFromHttp(status: number, bodyText = ''): AiError {
  let apiMsg = '';
  try {
    apiMsg = (JSON.parse(bodyText) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    /* not JSON */
  }
  if (status === 401 || status === 403)
    return new AiError('auth', 'Your Anthropic API key was rejected. Check or replace it in Settings.', apiMsg);
  if (status === 429) return new AiError('rate_limit', 'Too many AI requests right now. Try again in a minute.', apiMsg);
  if (status === 529 || status === 503) return new AiError('overloaded', 'The AI service is busy. Try again shortly.', apiMsg);
  if (status === 413) return new AiError('api_error', 'The photo is too large. Try a smaller one.', apiMsg);
  return new AiError('api_error', `The AI request failed (HTTP ${status}).`, apiMsg);
}

export interface MealEstimateResult {
  estimate: MealEstimate;
  /** The model that produced the answer (may be a fallback model). */
  model: string;
  /** Total input tokens (uncached + cache writes + cache reads). */
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

interface RawResponse {
  type?: string;
  model?: string;
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  content?: { type: string; text?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  error?: { type?: string; message?: string };
}

/** Validate a Messages API response (fetch JSON or SDK Message) and extract the estimate. */
export function parseMealEstimateResponse(json: unknown): MealEstimateResult {
  const r = (json ?? {}) as RawResponse;
  if (r.type === 'error') throw new AiError('api_error', 'The AI request failed.', r.error?.message);
  if (r.stop_reason === 'refusal') {
    throw new AiError(
      'refusal',
      'The AI declined to estimate this. Try a different photo or describe the meal in words.',
      r.stop_details,
    );
  }
  if (r.stop_reason === 'max_tokens') {
    throw new AiError('max_tokens', 'The AI response was cut off. Try again, or split the meal into fewer items.');
  }
  const content = r.content ?? [];
  // With server-side fallbacks, text before the last `fallback` block came from the model that declined.
  let start = 0;
  content.forEach((b, i) => {
    if (b.type === 'fallback') start = i + 1;
  });
  const text = content
    .slice(start)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError('invalid_response', 'The AI returned an unreadable answer. Please try again.', text.slice(0, 500));
  }
  const parsed = MealEstimate.safeParse(data);
  if (!parsed.success) {
    throw new AiError('invalid_response', 'The AI returned an unexpected answer. Please try again.', parsed.error.message);
  }
  const estimate: MealEstimate = {
    assumptions: parsed.data.assumptions.filter((a) => a.trim()),
    items: parsed.data.items.map((it) => ({ ...it, nutrients: cleanNutrients(it.nutrients) })),
  };
  const u = r.usage ?? {};
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  return {
    estimate,
    model: r.model ?? '',
    inputTokens: (u.input_tokens ?? 0) + read + write,
    outputTokens: u.output_tokens ?? 0,
    cacheReadInputTokens: read,
    cacheCreationInputTokens: write,
  };
}

/** Keep only known nutrient keys with finite, non-negative values. */
function cleanNutrients(m: Record<string, number>): NutrientMap {
  const out: NutrientMap = {};
  for (const [k, v] of Object.entries(m)) if (NUTRIENT_BY_KEY[k] && Number.isFinite(v) && v >= 0) out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------
// Resolving items against the food database
// ---------------------------------------------------------------------------

export interface ReviewItem {
  name: string;
  usdaQuery: string;
  grams: number;
  confidence: MealEstimateItem['confidence'];
  notes: string | null;
  /** Best database match if it scored at or above the threshold. */
  matchedFood: Food | null;
  /** 0..1 score of the best candidate (even when below the threshold). */
  matchScore: number;
  /** The model's own totals for this item. */
  aiNutrients: NutrientMap;
  /** Totals to log: database × grams when matched (macros filled from AI if the DB lacks them), else AI. */
  nutrients: NutrientMap;
  usedAi: boolean;
}

export const DEFAULT_MATCH_THRESHOLD = 0.55;

const STOPWORDS = new Set(['and', 'or', 'with', 'without', 'the', 'a', 'of', 'in', 'for', 'to', 'not', 'ns', 'as', 'type', 'made', 'from', 'regular', 'commercially', 'prepared']);
const COOKED = new Set(['cooked', 'boiled', 'baked', 'roasted', 'grilled', 'fried', 'broiled', 'steamed', 'braised', 'stewed', 'sauteed', 'microwaved', 'toasted', 'scrambled', 'poached', 'simmered', 'pan']);
const RAW = new Set(['raw', 'uncooked', 'dry', 'unprepared']);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9%]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('es') && !t.endsWith('ses') ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

function cookState(ts: string[]): 'cooked' | 'raw' | null {
  if (ts.some((t) => COOKED.has(t))) return 'cooked';
  if (ts.some((t) => RAW.has(t))) return 'raw';
  return null;
}

/**
 * How well a database food name matches an AI search term (0..1).
 * Token overlap weighted towards covering the query, a bonus for the same
 * first (head) word, and a penalty when cooked/raw states disagree.
 */
export function matchScore(query: string, foodName: string): number {
  const q = [...new Set(tokens(query))];
  const f = [...new Set(tokens(foodName))];
  if (!q.length || !f.length) return 0;
  const fs = new Set(f);
  const overlap = q.filter((t) => fs.has(t)).length;
  let score = 0.7 * (overlap / q.length) + 0.3 * (overlap / f.length);
  if (q[0] === f[0]) score += 0.1;
  const qs = cookState(q);
  const fsState = cookState(f);
  if (qs && fsState) score += qs === fsState ? 0.05 : -0.3;
  return Math.max(0, Math.min(1, score));
}

const MACROS = [N.energy, N.protein, N.carbs, N.fat];

/**
 * Turn a MealEstimate into review items: search the food DB for each item's
 * `usdaQuery` (falling back to its name), pick the best-scoring candidate,
 * and use DB nutrients × grams when the score reaches `threshold`; otherwise
 * use the model's own estimate (`usedAi: true`).
 */
export async function resolveEstimate(
  estimate: MealEstimate,
  search: (q: string) => Promise<Food[]> | Food[],
  opts: { threshold?: number } = {},
): Promise<ReviewItem[]> {
  const threshold = opts.threshold ?? DEFAULT_MATCH_THRESHOLD;
  return Promise.all(
    estimate.items.map(async (item) => {
      const query = item.usdaQuery.trim() || item.name;
      let candidates: Food[] = [];
      try {
        candidates = await search(query);
        if (!candidates.length && item.name && item.name !== query) candidates = await search(item.name);
      } catch {
        candidates = [];
      }
      let best: Food | null = null;
      let bestScore = 0;
      for (const c of candidates) {
        let s = Math.max(matchScore(query, c.name), 0.9 * matchScore(item.name, c.name));
        if (c.nutrients[N.energy] == null) s -= 0.1;
        if (s > bestScore) {
          best = c;
          bestScore = s;
        }
      }
      const base = {
        name: item.name,
        usdaQuery: item.usdaQuery,
        grams: item.grams,
        confidence: item.confidence,
        notes: item.notes,
        matchScore: bestScore,
        aiNutrients: item.nutrients,
      };
      if (best && bestScore >= threshold) {
        const nutrients = scaleNutrients(best.nutrients, item.grams);
        for (const k of MACROS) if (nutrients[k] == null && item.nutrients[k] != null) nutrients[k] = item.nutrients[k]!;
        if (nutrients[N.energy] == null) nutrients[N.energy] = kcalFromMacros(nutrients);
        return { ...base, matchedFood: best, nutrients, usedAi: false };
      }
      return { ...base, matchedFood: null, nutrients: { ...item.nutrients }, usedAi: true };
    }),
  );
}

/** Same item at a different weight (for the portion slider). */
export function rescaleReviewItem(item: ReviewItem, grams: number): ReviewItem {
  const f = item.grams > 0 ? grams / item.grams : 0;
  return { ...item, grams, nutrients: multiplyNutrients(item.nutrients, f), aiNutrients: multiplyNutrients(item.aiNutrients, f) };
}

/** Replace an item's match with a food the user picked (always uses DB values). */
export function swapReviewItemFood(item: ReviewItem, food: Food): ReviewItem {
  return { ...item, matchedFood: food, matchScore: 1, nutrients: scaleNutrients(food.nutrients, item.grams), usedAi: false };
}

/**
 * Arguments for `store.logFood` (add `day`, `meal` and `aiEstimateId`):
 * the matched food, or a new `source: 'ai'` food whose per-100 g values are
 * derived from the AI totals. `nutrients` carries the reviewed totals.
 */
export function reviewItemToLog(item: ReviewItem): {
  food: Food;
  grams: number;
  servingLabel: string | null;
  quantity: number;
  nutrients: NutrientMap;
} {
  const food: Food = item.matchedFood ?? {
    id: '',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    name: item.name.slice(0, 300),
    brand: null,
    barcode: null,
    source: 'ai',
    sourceId: null,
    servings: item.grams > 0 ? [{ label: '100 g', grams: 100 }, { label: 'AI portion', grams: item.grams }] : [{ label: '100 g', grams: 100 }],
    nutrients: item.grams > 0 ? multiplyNutrients(item.nutrients, 100 / item.grams) : {},
    favorite: false,
  };
  return { food, grams: item.grams, servingLabel: null, quantity: 1, nutrients: item.nutrients };
}
