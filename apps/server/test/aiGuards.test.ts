// What keeps the AI endpoints from running up the server owner's bill.

import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { N } from '@open-nutrition/shared';
import type { AnthropicClient } from '../src/llm';
import { register, startApp, tokenFor, type App } from './helpers';

let app: App;
afterEach(async () => app?.close());

const item = {
  name: 'Chick-fil-A Chicken Sandwich',
  usdaQuery: '',
  grams: 183,
  confidence: 'high',
  nutrients: { [N.energy]: 440, [N.protein]: 29, [N.carbs]: 41, [N.fat]: 18 },
  notes: null,
  brand: 'Chick-fil-A',
  sourceUrl: 'https://www.chick-fil-a.com/menu/chicken-sandwich',
  sourceName: 'Chick-fil-A menu',
  portionOptions: [],
};
const text = JSON.stringify({ items: [item], assumptions: [] });
const usage = { input_tokens: 9000, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 1 } };
const searched = (answer = text) => ({
  type: 'message',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [
    { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'chick-fil-a sandwich nutrition' } },
    { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.chick-fil-a.com/nutrition-allergens', title: 'Nutrition' }] },
    { type: 'text', text: answer },
  ],
  usage,
});
/** What one searched answer costs on Opus: tokens plus one search. */
const COST = (9000 * 4 + 700 * 20) / 1e6 + 0.01;

type Call = { body: Record<string, unknown>; opts: Record<string, unknown> };

async function setup(behaviour: (n: number) => unknown, env: NodeJS.ProcessEnv = {}) {
  const calls: Call[] = [];
  const create = async (body: Record<string, unknown>, opts: Record<string, unknown>) => {
    calls.push({ body, opts });
    return behaviour(calls.length);
  };
  const client = { messages: { create }, beta: { messages: { create } } } as unknown as AnthropicClient;
  app = await startApp(env, { anthropic: client });
  const admin = await tokenFor(app);
  const as = (token: string) => {
    const headers = { authorization: `Bearer ${token}` };
    return {
      post: (payload: Record<string, unknown> = { description: 'chick-fil-a sandwich' }) => app.inject({ method: 'POST', url: '/api/v1/ai/estimate', headers, payload }),
      status: async () => (await app.inject({ url: '/api/v1/ai/status', headers })).json(),
    };
  };
  return { calls, admin, as, ...as(admin) };
}

const apiError = (status: number) => new Anthropic.APIError(status, { type: 'error', error: { type: 'api_error', message: 'x' } }, 'x', new Headers());

describe('web search on the server', () => {
  it('looks up brands by default, with a capped search tool, and returns the source', async () => {
    const t = await setup(() => searched());
    const r = await t.post();
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.webSearches).toBe(1);
    expect(body.costUsd).toBeCloseTo(COST, 8);
    expect(body.estimate.items[0]).toMatchObject({ brand: 'Chick-fil-A', sourceUrl: item.sourceUrl });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.body.tools).toEqual([{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, allowed_callers: ['direct'] }]);
    // The SDK must never resend a request on its own.
    expect(t.calls[0]!.opts).toMatchObject({ maxRetries: 0 });
  });

  it('lets the user search for every meal, within the server cap', async () => {
    const t = await setup(() => searched(), { AI_MAX_SEARCHES: '2' });
    await t.post({ description: 'a banana', webSearch: 'always' });
    expect((t.calls[0]!.body.tools as { max_uses: number }[])[0]!.max_uses).toBe(2);
    expect(JSON.stringify(t.calls[0]!.body.messages)).toContain('Web search mode: always.');
  });

  it('can be turned off for the whole server, whatever the client asks for', async () => {
    const t = await setup(() => ({ ...searched(), content: [{ type: 'text', text }], usage: { ...usage, server_tool_use: undefined } }), { AI_WEB_SEARCH: 'off' });
    expect((await t.status()).webSearch).toBe(false);
    const r = await t.post({ description: 'a banana', webSearch: 'always' });
    expect(r.statusCode).toBe(200);
    expect(t.calls[0]!.body.tools).toBeUndefined();
    // No search ran, so the source the model claimed is not trusted.
    expect(r.json().estimate.items[0].sourceUrl).toBeNull();
  });
});

describe('spending limits', () => {
  it('has safe defaults when nothing is configured', async () => {
    const t = await setup(() => searched());
    expect(await t.status()).toMatchObject({ monthlyLimit: 150, dailyLimit: 40, monthlyBudgetUsd: 25 });
  });

  it('stops everyone when the server budget is used up, without calling the API', async () => {
    // Enough budget for the first request's worst case, not for a second one after real spending.
    const t = await setup(() => searched(), { AI_MONTHLY_BUDGET_USD: '0.65', ALLOW_REGISTRATION: 'true' });
    expect((await t.post()).statusCode).toBe(200);
    const again = await t.post();
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ code: 'limit_reached' });
    expect(again.json().error).toMatch(/budget/);
    // The budget is server-wide: another user is stopped too.
    const bob = t.as((await register(app, 'bob')).json().token);
    expect((await bob.post()).statusCode).toBe(429);
    expect(t.calls).toHaveLength(1);
    // A refused request does not use up the user's own allowance.
    expect((await t.status()).usedThisMonth).toBe(1);
  });

  it('shows the server-wide budget to the admin only', async () => {
    const t = await setup(() => searched(), { ALLOW_REGISTRATION: 'true' });
    await t.post();
    expect((await t.status()).spentThisMonthUsd).toBeCloseTo(COST, 8);
    const bob = await t.as((await register(app, 'bob')).json().token).status();
    expect(bob.monthlyBudgetUsd).toBeUndefined();
    expect(bob.spentThisMonthUsd).toBeUndefined();
    expect(bob.usedThisMonth).toBe(0);
  });

  it('caps requests per day', async () => {
    const t = await setup(() => searched(), { AI_DAILY_LIMIT: '2' });
    expect((await t.post()).statusCode).toBe(200);
    expect((await t.post()).statusCode).toBe(200);
    const r = await t.post();
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toMatch(/today/);
    expect(t.calls).toHaveLength(2);
  });

  it('runs one request per user at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const t = await setup(async () => {
      await gate;
      return searched();
    });
    const first = t.post();
    // Let the first request reach the (blocked) API call.
    await new Promise((res) => setTimeout(res, 50));
    const second = await t.post();
    expect(second.statusCode).toBe(429);
    expect(second.json().error).toMatch(/still running/);
    release();
    expect((await first).statusCode).toBe(200);
    expect(t.calls).toHaveLength(1);
    // The slot is free again afterwards.
    expect((await t.post()).statusCode).toBe(200);
  });

  it('limits how many requests run at once across the server', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const t = await setup(
      async () => {
        await gate;
        return searched();
      },
      { AI_MAX_CONCURRENT: '1', ALLOW_REGISTRATION: 'true' },
    );
    const first = t.post();
    await new Promise((res) => setTimeout(res, 50));
    const bob = t.as((await register(app, 'bob')).json().token);
    const r = await bob.post();
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe('overloaded');
    release();
    await first;
    expect(t.calls).toHaveLength(1);
  });

  it('limits bursts of attempts, including failed ones', async () => {
    const t = await setup(() => {
      throw apiError(529);
    });
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await t.post()).statusCode);
    expect(codes.slice(0, 30).every((c) => c === 503)).toBe(true);
    expect(codes.slice(30)).toEqual([429, 429]);
    expect(t.calls).toHaveLength(30);
  });
});

describe('failures', () => {
  it('never sends a failed request again', async () => {
    for (const status of [429, 500, 529]) {
      const t = await setup(() => {
        throw apiError(status);
      });
      await t.post();
      expect(t.calls, `HTTP ${status}`).toHaveLength(1);
      // The API never ran it: the user gets the request back.
      expect((await t.status()).usedThisMonth).toBe(0);
      await app.close();
    }
  });

  it('keeps a timed-out request counted, because it may have been billed', async () => {
    const t = await setup(() => {
      throw new Anthropic.APIConnectionTimeoutError({ message: 'timed out' });
    });
    const r = await t.post();
    expect(r.statusCode).toBe(502);
    expect(t.calls).toHaveLength(1);
    expect((await t.status()).usedThisMonth).toBe(1);
  });

  it('counts the cost of an answer it could not use', async () => {
    const t = await setup(() => searched('not json at all'));
    const r = await t.post();
    expect(r.statusCode).toBe(502);
    expect(r.json().code).toBe('invalid_response');
    expect(await t.status()).toMatchObject({ usedThisMonth: 1 });
    expect((await t.status()).spentThisMonthUsd).toBeCloseTo(COST, 8);
  });

  it('falls back to no search once when the API rejects the search tool', async () => {
    const t = await setup((n) => {
      if (n === 1) throw apiError(400);
      return { ...searched(), content: [{ type: 'text', text }], usage: { ...usage, server_tool_use: undefined } };
    });
    const r = await t.post();
    expect(r.statusCode).toBe(200);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]!.body.tools).toBeUndefined();
    expect(r.json().searchUnavailable).toBe(true);
    expect(r.json().estimate.items[0].sourceUrl).toBeNull();
    expect((await t.status()).usedThisMonth).toBe(1);
  });
});
