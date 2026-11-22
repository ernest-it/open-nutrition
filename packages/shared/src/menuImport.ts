// "Import from a nutrition page": the user points the app at a restaurant's own nutrition page
// (HTML or PDF) or pastes its text, Claude transcribes the menu items, and the user picks which
// ones to save as their own foods. Nothing is crawled, cached or shared: each import is one
// user-initiated read of one page, and the results only ever land in that user's foods.
//
// Same transport rules as AI meal logging (see ai.ts): the server sends the body with the SDK
// (streaming, since a big menu is a long answer); the phone in local mode sends it with fetch
// and the user's own key.

import { z } from 'zod';
import { AI_MODELS, AiError, DEFAULT_AI_MODEL, type AiEffort } from './ai';
import { N, NUTRIENT_BY_KEY, type NutrientMap } from './nutrients';
import type { FoodData } from './store';

// ---------------------------------------------------------------------------
// Page content
// ---------------------------------------------------------------------------

/** What gets sent to Claude: page text (HTML reduced to text, or pasted), or a PDF. */
export type MenuPage = { kind: 'text'; text: string; url?: string | null } | { kind: 'pdf'; base64: string; url?: string | null };

/** Big enough for a whole chain's nutrition guide; past this, ask for the relevant part instead of cutting it. */
export const MAX_MENU_TEXT_CHARS = 400_000;
export const MAX_MENU_PDF_BYTES = 20 * 1024 * 1024;
/** Below this the page almost certainly renders its menu with scripts. */
export const MIN_MENU_TEXT_CHARS = 200;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', reg: '®', trade: '™', copy: '©', deg: '°', frac12: '½', frac14: '¼', frac34: '¾' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Reduce an HTML page to readable text: table cells joined with " | ", one row or block per
 * line. Embedded JSON data (application/json, ld+json, e.g. Next.js page data) is kept,
 * because many nutrition pages ship their numbers that way.
 */
export function htmlToText(html: string): string {
  const json: string[] = [];
  html.replace(/<script\b[^>]*type\s*=\s*["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi, (_m, body: string) => {
    const t = body.trim();
    if (t) json.push(t);
    return '';
  });
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/i, (head) => {
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
      return title ? `\n${title}\n` : ' ';
    })
    .replace(/<\/(td|th)\s*>/gi, ' | ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|section|article|table|thead|tbody|ul|ol|dl|dt|dd|caption|header|footer|figure)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  const lines = s
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v ]+/g, ' ').replace(/(\s*\|\s*)+$/, '').trim())
    .filter((l) => l && l !== '|');
  // Drop exact consecutive repeats (menus duplicated for mobile/desktop layouts).
  const out: string[] = [];
  for (const l of lines) if (out[out.length - 1] !== l) out.push(l);
  let text = out.join('\n');
  if (json.length) text += `\n\n[Structured data embedded in the page]\n${json.join('\n')}`;
  return text;
}

/** Base64 without Buffer (works in React Native and Node). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

const isPdf = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF

/** Turn a fetched page into what Claude reads. Throws an AiError with a message for the user. */
export function pageFromBytes(bytes: Uint8Array, contentType: string | null, url: string | null): MenuPage {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('application/pdf') || isPdf(bytes)) {
    if (bytes.length > MAX_MENU_PDF_BYTES) throw new AiError('no_input', 'That PDF is larger than 20 MB. Try a smaller nutrition guide, or paste the part you need.');
    return { kind: 'pdf', base64: bytesToBase64(bytes), url };
  }
  if (type && !/(text\/|html|xml|json)/.test(type)) {
    throw new AiError('no_input', 'That link is not a web page or PDF. Open the restaurant’s nutrition page and copy its address, or paste the text.');
  }
  const raw = new TextDecoder('utf-8').decode(bytes);
  const text = /html|xml/.test(type) || /^\s*</.test(raw) ? htmlToText(raw) : raw.trim();
  return checkText(text, url, true);
}

/** Validate pasted or extracted text. */
export function checkText(text: string, url: string | null = null, fetched = false): MenuPage {
  const t = text.trim();
  if (t.length < MIN_MENU_TEXT_CHARS) {
    throw new AiError(
      'no_input',
      fetched
        ? 'That page has almost no text; it probably loads its menu with scripts. Look for a “nutrition PDF” link on the page, or select the nutrition table, copy it and paste it here.'
        : 'Paste more of the nutrition information (the table of items with calories, fat, carbs and protein).',
    );
  }
  if (t.length > MAX_MENU_TEXT_CHARS) {
    throw new AiError('no_input', 'That page is too long to read in one go. Paste just the part with the items you want.');
  }
  return { kind: 'text', text: t, url };
}

// ---------------------------------------------------------------------------
// Response schema
// ---------------------------------------------------------------------------

/** Nutrients restaurant guides usually print (US menu-labelling set). */
export const MENU_NUTRIENT_KEYS = [N.energy, N.fat, N.satFat, N.sodium, N.carbs, N.fiber, N.sugar, N.addedSugar, N.protein].filter((k) => NUTRIENT_BY_KEY[k]);

export const MenuImportItem = z.object({
  /** "Spicy Deluxe Sandwich" or "Waffle Potato Fries, Medium" */
  name: z.string().min(1),
  /** As printed: "1 sandwich", "Medium (125 g)", "8-count". */
  serving: z.string(),
  /** Weight of that serving in grams (printed, or estimated when gramsEstimated). */
  servingGrams: z.number().positive(),
  gramsEstimated: z.boolean(),
  /** Per serving, as printed; null when the page does not list it. */
  nutrients: z.record(z.string(), z.number().nullable()),
});
export const MenuImport = z.object({
  /** "Chick-fil-A", or null when the page does not say. */
  restaurant: z.string().nullable(),
  items: z.array(MenuImportItem),
  /** Short notes for the user (e.g. "sauces are listed separately"). */
  notes: z.array(z.string()),
});
export type MenuImport = z.infer<typeof MenuImport>;
export type MenuImportItem = z.infer<typeof MenuImportItem>;

export const menuImportJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['restaurant', 'items', 'notes'],
  properties: {
    restaurant: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'serving', 'servingGrams', 'gramsEstimated', 'nutrients'],
        properties: {
          name: { type: 'string' },
          serving: { type: 'string' },
          servingGrams: { type: 'number' },
          gramsEstimated: { type: 'boolean' },
          nutrients: {
            type: 'object',
            additionalProperties: false,
            required: MENU_NUTRIENT_KEYS,
            properties: Object.fromEntries(
              MENU_NUTRIENT_KEYS.map((k) => {
                const d = NUTRIENT_BY_KEY[k]!;
                return [k, { anyOf: [{ type: 'number' }, { type: 'null' }], description: `${d.name} (${d.unit}) per serving` }];
              }),
            ),
          },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const;

// ---------------------------------------------------------------------------
// Prompt & request
// ---------------------------------------------------------------------------

const menuNutrientList = MENU_NUTRIENT_KEYS.map((k) => {
  const d = NUTRIENT_BY_KEY[k]!;
  return `- "${k}": ${d.name} (${d.unit})`;
}).join('\n');

/** Stable system prompt (byte-identical across calls so it caches). */
export const MENU_IMPORT_SYSTEM_PROMPT = `You read restaurant nutrition information for Open Nutrition, a food diary app. The user has opened a restaurant's own nutrition page or nutrition guide (as page text or a PDF) and wants its menu items saved as foods in their personal diary. Your job is transcription: copy what the page states, item by item.

Rules:
- Transcribe only what the page says. Never invent or estimate a nutrient value: when the page does not list a nutrient for an item, use null for it. The one exception is the serving weight (see below).
- One item per menu item and size as listed ("Waffle Potato Fries, Small" and "Waffle Potato Fries, Medium" are separate items). Include drinks, sides, desserts, sauces and dressings when the page lists them. Skip anything with no calories listed, and skip combo meals that only add up other listed items.
- name: the item name as the restaurant writes it, in normal capitalisation, including the size when there are several sizes. Do not repeat the restaurant name in the item name.
- serving: the serving as printed ("1 sandwich", "8 count", "Medium", "1 packet"). If none is printed, use "1 serving".
- servingGrams: the serving weight in grams when the page gives it (convert ounces: 1 oz = 28.35 g; for drinks use fluid ounces × 29.6). When the page gives no weight, estimate a typical weight for that item and set gramsEstimated to true; otherwise gramsEstimated is false.
- nutrients: per serving, exactly as printed, keyed by these nutrient numbers and in these units:
${menuNutrientList}
  Convert units when the page uses different ones (for example sodium in g to mg). "<1 g" counts as 0.5, "0" stays 0.
- restaurant: the restaurant or brand name if the page makes it clear, otherwise null.
- notes: at most a few short sentences the user should know (for example "Sauces are listed separately", "Values are for the US menu", or that the page held no nutrition data). Empty when there is nothing to add.
If the page contains no menu nutrition data at all, return an empty items list and say so in notes. Answer only with the JSON object that matches the schema.`;

export interface MenuImportRequestInput {
  page: MenuPage;
  model?: string;
  effort?: AiEffort;
  fallbacks?: boolean;
  maxTokens?: number;
}

/** Messages API body for one import (send with streaming on the server: a large menu is a long answer). */
export function buildMenuImportRequest(input: MenuImportRequestInput) {
  const model = input.model || DEFAULT_AI_MODEL;
  const where = input.page.url ? ` The user opened: ${input.page.url}` : '';
  const content: unknown[] =
    input.page.kind === 'pdf'
      ? [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.page.base64 } },
          { type: 'text', text: `The attached PDF is the restaurant's nutrition guide.${where} Transcribe its menu items.` },
        ]
      : [{ type: 'text', text: `Restaurant nutrition page text.${where}\n"""\n${input.page.text}\n"""\nTranscribe its menu items.` }];
  const body: {
    model: string;
    max_tokens: number;
    system: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[];
    messages: { role: 'user'; content: unknown[] }[];
    output_config: { effort: AiEffort; format: { type: 'json_schema'; schema: typeof menuImportJsonSchema } };
    fallbacks?: 'default';
  } = {
    model,
    max_tokens: input.maxTokens ?? 64000,
    system: [{ type: 'text', text: MENU_IMPORT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    output_config: { effort: input.effort ?? 'low', format: { type: 'json_schema', schema: menuImportJsonSchema } },
  };
  if (input.fallbacks !== false && AI_MODELS.find((m) => m.id === model)?.fallbacks) body.fallbacks = 'default';
  return body;
}

export interface MenuImportResult {
  menu: MenuImport;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** Validate a Messages API response and extract the menu. */
export function parseMenuImportResponse(json: unknown): MenuImportResult {
  const r = (json ?? {}) as {
    type?: string;
    model?: string;
    stop_reason?: string | null;
    stop_details?: unknown;
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null };
    error?: { message?: string };
  };
  if (r.type === 'error') throw new AiError('api_error', 'The AI request failed.', r.error?.message);
  if (r.stop_reason === 'refusal') throw new AiError('refusal', 'The AI declined to read this page. Try pasting the nutrition table instead.', r.stop_details);
  if (r.stop_reason === 'max_tokens') {
    throw new AiError('max_tokens', 'This menu is too long to read in one go. Paste just the part with the items you want.');
  }
  const content = r.content ?? [];
  let start = 0;
  content.forEach((b, i) => {
    if (b.type === 'fallback') start = i + 1;
  });
  const text = content
    .slice(start)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AiError('invalid_response', 'The AI returned an unreadable answer. Please try again.', text.slice(0, 500));
  }
  const parsed = MenuImport.safeParse(data);
  if (!parsed.success) throw new AiError('invalid_response', 'The AI returned an unexpected answer. Please try again.', parsed.error.message);
  const u = r.usage ?? {};
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  return {
    menu: cleanMenu(parsed.data),
    model: r.model ?? '',
    inputTokens: (u.input_tokens ?? 0) + read + write,
    outputTokens: u.output_tokens ?? 0,
    cacheReadInputTokens: read,
    cacheCreationInputTokens: write,
  };
}

/** Drop items without calories, unknown keys and impossible values. */
export function cleanMenu(m: MenuImport): MenuImport {
  const items: MenuImportItem[] = [];
  for (const it of m.items) {
    const nutrients: Record<string, number | null> = {};
    for (const k of MENU_NUTRIENT_KEYS) {
      const v = it.nutrients[k];
      nutrients[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    }
    if (nutrients[N.energy] == null || !(it.servingGrams > 0) || !it.name.trim()) continue;
    items.push({ ...it, name: it.name.trim().slice(0, 200), serving: (it.serving.trim() || '1 serving').slice(0, 80), nutrients });
  }
  return { restaurant: m.restaurant?.trim() || null, items, notes: m.notes.map((n) => n.trim()).filter(Boolean).slice(0, 5) };
}

/** A transcribed item as a food (nutrients stored per 100 g, with the printed serving). */
export function menuItemToFood(item: MenuImportItem, restaurant: string | null): FoodData {
  const g = item.servingGrams;
  const nutrients: NutrientMap = {};
  for (const [k, v] of Object.entries(item.nutrients)) if (v != null) nutrients[k] = Math.round((v * 100 * 1000) / g) / 1000;
  const label = `${item.serving}${item.gramsEstimated ? ' (weight estimated)' : ''}`.slice(0, 100);
  return {
    name: item.name,
    brand: restaurant,
    barcode: null,
    source: 'custom',
    sourceId: null,
    servings: [
      { label, grams: g },
      { label: '100 g', grams: 100 },
    ],
    nutrients,
    favorite: false,
  };
}
