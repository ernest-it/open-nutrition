import { describe, expect, it } from 'vitest';
import {
  AiError,
  MAX_REQUESTS_PER_ESTIMATE,
  N,
  aiErrorFromHttp,
  buildMealEstimateRequest,
  estimateCostUsd,
  mealEstimateBetas,
  parseMealEstimateResponse,
  resolveEstimate,
  reviewItemToLog,
  runMealEstimate,
  swapReviewItemFood,
  usageCostUsd,
  type Food,
  type MessagesRequestBody,
} from '../src';

const nutrients = { [N.energy]: 440, [N.protein]: 29, [N.carbs]: 41, [N.fat]: 18 };
const item = (over: Record<string, unknown> = {}) => ({
  name: 'Chick-fil-A Chicken Sandwich',
  usdaQuery: '',
  grams: 183,
  confidence: 'high',
  nutrients,
  notes: null,
  brand: 'Chick-fil-A',
  sourceUrl: 'https://www.chick-fil-a.com/menu/chicken-sandwich',
  sourceName: 'Chick-fil-A menu',
  portionOptions: [],
  ...over,
});
const answer = (items: unknown[]) => JSON.stringify({ items, assumptions: ['One sandwich'] });
const usage = (searches = 0) => ({
  input_tokens: 9000,
  output_tokens: 700,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  ...(searches ? { server_tool_use: { web_search_requests: searches } } : {}),
});
/** A response where Claude searched once and then answered. */
const searched = (text: string, urls = ['https://www.chick-fil-a.com/nutrition-allergens']) => ({
  type: 'message',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [
    { type: 'text', text: 'I will look up the published numbers. {not json}' },
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'chick-fil-a chicken sandwich nutrition' } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: urls.map((url) => ({ type: 'web_search_result', url, title: 'Nutrition', encrypted_content: 'x' })) },
    { type: 'text', text },
  ],
  usage: usage(1),
});
const plain = (text: string) => ({ type: 'message', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: usage() });

describe('web search request', () => {
  it('adds a capped search tool and drops structured output and fallbacks', () => {
    const body = buildMealEstimateRequest({ description: 'chick-fil-a sandwich', webSearch: 'auto' });
    expect(body.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, allowed_callers: ['direct'] }]);
    expect(body.output_config.format).toBeUndefined();
    expect(body.fallbacks).toBeUndefined();
    expect(mealEstimateBetas(body)).toEqual([]);
    expect(JSON.stringify(body.messages)).toContain('Web search mode: brands only.');

    expect(buildMealEstimateRequest({ description: 'x', webSearch: 'always' }).tools![0]!.max_uses).toBe(5);
    // A caller can lower the cap but never raise it.
    expect(buildMealEstimateRequest({ description: 'x', webSearch: 'always', maxSearches: 2 }).tools![0]!.max_uses).toBe(2);
    expect(buildMealEstimateRequest({ description: 'x', webSearch: 'auto', maxSearches: 50 }).tools![0]!.max_uses).toBe(3);
    expect(buildMealEstimateRequest({ description: 'x', webSearch: 'auto', maxSearches: 0 }).tools![0]!.max_uses).toBe(1);
  });

  it('sends no tool when search is off', () => {
    const body = buildMealEstimateRequest({ description: 'a banana' });
    expect(body.tools).toBeUndefined();
    expect(body.output_config.format?.type).toBe('json_schema');
    expect(JSON.stringify(body.messages)).toContain('Web search mode: off');
  });

  it('prices searches at a cent each', () => {
    expect(estimateCostUsd('claude-opus-5-5', 0, 0, { webSearches: 3 })).toBeCloseTo(0.03, 10);
    expect(usageCostUsd('claude-opus-5-5', { inputTokens: 1000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearches: 1 })).toBeCloseTo(0.014, 10);
  });
});

describe('parsing a searched answer', () => {
  it('reads only the text after the search and counts searches', () => {
    const r = parseMealEstimateResponse(searched(answer([item()])));
    expect(r.webSearches).toBe(1);
    expect(r.estimate.items[0]).toMatchObject({ brand: 'Chick-fil-A', sourceUrl: 'https://www.chick-fil-a.com/menu/chicken-sandwich', sourceName: 'Chick-fil-A menu' });
  });

  it('tolerates markdown fences and a sentence around the JSON', () => {
    const r = parseMealEstimateResponse(searched('Here it is:\n```json\n' + answer([item()]) + '\n```'));
    expect(r.estimate.items).toHaveLength(1);
  });

  it('drops a source that the search did not return', () => {
    const r = parseMealEstimateResponse(searched(answer([item({ sourceUrl: 'https://made-up.example/sandwich' })])));
    expect(r.estimate.items[0]!.sourceUrl).toBeNull();
    expect(r.estimate.items[0]!.sourceName).toBeNull();
  });

  it('drops every source when nothing was searched, and anything that is not a web address', () => {
    expect(parseMealEstimateResponse(plain(answer([item()]))).estimate.items[0]!.sourceUrl).toBeNull();
    const r = parseMealEstimateResponse(searched(answer([item({ sourceUrl: 'javascript:alert(1)' }), item({ sourceUrl: 'file:///etc/passwd' })])));
    expect(r.estimate.items.map((i) => i.sourceUrl)).toEqual([null, null]);
  });

  it('cleans portion options and accepts answers without the new fields', () => {
    const r = parseMealEstimateResponse(
      plain(
        answer([
          item({
            sourceUrl: null,
            portionOptions: [
              { label: '1 cup (about 160 g)', grams: 160 },
              { label: ' ', grams: 100 },
              { label: 'half a cup', grams: 80 },
              { label: 'also 160', grams: 160.2 },
              { label: 'nothing', grams: 0 },
              { label: 'huge', grams: 90000 },
            ],
          }),
        ]),
      ),
    );
    expect(r.estimate.items[0]!.portionOptions).toEqual([
      { label: 'half a cup', grams: 80 },
      { label: '1 cup (about 160 g)', grams: 160 },
    ]);
    const old = parseMealEstimateResponse(plain(JSON.stringify({ items: [{ name: 'Toast', usdaQuery: 'Bread, toasted', grams: 30, confidence: 'high', nutrients: { [N.energy]: 80 }, notes: null }], assumptions: [] })));
    expect(old.estimate.items[0]).toMatchObject({ brand: null, sourceUrl: null, portionOptions: [] });
  });
});

const failure = async (p: Promise<unknown>): Promise<AiError> => {
  try {
    await p;
  } catch (e) {
    return e as AiError;
  }
  throw new Error('expected a failure');
};

describe('runMealEstimate (the only place a second request can happen)', () => {
  const input = { description: 'chick-fil-a sandwich', webSearch: 'auto' as const };
  const recorder = (answers: (() => unknown)[]) => {
    const bodies: MessagesRequestBody[] = [];
    const send = async (b: MessagesRequestBody) => {
      bodies.push(b);
      const next = answers[bodies.length - 1];
      if (!next) throw new Error('unexpected extra request');
      return next();
    };
    return { bodies, send };
  };

  it('sends exactly one request in the normal case', async () => {
    const t = recorder([() => searched(answer([item()]))]);
    const r = await runMealEstimate(input, t.send);
    expect(t.bodies).toHaveLength(1);
    expect(r).toMatchObject({ requests: 1, searchUnavailable: false, webSearches: 1 });
  });

  it('retries once without search when the API rejects the request, and says so', async () => {
    const t = recorder([
      () => {
        throw aiErrorFromHttp(400, '{"error":{"message":"web search is not enabled"}}');
      },
      () => plain(answer([item({ sourceUrl: null })])),
    ]);
    const r = await runMealEstimate(input, t.send);
    expect(t.bodies).toHaveLength(2);
    expect(t.bodies[1]!.tools).toBeUndefined();
    expect(r.searchUnavailable).toBe(true);
    expect(r.estimate.assumptions.join(' ')).toMatch(/Web lookup was not available/);
  });

  it('never retries any other failure', async () => {
    for (const status of [401, 429, 500, 529]) {
      const t = recorder([
        () => {
          throw aiErrorFromHttp(status);
        },
      ]);
      await expect(runMealEstimate(input, t.send)).rejects.toBeInstanceOf(AiError);
      expect(t.bodies).toHaveLength(1);
    }
    // A network failure or timeout (no HTTP status) is not retried either: it may have been billed.
    const t = recorder([
      () => {
        throw new AiError('api_error', 'timed out');
      },
    ]);
    await expect(runMealEstimate(input, t.send)).rejects.toThrow('timed out');
    expect(t.bodies).toHaveLength(1);
    // Without search there is nothing to fall back to: a 400 fails at once.
    const off = recorder([
      () => {
        throw aiErrorFromHttp(400);
      },
    ]);
    await expect(runMealEstimate({ description: 'x' }, off.send)).rejects.toBeInstanceOf(AiError);
    expect(off.bodies).toHaveLength(1);
  });

  it('continues a paused search turn once, then gives up', async () => {
    const paused = { ...searched(''), stop_reason: 'pause_turn' };
    const ok = recorder([() => paused, () => searched(answer([item()]))]);
    const r = await runMealEstimate(input, ok.send);
    expect(ok.bodies).toHaveLength(2);
    expect(ok.bodies[1]!.messages).toHaveLength(2);
    expect(ok.bodies[1]!.messages[1]).toMatchObject({ role: 'assistant' });
    // Both responses were billed.
    expect(r.webSearches).toBe(2);
    expect(r.inputTokens).toBe(18000);

    const stuck = recorder([() => paused, () => paused, () => paused, () => paused]);
    const err = await failure(runMealEstimate(input, stuck.send));
    expect(err).toBeInstanceOf(AiError);
    expect(stuck.bodies).toHaveLength(2);
    expect(err.usage).toMatchObject({ webSearches: 2, inputTokens: 18000 });
  });

  it('can never send more than the fixed number of requests', async () => {
    const paused = { ...searched(''), stop_reason: 'pause_turn' };
    const t = recorder([
      () => {
        throw aiErrorFromHttp(400);
      },
      () => paused,
      () => paused,
      () => paused,
      () => paused,
    ]);
    await expect(runMealEstimate(input, t.send)).rejects.toBeInstanceOf(AiError);
    expect(t.bodies.length).toBeLessThanOrEqual(MAX_REQUESTS_PER_ESTIMATE);
    expect(t.bodies).toHaveLength(3);
  });

  it('reports what an unusable answer cost', async () => {
    const t = recorder([() => searched('sorry, no JSON here')]);
    const err = await failure(runMealEstimate(input, t.send));
    expect(err.code).toBe('invalid_response');
    expect(err.usage).toMatchObject({ inputTokens: 9000, outputTokens: 700, webSearches: 1 });
  });
});

describe('review items with sources', () => {
  const generic: Food = {
    id: 'usda:1',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    name: 'Chicken sandwich, fast food',
    brand: null,
    barcode: null,
    source: 'usda',
    sourceId: '1',
    servings: [],
    nutrients: { [N.energy]: 250 },
    favorite: false,
  };

  it('keeps published numbers instead of matching a generic food', async () => {
    const { estimate } = parseMealEstimateResponse(searched(answer([item({ portionOptions: [{ label: '2 sandwiches', grams: 366 }] })])));
    let searches = 0;
    const [it1] = await resolveEstimate(estimate, () => {
      searches++;
      return [generic];
    });
    expect(searches).toBe(0);
    expect(it1).toMatchObject({ source: 'web', usedAi: true, matchedFood: null, brand: 'Chick-fil-A', sourceName: 'Chick-fil-A menu' });
    expect(it1!.nutrients[N.energy]).toBe(440);
    expect(it1!.portionOptions).toEqual([{ label: '2 sandwiches', grams: 366 }]);
    expect(reviewItemToLog(it1!).food).toMatchObject({ source: 'ai', brand: 'Chick-fil-A' });
    // Swapping to a database food drops the web source.
    expect(swapReviewItemFood(it1!, generic)).toMatchObject({ source: 'database', sourceUrl: null, usedAi: false });
  });

  it('does not match a brand-name item to a generic food by its name', async () => {
    const { estimate } = parseMealEstimateResponse(plain(answer([item({ sourceUrl: null })])));
    const queries: string[] = [];
    const [it1] = await resolveEstimate(estimate, (q) => {
      queries.push(q);
      return [generic];
    });
    expect(queries).toEqual([]);
    expect(it1).toMatchObject({ source: 'estimate', usedAi: true, sourceUrl: null });
  });
});
