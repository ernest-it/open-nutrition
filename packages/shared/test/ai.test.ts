import { describe, expect, it } from 'vitest';
import {
  AI_NUTRIENT_KEYS,
  AiError,
  FALLBACK_BETA,
  MEAL_ESTIMATE_SYSTEM_PROMPT,
  MemoryStorage,
  N,
  NutritionStore,
  anthropicHeaders,
  buildMealEstimateRequest,
  estimateCostUsd,
  maskApiKey,
  matchScore,
  mealEstimateBetas,
  mealEstimateJsonSchema,
  parseMealEstimateResponse,
  rescaleReviewItem,
  resolveEstimate,
  reviewItemToLog,
  typicalMealCostUsd,
  type Food,
  type MealEstimate,
} from '../src';

const food = (fdcId: number, name: string, nutrients: Record<string, number>): Food => ({
  id: `usda:${fdcId}`,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  name,
  brand: null,
  barcode: null,
  source: 'usda',
  sourceId: String(fdcId),
  servings: [{ label: '100 g', grams: 100 }],
  nutrients,
  favorite: false,
});

const itemNutrients = (kcal: number, p: number, c: number, f: number): Record<string, number> => ({
  ...Object.fromEntries(AI_NUTRIENT_KEYS.map((k) => [k, 0.5])),
  [N.energy]: kcal,
  [N.protein]: p,
  [N.carbs]: c,
  [N.fat]: f,
});

const estimate: MealEstimate = {
  items: [
    {
      name: 'White rice',
      usdaQuery: 'Rice, white, long-grain, regular, cooked',
      grams: 150,
      confidence: 'medium',
      nutrients: itemNutrients(195, 4, 42, 0.4),
      notes: null,
    },
    {
      name: 'Grilled chicken breast',
      usdaQuery: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted',
      grams: 120,
      confidence: 'high',
      nutrients: itemNutrients(198, 37, 0, 4.3),
      notes: 'assumed no skin',
    },
    {
      name: 'Grandma special sauce',
      usdaQuery: 'Sauce, homemade, secret',
      grams: 30,
      confidence: 'low',
      nutrients: itemNutrients(60, 0.5, 4, 5),
      notes: null,
    },
  ],
  assumptions: ['Half the usual rice, as described.'],
};

const sampleResponse = (over: Record<string, unknown> = {}) => ({
  id: 'msg_01',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [
    { type: 'thinking', thinking: '', signature: 'abc' },
    { type: 'text', text: JSON.stringify(estimate) },
  ],
  stop_reason: 'end_turn',
  stop_details: null,
  usage: { input_tokens: 1800, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500, output_tokens: 900 },
  ...over,
});

describe('buildMealEstimateRequest', () => {
  it('builds a Messages API body with image first, cached system prompt and structured output', () => {
    const body = buildMealEstimateRequest({
      model: 'claude-opus-5-5',
      effort: 'low',
      imageBase64: 'data:image/jpeg;base64,/9j/4AAQ\nSkZJRg==',
      mediaType: 'image/jpeg',
      description: 'chicken burrito bowl, half the rice',
    });
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(16000);
    expect(body.system[0]).toEqual({ type: 'text', text: MEAL_ESTIMATE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } });
    const content = body.messages[0]!.content as { type: string; source?: { data: string; media_type: string }; text?: string }[];
    expect(content[0]!.type).toBe('image');
    expect(content[0]!.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' });
    expect(content[1]!.text).toContain('half the rice');
    expect(content[1]!.text).toContain('ground truth');
    expect(body.output_config.effort).toBe('low');
    expect(body.output_config.format?.type).toBe('json_schema');
    expect(body.fallbacks).toBe('default');
    expect(mealEstimateBetas(body)).toEqual([FALLBACK_BETA]);
    expect('thinking' in body).toBe(false);
    expect('temperature' in body).toBe(false);
    // body must be plain JSON
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it('has a schema within the structured-output subset', () => {
    const walk = (s: unknown): void => {
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      if (o.type === 'object') expect(o.additionalProperties).toBe(false);
      for (const bad of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems']) expect(o[bad]).toBeUndefined();
      Object.values(o).forEach(walk);
    };
    walk(mealEstimateJsonSchema);
    const nutrientProps = mealEstimateJsonSchema.properties.items.items.properties.nutrients.properties;
    expect(Object.keys(nutrientProps)).toContain(N.energy);
    expect(Object.keys(nutrientProps)).toContain(N.vitD);
  });

  it('handles text-only, Haiku (no fallbacks) and missing input', () => {
    const body = buildMealEstimateRequest({ model: 'claude-haiku-5-5', description: '2 eggs and toast' });
    expect(body.messages[0]!.content).toHaveLength(1);
    expect(body.fallbacks).toBeUndefined();
    expect(body.output_config.effort).toBe('low');
    expect(anthropicHeaders('sk-ant-x', body)).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-ant-x',
      'anthropic-version': '2026-10-21',
    });
    const opus = buildMealEstimateRequest({ description: 'toast' });
    expect(opus.model).toBe('claude-opus-5-5');
    const h = anthropicHeaders('k', opus, { browser: true });
    expect(h['anthropic-beta']).toBe(FALLBACK_BETA);
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(() => buildMealEstimateRequest({ description: '   ' })).toThrow(AiError);
  });
});

describe('parseMealEstimateResponse', () => {
  it('parses the estimate and usage', () => {
    const r = parseMealEstimateResponse(sampleResponse());
    expect(r.estimate.items).toHaveLength(3);
    expect(r.estimate.items[1]!.nutrients[N.protein]).toBe(37);
    expect(r.model).toBe('claude-opus-5-5');
    expect(r.inputTokens).toBe(3300);
    expect(r.cacheReadInputTokens).toBe(1500);
    expect(r.outputTokens).toBe(900);
  });

  it('uses only text after a fallback block', () => {
    const r = parseMealEstimateResponse(
      sampleResponse({
        model: 'claude-opus-4-8',
        content: [
          { type: 'text', text: '{"items": [' },
          { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } },
          { type: 'text', text: JSON.stringify(estimate) },
        ],
      }),
    );
    expect(r.model).toBe('claude-opus-4-8');
    expect(r.estimate.items).toHaveLength(3);
  });

  it('throws user-facing AiErrors for refusal, truncation and junk', () => {
    const refusal = () =>
      parseMealEstimateResponse(
        sampleResponse({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: 'x' }, content: [] }),
      );
    expect(refusal).toThrow(AiError);
    try {
      refusal();
    } catch (e) {
      expect((e as AiError).code).toBe('refusal');
      expect((e as AiError).message).toMatch(/describe the meal/);
    }
    expect(() => parseMealEstimateResponse(sampleResponse({ stop_reason: 'max_tokens' }))).toThrow(/cut off/);
    expect(() => parseMealEstimateResponse(sampleResponse({ content: [{ type: 'text', text: 'Sure! Here' }] }))).toThrow(
      /unreadable/,
    );
    expect(() =>
      parseMealEstimateResponse(sampleResponse({ content: [{ type: 'text', text: '{"items": [{"name": 3}]}' }] })),
    ).toThrow(/unexpected/);
  });
});

describe('resolveEstimate', () => {
  const db = [
    food(169704, 'Rice, white, long-grain, regular, cooked', { [N.energy]: 130, [N.protein]: 2.69, [N.carbs]: 28.2, [N.fat]: 0.28, [N.iron]: 1.2 }),
    food(169756, 'Rice, white, long-grain, regular, raw, enriched', { [N.energy]: 365, [N.protein]: 7.13, [N.carbs]: 80, [N.fat]: 0.66 }),
    food(171477, 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', { [N.protein]: 31, [N.fat]: 3.6 }),
    food(174524, 'Sauce, pasta, spaghetti/marinara, ready-to-serve', { [N.energy]: 50 }),
  ];
  const search = (q: string) => {
    const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    return db.filter((f) => words.some((w) => f.name.toLowerCase().includes(w)));
  };

  it('prefers cooked/raw agreement in scoring', () => {
    const q = 'Rice, white, long-grain, regular, cooked';
    expect(matchScore(q, db[0]!.name)).toBeGreaterThan(matchScore(q, db[1]!.name));
    expect(matchScore(q, db[0]!.name)).toBeGreaterThan(0.9);
  });

  it('uses DB values for good matches and AI values otherwise', async () => {
    const items = await resolveEstimate(estimate, search);
    const [rice, chicken, sauce] = items;
    expect(rice!.usedAi).toBe(false);
    expect(rice!.matchedFood?.id).toBe('usda:169704');
    expect(rice!.nutrients[N.energy]).toBeCloseTo(195);
    expect(rice!.nutrients[N.iron]).toBeCloseTo(1.8);
    // DB values only: no AI micronutrients mixed in
    expect(rice!.nutrients[N.vitC]).toBeUndefined();
    expect(rice!.aiNutrients[N.energy]).toBe(195);

    // DB match lacks energy and carbs: filled from AI
    expect(chicken!.usedAi).toBe(false);
    expect(chicken!.nutrients[N.protein]).toBeCloseTo(37.2);
    expect(chicken!.nutrients[N.energy]).toBe(198);
    expect(chicken!.nutrients[N.carbs]).toBe(0);

    expect(sauce!.usedAi).toBe(true);
    expect(sauce!.matchedFood).toBeNull();
    expect(sauce!.nutrients[N.energy]).toBe(60);
    expect(sauce!.matchScore).toBeLessThan(0.55);
  });

  it('survives a failing search and logs AI items as ai foods', async () => {
    const items = await resolveEstimate(estimate, async () => {
      throw new Error('offline');
    });
    expect(items.every((i) => i.usedAi)).toBe(true);
    const half = rescaleReviewItem(items[0]!, 75);
    expect(half.nutrients[N.energy]).toBeCloseTo(97.5);

    const store = new NutritionStore(new MemoryStorage());
    await store.init();
    const args = reviewItemToLog(half);
    expect(args.food.source).toBe('ai');
    expect(args.food.nutrients[N.energy]).toBeCloseTo(130);
    const e = store.logFood({ day: '2026-11-19', meal: 'lunch', ...args, aiEstimateId: 'est1' });
    expect(e.source).toBe('ai');
    expect(e.nutrients[N.energy]).toBeCloseTo(97.5);
    expect(e.aiEstimateId).toBe('est1');
    expect(store.all('foods')[0]!.id).not.toBe('');
  });
});

describe('pricing and keys', () => {
  it('estimates cost', () => {
    expect(estimateCostUsd('claude-opus-5-5', 1_000_000, 0)).toBeCloseTo(4);
    expect(estimateCostUsd('claude-opus-5-5', 0, 1_000_000)).toBeCloseTo(20);
    expect(estimateCostUsd('claude-haiku-5-5', 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(estimateCostUsd('claude-opus-5-5', 1_000_000, 0, { readTokens: 1_000_000 })).toBeCloseTo(0.2);
    const opus = typicalMealCostUsd('claude-opus-5-5');
    expect(opus).toBeGreaterThan(0.02);
    expect(opus).toBeLessThan(0.06);
    expect(typicalMealCostUsd('claude-haiku-5-5')).toBeLessThan(0.002);
  });

  it('masks keys', () => {
    expect(maskApiKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz-a1b2')).toBe('sk-ant-…a1b2');
    expect(maskApiKey('short')).toBe('…');
  });
});
