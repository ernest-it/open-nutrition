// AI meal-estimate endpoints with a per-user monthly cap.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AI_MODELS, AiError, MAX_MENU_TEXT_CHARS, checkText, pageFromBytes, type MenuPage } from '@open-nutrition/shared';
import { RateLimiter } from './auth';
import type { Config } from './config';
import type { DB } from './db';
import { aiErrorStatus, toAiError, type MealEstimator } from './llm';
import { PageFetchError, fetchPublicPage } from './pageFetch';

export const AI_BODY_LIMIT = 8 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const estimateBody = z.object({
  imageBase64: z.string().max(AI_BODY_LIMIT).nullish(),
  mediaType: z.enum(MEDIA_TYPES).nullish(),
  description: z.string().max(4000).nullish(),
  model: z.string().max(100).nullish(),
  effort: z.enum(['low', 'medium', 'high']).nullish(),
});

const menuBody = z.object({
  /** A restaurant's nutrition page or PDF (fetched by the server). */
  url: z.string().max(2000).nullish(),
  /** Or the page's text, pasted by the user. */
  text: z.string().max(MAX_MENU_TEXT_CHARS + 1000).nullish(),
  model: z.string().max(100).nullish(),
  effort: z.enum(['low', 'medium', 'high']).nullish(),
});

export interface AiRouteDeps {
  /** Page fetcher (tests inject a fake). */
  fetchPage?: typeof fetchPublicPage;
}

/** Detect the image type from its first bytes (base64). */
export function sniffImageType(b64: string): (typeof MEDIA_TYPES)[number] | null {
  const head = b64.replace(/^data:[^,]*,/, '').trimStart().slice(0, 16);
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBORw0KGgo')) return 'image/png';
  if (head.startsWith('UklGR')) return 'image/webp';
  return null;
}

const month = (ms: number) => new Date(ms).toISOString().slice(0, 7);

export interface AiDeps extends AiRouteDeps {
  db: DB;
  config: Config;
  estimator: MealEstimator | null;
  now?: () => number;
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
}

export function registerAiRoutes(r: FastifyInstance, deps: AiDeps) {
  const { db, config, estimator } = deps;
  const now = deps.now ?? Date.now;
  const limit = config.ai.monthlyLimit;
  // Burst protection on top of the monthly cap.
  const burst = new RateLimiter(30, 60 * 60_000);
  const allowedModels = new Set([...AI_MODELS.map((m) => m.id), config.ai.model]);

  const used = (userId: string) =>
    (db.prepare('SELECT count FROM ai_usage WHERE userId = ? AND month = ?').get(userId, month(now())) as { count: number } | undefined)
      ?.count ?? 0;

  /** Atomically take one slot of the monthly allowance; false when the cap is reached. */
  const reserve = db.transaction((userId: string, m: string): boolean => {
    const row = db.prepare('SELECT count FROM ai_usage WHERE userId = ? AND month = ?').get(userId, m) as { count: number } | undefined;
    if (limit > 0 && (row?.count ?? 0) >= limit) return false;
    db.prepare(
      `INSERT INTO ai_usage (userId, month, count) VALUES (?, ?, 1)
       ON CONFLICT (userId, month) DO UPDATE SET count = count + 1`,
    ).run(userId, m);
    return true;
  });
  const refund = (userId: string, m: string) =>
    db.prepare('UPDATE ai_usage SET count = MAX(0, count - 1) WHERE userId = ? AND month = ?').run(userId, m);
  const record = (userId: string, m: string, o: { inputTokens: number; outputTokens: number; costUsd: number }) =>
    db
      .prepare('UPDATE ai_usage SET inputTokens = inputTokens + ?, outputTokens = outputTokens + ?, costUsd = costUsd + ? WHERE userId = ? AND month = ?')
      .run(o.inputTokens, o.outputTokens, o.costUsd, userId, m);

  r.get('/api/v1/ai/status', async (req) => ({
    enabled: !!estimator,
    models: AI_MODELS.map((m) => m.id),
    defaultModel: config.ai.model,
    defaultEffort: config.ai.effort,
    monthlyLimit: limit,
    usedThisMonth: used(req.user!.id),
  }));

  r.post('/api/v1/ai/estimate', { bodyLimit: AI_BODY_LIMIT }, async (req, reply) => {
    const fail = (e: AiError) => reply.code(aiErrorStatus(e.code)).send({ error: e.message, code: e.code });
    if (!estimator) return fail(new AiError('not_configured', 'AI meal estimates are not enabled on this server.'));
    const parsed = estimateBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation', code: 'validation', issues: parsed.error.issues });
    const b = parsed.data;
    const model = b.model || config.ai.model;
    if (!allowedModels.has(model)) return reply.code(400).send({ error: `unknown model: ${model}`, code: 'validation' });
    const image = b.imageBase64?.trim() || null;
    let mediaType: string | null = null;
    if (image) {
      // Trust the bytes over the declared type (a wrong media_type is a 400 upstream).
      mediaType = sniffImageType(image) ?? b.mediaType ?? null;
      if (!mediaType) return reply.code(400).send({ error: 'image must be JPEG, PNG or WebP', code: 'validation' });
    }
    if (!image && !b.description?.trim()) return fail(new AiError('no_input', 'Add a photo or describe what you ate.'));

    const userId = req.user!.id;
    if (!burst.allow(userId)) return fail(new AiError('rate_limit', 'Too many AI requests. Try again later.'));
    const m = month(now());
    if (!reserve.immediate(userId, m)) {
      return fail(new AiError('limit_reached', `You have used all ${limit} AI estimates for this month.`));
    }
    const started = Date.now();
    try {
      const out = await estimator.estimate({ model, effort: b.effort ?? config.ai.effort, imageBase64: image, mediaType, description: b.description });
      record(userId, m, out);
      deps.log.info({ model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, ms: Date.now() - started }, 'ai estimate');
      return out;
    } catch (e) {
      const err = toAiError(e);
      // Nothing was generated (or billed) for these: give the slot back.
      if (['no_input', 'auth', 'rate_limit', 'overloaded', 'api_error', 'not_configured'].includes(err.code)) refund(userId, m);
      deps.log.warn({ code: err.code, model, ms: Date.now() - started }, 'ai estimate failed');
      return fail(err);
    }
  });

  /**
   * Import from a nutrition page: the user gives a restaurant's nutrition page (URL) or pastes
   * its text; Claude transcribes the menu items. One user-initiated read; nothing is cached or
   * shared between users. Counts as one AI use against the monthly cap.
   */
  r.post('/api/v1/ai/menu-import', { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const fail = (e: AiError) => reply.code(aiErrorStatus(e.code)).send({ error: e.message, code: e.code });
    if (!estimator) return fail(new AiError('not_configured', 'AI features are not enabled on this server.'));
    const parsed = menuBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation', code: 'validation', issues: parsed.error.issues });
    const b = parsed.data;
    const model = b.model || config.ai.model;
    if (!allowedModels.has(model)) return reply.code(400).send({ error: `unknown model: ${model}`, code: 'validation' });
    const userId = req.user!.id;
    if (!burst.allow(userId)) return fail(new AiError('rate_limit', 'Too many AI requests. Try again later.'));

    // Read the page first: a link that cannot be opened costs nothing.
    let page: MenuPage;
    try {
      if (b.text?.trim()) page = checkText(b.text, b.url?.trim() || null);
      else if (b.url?.trim()) {
        const fetched = await (deps.fetchPage ?? fetchPublicPage)(b.url);
        page = pageFromBytes(fetched.bytes, fetched.contentType, fetched.finalUrl);
      } else return fail(new AiError('no_input', 'Paste a link to the restaurant’s nutrition page, or its text.'));
    } catch (e) {
      if (e instanceof PageFetchError) return reply.code(422).send({ error: e.message, code: 'page' });
      if (e instanceof AiError) return fail(e);
      throw e;
    }

    const m = month(now());
    if (!reserve.immediate(userId, m)) return fail(new AiError('limit_reached', `You have used all ${limit} AI requests for this month.`));
    const started = Date.now();
    try {
      const out = await estimator.readMenu({ page, model, effort: b.effort ?? config.ai.effort });
      record(userId, m, out);
      deps.log.info({ model: out.model, items: out.menu.items.length, inputTokens: out.inputTokens, outputTokens: out.outputTokens, ms: Date.now() - started }, 'ai menu import');
      return out;
    } catch (e) {
      const err = toAiError(e);
      if (['no_input', 'auth', 'rate_limit', 'overloaded', 'api_error', 'not_configured'].includes(err.code)) refund(userId, m);
      deps.log.warn({ code: err.code, model, ms: Date.now() - started }, 'ai menu import failed');
      return fail(err);
    }
  });
}
