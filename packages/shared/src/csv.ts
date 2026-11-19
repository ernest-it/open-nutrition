// CSV helpers: a minimal RFC-4180 reader/writer and the diary export.

import { roundNutrient } from './calc';
import { NUTRIENT_BY_KEY, NUTRIENTS, type NutrientKey } from './nutrients';
import { MEALS, type DiaryEntry } from './schema';
// Minimal RFC-4180 CSV reader/writer (quotes, escaped quotes, CRLF, embedded newlines).

export function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const c = headerLine.split(d).length;
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const d = delimiter ?? detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][], delimiter = ','): string {
  return (
    rows
      .map((r) =>
        r
          .map((v) => {
            const s = v == null ? '' : String(v);
            return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(delimiter),
      )
      .join('\n') + '\n'
  );
}

// ---- diary export -------------------------------------------------------------


/**
 * Diary entries as CSV: one row per entry, sorted by day, meal, position.
 * Nutrient columns default to the core list ("Calories (kcal)", "Protein (g)", …);
 * a missing value is an empty cell (unknown), not 0.
 */
export function diaryToCsv(entries: DiaryEntry[], keys: NutrientKey[] = NUTRIENTS.filter((n) => n.core).map((n) => n.key)): string {
  const sorted = entries
    .filter((e) => !e.deletedAt)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.position - b.position,
    );
  const header = [
    'Date',
    'Meal',
    'Food',
    'Source',
    'Grams',
    'Serving',
    'Quantity',
    ...keys.map((k) => {
      const d = NUTRIENT_BY_KEY[k];
      return d ? `${d.name} (${d.unit})` : k;
    }),
  ];
  const rows = sorted.map((e) => [
    e.date,
    e.meal,
    e.name,
    e.source,
    e.grams == null ? '' : +e.grams.toFixed(1),
    e.servingLabel ?? '',
    +e.quantity.toFixed(3),
    ...keys.map((k) => (e.nutrients[k] == null ? '' : roundNutrient(k, e.nutrients[k]!))),
  ]);
  return toCsv([header, ...rows]);
}
