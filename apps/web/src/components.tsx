import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  isStoredFoodId,
  multiplyNutrients,
  N,
  scaleNutrients,
  type DiaryEntry,
  type Food,
  type FoodData,
  type Meal,
  type NutrientMap,
} from '@open-nutrition/shared';
import { removeRows, restoreRows, store, useLoggedDays, useStore } from './state';
import { useAddFood } from './addFood';
import { useToast } from './feedback';
import { DateField, formatDay, grams, Icon, kcal, MEAL_LABEL, MealSelect, Modal, NumberInput, round } from './ui';

export function MacroLine({ n, className = '' }: { n: NutrientMap; className?: string }) {
  return (
    <span className={`macro-line ${className}`}>
      <span className="m-p">P {grams(n[N.protein])} g</span>
      <span className="m-c">C {grams(n[N.carbs])} g</span>
      <span className="m-f">F {grams(n[N.fat])} g</span>
    </span>
  );
}

export const SOURCE_LABEL: Record<string, string> = {
  usda: 'USDA',
  off: 'Open Food Facts',
  custom: 'Custom',
  ai: 'AI estimate',
  quick: 'Quick add',
  recipe: 'Recipe',
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "1.5 × 1 cup (237 g)", "150 g", or the source for quick adds. Never repeats the grams ("100 g (100 g)"). */
export function entryAmount(e: DiaryEntry): string {
  if (e.servingLabel) {
    const g = e.grams != null ? `${grams(e.grams)} g` : null;
    const showGrams = g != null && !e.servingLabel.includes(g) && !/^\s*[\d.,]+\s*g\s*$/i.test(e.servingLabel);
    return `${e.quantity === 1 ? '' : `${round(e.quantity, 2)} × `}${e.servingLabel}${showGrams ? ` (${g})` : ''}`;
  }
  if (e.grams != null) return `${grams(e.grams)} g`;
  return SOURCE_LABEL[e.source] ?? '';
}

/** Toast after removing diary entries, with Undo. */
export function useEntryUndo() {
  const toast = useToast();
  return (ids: string[], message: string) => toast({ message, action: { label: 'Undo', onClick: () => restoreRows('diaryEntries', ids) } });
}

/** Toast after adding diary entries (copies), with Undo that removes them again. */
export function useAddedUndo() {
  const toast = useToast();
  return (ids: string[], message: string) =>
    toast({ message, tone: 'success', action: ids.length ? { label: 'Undo', onClick: () => removeRows('diaryEntries', ids) } : undefined });
}

// ---------------------------------------------------------------------------
// Dropdown menu: closes on outside click / Esc / selection; arrow keys move between items.
// ---------------------------------------------------------------------------

export function MenuButton({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  function onKey(e: React.KeyboardEvent) {
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  }
  return (
    <div className="menu-wrap" ref={wrap} onKeyDown={open ? onKey : undefined}>
      <button ref={btn} className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={label}>
          {children(() => close(false))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meal section (Today + Diary)
// ---------------------------------------------------------------------------

export function MealSection({ day, meal, entries, tools = true }: { day: string; meal: Meal; entries: DiaryEntry[]; tools?: boolean }) {
  const openAdd = useAddFood();
  const added = useAddedUndo();
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [copyTo, setCopyTo] = useState(false);
  const [saveAs, setSaveAs] = useState(false);
  const total = entries.reduce((a, e) => a + (e.nutrients[N.energy] ?? 0), 0);
  const yesterday = store.entriesOn(addDays(day, -1)).filter((e) => e.meal === meal);
  const mealName = MEAL_LABEL[meal].toLowerCase();

  function copyYesterday() {
    const rows = store.copyMealFromYesterday(day, meal);
    added(
      rows.map((r) => r.id),
      `Copied ${plural(rows.length, 'item')} from yesterday's ${mealName}.`,
    );
  }

  return (
    <section className="meal card" aria-label={MEAL_LABEL[meal]}>
      <header className="meal-head">
        <div className="meal-title">
          <h3>{MEAL_LABEL[meal]}</h3>
          <span className="muted">{entries.length ? `${kcal(total)} kcal` : 'Nothing logged'}</span>
        </div>
        <div className="meal-actions">
          {tools && (
            <MenuButton label={`${MEAL_LABEL[meal]} options`}>
              {(close) => (
                <>
                  <button
                    role="menuitem"
                    disabled={!yesterday.length}
                    onClick={() => {
                      close();
                      copyYesterday();
                    }}
                  >
                    <Icon name="history" size={18} /> Copy yesterday's {mealName}
                    {yesterday.length ? ` (${yesterday.length})` : ''}
                  </button>
                  <button
                    role="menuitem"
                    disabled={!entries.length}
                    onClick={() => {
                      close();
                      setCopyTo(true);
                    }}
                  >
                    <Icon name="copy" size={18} /> Copy this meal to…
                  </button>
                  <button
                    role="menuitem"
                    disabled={!entries.length}
                    onClick={() => {
                      close();
                      setSaveAs(true);
                    }}
                  >
                    <Icon name="bowl" size={18} /> Save as a meal
                  </button>
                </>
              )}
            </MenuButton>
          )}
          <button className="icon-btn accent" aria-label={`Add to ${MEAL_LABEL[meal]}`} onClick={() => openAdd({ day, meal })}>
            <Icon name="plus" />
          </button>
        </div>
      </header>
      {entries.length > 0 && (
        <ul className="entries">
          {entries.map((e) => (
            <li key={e.id}>
              <button className="entry" onClick={() => setEditing(e)} aria-label={`${e.name}, ${entryAmount(e)}, ${kcal(e.nutrients[N.energy])} kcal. Edit`}>
                <span className="entry-main">
                  <span className="entry-name">{e.name}</span>
                  <span className="entry-sub">
                    {entryAmount(e)}
                    {e.source === 'ai' && <span className="badge">AI</span>}
                  </span>
                </span>
                <span className="entry-kcal">{kcal(e.nutrients[N.energy])}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!entries.length && yesterday.length > 0 && tools && (
        <button className="link small pad-x" onClick={copyYesterday}>
          <Icon name="history" size={16} /> Copy yesterday's {mealName} ({plural(yesterday.length, 'item')})
        </button>
      )}
      {editing && <EntryEditor entry={editing} onClose={() => setEditing(null)} />}
      {copyTo && <CopyMealDialog day={day} meal={meal} ids={entries.map((e) => e.id)} onClose={() => setCopyTo(false)} />}
      {saveAs && <SaveMealDialog meal={meal} ids={entries.map((e) => e.id)} onClose={() => setSaveAs(false)} />}
    </section>
  );
}

function CopyMealDialog({ day, meal, ids, onClose }: { day: string; meal: Meal; ids: string[]; onClose: () => void }) {
  const [to, setTo] = useState(addDays(day, 1));
  const [toMeal, setToMeal] = useState<Meal>(meal);
  const added = useAddedUndo();
  const marked = useLoggedDays();
  const same = to === day && toMeal === meal;
  return (
    <Modal
      title={`Copy ${MEAL_LABEL[meal].toLowerCase()}`}
      variant="compact"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={same}
            onClick={() => {
              const rows = store.copyEntries(ids, { day: to, meal: toMeal });
              added(
                rows.map((r) => r.id),
                `Copied ${plural(rows.length, 'item')} to ${MEAL_LABEL[toMeal].toLowerCase()}, ${formatDay(to, true)}.`,
              );
              onClose();
            }}
          >
            Copy {plural(ids.length, 'item')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          To day
          <DateField value={to} onChange={setTo} marked={marked} />
        </label>
        <label>
          Meal
          <MealSelect value={toMeal} onChange={setToMeal} />
        </label>
      </div>
      {same && <p className="muted small">Pick a different day or meal.</p>}
    </Modal>
  );
}

function SaveMealDialog({ meal, ids, onClose }: { meal: Meal; ids: string[]; onClose: () => void }) {
  const [name, setName] = useState(`My ${MEAL_LABEL[meal].toLowerCase()}`);
  const toast = useToast();
  function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim()) return;
    const m = store.saveMealFromEntries(name, ids);
    toast({ message: `Saved “${m.name}”. Find it under Saved meals when you add food.`, tone: 'success' });
    onClose();
  }
  return (
    <Modal
      title="Save as a meal"
      variant="compact"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!name.trim()} onClick={() => save()}>
            Save
          </button>
        </>
      }
    >
      <form onSubmit={save}>
        <p className="muted small">Saved meals appear under "Saved meals" when you add food, so you can log them again in one tap.</p>
        <label>
          Name
          <input autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Entry editor
// ---------------------------------------------------------------------------

const GRAMS = '__g';

export function EntryEditor({ entry, onClose }: { entry: DiaryEntry; onClose: () => void }) {
  useStore();
  const undoDelete = useEntryUndo();
  const added = useAddedUndo();
  const marked = useLoggedDays();
  const food = entry.foodId ? store.get('foods', entry.foodId) : undefined;
  const isQuick = entry.grams == null;
  const servings = food?.servings ?? [];
  const initialServing = entry.servingLabel && servings.some((s) => s.label === entry.servingLabel) ? entry.servingLabel : GRAMS;
  const [serving, setServing] = useState(initialServing);
  const [qty, setQty] = useState<number | null>(initialServing === GRAMS ? round(entry.grams ?? 0, 1) : entry.quantity);
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [day, setDay] = useState(entry.date);
  const [quick, setQuick] = useState<NutrientMap>({ ...entry.nutrients });
  const [name, setName] = useState(entry.name);
  const [copy, setCopy] = useState<{ day: string; meal: Meal } | null>(null);

  const totalGrams = serving === GRAMS ? (qty ?? 0) : (servings.find((s) => s.label === serving)?.grams ?? 0) * (qty ?? 0);
  const nutrients: NutrientMap = isQuick
    ? quick
    : food
      ? scaleNutrients(food.nutrients, totalGrams)
      : multiplyNutrients(entry.nutrients, entry.grams ? totalGrams / entry.grams : 1);
  const canSave = isQuick ? (quick[N.energy] ?? 0) >= 0 && quick[N.energy] != null : totalGrams > 0;

  function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSave) return;
    if (isQuick) store.update('diaryEntries', entry.id, { nutrients: quick, name: name.trim() || 'Quick add' });
    else
      store.update('diaryEntries', entry.id, {
        grams: totalGrams,
        servingLabel: serving === GRAMS ? null : serving,
        quantity: serving === GRAMS ? 1 : (qty ?? 1),
        nutrients,
      });
    if (day !== entry.date || meal !== entry.meal) store.moveEntry(entry.id, { day, meal });
    onClose();
  }

  return (
    <Modal
      title="Edit entry"
      onClose={onClose}
      footer={
        <>
          <button
            className="danger"
            onClick={() => {
              store.remove('diaryEntries', entry.id);
              undoDelete([entry.id], `Deleted “${entry.name}”.`);
              onClose();
            }}
          >
            <Icon name="trash" size={18} /> Delete
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => save()} disabled={!canSave}>
            Save
          </button>
        </>
      }
    >
      <form onSubmit={save}>
        {isQuick ? (
          <>
            <label>
              Name
              <input value={name} maxLength={300} onChange={(e) => setName(e.target.value)} />
            </label>
            <MacroInputs value={quick} onChange={setQuick} />
          </>
        ) : (
          <>
            <p className="entry-title">{entry.name}</p>
            <div className="form-grid">
              <label>
                Amount
                <NumberInput value={qty} onChange={setQty} />
              </label>
              <label>
                Unit
                <select
                  value={serving}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === GRAMS) setQty(round(totalGrams, 1));
                    else setQty(1);
                    setServing(v);
                  }}
                >
                  <option value={GRAMS}>grams</option>
                  {servings.map((s) => (
                    <option key={s.label} value={s.label}>
                      {servingOption(s)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <NutrientSummary n={nutrients} />
          </>
        )}
        <div className="form-grid">
          <label>
            Meal
            <MealSelect value={meal} onChange={setMeal} />
          </label>
          <label>
            Day
            <DateField value={day} onChange={setDay} marked={marked} />
          </label>
        </div>
        {/* Enter in a field saves */}
        <button type="submit" hidden />
      </form>
      <details
        className="disclosure"
        open={!!copy}
        onToggle={(e) => setCopy((e.target as HTMLDetailsElement).open ? (copy ?? { day: addDays(entry.date, 1), meal: entry.meal }) : null)}
      >
        <summary>Copy to another day</summary>
        {copy && (
          <div className="form-grid">
            <label>
              Day
              <DateField value={copy.day} onChange={(d) => setCopy({ ...copy, day: d })} marked={marked} />
            </label>
            <label>
              Meal
              <MealSelect value={copy.meal} onChange={(m) => setCopy({ ...copy, meal: m })} />
            </label>
            <button
              className="span-2"
              onClick={() => {
                const rows = store.copyEntries([entry.id], copy);
                added(
                  rows.map((r) => r.id),
                  `Copied to ${MEAL_LABEL[copy.meal].toLowerCase()}, ${formatDay(copy.day, true)}.`,
                );
                onClose();
              }}
            >
              <Icon name="copy" size={18} /> Copy
            </button>
          </div>
        )}
      </details>
      {entry.source === 'off' && <p className="attribution">Product data: Open Food Facts contributors (ODbL).</p>}
    </Modal>
  );
}

/** "1 cup (158 g)", without repeating grams for labels like "100 g". */
export function servingOption(s: { label: string; grams: number }): string {
  const g = `${grams(s.grams)} g`;
  return s.label.includes(g) || /^\s*[\d.,]+\s*g\s*$/i.test(s.label) ? s.label : `${s.label} (${g})`;
}

export function NutrientSummary({ n }: { n: NutrientMap }) {
  return (
    <div className="nutrient-summary">
      <div>
        <strong>{kcal(n[N.energy])}</strong>
        <span>kcal</span>
      </div>
      <div className="m-p">
        <strong>{grams(n[N.protein])}</strong>
        <span>protein g</span>
      </div>
      <div className="m-c">
        <strong>{grams(n[N.carbs])}</strong>
        <span>carbs g</span>
      </div>
      <div className="m-f">
        <strong>{grams(n[N.fat])}</strong>
        <span>fat g</span>
      </div>
    </div>
  );
}

export function MacroInputs({ value, onChange }: { value: NutrientMap; onChange: (n: NutrientMap) => void }) {
  const set = (k: string, v: number | null) => {
    const next = { ...value };
    if (v == null) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const fields: [string, string][] = [
    [N.energy, 'Calories (kcal)'],
    [N.protein, 'Protein (g)'],
    [N.carbs, 'Carbs (g)'],
    [N.fat, 'Fat (g)'],
  ];
  return (
    <div className="form-grid four">
      {fields.map(([k, l]) => (
        <label key={k}>
          {l}
          <NumberInput value={value[k] ?? null} onChange={(v) => set(k, v)} />
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portion picker: choose an amount of a food and log it
// ---------------------------------------------------------------------------

export function FoodPortion({
  food,
  day,
  meal: initialMeal,
  onLogged,
  onBack,
  note,
}: {
  food: Food | FoodData;
  day: string;
  meal: Meal;
  onLogged: (entry: DiaryEntry, meal: Meal) => void;
  onBack?: () => void;
  note?: React.ReactNode;
}) {
  useStore();
  const servings = food.servings ?? [];
  const firstServing = servings.find((s) => s.label !== '100 g') ?? null;
  const [serving, setServing] = useState(firstServing ? firstServing.label : GRAMS);
  const [qty, setQty] = useState<number | null>(firstServing ? 1 : 100);
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const stored = storedCopy(food);
  const fav = stored?.favorite ?? false;

  const totalGrams = useMemo(
    () => (serving === GRAMS ? (qty ?? 0) : (servings.find((s) => s.label === serving)?.grams ?? 0) * (qty ?? 0)),
    [serving, qty, servings],
  );
  const nutrients = scaleNutrients(food.nutrients, totalGrams);

  function toggleFav() {
    const f = stored ?? store.ensureFood(food);
    store.update('foods', f.id, { favorite: !f.favorite });
  }

  function log(e?: React.FormEvent) {
    e?.preventDefault();
    if (!(totalGrams > 0)) return;
    const entry = store.logFood({
      day,
      meal,
      food,
      grams: totalGrams,
      servingLabel: serving === GRAMS ? null : serving,
      quantity: serving === GRAMS ? 1 : (qty ?? 1),
    });
    onLogged(entry, meal);
  }

  return (
    <form className="portion" onSubmit={log}>
      <div className="portion-head">
        {onBack && (
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to results">
            <Icon name="left" />
          </button>
        )}
        <div className="portion-title">
          <strong>{food.name}</strong>
          <span className="muted small">
            {[food.brand, SOURCE_LABEL[food.source], `${kcal(food.nutrients[N.energy])} kcal / 100 g`].filter(Boolean).join(' · ')}
          </span>
        </div>
        <button
          type="button"
          className={`icon-btn ${fav ? 'fav' : ''}`}
          onClick={toggleFav}
          aria-pressed={fav}
          aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
          title={fav ? 'Remove from favourites' : 'Add to favourites'}
        >
          <Icon name="star" filled={fav} />
        </button>
      </div>
      <div className="form-grid">
        <label>
          Amount
          <NumberInput value={qty} onChange={setQty} />
        </label>
        <label>
          Unit
          <select
            value={serving}
            onChange={(e) => {
              const v = e.target.value;
              setQty(v === GRAMS ? round(totalGrams || 100, 1) : 1);
              setServing(v);
            }}
          >
            <option value={GRAMS}>grams</option>
            {servings.map((s) => (
              <option key={s.label} value={s.label}>
                {servingOption(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="span-2">
          Meal
          <MealSelect value={meal} onChange={setMeal} />
        </label>
      </div>
      <NutrientSummary n={nutrients} />
      {note}
      <button type="submit" className="primary block" disabled={!(totalGrams > 0)}>
        Add to {MEAL_LABEL[meal].toLowerCase()}
      </button>
    </form>
  );
}

/** The user's stored copy of a food (itself, or the cached copy of a builtin/OFF food), if any. */
export function storedCopy(food: Food | FoodData): Food | undefined {
  const id = 'id' in food ? (food.id as string | undefined) : undefined;
  if (isStoredFoodId(id)) return store.get('foods', id!);
  const source = id?.startsWith('usda:') ? 'usda' : food.source;
  const sourceId = id?.startsWith('usda:') && food.sourceId == null ? id.slice(5) : food.sourceId;
  if (sourceId == null) return undefined;
  return store.all('foods').find((f) => f.source === source && f.sourceId === sourceId);
}

export function FoodRow({ food, onPick, hint }: { food: Food | FoodData; onPick: () => void; hint?: string }) {
  const fav = 'favorite' in food && food.favorite;
  return (
    <li>
      <button type="button" className="food-row" onClick={onPick}>
        <span className="entry-main">
          <span className="entry-name">
            {fav && <Icon name="star" size={14} filled />} {food.name}
          </span>
          <span className="entry-sub">{[hint, food.brand, SOURCE_LABEL[food.source]].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="entry-kcal">
          {kcal(food.nutrients[N.energy])}
          <small> kcal/100 g</small>
        </span>
      </button>
    </li>
  );
}
