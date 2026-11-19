import { afterEach, describe, expect, it } from 'vitest';
import type { AnthropicClient } from '../src/llm';
import { register, startApp, type App } from './helpers';

let app: App;
afterEach(async () => app?.close());

const neverCalled = {
  messages: { create: async () => { throw new Error('should not be called'); } },
  beta: { messages: { create: async () => { throw new Error('should not be called'); } } },
} as unknown as AnthropicClient;

async function start(env: NodeJS.ProcessEnv = {}) {
  app = await startApp(env, { anthropic: neverCalled });
}

describe('security', () => {
  it('rejects unauthenticated requests before reading large bodies', async () => {
    await start();
    const big = '{"x":"' + 'a'.repeat(5 * 1024 * 1024) + '"}';
    for (const url of ['/api/v1/sync', '/api/v1/ai/estimate', '/mcp']) {
      const r = await app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: big });
      expect(r.statusCode, url).toBe(401);
    }
    // public endpoints have a small body limit
    const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: { 'content-type': 'application/json' }, payload: big });
    expect(reg.statusCode).toBe(413);
  });

  it('requires auth on every data endpoint', async () => {
    await start();
    for (const url of ['/api/v1/me', '/api/v1/foods/search?q=apple', '/api/v1/foods/usda:1', '/api/v1/foods/barcode/3017620422003', '/api/v1/ai/status', '/api/v1/export/json', '/api/v1/export/diary.csv']) {
      expect((await app.inject(url)).statusCode, url).toBe(401);
    }
  });

  it('still accepts large bodies on sync for signed-in users', async () => {
    await start();
    const { token } = (await register(app)).json();
    const rows = Array.from({ length: 20_000 }, (_, i) => ({ id: `m${i}`, kind: 'body_weight', value: 80, takenAt: i, note: null, createdAt: 1, updatedAt: 1, deletedAt: null }));
    const r = await app.inject({ method: 'POST', url: '/api/v1/sync', headers: { authorization: `Bearer ${token}` }, payload: { since: 0, changes: { measurements: rows } } });
    expect(r.statusCode).toBe(200);
  });

  it('caps AI request bodies at about 8 MB', async () => {
    await start();
    const { token } = (await register(app)).json();
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/estimate',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ imageBase64: '/9j/' + 'A'.repeat(9 * 1024 * 1024), mediaType: 'image/jpeg' }),
    });
    expect(r.statusCode).toBe(413);
  });

  it('makes exactly one admin even with concurrent first sign-ups', async () => {
    await start();
    const results = await Promise.all(['a1', 'a2', 'a3'].map((u) => register(app, u)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 403, 403]);
  });

  it('sends security headers', async () => {
    await start();
    const r = await app.inject('/api/v1/health');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
  });

  it('requires the password to delete an account, and deletes usage with it', async () => {
    await start();
    const { token } = (await register(app)).json();
    const auth = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: auth, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: auth, payload: { password: 'wrong' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: auth, payload: { password: 'correct horse' } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/me', headers: auth })).statusCode).toBe(401);
  });

  it('never exposes the AI key', async () => {
    const key = 'sk-ant-secret-key-do-not-leak-1234';
    app = await startApp({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: key });
    const { token } = (await register(app)).json();
    for (const url of ['/api/v1/ai/status', '/api/v1/server-info']) {
      const r = await app.inject({ url, headers: { authorization: `Bearer ${token}` } });
      expect(r.body).not.toContain(key);
    }
  });
});
