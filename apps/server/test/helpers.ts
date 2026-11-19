import { buildApp, type AppDeps } from '../src/app';
import { loadConfig, type Config } from '../src/config';

export type App = Awaited<ReturnType<typeof buildApp>>;

/** In-memory app with the real bundled food DB (resolved from the repo). */
export async function startApp(env: NodeJS.ProcessEnv = {}, deps: AppDeps = {}, overrides: Partial<Config> = {}): Promise<App> {
  const app = buildApp({ ...loadConfig(env), databaseFile: ':memory:', logLevel: 'silent', ...overrides }, undefined, deps);
  await app.ready();
  return app;
}

export async function register(app: App, username = 'alice', password = 'correct horse') {
  return app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username, password } });
}

export async function tokenFor(app: App, username = 'alice') {
  return (await register(app, username)).json().token as string;
}

/** fetch() shim that routes NutritionStore requests into fastify.inject. */
export const injectFetch = (app: App) =>
  (async (url: string, init: RequestInit) => {
    const res = await app.inject({
      method: init.method as 'POST',
      url: new URL(url).pathname,
      headers: init.headers as Record<string, string>,
      payload: init.body as string,
    });
    return { ok: res.statusCode < 300, status: res.statusCode, json: async () => res.json() } as Response;
  }) as unknown as typeof fetch;
