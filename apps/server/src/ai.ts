// AI endpoints (meal estimates, menu import) and everything that keeps them from running up a bill.
//
// The server owner pays for every request, so each one passes these gates, in order:
//   1. sign-in (all /api/v1 routes) and a per-user burst limit (30 attempts an hour);
//   2. one AI request per user at a time, and a small number across the whole server;
//   3. the server-wide monthly budget in USD, checked against what was spent plus the worst
//      case of every request still running;
//   4. the per-user daily and monthly request caps.
// One user action makes one upstream request: nothing here or in llm.ts retries. The single
// bounded exception lives in runMealEstimate (@open-nutrition/shared).

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  AI_MODELS,
  AiError,
  MAX_MENU_TEXT_CHARS,
  WEB_SEARCH_MAX_USES,
  checkText,
  pageFromBytes,
  usageCostUsd,
  worstCaseCostUsd,
  type AiWebSearch,
  type MenuPage,
} from '@open-nutrition/shared';
import { RateLimiter } from './auth';
import type { Config } from './config';
import type { DB } from './db';
import { ESTIMATE_MAX_TOKENS, MENU_MAX_TOKENS, aiErrorStatus, toAiError, type MealEstimator } from './llm';
import { PageFetchError, fetchPublicPage } from './pageFetch';

export const AI_BODY_LIMIT = 8 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const estimateBody = z.object({
  imageBase64: z.string().max(AI_BODY_LIMIT).nullish(),
  mediaType: z.enum(MEDIA_TYPES).nullish(),
  description: z.string().max(4000).nullish(),
  model: z.string().max(100).nullish(),
  effort: z.enum(['low', 'medium', 'high']).nullish(),
  /** 'auto' (default): look up brand-name items. 'always': search for every meal. 'off': never. */
  webSearch: z.enum(['off', 'auto', 'always']).nullish(),
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
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface AiDeps extends AiRouteDeps {
  db: DB;
  config: Config;
  estimator: MealEstimator | null;
  now?: () => number;
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
}

/** Errors where the Anthropic API never ran the request, so nothing was billed. */
const unbilled = (e: AiError) => !e.usage && (e.httpStatus != null || e.code === 'no_input' || e.code === 'not_configured');

export function registerAiRoutes(r: FastifyInstance, deps: AiDeps) {
  const { db, config, estimator } = deps;
  const now = deps.now ?? Date.now;
  const { monthlyLimit, dailyLimit, monthlyBudgetUsd: budget } = config.ai;
  // Burst protection on top of the caps: counts every attempt, including failed ones.
  const burst = new RateLimiter(30, 60 * 60_000);
  const allowedModels = new Set([...AI_MODELS.map((m) => m.id), config.ai.model]);

  /** Users with a request running, and the worst-case cost of everything running. */
  const running = new Set<string>();
  let pendingUsd = 0;

  const usedMonth = (userId: string, m: string) =>
    (db.prepare('SELECT count FROM ai_usage WHERE userId = ? AND month = ?').get(userId, m) as { count: number } | undefined)?.count ?? 0;
  const usedDay = (userId: string, d: string) =>
    (db.prepare('SELECT count FROM ai_daily WHERE userId = ? AND day = ?').get(userId, d) as { count: number } | undefined)?.count ?? 0;
  const spent = (m: string) => (db.prepare('SELECT COALESCE(SUM(costUsd), 0) AS usd FROM ai_usage WHERE month = ?').get(m) as { usd: number }).usd;

  /** Atomically take one request from the daily and monthly allowances; names the cap that is full. */
  const reserve = db.transaction((userId: string, m: string, d: string): 'ok' | 'month' | 'day' => {
    if (monthlyLimit > 0 && usedMonth(userId, m) >= monthlyLimit) return 'month';
    if (dailyLimit > 0 && usedDay(userId, d) >= dailyLimit) return 'day';
    db.prepare(`INSERT INTO ai_usage (userId, month, count) VALUES (?, ?, 1) ON CONFLICT (userId, month) DO UPDATE SET count = count + 1`).run(userId, m);
    db.prepare(`INSERT INTO ai_daily (userId, day, count) VALUES (?, ?, 1) ON CONFLICT (userId, day) DO UPDATE SET count = count + 1`).run(userId, d);
    return 'ok';
  });
  const refund = (userId: string, m: string, d: string) => {
    db.prepare('UPDATE ai_usage SET count = MAX(0, count - 1) WHERE userId = ? AND month = ?').run(userId, m);
    db.prepare('UPDATE ai_daily SET count = MAX(0, count - 1) WHERE userId = ? AND day = ?').run(userId, d);
  };
  const record = (userId: string, m: string, o: { inputTokens: number; outputTokens: number; costUsd: number }) =>
    db
      .prepare(
        `INSERT INTO ai_usage (userId, month, count, inputTokens, outputTokens, costUsd) VALUES (?, ?, 0, ?, ?, ?)
         ON CONFLICT (userId, month) DO UPDATE SET inputTokens = inputTokens + excluded.inputTokens,
           outputTokens = outputTokens + excluded.outputTokens, costUsd = costUsd + excluded.costUsd`,
      )
      .run(userId, m, o.inputTokens, o.outputTokens, o.costUsd);

  const fail = (reply: FastifyReply, e: AiError) => reply.code(aiErrorStatus(e.code)).send({ error: e.message, code: e.code });

  /**
   * Take the per-user and server-wide running slots. Synchronous, so two requests arriving
   * together cannot both pass. Returns an error to send, or a function that gives the slots back.
   */
  function enter(userId: string): AiError | (() => void) {
    if (!burst.allow(userId)) return new AiError('rate_limit', 'Too many AI requests. Try again later.');
    if (running.has(userId)) return new AiError('rate_limit', 'Your previous AI request is still running. Wait for it to finish.');
    if (running.size >= config.ai.maxConcurrent) return new AiError('overloaded', 'The server is busy with other AI requests. Try again in a minute.');
    running.add(userId);
    return () => void running.delete(userId);
  }

  /**
   * Run one billed request for a user who already holds a slot (see `enter`): budget and caps
   * first, then `run`, then the bookkeeping whether it worked or not.
   */
  async function charge<T extends { model: string; inputTokens: number; outputTokens: number; costUsd: number }>(
    reply: FastifyReply,
    o: { userId: string; kind: string; model: string; worstUsd: number },
    run: () => Promise<T>,
  ): Promise<T | FastifyReply> {
    const t = now();
    const m = month(t);
    const d = dayOf(t);
    if (budget > 0 && spent(m) + pendingUsd + o.worstUsd > budget) {
      deps.log.warn({ budgetUsd: budget, spentUsd: spent(m) }, 'ai budget reached');
      return fail(reply, new AiError('limit_reached', 'This server has used its AI budget for this month. It resets on the 1st.'));
    }
    const slot = reserve.immediate(o.userId, m, d);
    if (slot === 'month') return fail(reply, new AiError('limit_reached', `You have used all ${monthlyLimit} AI requests for this month.`));
    if (slot === 'day') return fail(reply, new AiError('limit_reached', `You have used all ${dailyLimit} AI requests for today. Try again tomorrow.`));
    pendingUsd += o.worstUsd;
    const started = Date.now();
    try {
      const out = await run();
      record(o.userId, m, out);
      deps.log.info({ kind: o.kind, model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd, ms: Date.now() - started }, 'ai request');
      return out;
    } catch (e) {
      const err = toAiError(e);
      // An answer that came back unusable was still billed: count what it cost.
      if (err.usage) record(o.userId, m, { inputTokens: err.usage.inputTokens, outputTokens: err.usage.outputTokens, costUsd: usageCostUsd(o.model, err.usage) });
      // Only give the request back when the API never ran it. A timeout may have been billed, so it stays counted.
      if (unbilled(err)) refund(o.userId, m, d);
      deps.log.warn({ kind: o.kind, code: err.code, model: o.model, ms: Date.now() - started }, 'ai request failed');
      return fail(reply, err);
    } finally {
      pendingUsd = Math.max(0, pendingUsd - o.worstUsd);
    }
  }

  r.get('/api/v1/ai/status', async (req) => {
    const t = now();
    return {
      enabled: !!estimator,
      models: AI_MODELS.map((m) => m.id),
      defaultModel: config.ai.model,
      defaultEffort: config.ai.effort,
      monthlyLimit,
      usedThisMonth: usedMonth(req.user!.id, month(t)),
      dailyLimit,
      usedToday: usedDay(req.user!.id, dayOf(t)),
      webSearch: !!estimator && config.ai.webSearch,
      // What the whole server has spent is the owner's business only.
      ...(req.user!.isAdmin ? { monthlyBudgetUsd: budget, spentThisMonthUsd: spent(month(t)) } : {}),
    };
  });

  r.post('/api/v1/ai/estimate', { bodyLimit: AI_BODY_LIMIT }, async (req, reply) => {
    if (!estimator) return fail(reply, new AiError('not_configured', 'AI meal estimates are not enabled on this server.'));
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
    if (!image && !b.description?.trim()) return fail(reply, new AiError('no_input', 'Add a photo or describe what you ate.'));

    // The server decides whether searching is allowed and how much; the client only chooses the mode.
    const webSearch: AiWebSearch = config.ai.webSearch ? (b.webSearch ?? 'auto') : 'off';
    const maxSearches = webSearch === 'off' ? 0 : Math.min(config.ai.maxSearches, WEB_SEARCH_MAX_USES[webSearch]);

    const userId = req.user!.id;
    const leave = enter(userId);
    if (leave instanceof AiError) return fail(reply, leave);
    try {
      return await charge(
        reply,
        // Worst case: the whole output allowance, the photo and prompt, and every search with its results.
        { userId, kind: 'estimate', model, worstUsd: worstCaseCostUsd(model, ESTIMATE_MAX_TOKENS, 10_000 + maxSearches * 20_000, maxSearches) },
        () => estimator.estimate({ model, effort: b.effort ?? config.ai.effort, imageBase64: image, mediaType, description: b.description, webSearch, maxSearches }),
      );
    } finally {
      leave();
    }
  });

  /**
   * Import from a nutrition page: the user gives a restaurant's nutrition page (URL) or pastes
   * its text; Claude transcribes the menu items. One user-initiated read; nothing is cached or
   * shared between users. Counts as one AI request against the caps.
   */
  r.post('/api/v1/ai/menu-import', { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    if (!estimator) return fail(reply, new AiError('not_configured', 'AI features are not enabled on this server.'));
    const parsed = menuBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'validation', code: 'validation', issues: parsed.error.issues });
    const b = parsed.data;
    const model = b.model || config.ai.model;
    if (!allowedModels.has(model)) return reply.code(400).send({ error: `unknown model: ${model}`, code: 'validation' });
    const userId = req.user!.id;
    const leave = enter(userId);
    if (leave instanceof AiError) return fail(reply, leave);
    try {
      // Read the page first: a link that cannot be opened costs nothing.
      let page: MenuPage;
      try {
        if (b.text?.trim()) page = checkText(b.text, b.url?.trim() || null);
        else if (b.url?.trim()) {
          const fetched = await (deps.fetchPage ?? fetchPublicPage)(b.url);
          page = pageFromBytes(fetched.bytes, fetched.contentType, fetched.finalUrl);
        } else return fail(reply, new AiError('no_input', 'Paste a link to the restaurant’s nutrition page, or its text.'));
      } catch (e) {
        if (e instanceof PageFetchError) return reply.code(422).send({ error: e.message, code: 'page' });
        if (e instanceof AiError) return fail(reply, e);
        throw e;
      }
      return await charge(
        reply,
        // Worst case: the whole output allowance plus the largest page the import accepts.
        { userId, kind: 'menu-import', model, worstUsd: worstCaseCostUsd(model, MENU_MAX_TOKENS, 150_000) },
        () => estimator.readMenu({ page, model, effort: b.effort ?? config.ai.effort }),
      );
    } finally {
      leave();
    }
  });
}
