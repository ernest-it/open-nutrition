import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { COLLECTION_NAMES, USDA_ATTRIBUTION, diaryToCsv, syncRequestSchema, type DiaryEntry } from '@open-nutrition/shared';
import { z } from 'zod';
import { RateLimiter, createSession, hashPassword, userForToken, verifyPassword, type User } from './auth';
import type { Config } from './config';
import { openDatabase, type DB } from './db';
import { allRows, applyChanges, pullChanges } from './sync';
import { VERSION } from './version';
import { createMealEstimator, type AnthropicClient } from './llm';
import { registerAiRoutes } from './ai';
import { BarcodeError, BarcodeService } from './barcode';
import { BrandedSearch } from './branded';
import type { fetchPublicPage } from './pageFetch';
import { FoodDb, MAX_SEARCH_LIMIT, openFoodDb } from './foods';
import { registerMcp } from './mcp';

export interface AppDeps {
  /** Inject an Anthropic SDK client (tests); `null` disables AI. */
  anthropic?: AnthropicClient | null;
  /** fetch used for Open Food Facts / USDA lookups (tests). */
  fetchImpl?: typeof fetch;
  /** Use this food DB instead of opening `config.foodDbPath`; `null` = none. */
  foodDb?: FoodDb | null;
  now?: () => number;
  /** Outbound Open Food Facts calls per minute (default 10). */
  offPerMinute?: number;
  /** Page fetcher for nutrition-page imports (tests). */
  fetchPage?: typeof fetchPublicPage;
}

export { VERSION };

declare module 'fastify' {
  interface FastifyRequest {
    user?: User & { sessionId: string };
  }
}

const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_.@-]+$/, 'letters, digits and _ . @ - only'),
  password: z.string().min(8).max(256),
  deviceName: z.string().max(100).optional(),
});

export function buildApp(config: Config, db: DB = openDatabase(config.databaseFile), deps: AppDeps = {}) {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    // Small default limit; the few authenticated routes that need large bodies
    // (sync, AI photos) raise it per route. Authentication runs in onRequest, i.e.
    // before any body is read, so anonymous clients can't make us buffer 50 MB.
    bodyLimit: 1024 * 1024,
    trustProxy: config.trustProxy,
  });
  const LARGE_BODY = 50 * 1024 * 1024;
  const authLimiter = new RateLimiter(20, 15 * 60 * 1000);

  // ---- food database, barcode lookups, AI -----------------------------------
  let foodDb: FoodDb | null;
  if (deps.foodDb !== undefined) foodDb = deps.foodDb;
  else {
    const opened = openFoodDb(config.foodDbPath);
    foodDb = opened.db;
    if (opened.error) app.log.warn(`${opened.error}; food search is disabled (set FOOD_DB_PATH)`);
  }
  const barcodes = new BarcodeService({
    db,
    fetchImpl: deps.fetchImpl,
    usdaApiKey: config.usdaApiKey,
    now: deps.now,
    offPerMinute: deps.offPerMinute,
    log: { warn: (m) => app.log.warn(m) },
  });
  const branded = config.usdaApiKey ? new BrandedSearch({ db, apiKey: config.usdaApiKey, fetchImpl: deps.fetchImpl, now: deps.now }) : null;
  const estimator = createMealEstimator(config, deps.anthropic);
  if (config.ai.provider === 'anthropic' && !estimator) app.log.warn('LLM_PROVIDER=anthropic but no LLM_API_KEY/ANTHROPIC_API_KEY is set; AI is disabled');

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data:; " +
        "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : true, credentials: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'internal error' : (err as Error).message });
  });

  const userCount = () => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const registrationOpen = () => config.allowRegistration || userCount() === 0;

  async function requireUser(req: FastifyRequest, reply: FastifyReply) {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    const user = token ? userForToken(db, token) : undefined;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    req.user = user;
  }

  // ---- public ---------------------------------------------------------------
  app.get('/api/v1/health', async () => ({ ok: true }));

  app.get('/api/v1/server-info', async () => ({
    name: 'open-nutrition',
    version: VERSION,
    apiVersion: 1,
    registrationOpen: registrationOpen(),
    serverId: serverId(db),
    foodDb: !!foodDb,
    aiEnabled: !!estimator,
    brandedSearch: !!branded,
  }));

  app.post('/api/v1/auth/register', async (req, reply) => {
    if (!authLimiter.allow(`reg:${req.ip}`)) return reply.code(429).send({ error: 'too many attempts' });
    if (!registrationOpen()) return reply.code(403).send({ error: 'registration is disabled on this server' });
    const body = credentials.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    // Re-check everything synchronously after the (slow) hash so concurrent
    // sign-ups can't both become admin or slip in after registration closes.
    const result = db.transaction(() => {
      if (!registrationOpen()) return { status: 403 as const, error: 'registration is disabled on this server' };
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) return { status: 409 as const, error: 'username already taken' };
      const id = crypto.randomUUID();
      const isAdmin = userCount() === 0 ? 1 : 0;
      db.prepare('INSERT INTO users (id, username, passwordHash, isAdmin, createdAt) VALUES (?, ?, ?, ?, ?)').run(
        id,
        body.username,
        passwordHash,
        isAdmin,
        Date.now(),
      );
      return { status: 201 as const, id, isAdmin };
    }).immediate();
    if (result.status !== 201) return reply.code(result.status).send({ error: result.error });
    const { token } = createSession(db, result.id, body.deviceName ?? 'unknown device');
    return reply.code(201).send({ token, user: { id: result.id, username: body.username, isAdmin: !!result.isAdmin } });
  });

  app.post('/api/v1/auth/login', async (req, reply) => {
    if (!authLimiter.allow(`login:${req.ip}`)) return reply.code(429).send({ error: 'too many attempts' });
    const body = credentials.extend({ password: z.string().min(1).max(256) }).parse(req.body);
    const u = db.prepare('SELECT id, username, passwordHash, isAdmin FROM users WHERE username = ?').get(body.username) as
      | { id: string; username: string; passwordHash: string; isAdmin: number }
      | undefined;
    // Always run a hash to keep timing similar for unknown users.
    const ok = u
      ? await verifyPassword(body.password, u.passwordHash)
      : (await hashPassword(body.password), false);
    if (!u || !ok) return reply.code(401).send({ error: 'invalid username or password' });
    const { token } = createSession(db, u.id, body.deviceName ?? 'unknown device');
    return { token, user: { id: u.id, username: u.username, isAdmin: !!u.isAdmin } };
  });

  // ---- authenticated --------------------------------------------------------
  app.register(async (r) => {
    r.addHook('onRequest', requireUser);

    r.get('/api/v1/me', async (req) => ({
      id: req.user!.id,
      username: req.user!.username,
      isAdmin: !!req.user!.isAdmin,
    }));

    r.post('/api/v1/auth/logout', async (req) => {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(req.user!.sessionId);
      return { ok: true };
    });

    r.post('/api/v1/auth/password', async (req, reply) => {
      const body = z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(256) }).parse(req.body);
      const u = db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(req.user!.id) as { passwordHash: string };
      if (!(await verifyPassword(body.currentPassword, u.passwordHash)))
        return reply.code(401).send({ error: 'current password is wrong' });
      db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(await hashPassword(body.newPassword), req.user!.id);
      db.prepare('DELETE FROM sessions WHERE userId = ? AND id != ?').run(req.user!.id, req.user!.sessionId);
      return { ok: true };
    });

    r.get('/api/v1/sessions', async (req) =>
      (
        db.prepare('SELECT id, name, createdAt, lastUsedAt FROM sessions WHERE userId = ? ORDER BY lastUsedAt DESC').all(
          req.user!.id,
        ) as { id: string }[]
      ).map((s) => ({ ...s, current: s.id === req.user!.sessionId })),
    );

    r.delete<{ Params: { id: string } }>('/api/v1/sessions/:id', async (req) => {
      db.prepare('DELETE FROM sessions WHERE id = ? AND userId = ?').run(req.params.id, req.user!.id);
      return { ok: true };
    });

    /** Long-lived API token, e.g. for scripts or an MCP client. */
    r.post('/api/v1/tokens', async (req) => {
      const body = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
      return createSession(db, req.user!.id, `token: ${body.name}`);
    });

    r.post('/api/v1/sync', { bodyLimit: LARGE_BODY }, async (req) => {
      const body = syncRequestSchema.parse(req.body);
      const { rejected } = applyChanges(db, req.user!.id, body.changes);
      const pulled = pullChanges(db, req.user!.id, body.since);
      return { ...pulled, rejected };
    });

    // ---- foods ---------------------------------------------------------------
    r.get<{ Querystring: { q?: string; limit?: string } }>('/api/v1/foods/search', async (req, reply) => {
      if (!foodDb) return reply.code(503).send({ error: 'the food database is not available on this server' });
      const q = (req.query.q ?? '').slice(0, 200);
      const limit = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Number(req.query.limit) || 20));
      return { foods: foodDb.search(q, limit) };
    });

    /** Packaged foods from USDA FoodData Central (Branded); 404 when the server has no USDA key. */
    r.get<{ Querystring: { q?: string } }>('/api/v1/foods/branded', async (req, reply) => {
      if (!branded) return reply.code(404).send({ error: 'packaged-food search is not enabled on this server (set USDA_API_KEY)' });
      try {
        return { foods: await branded.search(req.query.q ?? ''), attribution: USDA_ATTRIBUTION };
      } catch (e) {
        if (e instanceof BarcodeError) {
          if (e.retryAfterSeconds) reply.header('retry-after', String(e.retryAfterSeconds));
          return reply.code(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    });

    r.get<{ Params: { code: string } }>('/api/v1/foods/barcode/:code', async (req, reply) => {
      try {
        const found = await barcodes.lookup(req.params.code);
        return { food: found.food, source: found.source, attribution: found.attribution };
      } catch (e) {
        if (e instanceof BarcodeError) {
          if (e.retryAfterSeconds) reply.header('retry-after', String(e.retryAfterSeconds));
          return reply.code(e.statusCode).send({ error: e.message });
        }
        throw e;
      }
    });

    r.get<{ Params: { id: string } }>('/api/v1/foods/:id', async (req, reply) => {
      if (!foodDb) return reply.code(503).send({ error: 'the food database is not available on this server' });
      const food = foodDb.byId(req.params.id);
      if (!food) return reply.code(404).send({ error: 'food not found' });
      return { food };
    });

    // ---- AI --------------------------------------------------------------------
    registerAiRoutes(r, {
      db,
      config,
      estimator,
      now: deps.now,
      fetchPage: deps.fetchPage,
      log: { info: (o, m) => app.log.info(o, m), warn: (o, m) => app.log.warn(o, m) },
    });

    // ---- export ------------------------------------------------------------------
    r.get('/api/v1/export/diary.csv', async (req, reply) => {
      const csv = diaryToCsv(allRows(db, req.user!.id, 'diaryEntries') as DiaryEntry[]);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="open-nutrition-diary-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(csv);
    });

    /** Full JSON backup of everything the user owns (re-importable via /sync). */
    r.get('/api/v1/export/json', async (req, reply) => {
      const data: Record<string, unknown[]> = {};
      for (const c of COLLECTION_NAMES) data[c] = allRows(db, req.user!.id, c);
      return reply
        .header('content-disposition', `attachment; filename="open-nutrition-${new Date().toISOString().slice(0, 10)}.json"`)
        .send({ format: 'open-nutrition-backup', version: 1, exportedAt: Date.now(), data });
    });

    /** Delete the account and all its data. Requires the password, not just a token. */
    r.delete('/api/v1/me', async (req, reply) => {
      const body = z.object({ password: z.string().min(1).max(256) }).parse(req.body ?? {});
      const u = db.prepare('SELECT passwordHash FROM users WHERE id = ?').get(req.user!.id) as { passwordHash: string };
      if (!(await verifyPassword(body.password, u.passwordHash))) return reply.code(401).send({ error: 'password is wrong' });
      db.prepare('DELETE FROM users WHERE id = ?').run(req.user!.id);
      return { ok: true };
    });
  });

  // ---- MCP (for AI assistants) ---------------------------------------------
  registerMcp(app, db, foodDb, requireUser);

  // ---- web UI ---------------------------------------------------------------
  if (config.webDir && fs.existsSync(path.join(config.webDir, 'index.html'))) {
    app.register(fastifyStatic, { root: path.resolve(config.webDir), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/mcp')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }

  app.addHook('onClose', async () => {
    db.close();
    // Only close a food DB we opened ourselves.
    if (deps.foodDb === undefined) foodDb?.close();
  });
  return app;
}

function serverId(db: DB): string {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'serverId'`).get() as { value: string } | undefined;
  if (row) return row.value;
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO meta (key, value) VALUES ('serverId', ?)`).run(id);
  return id;
}
