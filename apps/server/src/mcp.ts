// Read-only Model Context Protocol (MCP) server over Streamable HTTP at /mcp.
//
// Lets any MCP-capable assistant (Claude Desktop, Claude Code, other clients)
// explore your food diary with tools, authenticated by an API token created in
// Settings. Stateless JSON responses, no server-sent events.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CORE_NUTRIENTS,
  DEFAULT_PREFS,
  MEALS,
  N,
  NUTRIENTS,
  NUTRIENT_BY_KEY,
  SETTING_PREFS,
  addDays,
  dayOf,
  fromKg,
  isLimit,
  mealIndex,
  sumNutrients,
  todayLocal,
  weeklyRate,
  weightTrend,
  type DiaryEntry,
  type Food,
  type Measurement,
  type NutrientMap,
  type Prefs,
  type Setting,
  type Target,
} from '@open-nutrition/shared';
import type { DB } from './db';
import type { FoodDb } from './foods';
import { allRows } from './sync';
import { VERSION } from './version';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const MAX_RANGE_DAYS = 366;

/** Lazily loaded data for one user (each tool reads only what it needs). */
class UserData {
  private cache = new Map<string, unknown[]>();
  constructor(
    private db: DB,
    private userId: string,
  ) {}
  private rows<T>(c: Parameters<typeof allRows>[2]): T[] {
    if (!this.cache.has(c)) this.cache.set(c, allRows(this.db, this.userId, c));
    return this.cache.get(c) as T[];
  }
  get entries() {
    return this.rows<DiaryEntry>('diaryEntries');
  }
  get targets() {
    return this.rows<Target>('targets').sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }
  get measurements() {
    return this.rows<Measurement>('measurements');
  }
  get foods() {
    return this.rows<Food>('foods');
  }
  get prefs(): Prefs {
    const s = this.rows<Setting>('settings').find((x) => x.id === SETTING_PREFS);
    try {
      return { ...DEFAULT_PREFS, ...(s ? (JSON.parse(s.value) as Partial<Prefs>) : {}) };
    } catch {
      return DEFAULT_PREFS;
    }
  }
  targetsOn(day: string): Target | undefined {
    let t: Target | undefined;
    for (const x of this.targets) if (x.effectiveFrom <= day) t = x;
    return t;
  }
  entriesOn(day: string) {
    return this.entries
      .filter((e) => e.date === day)
      .sort((a, b) => mealIndex(a.meal) - mealIndex(b.meal) || a.position - b.position || a.loggedAt - b.loggedAt);
  }
  waterOn(day: string) {
    return this.measurements.filter((m) => m.kind === 'water' && dayOf(m.takenAt) === day).reduce((a, m) => a + m.value, 0);
  }
}

interface Ctx {
  u: UserData;
  foodDb: FoodDb | null;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  args: z.ZodType;
  run: (ctx: Ctx, args: never) => string;
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : (+v.toFixed(1)).toString());
const amount = (key: string, v: number | undefined) => {
  const d = NUTRIENT_BY_KEY[key];
  return v == null ? '-' : `${fmt(v)} ${d?.unit ?? ''}`.trim();
};

/** Resolve nutrient names or numbers ("protein", "fibre", "307") to keys. */
function resolveNutrients(refs: string[] | undefined): string[] {
  if (!refs?.length) return CORE_NUTRIENTS.map((n) => n.key);
  const out: string[] = [];
  for (const r of refs) {
    const q = r.trim().toLowerCase().replace('fiber', 'fibre').replace(/^calories?$|^energy$|^kcal$/, 'calories');
    const n = NUTRIENTS.find((x) => x.key === q || x.name.toLowerCase() === q) ?? NUTRIENTS.find((x) => x.name.toLowerCase().includes(q));
    if (n && !out.includes(n.key)) out.push(n.key);
  }
  return out.length ? out : CORE_NUTRIENTS.map((n) => n.key);
}

function nutrientLine(key: string, value: number | undefined, target: number | undefined) {
  const d = NUTRIENT_BY_KEY[key]!;
  let s = `- ${d.name}: ${amount(key, value ?? 0)}`;
  if (target != null && target > 0) {
    const pct = Math.round(((value ?? 0) / target) * 100);
    s += ` of ${amount(key, target)} ${isLimit(key) ? 'limit' : 'target'} (${pct}%)`;
  }
  return s;
}

const NUTRIENTS_PROP = {
  type: 'array',
  items: { type: 'string' },
  description: 'Nutrient names or USDA numbers, e.g. ["protein", "fibre", "sodium"]. Default: the core nutrients.',
};

const TOOLS: Tool[] = [
  {
    name: 'get_day',
    description:
      "One day of the food diary: every entry by meal (name, amount, calories and macros), the day's totals compared with the user's targets, and water. Dates are the user's local calendar days.",
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD (default: today on the server).' },
        nutrients: NUTRIENTS_PROP,
      },
      additionalProperties: false,
    },
    args: z.object({ date: dateStr.optional(), nutrients: z.array(z.string()).max(40).optional() }),
    run: ({ u }, a: { date?: string; nutrients?: string[] }) => {
      const day = a.date ?? todayLocal();
      const entries = u.entriesOn(day);
      const keys = resolveNutrients(a.nutrients);
      const t = u.targetsOn(day);
      const lines = [`# ${day}`];
      if (!entries.length) lines.push('No food logged on this day.');
      for (const meal of MEALS) {
        const list = entries.filter((e) => e.meal === meal);
        if (!list.length) continue;
        const kcal = sumNutrients(list.map((e) => e.nutrients))[N.energy] ?? 0;
        lines.push('', `## ${meal} (${Math.round(kcal)} kcal)`);
        for (const e of list) {
          const portion = e.servingLabel ? `${fmt(e.quantity)} × ${e.servingLabel}` : e.grams != null ? `${fmt(e.grams)} g` : 'quick add';
          const n = e.nutrients;
          lines.push(
            `- ${e.name} · ${portion} · ${Math.round(n[N.energy] ?? 0)} kcal · P ${fmt(n[N.protein] ?? 0)} g · C ${fmt(n[N.carbs] ?? 0)} g · F ${fmt(n[N.fat] ?? 0)} g`,
          );
        }
      }
      const totals = sumNutrients(entries.map((e) => e.nutrients));
      lines.push('', `## Totals${t ? ` vs targets (effective ${t.effectiveFrom})` : ' (no targets set)'}`);
      for (const k of keys) lines.push(nutrientLine(k, totals[k], t?.nutrients[k]));
      const water = u.waterOn(day);
      if (water || t?.waterMl) lines.push(`- Water: ${Math.round(water)} ml${t?.waterMl ? ` of ${Math.round(t.waterMl)} ml` : ''}`);
      return lines.join('\n');
    },
  },
  {
    name: 'get_range_summary',
    description:
      'Daily averages over a date range (e.g. "average protein this month"), compared with average targets. Averages are over days that have any food logged; unlogged days are reported separately. Also lists the top foods for the first requested nutrient.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date, YYYY-MM-DD (inclusive).' },
        to: { type: 'string', description: 'End date, YYYY-MM-DD (inclusive, default today).' },
        nutrients: NUTRIENTS_PROP,
      },
      required: ['from'],
      additionalProperties: false,
    },
    args: z.object({ from: dateStr, to: dateStr.optional(), nutrients: z.array(z.string()).max(40).optional() }),
    run: ({ u }, a: { from: string; to?: string; nutrients?: string[] }) => {
      const to = a.to ?? todayLocal();
      if (to < a.from) return '`to` is before `from`.';
      const days: string[] = [];
      for (let d = a.from; d <= to && days.length < MAX_RANGE_DAYS; d = addDays(d, 1)) days.push(d);
      const keys = resolveNutrients(a.nutrients);
      const inRange = u.entries.filter((e) => e.date >= a.from && e.date <= days[days.length - 1]!);
      const byDay = new Map<string, NutrientMap[]>();
      for (const e of inRange) (byDay.get(e.date) ?? byDay.set(e.date, []).get(e.date)!).push(e.nutrients);
      const logged = days.filter((d) => byDay.has(d));
      const lines = [
        `# ${days[0]} to ${days[days.length - 1]}${days.length >= MAX_RANGE_DAYS ? ` (capped at ${MAX_RANGE_DAYS} days)` : ''}`,
        `Days in range: ${days.length}; days with food logged: ${logged.length}.`,
      ];
      if (!logged.length) return [...lines, 'No food logged in this range.'].join('\n');
      const dayTotals = logged.map((d) => sumNutrients(byDay.get(d)!));
      const avg = (k: string) => dayTotals.reduce((s, t) => s + (t[k] ?? 0), 0) / logged.length;
      const avgTarget = (k: string) => {
        const vals = logged.map((d) => u.targetsOn(d)?.nutrients[k]).filter((v): v is number => v != null);
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : undefined;
      };
      lines.push('', '## Daily average (logged days)');
      for (const k of keys) {
        const values = dayTotals.map((t) => t[k] ?? 0);
        lines.push(`${nutrientLine(k, avg(k), avgTarget(k))} · range ${amount(k, Math.min(...values))}–${amount(k, Math.max(...values))}`);
      }
      const k0 = keys[0]!;
      const by = new Map<string, number>();
      for (const e of inRange) by.set(e.name, (by.get(e.name) ?? 0) + (e.nutrients[k0] ?? 0));
      const total = [...by.values()].reduce((s, v) => s + v, 0);
      const top = [...by.entries()].filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 10);
      if (top.length) {
        lines.push('', `## Top sources of ${NUTRIENT_BY_KEY[k0]!.name.toLowerCase()}`);
        for (const [name, v] of top) lines.push(`- ${name}: ${amount(k0, v)} (${Math.round((v / total) * 100)}%)`);
      }
      return lines.join('\n');
    },
  },
  {
    name: 'search_foods',
    description:
      "Search foods: the user's own saved foods (custom, scanned, AI) and the bundled USDA database. Shows calories and macros per 100 g and common servings.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'e.g. "greek yogurt" or "chicken breast cooked".' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 10.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    args: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(10) }),
    run: ({ u, foodDb }, a: { query: string; limit: number }) => {
      const q = a.query.trim().toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      const mine = u.foods
        .filter((f) => words.every((w) => `${f.name} ${f.brand ?? ''}`.toLowerCase().includes(w)))
        .sort((x, y) => Number(y.favorite) - Number(x.favorite) || x.name.length - y.name.length)
        .slice(0, a.limit);
      const usda = foodDb ? foodDb.search(a.query, a.limit) : [];
      const line = (f: Food) => {
        const n = f.nutrients;
        const servings = f.servings.filter((s) => s.label !== '100 g').slice(0, 3).map((s) => `${s.label} = ${fmt(s.grams)} g`);
        return `- ${f.name}${f.brand ? ` (${f.brand})` : ''} · per 100 g: ${Math.round(n[N.energy] ?? 0)} kcal, P ${fmt(n[N.protein] ?? 0)} g, C ${fmt(n[N.carbs] ?? 0)} g, F ${fmt(n[N.fat] ?? 0)} g${servings.length ? ` · ${servings.join('; ')}` : ''} [id: ${f.id}]`;
      };
      const lines: string[] = [];
      if (mine.length) lines.push("## User's foods", ...mine.map(line));
      if (usda.length) lines.push(...(lines.length ? [''] : []), '## USDA database', ...usda.map(line));
      if (!foodDb) lines.push('(The bundled USDA database is not available on this server.)');
      return lines.length ? lines.join('\n') : 'No foods match.';
    },
  },
  {
    name: 'get_weight_trend',
    description: "Body weight over time in the user's unit: recent weigh-ins, the 7-day moving average, and the rate of change per week.",
    inputSchema: {
      type: 'object',
      properties: { days: { type: 'integer', minimum: 7, maximum: 3650, description: 'How far back to look (default 90).' } },
      additionalProperties: false,
    },
    args: z.object({ days: z.number().int().min(7).max(3650).default(90) }),
    run: ({ u }, a: { days: number }) => {
      const unit = u.prefs.weightUnit;
      const since = Date.now() - a.days * 86_400_000;
      const all = u.measurements.filter((m) => m.kind === 'body_weight').sort((x, y) => x.takenAt - y.takenAt);
      const pts = all.filter((m) => m.takenAt >= since);
      if (!pts.length) return all.length ? `No weigh-ins in the last ${a.days} days (last one: ${dayOf(all[all.length - 1]!.takenAt)}).` : 'No body weight recorded.';
      const w = (kg: number) => `${+fromKg(kg, unit).toFixed(1)} ${unit}`;
      const trend = weightTrend(all, 7).filter((p) => p.takenAt >= since);
      const rate = weeklyRate(pts);
      const first = trend[0]!;
      const last = trend[trend.length - 1]!;
      const lines = [
        `# Body weight, last ${a.days} days (${pts.length} weigh-ins)`,
        `Latest: ${w(last.value)} on ${dayOf(last.takenAt)}; 7-day average ${w(last.trend)}.`,
        `Trend change: ${w(last.trend - first.trend).replace(/^(?!-)/, '+')} since ${dayOf(first.takenAt)}.`,
        `Rate: ${rate == null ? 'not enough data' : `${w(rate).replace(/^(?!-)/, '+')} per week`}.`,
        '',
        '## Weigh-ins (newest first)',
        ...trend
          .slice(-30)
          .reverse()
          .map((p) => `- ${dayOf(p.takenAt)}: ${w(p.value)} (7-day avg ${w(p.trend)})`),
      ];
      return lines.join('\n');
    },
  },
];

type JsonRpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

function rpcResult(id: JsonRpc['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}
function rpcError(id: JsonRpc['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export function handleRpc(db: DB, foodDb: FoodDb | null, userId: string, msg: JsonRpc) {
  switch (msg.method) {
    case 'initialize': {
      const requested = String(msg.params?.protocolVersion ?? '');
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'open-nutrition', title: 'Open Nutrition', version: VERSION },
        instructions:
          "Read-only access to the user's food diary, targets and body weight. Use get_day for one day, get_range_summary for averages over a period, search_foods to look up foods, and get_weight_trend for weight. Nutrient amounts use USDA units (kcal, g, mg, µg).",
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: true, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      const args = tool.args.safeParse(msg.params?.arguments ?? {});
      if (!args.success) {
        return rpcResult(msg.id, { content: [{ type: 'text', text: `Invalid arguments: ${args.error.message}` }], isError: true });
      }
      const text = tool.run({ u: new UserData(db, userId), foodDb }, args.data as never);
      return rpcResult(msg.id, { content: [{ type: 'text', text }], isError: false });
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export function registerMcp(
  app: FastifyInstance,
  db: DB,
  foodDb: FoodDb | null,
  authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  app.post('/mcp', { onRequest: authenticate }, async (req, reply) => {
    const body = req.body as JsonRpc | JsonRpc[];
    const msgs = Array.isArray(body) ? body : [body];
    if (!msgs.length || msgs.some((m) => !m || m.jsonrpc !== '2.0' || typeof m.method !== 'string')) {
      return reply.code(400).send(rpcError(null, -32600, 'Invalid JSON-RPC request'));
    }
    // Notifications (no id) are acknowledged without a body.
    const responses = msgs.filter((m) => m.id !== undefined).map((m) => handleRpc(db, foodDb, req.user!.id, m));
    if (!responses.length) return reply.code(202).send();
    return reply.header('content-type', 'application/json').send(Array.isArray(body) ? responses : responses[0]);
  });
  // Stateless server: no server-initiated SSE stream and no sessions to delete.
  app.get('/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send());
  app.delete('/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send());
}
