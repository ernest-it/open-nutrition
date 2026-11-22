import { afterEach, describe, expect, it } from 'vitest';
import { MENU_NUTRIENT_KEYS, N } from '@open-nutrition/shared';
import type { AnthropicClient } from '../src/llm';
import { PageFetchError, isPublicAddress, vetUrl, type FetchedPage } from '../src/pageFetch';
import { startApp, tokenFor, type App } from './helpers';

let app: App;
afterEach(async () => app?.close());

const nut = (kcal: number) => ({ ...Object.fromEntries(MENU_NUTRIENT_KEYS.map((k) => [k, null])), [N.energy]: kcal, [N.protein]: 20 });
const menu = {
  restaurant: 'Example Chicken',
  notes: [],
  items: [
    { name: 'Spicy Deluxe Sandwich', serving: '1 sandwich', servingGrams: 250, gramsEstimated: false, nutrients: nut(540) },
    { name: 'Waffle Fries, Medium', serving: 'Medium', servingGrams: 125, gramsEstimated: false, nutrients: nut(420) },
  ],
};
const message = {
  type: 'message',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(menu) }],
  usage: { input_tokens: 5000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
};
const ROWS = Array.from({ length: 20 }, (_, i) => `<tr><td>Item ${i}</td><td>${400 + i} kcal</td></tr>`).join('');
const HTML = `<html><body><table>${ROWS}</table></body></html>`;

async function setup(page: (url: string) => Promise<FetchedPage> = async (url) => ({ bytes: new TextEncoder().encode(HTML), contentType: 'text/html', finalUrl: url }), env: NodeJS.ProcessEnv = {}) {
  const calls: { beta: boolean; body: Record<string, unknown>; opts: unknown }[] = [];
  const stream = (beta: boolean) => (body: Record<string, unknown>, opts: unknown) => {
    calls.push({ beta, body, opts });
    return { finalMessage: async () => message };
  };
  const client = {
    messages: { create: async () => message, stream: stream(false) },
    beta: { messages: { create: async () => message, stream: stream(true) } },
  } as unknown as AnthropicClient;
  const fetched: string[] = [];
  app = await startApp(env, {
    anthropic: client,
    fetchPage: async (url: string) => {
      fetched.push(url);
      return page(url);
    },
  });
  const token = await tokenFor(app);
  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/ai/menu-import', headers: { authorization: `Bearer ${token}` }, payload });
  const used = async () => (await app.inject({ url: '/api/v1/ai/status', headers: { authorization: `Bearer ${token}` } })).json().usedThisMonth;
  return { calls, fetched, post, used };
}

describe('menu import endpoint', () => {
  it('fetches the page, streams the request with fallbacks, and counts one AI use', async () => {
    const t = await setup();
    const r = await t.post({ url: 'https://example.test/nutrition' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.menu.restaurant).toBe('Example Chicken');
    expect(body.menu.items.map((i: { name: string }) => i.name)).toEqual(['Spicy Deluxe Sandwich', 'Waffle Fries, Medium']);
    expect(body.costUsd).toBeGreaterThan(0);
    expect(t.fetched).toEqual(['https://example.test/nutrition']);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.beta).toBe(true);
    expect(t.calls[0]!.body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(JSON.stringify(t.calls[0]!.body.messages)).toContain('Item 7 | 407 kcal');
    expect(await t.used()).toBe(1);
  });

  it('uses pasted text without fetching anything', async () => {
    const t = await setup();
    const r = await t.post({ text: 'Nutrition guide\n' + 'Spicy Deluxe Sandwich 540 kcal 22 g fat\n'.repeat(10) });
    expect(r.statusCode).toBe(200);
    expect(t.fetched).toEqual([]);
  });

  it('reports pages it cannot use without spending an AI use', async () => {
    const blocked = await setup(async () => {
      throw new PageFetchError('That address points to a private or local network, which the server will not open.');
    });
    const r = await blocked.post({ url: 'http://10.0.0.5/' });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('page');
    expect(blocked.calls).toHaveLength(0);
    expect(await blocked.used()).toBe(0);
    await app.close();

    const scripted = await setup(async (url) => ({ bytes: new TextEncoder().encode('<html><body><div id="app"></div></body></html>'), contentType: 'text/html', finalUrl: url }));
    const s = await scripted.post({ url: 'https://example.test/app' });
    expect(s.statusCode).toBe(400);
    expect(s.json().error).toMatch(/scripts/);
    expect(await scripted.used()).toBe(0);
  });

  it('needs AI on the server and a link or text', async () => {
    const t = await setup();
    expect((await t.post({})).statusCode).toBe(400);
    await app.close();
    app = await startApp({}, { anthropic: null });
    const token = await tokenFor(app);
    const r = await app.inject({ method: 'POST', url: '/api/v1/ai/menu-import', headers: { authorization: `Bearer ${token}` }, payload: { url: 'https://x.test' } });
    expect(r.statusCode).toBe(503);
  });
});

describe('page fetch safety', () => {
  it('only treats public unicast addresses as public', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it('rejects non-web schemes, odd ports, credentials and local names', () => {
    expect(() => vetUrl('file:///etc/passwd')).toThrow(PageFetchError);
    expect(() => vetUrl('ftp://example.com/menu.pdf')).toThrow(/http and https/);
    expect(() => vetUrl('http://example.com:8080/')).toThrow(/standard web ports/);
    expect(() => vetUrl('https://user:pw@example.com/')).toThrow(/password/);
    expect(() => vetUrl('http://localhost/')).toThrow(/private or local/);
    expect(() => vetUrl('http://printer.local/')).toThrow(/private or local/);
    expect(() => vetUrl('http://[::1]/')).toThrow(/private or local/);
    expect(() => vetUrl('http://169.254.169.254/latest/meta-data/')).toThrow(/private or local/);
    expect(vetUrl('https://www.example.com/nutrition.pdf').hostname).toBe('www.example.com');
  });
});
