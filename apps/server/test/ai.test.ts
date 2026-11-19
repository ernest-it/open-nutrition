import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_MODELS, N, type MealEstimate } from '@open-nutrition/shared';
import type { AnthropicClient } from '../src/llm';
import { startApp, tokenFor, type App } from './helpers';

let app: App;
afterEach(async () => app?.close());

const estimate: MealEstimate = {
  items: [
    {
      name: 'Grilled chicken breast',
      usdaQuery: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted',
      grams: 150,
      confidence: 'high',
      nutrients: { [N.energy]: 248, [N.protein]: 46.5, [N.carbs]: 0, [N.fat]: 5.4 },
      notes: null,
    },
  ],
  assumptions: ['No oil added'],
};

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  stop_details: null,
  content: [{ type: 'text', text: JSON.stringify(estimate) }],
  usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
  ...over,
});

type Behaviour = () => unknown;

function fakeClient(behaviour: Behaviour) {
  const calls: { beta: boolean; body: Record<string, unknown> }[] = [];
  const create = (beta: boolean) => async (body: Record<string, unknown>) => {
    calls.push({ beta, body });
    return behaviour();
  };
  const client = { messages: { create: create(false) }, beta: { messages: { create: create(true) } } } as unknown as AnthropicClient;
  return { client, calls };
}

// 1x1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function setup(behaviour: Behaviour, env: NodeJS.ProcessEnv = {}) {
  const fake = fakeClient(behaviour);
  app = await startApp(env, { anthropic: fake.client });
  const token = await tokenFor(app);
  const headers = { authorization: `Bearer ${token}` };
  const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/ai/estimate', headers, payload });
  const status = async () => (await app.inject({ url: '/api/v1/ai/status', headers })).json();
  return { ...fake, post, status };
}

describe('AI estimate', () => {
  it('returns an estimate with tokens and cost, and counts usage', async () => {
    const t = await setup(() => message(), { AI_MONTHLY_LIMIT: '5' });
    expect(await t.status()).toEqual({
      enabled: true,
      models: AI_MODELS.map((m) => m.id),
      defaultModel: 'claude-opus-5-5',
      defaultEffort: 'low',
      monthlyLimit: 5,
      usedThisMonth: 0,
    });
    // declared jpeg, bytes are PNG: the sniffed type wins
    const r = await t.post({ imageBase64: PNG, mediaType: 'image/jpeg', description: 'chicken, no oil' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.estimate).toEqual(estimate);
    expect(body).toMatchObject({ model: 'claude-opus-5-5', inputTokens: 3000, outputTokens: 500 });
    expect(body.costUsd).toBeCloseTo((1000 * 4 + 2000 * 0.2 + 500 * 20) / 1e6, 8);
    expect((await t.status()).usedThisMonth).toBe(1);

    // Opus supports server-side fallbacks -> beta endpoint with the beta flag
    const call = t.calls[0]!;
    expect(call.beta).toBe(true);
    expect(call.body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(call.body.model).toBe('claude-opus-5-5');
    expect(call.body.output_config).toMatchObject({ effort: 'low' });
    const content = (call.body.messages as { content: { type: string; source?: { media_type: string } }[] }[])[0]!.content;
    expect(content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
  });

  it('uses the plain endpoint for models without fallbacks and honours effort', async () => {
    const t = await setup(() => message({ model: 'claude-haiku-5-5' }));
    const r = await t.post({ description: 'a banana', model: 'claude-haiku-5-5', effort: 'medium' });
    expect(r.statusCode).toBe(200);
    expect(t.calls[0]!.beta).toBe(false);
    expect(t.calls[0]!.body.output_config).toMatchObject({ effort: 'medium' });
  });

  it('maps a refusal to 422 and still counts it', async () => {
    const t = await setup(() => message({ stop_reason: 'refusal', stop_details: { category: null, explanation: null }, content: [] }));
    const r = await t.post({ description: 'something' });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('refusal');
    expect((await t.status()).usedThisMonth).toBe(1);
  });

  it('returns 429 limit_reached when the monthly cap is hit', async () => {
    const t = await setup(() => message(), { AI_MONTHLY_LIMIT: '2' });
    expect((await t.post({ description: 'toast' })).statusCode).toBe(200);
    expect((await t.post({ description: 'toast' })).statusCode).toBe(200);
    const r = await t.post({ description: 'toast' });
    expect(r.statusCode).toBe(429);
    expect(r.json().code).toBe('limit_reached');
    expect(t.calls).toHaveLength(2);
  });

  it('maps SDK errors without returning 401, and refunds the slot', async () => {
    const t = await setup(() => {
      throw new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', new Headers());
    });
    const r = await t.post({ description: 'toast' });
    expect(r.statusCode).toBe(502);
    expect(r.json().code).toBe('auth');
    expect((await t.status()).usedThisMonth).toBe(0);
  });

  it('validates input', async () => {
    const t = await setup(() => message());
    expect((await t.post({})).json().code).toBe('no_input');
    expect((await t.post({ imageBase64: 'R0lGODlhAQABAAAAACw=', mediaType: 'image/gif' })).statusCode).toBe(400);
    expect((await t.post({ imageBase64: 'AAAA' })).statusCode).toBe(400); // unknown image type
    expect((await t.post({ description: 'x', model: 'gpt-4o' })).statusCode).toBe(400);
    expect(t.calls).toHaveLength(0);
  });

  it('is 503 when not configured', async () => {
    app = await startApp({});
    const token = await tokenFor(app);
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ url: '/api/v1/ai/status', headers })).json().enabled).toBe(false);
    const r = await app.inject({ method: 'POST', url: '/api/v1/ai/estimate', headers, payload: { description: 'toast' } });
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe('not_configured');
  });

  it('is enabled from env with LLM_PROVIDER=anthropic and a key', async () => {
    app = await startApp({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test-0000000000' });
    const token = await tokenFor(app);
    expect((await app.inject({ url: '/api/v1/ai/status', headers: { authorization: `Bearer ${token}` } })).json().enabled).toBe(true);
  });
});
