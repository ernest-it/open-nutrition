#!/usr/bin/env node
// Builds apps/mobile/assets/foods.db from USDA FoodData Central (Foundation Foods + SR Legacy CSV releases).
// No npm dependencies: uses Node's built-in `node:sqlite` (Node >= 22.13 / 24, which ships FTS5).
//
// Usage:  node data/build-foods-db.mjs [--foundation=YYYY-MM-DD] [--sr=YYYY-MM] [--out=path] [--built-at=ISO] [--no-check]
//
// Downloads are cached in data/.cache/ (gitignored). Output is deterministic for a given set of releases
// (rows are inserted in fdcId order); only meta.built_at changes between runs unless --built-at or
// SOURCE_DATE_EPOCH is given.

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE = path.join(HERE, '.cache');
const BASE_URL = 'https://fdc.nal.usda.gov/fdc-datasets/';

// Pinned releases (see https://fdc.nal.usda.gov/download-datasets). Bump these to update the bundled data.
// NOTE: the 2026-10-29 Foundation CSV zip ships without food.csv / food_nutrient.csv / food_portion.csv,
// so 2026-04-30 is the latest complete Foundation CSV release. SR Legacy is frozen at 2018-04.
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Unknown argument: ${a}`);
    return [m[1], m[2] ?? true];
  }),
);
const FOUNDATION_RELEASE = args.foundation || '2026-04-30';
const SR_RELEASE = args.sr || '2018-04';
const OUT = path.resolve(ROOT, args.out || 'apps/mobile/assets/foods.db');

const SOURCES = [
  { key: 'foundation', name: 'USDA FoodData Central — Foundation Foods', release: FOUNDATION_RELEASE,
    zip: `FoodData_Central_foundation_food_csv_${FOUNDATION_RELEASE}.zip`, dataType: 'foundation_food' },
  { key: 'sr_legacy', name: 'USDA FoodData Central — SR Legacy', release: SR_RELEASE,
    zip: `FoodData_Central_sr_legacy_food_csv_${SR_RELEASE}.zip`, dataType: 'sr_legacy_food' },
];

// Our nutrient keys (USDA nutrient numbers) — must match packages/shared/src/nutrients.ts.
const KEYS = ['208', '203', '204', '205', '291', '269', '539', '606', '605', '645', '646', '601', '307', '306', '301',
  '303', '304', '305', '309', '312', '315', '317', '320', '401', '328', '323', '430', '404', '405', '406', '410',
  '415', '435', '418', '421', '262', '221', '255'];
// Fallback nutrient numbers, in priority order, when the primary number is absent for a food.
const FALLBACKS = {
  208: ['958', '957'], // Energy: Atwater specific, then general factors (Foundation foods)
  204: ['298'], // Total fat (NLEA)
  205: ['205.2'], // Carbohydrate by summation
  269: ['269.3'], // Sugars, Total (NLEA)
};
const EXTRA = ['958', '957', '298', '205.2', '269.3', '417', '431', '432']; // read but not stored directly

// Portion measure units that are not real servings (paired raw/cooked weights, drippings).
const SKIP_UNITS = new Set(['paired cooked w', 'paired raw w', 'dripping w', 'orig ckd g', 'orig rw g']);
// Leading words that are scalable measures: "3 oz" (85 g) is normalised to "1 oz" (28.3 g).
const MEASURES = new Map(Object.entries({
  cup: 'cup', cups: 'cup', tbsp: 'tbsp', tablespoon: 'tablespoon', tablespoons: 'tablespoon', tsp: 'tsp',
  teaspoon: 'teaspoon', teaspoons: 'teaspoon', oz: 'oz', 'fl oz': 'fl oz', lb: 'lb', ml: 'ml', milliliter: 'ml',
  liter: 'liter', quart: 'quart', pint: 'pint', gallon: 'gallon', 'cubic inch': 'cubic inch', g: 'g',
}));
const MAX_SERVINGS = 10;

// ---------------------------------------------------------------------------------------------- helpers

function log(...a) { console.log(...a); }

/** Minimal RFC 4180 CSV parser (quoted fields, "" escapes, embedded newlines). Yields objects keyed by header. */
function* readCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  let i = 0;
  const n = text.length;
  const row = () => {
    const out = [];
    let field = '';
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; } else { i++; break; }
          } else field += text[i++];
        }
      } else if (c === ',') { out.push(field); field = ''; i++; }
      else if (c === '\r') i++;
      else if (c === '\n') { i++; break; }
      else field += text[i++];
    }
    out.push(field);
    return out;
  };
  const header = row();
  while (i < n) {
    const r = row();
    if (r.length === 1 && r[0] === '') continue;
    const o = {};
    for (let k = 0; k < header.length; k++) o[header[k]] = r[k] ?? '';
    yield o;
  }
}

async function download(zip) {
  const dest = path.join(CACHE, zip);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const url = BASE_URL + zip;
  log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const tmp = dest + '.part';
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(tmp, dest);
  return dest;
}

function extract(zipPath) {
  const dir = zipPath.replace(/\.zip$/, '');
  if (fs.existsSync(dir)) return findCsvDir(dir);
  fs.mkdirSync(dir, { recursive: true });
  const attempts = [
    ['unzip', ['-q', '-o', zipPath, '-d', dir]],
    ['tar', ['-xf', zipPath, '-C', dir]], // bsdtar (Windows 10+, macOS) reads zip
    ['powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dir}' -Force`]],
  ];
  for (const [cmd, a] of attempts) {
    try { execFileSync(cmd, a, { stdio: 'ignore' }); return findCsvDir(dir); } catch { /* try next */ }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  throw new Error(`Could not extract ${zipPath} (need unzip, bsdtar or PowerShell)`);
}

function findCsvDir(dir) {
  if (fs.existsSync(path.join(dir, 'food.csv'))) return dir;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'food.csv'))) return path.join(dir, e.name);
  }
  throw new Error(`No food.csv found in ${dir} — is this a complete CSV release?`);
}

/** ≤3 significant figures (integers for values ≥ 100). */
function round(v) {
  if (!Number.isFinite(v)) return null;
  if (Math.abs(v) >= 100) return Math.round(v);
  if (v === 0) return 0;
  return Number(v.toPrecision(3));
}

function fmtAmount(a) {
  const r = Math.round(a * 100) / 100;
  return String(r);
}

function servingLabel(amount, unitName, desc) {
  // desc: SR modifier ("cup, chopped") or Foundation modifier ("whole in shell"); unitName may be null.
  let text = unitName ? (desc ? `${unitName}, ${desc}` : unitName) : desc;
  text = text.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  if (!text) return null;
  if (!(amount > 0)) return { label: text, div: 1 };
  if (amount === 1) return { label: `1 ${text}`, div: 1 };
  const lower = text.toLowerCase();
  for (const [word, unit] of MEASURES) {
    if (lower === word || lower.startsWith(word + ',') || lower.startsWith(word + ' (') || lower.startsWith(word + ' ')) {
      const rest = text.slice(word.length);
      return { label: `1 ${unit}${rest}`, div: amount };
    }
  }
  return { label: `${fmtAmount(amount)} ${text}`, div: 1 };
}

// ---------------------------------------------------------------------------------------------- load

function loadRelease(src, dir) {
  const nbrById = new Map();
  for (const r of readCsv(path.join(dir, 'nutrient.csv'))) {
    const nbr = String(r.nutrient_nbr).replace(/\.0+$/, '');
    if (KEYS.includes(nbr) || EXTRA.includes(nbr)) nbrById.set(r.id, nbr);
  }
  const categories = new Map();
  for (const r of readCsv(path.join(dir, 'food_category.csv'))) categories.set(r.id, r.description || null);
  const units = new Map();
  for (const r of readCsv(path.join(dir, 'measure_unit.csv'))) units.set(r.id, r.name);

  // food.csv also lists superseded versions of foundation foods; the per-type table holds the current set.
  const current = new Set([...readCsv(path.join(dir, `${src.dataType}.csv`))].map((r) => r.fdc_id));
  const foods = new Map();
  for (const r of readCsv(path.join(dir, 'food.csv'))) {
    if (r.data_type !== src.dataType || !current.has(r.fdc_id)) continue;
    foods.set(r.fdc_id, {
      fdcId: Number(r.fdc_id),
      name: r.description.trim(),
      category: categories.get(r.food_category_id) ?? null,
      dataType: src.dataType,
      raw: {},
      portions: [],
    });
  }

  for (const r of readCsv(path.join(dir, 'food_nutrient.csv'))) {
    const f = foods.get(r.fdc_id);
    if (!f) continue;
    const nbr = nbrById.get(r.nutrient_id);
    if (!nbr || r.amount === '') continue;
    const v = Number(r.amount);
    if (Number.isFinite(v)) f.raw[nbr] = v;
  }

  for (const r of readCsv(path.join(dir, 'food_portion.csv'))) {
    const f = foods.get(r.fdc_id);
    if (!f) continue;
    f.portions.push(r);
  }

  for (const f of foods.values()) {
    f.nutrients = buildNutrients(f.raw);
    f.servings = buildServings(f.portions, units);
    delete f.raw;
    delete f.portions;
  }
  return foods;
}

function buildNutrients(raw) {
  const out = {};
  for (const key of KEYS) {
    let v = raw[key];
    if (v === undefined) for (const fb of FALLBACKS[key] ?? []) if (raw[fb] !== undefined) { v = raw[fb]; break; }
    if (v === undefined && key === '435') {
      // Folate DFE = food folate + 1.7 × folic acid; else total folate when there is no added folic acid.
      if (raw['432'] !== undefined) v = raw['432'] + 1.7 * (raw['431'] ?? 0);
      else if (raw['417'] !== undefined && !raw['431']) v = raw['417'];
    }
    if (v === undefined) continue;
    const r = round(v);
    if (r !== null && r >= 0) out[key] = r;
  }
  if (out['208'] === undefined) {
    // Some Foundation foods publish macros but no energy row. Use Atwater general factors (4/4/9/7) when the
    // macros are complete (protein, fat and carbs), or for a near-pure fat (oils, butter) where the rest is ~0.
    const p = out['203'], f = out['204'], c = out['205'], a = out['221'] ?? 0;
    if ((p !== undefined && f !== undefined && c !== undefined) || (f !== undefined && f >= 80)) {
      out['208'] = round(4 * (p ?? 0) + 4 * (c ?? 0) + 9 * (f ?? 0) + 7 * a);
    }
  }
  return out;
}

function buildServings(portions, units) {
  portions.sort((a, b) => (Number(a.seq_num) || 0) - (Number(b.seq_num) || 0) || Number(a.id) - Number(b.id));
  const seen = new Set();
  const out = [];
  for (const p of portions) {
    const grams = Number(p.gram_weight);
    if (!(grams > 0)) continue;
    let unit = units.get(p.measure_unit_id) ?? null;
    if (unit && SKIP_UNITS.has(unit)) continue;
    if (unit === 'undetermined') unit = null;
    if (unit === 'RACC') unit = 'serving';
    const desc = [p.portion_description, p.modifier].map((s) => (s || '').trim()).filter(Boolean)
      .filter((s, i, a) => a.indexOf(s) === i).join(', ');
    const amount = p.amount === '' ? 1 : Number(p.amount);
    const s = servingLabel(amount, unit, desc);
    if (!s) continue;
    const label = s.label.slice(0, 100);
    const g = round(grams / s.div);
    if (!(g > 0)) continue;
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label, grams: g });
    if (out.length >= MAX_SERVINGS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- build

const SCHEMA = `
CREATE TABLE foods (fdcId INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, dataType TEXT NOT NULL,
  servings TEXT NOT NULL,
  nutrients TEXT NOT NULL);
CREATE VIRTUAL TABLE foods_fts USING fts5(name, category, content='foods', content_rowid='fdcId', tokenize='porter unicode61 remove_diacritics 2');
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const SEARCH_SQL = 'SELECT f.* FROM foods_fts JOIN foods f ON f.fdcId = foods_fts.rowid WHERE foods_fts MATCH ? ORDER BY bm25(foods_fts, 10.0, 1.0), length(f.name) LIMIT ?';

function ftsQuery(text) {
  const toks = text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  return toks.length ? toks.map((t) => `"${t}"*`).join(' ') : null;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const all = new Map();
  for (const src of SOURCES) {
    const dir = extract(await download(src.zip));
    const foods = loadRelease(src, dir);
    log(`${src.name} ${src.release}: ${foods.size} foods`);
    for (const f of foods.values()) all.set(f.fdcId, f);
  }

  // A food without energy would silently log 0 kcal, so leave those out (they are partial Foundation records).
  const dropped = [...all.values()].filter((f) => f.nutrients['208'] === undefined);
  const rows = [...all.values()].filter((f) => f.nutrients['208'] !== undefined).sort((a, b) => a.fdcId - b.fdcId);
  if (dropped.length) log(`Skipping ${dropped.length} foods without energy: ${dropped.map((f) => f.name).join('; ')}`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + '.tmp';
  for (const p of [tmp, tmp + '-journal', tmp + '-wal', tmp + '-shm']) fs.rmSync(p, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA page_size = 4096;');
  db.exec(SCHEMA);
  db.exec('BEGIN');
  const ins = db.prepare('INSERT INTO foods (fdcId, name, category, dataType, servings, nutrients) VALUES (?, ?, ?, ?, ?, ?)');
  for (const f of rows) {
    ins.run(f.fdcId, f.name, f.category, f.dataType, JSON.stringify(f.servings), JSON.stringify(f.nutrients));
  }
  db.exec("INSERT INTO foods_fts(foods_fts) VALUES('rebuild')");
  db.exec("INSERT INTO foods_fts(foods_fts) VALUES('optimize')");

  const epoch = process.env.SOURCE_DATE_EPOCH;
  const builtAt = typeof args['built-at'] === 'string' ? args['built-at']
    : epoch ? new Date(Number(epoch) * 1000).toISOString() : new Date().toISOString();
  const meta = {
    sources: JSON.stringify(SOURCES.map((s) => ({ name: s.name, dataType: s.dataType, release: s.release, url: BASE_URL + s.zip }))),
    foundation_release: FOUNDATION_RELEASE,
    sr_legacy_release: SR_RELEASE,
    built_at: builtAt,
    food_count: String(rows.length),
    attribution: 'USDA, Agricultural Research Service. FoodData Central.',
    license: 'CC0 1.0 Universal (public domain)',
    homepage: 'https://fdc.nal.usda.gov/',
    nutrient_basis: 'per 100 g; keys are USDA nutrient numbers',
    schema_version: '1',
  };
  const insMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const k of Object.keys(meta).sort()) insMeta.run(k, meta[k]);
  db.exec('COMMIT');
  db.exec('VACUUM');
  db.close();
  fs.rmSync(OUT, { force: true });
  fs.renameSync(tmp, OUT);

  const size = fs.statSync(OUT).size;
  log(`Wrote ${path.relative(ROOT, OUT)}: ${rows.length} foods, ${(size / 1024 / 1024).toFixed(2)} MB`);

  if (!args['no-check']) {
    const ro = new DatabaseSync(OUT, { readOnly: true });
    const q = ro.prepare(SEARCH_SQL);
    for (const s of ['chicken breast', 'rice white cooked', 'banana', 'egg', 'olive oil', 'greek yogurt']) {
      const r = q.all(ftsQuery(s), 3);
      log(`\n"${s}":`);
      for (const f of r) log(`  ${f.fdcId}  ${f.name}  [${f.dataType}]  ${JSON.parse(f.nutrients)['208'] ?? '?'} kcal`);
    }
    ro.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
