// Offline-first client store shared by the web UI and the mobile app.
//
// * All rows are held in memory and persisted through a StorageAdapter
//   (IndexedDB/localStorage on web, SQLite/AsyncStorage on mobile).
// * Every local mutation bumps `updatedAt` and marks the row as pending.
// * `sync()` pushes pending rows and pulls everything newer than the last
//   server revision. The server resolves conflicts with last-write-wins.
// * Bundled USDA foods (`usda:<fdcId>`) are never stored here; logging one
//   copies it into `foods` (deduped on source + sourceId).

import { addDays, dayOf, mealIndex, recipePer100g, recipePortionGrams, scaleNutrients, sumNutrients, todayLocal } from './calc';
import type { Profile } from './calc';
import type { NutrientMap } from './nutrients';
import {
  BUILTIN_PREFIX,
  COLLECTION_NAMES,
  type AiEstimateRow,
  type ChangeSet,
  type CollectionName,
  type DiaryEntry,
  type Food,
  type Meal,
  type Measurement,
  type MeasurementKind,
  type RowTypes,
  type SavedMeal,
  type SyncResponse,
  type Target,
} from './schema';

export interface Snapshot {
  rev: number;
  rows: { [K in CollectionName]?: RowTypes[K][] };
  pending: { [K in CollectionName]?: string[] };
}

export interface StorageAdapter {
  load(): Promise<Snapshot | null>;
  save(snapshot: Snapshot): Promise<void>;
  clear?(): Promise<void>;
}

export class MemoryStorage implements StorageAdapter {
  data: Snapshot | null = null;
  async load() {
    return this.data ? structuredClone(this.data) : null;
  }
  async save(s: Snapshot) {
    this.data = structuredClone(s);
  }
  async clear() {
    this.data = null;
  }
}

export interface ServerConfig {
  baseUrl: string; // e.g. https://nutrition.example.com
  token: string;
}

type Maps = { [K in CollectionName]: Map<string, RowTypes[K]> };
export type Editable<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;
/** A food as produced by a data source (OFF, AI, custom form) before it is stored. */
export type FoodData = Editable<Food>;

export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- settings ---------------------------------------------------------------

export interface Prefs {
  weightUnit: 'kg' | 'lb';
  lengthUnit: 'cm' | 'in';
  waterUnit: 'ml' | 'floz';
  /** Off until the user opts in (meal photos go to Anthropic). */
  aiEnabled: boolean;
  aiModel: string;
  aiEffort: 'low' | 'medium' | 'high';
}

export const DEFAULT_PREFS: Prefs = {
  weightUnit: 'kg',
  lengthUnit: 'cm',
  waterUnit: 'ml',
  aiEnabled: false,
  aiModel: 'claude-opus-5-5',
  aiEffort: 'low',
};

export const SETTING_PROFILE = 'profile';
export const SETTING_PREFS = 'prefs';

export interface LogFoodArgs {
  day: string;
  meal: Meal;
  /** A stored food, a builtin `usda:` food, or an OFF/AI/custom food not stored yet. */
  food: Food | (FoodData & { id?: string });
  grams: number;
  servingLabel?: string | null;
  quantity?: number;
  /** Override the computed totals (e.g. an AI review item with filled-in macros). */
  nutrients?: NutrientMap;
  aiEstimateId?: string | null;
}

/** Precision used for stored nutrient snapshots (avoids float noise, keeps sums accurate). */
const snap = (m: NutrientMap): NutrientMap =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));

export class NutritionStore {
  private maps: Maps = Object.fromEntries(COLLECTION_NAMES.map((c) => [c, new Map()])) as unknown as Maps;
  private pending: { [K in CollectionName]: Set<string> } = Object.fromEntries(
    COLLECTION_NAMES.map((c) => [c, new Set<string>()]),
  ) as unknown as { [K in CollectionName]: Set<string> };
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing: Promise<SyncResponse | null> | null = null;
  rev = 0;
  version = 0;
  server: ServerConfig | null = null;
  lastSyncError: string | null = null;
  lastSyncAt: number | null = null;

  constructor(
    private storage: StorageAdapter,
    private opts: { now?: () => number; fetch?: typeof fetch } = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  /** Today's local day according to the store's clock. */
  today(): string {
    return todayLocal(new Date(this.now()));
  }

  async init() {
    const snap = await this.storage.load();
    if (snap) {
      this.rev = snap.rev;
      for (const c of COLLECTION_NAMES) {
        for (const r of snap.rows[c] ?? []) (this.maps[c] as Map<string, unknown>).set(r.id, r);
        for (const id of snap.pending[c] ?? []) this.pending[c].add(id);
      }
    }
    this.emit(false);
  }

  // ---- subscription -------------------------------------------------------
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(persist = true) {
    this.version++;
    for (const l of this.listeners) l();
    if (persist) this.schedulePersist();
  }

  private schedulePersist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.persist(), 200);
  }

  async persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const snap: Snapshot = { rev: this.rev, rows: {}, pending: {} };
    for (const c of COLLECTION_NAMES) {
      (snap.rows as Record<string, unknown[]>)[c] = [...this.maps[c].values()];
      snap.pending[c] = [...this.pending[c]];
    }
    await this.storage.save(snap);
  }

  async reset() {
    for (const c of COLLECTION_NAMES) {
      this.maps[c].clear();
      this.pending[c].clear();
    }
    this.rev = 0;
    await this.storage.clear?.();
    this.emit();
  }

  // ---- generic access -----------------------------------------------------
  all<K extends CollectionName>(c: K, includeDeleted = false): RowTypes[K][] {
    const rows = [...this.maps[c].values()] as RowTypes[K][];
    return includeDeleted ? rows : rows.filter((r) => !r.deletedAt);
  }

  /** Alias of `all`. */
  list<K extends CollectionName>(c: K, includeDeleted = false): RowTypes[K][] {
    return this.all(c, includeDeleted);
  }

  get<K extends CollectionName>(c: K, id: string): RowTypes[K] | undefined {
    const r = this.maps[c].get(id) as RowTypes[K] | undefined;
    return r && !r.deletedAt ? r : undefined;
  }

  pendingCount(): number {
    return COLLECTION_NAMES.reduce((a, c) => a + this.pending[c].size, 0);
  }

  insert<K extends CollectionName>(c: K, data: Editable<RowTypes[K]> & { id?: string }): RowTypes[K] {
    const t = this.now();
    const row = { ...data, id: data.id ?? randomId(), createdAt: t, updatedAt: t, deletedAt: null } as RowTypes[K];
    this.put(c, row);
    return row;
  }

  update<K extends CollectionName>(c: K, id: string, patch: Partial<Editable<RowTypes[K]>>): RowTypes[K] | undefined {
    const cur = this.maps[c].get(id) as RowTypes[K] | undefined;
    if (!cur) return undefined;
    const row = { ...cur, ...patch, updatedAt: Math.max(this.now(), cur.updatedAt + 1) } as RowTypes[K];
    this.put(c, row);
    return row;
  }

  remove(c: CollectionName, id: string) {
    const cur = this.maps[c].get(id);
    if (!cur || cur.deletedAt) return;
    const t = Math.max(this.now(), cur.updatedAt + 1);
    this.put(c, { ...cur, deletedAt: t, updatedAt: t } as never);
  }

  private put<K extends CollectionName>(c: K, row: RowTypes[K]) {
    (this.maps[c] as Map<string, RowTypes[K]>).set(row.id, row);
    this.pending[c].add(row.id);
    this.emit();
  }

  /** Apply rows from the server or an import without marking them pending. */
  applyRemote(changes: ChangeSet, markPending = false) {
    for (const c of COLLECTION_NAMES) {
      for (const r of (changes[c] ?? []) as RowTypes[typeof c][]) {
        const cur = this.maps[c].get(r.id);
        // A newer local edit made while the request was in flight wins locally;
        // it is still pending and will be pushed next sync.
        if (cur && this.pending[c].has(r.id) && cur.updatedAt > r.updatedAt) continue;
        (this.maps[c] as Map<string, unknown>).set(r.id, r);
        if (markPending) this.pending[c].add(r.id);
      }
    }
    this.emit();
  }

  // ---- sync ---------------------------------------------------------------
  sync(): Promise<SyncResponse | null> {
    if (!this.server) return Promise.resolve(null);
    if (!this.syncing) {
      this.syncing = this.doSync().finally(() => {
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  private async doSync(): Promise<SyncResponse | null> {
    const server = this.server!;
    const pushed: { c: CollectionName; id: string; updatedAt: number }[] = [];
    const changes: ChangeSet = {};
    for (const c of COLLECTION_NAMES) {
      const rows: unknown[] = [];
      for (const id of this.pending[c]) {
        const r = this.maps[c].get(id);
        if (!r) continue;
        rows.push(r);
        pushed.push({ c, id, updatedAt: r.updatedAt });
      }
      if (rows.length) (changes as Record<string, unknown[]>)[c] = rows;
    }
    const f = this.opts.fetch ?? fetch;
    const url = `${server.baseUrl.replace(/\/$/, '')}/api/v1/sync`;
    try {
      let body: SyncResponse & { more?: boolean };
      let first = true;
      do {
        const res = await f(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
          body: JSON.stringify({ since: this.rev, changes: first ? changes : {} }),
        });
        if (!res.ok) throw new Error(res.status === 401 ? 'Not signed in (HTTP 401)' : `Sync failed: HTTP ${res.status}`);
        body = (await res.json()) as SyncResponse & { more?: boolean };
        if (first) {
          // Clear pending flags for rows that were not edited again meanwhile.
          for (const p of pushed) {
            const cur = this.maps[p.c].get(p.id);
            if (cur && cur.updatedAt === p.updatedAt) this.pending[p.c].delete(p.id);
          }
          first = false;
        }
        this.applyRemote(body.changes);
        this.rev = body.rev;
      } while (body.more);
      this.lastSyncError = null;
      this.lastSyncAt = this.now();
      this.emit();
      await this.persist();
      return body;
    } catch (e) {
      this.lastSyncError = e instanceof Error ? e.message : String(e);
      this.emit(false);
      throw e;
    }
  }

  // ---- diary ----------------------------------------------------------------

  /** Entries for a day, ordered by meal (breakfast → snack) then position. */
  entriesOn(day: string): DiaryEntry[] {
    return this.all('diaryEntries')
      .filter((e) => e.date === day)
      .sort((a, b) => mealIndex(a.meal) - mealIndex(b.meal) || a.position - b.position || a.loggedAt - b.loggedAt);
  }

  dayTotals(day: string): NutrientMap {
    return sumNutrients(this.entriesOn(day).map((e) => e.nutrients));
  }

  mealTotals(day: string, meal: Meal): NutrientMap {
    return sumNutrients(
      this.entriesOn(day)
        .filter((e) => e.meal === meal)
        .map((e) => e.nutrients),
    );
  }

  private nextPosition(day: string, meal: Meal): number {
    let max = -1;
    for (const e of this.all('diaryEntries')) if (e.date === day && e.meal === meal && e.position > max) max = e.position;
    return max + 1;
  }

  /**
   * Make sure a food is in the synced `foods` collection and return the stored row.
   * Builtin (`usda:`) foods and foods not stored yet are copied under a fresh id,
   * reusing an existing copy with the same source + sourceId.
   */
  ensureFood(food: Food | (FoodData & { id?: string })): Food {
    if (food.id && !food.id.startsWith(BUILTIN_PREFIX)) {
      const existing = this.get('foods', food.id);
      if (existing) return existing;
    }
    const sourceId =
      food.id?.startsWith(BUILTIN_PREFIX) && food.sourceId == null ? food.id.slice(BUILTIN_PREFIX.length) : food.sourceId;
    const source = food.id?.startsWith(BUILTIN_PREFIX) ? 'usda' : food.source;
    if (sourceId != null) {
      const dupe = this.all('foods').find((f) => f.source === source && f.sourceId === sourceId);
      if (dupe) return dupe;
    }
    return this.insert('foods', {
      name: food.name,
      brand: food.brand,
      barcode: food.barcode,
      source,
      sourceId,
      servings: food.servings,
      nutrients: food.nutrients,
      favorite: food.favorite,
    });
  }

  logFood(args: LogFoodArgs): DiaryEntry {
    const food = this.ensureFood(args.food);
    const nutrients = args.nutrients ?? scaleNutrients(food.nutrients, args.grams);
    return this.insert('diaryEntries', {
      date: args.day,
      meal: args.meal,
      foodId: food.id,
      recipeId: null,
      name: food.brand ? `${food.name} (${food.brand})`.slice(0, 300) : food.name,
      source: food.source,
      grams: args.grams,
      servingLabel: args.servingLabel ?? null,
      quantity: args.quantity ?? 1,
      nutrients: snap(nutrients),
      aiEstimateId: args.aiEstimateId ?? null,
      position: this.nextPosition(args.day, args.meal),
      loggedAt: this.now(),
    });
  }

  quickAdd(args: { day: string; meal: Meal; name?: string; nutrients: NutrientMap }): DiaryEntry {
    return this.insert('diaryEntries', {
      date: args.day,
      meal: args.meal,
      foodId: null,
      recipeId: null,
      name: args.name?.trim() || 'Quick add',
      source: 'quick',
      grams: null,
      servingLabel: null,
      quantity: 1,
      nutrients: snap(args.nutrients),
      aiEstimateId: null,
      position: this.nextPosition(args.day, args.meal),
      loggedAt: this.now(),
    });
  }

  /** Log a recipe by portions (default 1) or by grams. */
  logRecipe(args: { day: string; meal: Meal; recipeId: string; portions?: number; grams?: number }): DiaryEntry {
    const recipe = this.get('recipes', args.recipeId);
    if (!recipe) throw new Error(`Unknown recipe ${args.recipeId}`);
    const portionGrams = recipePortionGrams(recipe);
    const byGrams = args.grams != null && args.portions == null;
    const grams = byGrams ? args.grams! : (args.portions ?? 1) * portionGrams;
    const portions = byGrams ? (portionGrams > 0 ? grams / portionGrams : 1) : (args.portions ?? 1);
    return this.insert('diaryEntries', {
      date: args.day,
      meal: args.meal,
      foodId: null,
      recipeId: recipe.id,
      name: recipe.name,
      source: 'recipe',
      grams,
      servingLabel: byGrams ? null : portions === 1 ? '1 portion' : `${+portions.toFixed(2)} portions`,
      quantity: portions,
      nutrients: snap(scaleNutrients(recipePer100g(recipe), grams)),
      aiEstimateId: null,
      position: this.nextPosition(args.day, args.meal),
      loggedAt: this.now(),
    });
  }

  moveEntry(id: string, to: { day?: string; meal?: Meal }): DiaryEntry | undefined {
    const e = this.get('diaryEntries', id);
    if (!e) return undefined;
    const day = to.day ?? e.date;
    const meal = to.meal ?? e.meal;
    if (day === e.date && meal === e.meal) return e;
    return this.update('diaryEntries', id, { date: day, meal, position: this.nextPosition(day, meal) });
  }

  /** Copy entries to a day (keeping each entry's meal unless `meal` is given). */
  copyEntries(ids: string[], to: { day: string; meal?: Meal }): DiaryEntry[] {
    const out: DiaryEntry[] = [];
    for (const id of ids) {
      const e = this.get('diaryEntries', id);
      if (!e) continue;
      const meal = to.meal ?? e.meal;
      const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = e;
      out.push(
        this.insert('diaryEntries', {
          ...rest,
          date: to.day,
          meal,
          position: this.nextPosition(to.day, meal),
          loggedAt: this.now(),
        }),
      );
    }
    return out;
  }

  copyMeal(fromDay: string, meal: Meal, toDay: string, toMeal: Meal = meal): DiaryEntry[] {
    const ids = this.entriesOn(fromDay)
      .filter((e) => e.meal === meal)
      .map((e) => e.id);
    return this.copyEntries(ids, { day: toDay, meal: toMeal });
  }

  /** Copy yesterday's meal into `day` (convenience for the "repeat yesterday" button). */
  copyMealFromYesterday(day: string, meal: Meal): DiaryEntry[] {
    return this.copyMeal(addDays(day, -1), meal, day, meal);
  }

  // ---- saved meals -----------------------------------------------------------

  saveMealFromEntries(name: string, entryIds: string[]): SavedMeal {
    const entries = entryIds.map((id) => this.get('diaryEntries', id)).filter((e): e is DiaryEntry => !!e);
    const meals = new Set(entries.map((e) => e.meal));
    return this.insert('savedMeals', {
      name: name.trim() || 'Saved meal',
      meal: meals.size === 1 ? [...meals][0]! : null,
      items: entries.map((e) => ({
        foodId: e.foodId,
        recipeId: e.recipeId,
        name: e.name,
        source: e.source,
        grams: e.grams,
        servingLabel: e.servingLabel,
        quantity: e.quantity,
        nutrients: e.nutrients,
      })),
    });
  }

  logSavedMeal(savedMealId: string, day: string, meal: Meal): DiaryEntry[] {
    const sm = this.get('savedMeals', savedMealId);
    if (!sm) throw new Error(`Unknown saved meal ${savedMealId}`);
    return sm.items.map((it) =>
      this.insert('diaryEntries', {
        date: day,
        meal,
        foodId: it.foodId,
        recipeId: it.recipeId,
        name: it.name,
        source: it.source,
        grams: it.grams,
        servingLabel: it.servingLabel,
        quantity: it.quantity,
        nutrients: it.nutrients,
        aiEstimateId: null,
        position: this.nextPosition(day, meal),
        loggedAt: this.now(),
      }),
    );
  }

  // ---- foods ------------------------------------------------------------------

  /** Most recently logged foods, newest first, unique. */
  recentFoods(limit = 30): Food[] {
    const seen = new Set<string>();
    const out: Food[] = [];
    const entries = this.all('diaryEntries')
      .filter((e) => e.foodId)
      .sort((a, b) => b.loggedAt - a.loggedAt);
    for (const e of entries) {
      if (seen.has(e.foodId!)) continue;
      seen.add(e.foodId!);
      const f = this.get('foods', e.foodId!);
      if (f) out.push(f);
      if (out.length >= limit) break;
    }
    return out;
  }

  favoriteFoods(): Food[] {
    return this.all('foods')
      .filter((f) => f.favorite)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  foodByBarcode(code: string): Food | undefined {
    return this.all('foods')
      .filter((f) => f.barcode === code)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  /** Create or update a food (custom foods, edits, cached OFF products). */
  upsertFood(food: FoodData & { id?: string }): Food {
    const { id, ...data } = food as FoodData & { id?: string; createdAt?: number; updatedAt?: number; deletedAt?: number | null };
    delete (data as { createdAt?: number }).createdAt;
    delete (data as { updatedAt?: number }).updatedAt;
    delete (data as { deletedAt?: number | null }).deletedAt;
    if (id && this.maps.foods.has(id)) return this.update('foods', id, { ...data, deletedAt: null } as Partial<FoodData>)!;
    return this.insert('foods', { ...data, id: id && !id.startsWith(BUILTIN_PREFIX) ? id : undefined });
  }

  // ---- targets ----------------------------------------------------------------

  /** Targets in effect on `day`: the row with the latest effectiveFrom <= day. */
  targetsOn(day: string): Target | undefined {
    let best: Target | undefined;
    for (const t of this.all('targets')) {
      if (t.effectiveFrom > day) continue;
      if (
        !best ||
        t.effectiveFrom > best.effectiveFrom ||
        (t.effectiveFrom === best.effectiveFrom && t.updatedAt > best.updatedAt)
      )
        best = t;
    }
    return best;
  }

  setTargets(nutrients: NutrientMap, waterMl: number | null, effectiveFrom: string = this.today()): Target {
    const existing = this.all('targets').find((t) => t.effectiveFrom === effectiveFrom);
    if (existing) return this.update('targets', existing.id, { nutrients, waterMl })!;
    return this.insert('targets', { effectiveFrom, nutrients, waterMl });
  }

  // ---- measurements & water ------------------------------------------------------

  measurementsOf(kind: MeasurementKind): Measurement[] {
    return this.all('measurements')
      .filter((m) => m.kind === kind)
      .sort((a, b) => a.takenAt - b.takenAt);
  }

  addMeasurement(kind: MeasurementKind, value: number, takenAt: number = this.now(), note: string | null = null): Measurement {
    return this.insert('measurements', { kind, value, takenAt, note });
  }

  latestWeightKg(): number | null {
    const w = this.measurementsOf('body_weight');
    return w.length ? w[w.length - 1]!.value : null;
  }

  waterOn(day: string): number {
    return this.all('measurements')
      .filter((m) => m.kind === 'water' && dayOf(m.takenAt) === day)
      .reduce((a, m) => a + m.value, 0);
  }

  /** Log a drink. For a past/future day the timestamp is noon local time of that day. */
  addWater(ml: number, day?: string): Measurement {
    let takenAt = this.now();
    if (day && day !== dayOf(takenAt)) {
      const [y, m, d] = day.split('-').map(Number);
      takenAt = new Date(y!, m! - 1, d!, 12).getTime();
    }
    return this.addMeasurement('water', ml, takenAt);
  }

  // ---- AI ---------------------------------------------------------------------------

  recordAiEstimate(row: Editable<AiEstimateRow>): AiEstimateRow {
    return this.insert('aiEstimates', row);
  }

  // ---- settings -------------------------------------------------------------------

  getSetting<T>(key: string, fallback: T): T {
    const s = this.get('settings', key);
    if (!s) return fallback;
    try {
      return JSON.parse(s.value) as T;
    } catch {
      return fallback;
    }
  }

  setSetting(key: string, value: unknown) {
    const v = JSON.stringify(value);
    if (this.maps.settings.has(key)) this.update('settings', key, { value: v, deletedAt: null } as never);
    else this.insert('settings', { id: key, value: v });
  }

  profile(): Profile | null {
    return this.getSetting<Profile | null>(SETTING_PROFILE, null);
  }

  /** Stored prefs merged over DEFAULT_PREFS. */
  prefs(): Prefs {
    return { ...DEFAULT_PREFS, ...this.getSetting<Partial<Prefs>>(SETTING_PREFS, {}) };
  }
}
