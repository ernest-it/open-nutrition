import { describe, expect, it } from 'vitest';
import {
  AiError,
  FALLBACK_BETA,
  MAX_MENU_TEXT_CHARS,
  MENU_IMPORT_SYSTEM_PROMPT,
  MENU_NUTRIENT_KEYS,
  N,
  buildMenuImportRequest,
  checkText,
  htmlToText,
  menuItemToFood,
  pageFromBytes,
  parseMenuImportResponse,
} from '../src';

const enc = (s: string) => new TextEncoder().encode(s);
const rows = Array.from({ length: 12 }, (_, i) => `<tr><td>Item ${i}</td><td>${300 + i}</td><td>12 g</td></tr>`).join('');
const PAGE = `<html><head><title>Nutrition | Example Chicken</title><style>.x{}</style><script>var junk=1</script></head>
<body><nav>Menu</nav><table><tr><th>Item</th><th>Calories</th><th>Fat</th></tr>${rows}</table>
<p>Fries &amp; sauces &nbsp;listed&#160;separately &#x2013; see PDF</p>
<script type="application/json" id="__NEXT_DATA__">{"items":[{"n":"Nuggets","kcal":250}]}</script></body></html>`;

describe('page text', () => {
  it('reduces HTML to rows, keeps embedded JSON, drops scripts and styles', () => {
    const t = htmlToText(PAGE);
    expect(t).toContain('Nutrition | Example Chicken');
    expect(t).toContain('Item 3 | 303 | 12 g');
    expect(t).toContain('Fries & sauces listed separately – see PDF');
    expect(t).toContain('"Nuggets"');
    expect(t).not.toContain('junk');
    expect(t).not.toContain('.x{}');
  });

  it('detects PDFs by content type or magic bytes', () => {
    const pdf = pageFromBytes(enc('%PDF-1.7 fake'), 'application/octet-stream', 'https://x.test/n.pdf');
    expect(pdf.kind).toBe('pdf');
    expect(pdf.kind === 'pdf' && atob(pdf.base64)).toBe('%PDF-1.7 fake');
    expect(pageFromBytes(enc(PAGE), 'text/html; charset=utf-8', null).kind).toBe('text');
  });

  it('explains script-only pages, oversized text and non-pages', () => {
    expect(() => pageFromBytes(enc('<html><body><div id="root"></div></body></html>'), 'text/html', null)).toThrow(/loads its menu with scripts/);
    expect(() => checkText('x'.repeat(MAX_MENU_TEXT_CHARS + 1))).toThrow(/too long/);
    expect(() => pageFromBytes(enc('GIF89a'), 'image/gif', null)).toThrow(/not a web page or PDF/);
    try {
      checkText('short');
    } catch (e) {
      expect(e).toBeInstanceOf(AiError);
      expect((e as AiError).code).toBe('no_input');
    }
  });
});

describe('request', () => {
  it('sends text or a PDF document with a cached system prompt, a schema and fallbacks', () => {
    const text = buildMenuImportRequest({ page: { kind: 'text', text: 'Spicy sandwich 450 kcal', url: 'https://x.test/n' } });
    expect(text.system[0]).toMatchObject({ text: MENU_IMPORT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } });
    expect(text.output_config.format.schema.properties.items.items.properties.nutrients.required).toEqual(MENU_NUTRIENT_KEYS);
    expect(text.fallbacks).toBe('default');
    expect(JSON.stringify(text.messages)).toContain('https://x.test/n');
    expect(FALLBACK_BETA).toMatch(/server-side-fallback/);

    const pdf = buildMenuImportRequest({ page: { kind: 'pdf', base64: 'QUJD' }, model: 'claude-haiku-5-5' });
    expect(pdf.messages[0]!.content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf', data: 'QUJD' } });
    expect(pdf.fallbacks).toBeUndefined();
  });
});

const reply = (obj: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'message',
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(obj) }],
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 },
  ...extra,
});
const nut = (kcal: number | null, more: Record<string, number | null> = {}) => ({ ...Object.fromEntries(MENU_NUTRIENT_KEYS.map((k) => [k, null])), [N.energy]: kcal, ...more });

describe('response', () => {
  it('parses, drops items without calories and keeps nulls for unlisted nutrients', () => {
    const r = parseMenuImportResponse(
      reply({
        restaurant: ' Example Chicken ',
        notes: ['Sauces are listed separately', ' '],
        items: [
          { name: 'Spicy Deluxe Sandwich', serving: '1 sandwich', servingGrams: 250, gramsEstimated: true, nutrients: nut(500, { [N.protein]: 30, [N.fat]: 22 }) },
          { name: 'Water', serving: '1 cup', servingGrams: 240, gramsEstimated: false, nutrients: nut(null) },
        ],
      }),
    );
    expect(r.menu.restaurant).toBe('Example Chicken');
    expect(r.menu.items).toHaveLength(1);
    expect(r.menu.items[0]!.nutrients[N.fiber]).toBeNull();
    expect(r.menu.notes).toEqual(['Sauces are listed separately']);
    expect(r.inputTokens).toBe(110);
  });

  it('maps refusals and cut-off answers to friendly errors', () => {
    expect(() => parseMenuImportResponse(reply({}, { stop_reason: 'refusal' }))).toThrow(/declined/);
    expect(() => parseMenuImportResponse(reply({}, { stop_reason: 'max_tokens' }))).toThrow(/too long/);
    expect(() => parseMenuImportResponse({ content: [{ type: 'text', text: 'nope' }] })).toThrow(/unreadable/);
  });
});

describe('to food', () => {
  it('stores per-100 g values with the printed serving first', () => {
    const f = menuItemToFood(
      { name: 'Nuggets, 8 count', serving: '8 count', servingGrams: 113, gramsEstimated: false, nutrients: nut(250, { [N.protein]: 27, [N.sodium]: 1210, [N.fiber]: null }) },
      'Example Chicken',
    );
    expect(f).toMatchObject({ name: 'Nuggets, 8 count', brand: 'Example Chicken', source: 'custom', barcode: null });
    expect(f.servings[0]).toEqual({ label: '8 count', grams: 113 });
    expect(f.nutrients[N.energy]).toBeCloseTo((250 * 100) / 113, 2);
    expect(f.nutrients[N.fiber]).toBeUndefined();
    const est = menuItemToFood({ name: 'Shake', serving: 'Small', servingGrams: 400, gramsEstimated: true, nutrients: nut(500) }, null);
    expect(est.servings[0]!.label).toBe('Small (weight estimated)');
  });
});
