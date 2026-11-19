import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AI_MODEL, type AiEffort } from '@open-nutrition/shared';

export interface Config {
  host: string;
  port: number;
  databaseFile: string;
  webDir: string | null;
  allowRegistration: boolean;
  trustProxy: boolean;
  corsOrigins: string[];
  logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug';
  /** Bundled USDA food database (read-only SQLite). */
  foodDbPath: string;
  /** Optional FoodData Central API key for the branded-food barcode fallback. */
  usdaApiKey: string | null;
  ai: {
    /** AI meal estimates are Anthropic-only for now. */
    provider: 'anthropic' | null;
    /** LLM_API_KEY or ANTHROPIC_API_KEY. Never logged. */
    apiKey: string | null;
    model: string;
    effort: AiEffort;
    /** Estimates per user per calendar month (UTC); 0 = unlimited. */
    monthlyLimit: number;
  };
}

const bool = (v: string | undefined, d: boolean) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

/**
 * Default food DB location: the repo's apps/mobile/assets/foods.db. Both the
 * source (apps/server/src/config.ts) and the bundle (apps/server/dist/index.js)
 * sit two levels below apps/server, so the repo root is three levels up.
 */
export function defaultFoodDbPath(): string {
  const candidates: string[] = [];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, '../../../apps/mobile/assets/foods.db'));
  } catch {
    /* not a file: URL (e.g. bundled differently) */
  }
  candidates.push(path.resolve('apps/mobile/assets/foods.db'), path.resolve('../mobile/assets/foods.db'));
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]!;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.DATA_DIR ?? path.resolve('data');
  const effort = env.LLM_EFFORT ?? 'low';
  const limit = Number(env.AI_MONTHLY_LIMIT ?? 0);
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8080),
    databaseFile: env.DATABASE_FILE ?? path.join(dataDir, 'open-nutrition.db'),
    webDir: env.WEB_DIR ?? null,
    // The very first account can always be created (and becomes admin).
    allowRegistration: bool(env.ALLOW_REGISTRATION, false),
    trustProxy: bool(env.TRUST_PROXY, false),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    logLevel: (env.LOG_LEVEL as Config['logLevel']) ?? 'info',
    foodDbPath: env.FOOD_DB_PATH || defaultFoodDbPath(),
    usdaApiKey: env.USDA_API_KEY || null,
    ai: {
      provider: env.LLM_PROVIDER === 'anthropic' ? 'anthropic' : null,
      apiKey: env.LLM_API_KEY || env.ANTHROPIC_API_KEY || null,
      model: env.LLM_MODEL || DEFAULT_AI_MODEL,
      effort: effort === 'low' || effort === 'medium' || effort === 'high' ? effort : 'low',
      monthlyLimit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0,
    },
  };
}
