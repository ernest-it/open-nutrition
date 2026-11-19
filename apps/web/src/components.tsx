import { useMemo, useState } from 'react';
import {
  addDays,
  multiplyNutrients,
  N,
  scaleNutrients,
  type DiaryEntry,
  type Food,
  type FoodData,
  type Meal,
  type NutrientMap,
} from '@open-nutrition/shared';
import { store, useStore } from './state';
import { useAddFood } from './addFood';
import { grams, Icon, kcal, MEAL_LABEL, MealSelect, Modal, NumberInput, round } from './ui';

export function MacroLine({ n, className = '' }: { n: NutrientMap; className?: string }) {
  return (
    <span className={`macro-line ${className}`}>
      <span className="m-p">P {grams(n[N.protein])}g</span>
      <span className="m-c">C {grams(n[N.carbs])}g</span>
      <span className="m-f">F {grams(n[N.fat])}g</span>
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

export function entryAmount(e: DiaryEntry): string {
  if (e.servingLabel) return `${e.quantity === 1 ? '' : `${round(e.quantity, 2)} × `}${e.servingLabel}${e.grams != null ? ` (${grams(e.grams)} g)` : ''}`;
  if (e.grams != null) return `${grams(e.grams)} g`;
  return SOURCE_LABEL[e.source] ?? '';
}

// ---------------------------------------------------------------------------
// Meal section (Today + Diary)
// ---------------------------------------------------------------------------

export function MealSection({ day, meal, entries, tools = true }: { day: string; meal: Meal; entries: DiaryEntry[]; tools?: boolean }) {
  const openAdd = useAddFood();
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [menu, setMenu] = useState(false);
  const [copyTo, setCopyTo] = useState(false);
  const [saveAs, setSaveAs] = useState(false);
  const total = entries.reduce((a, e) => a + (e.nutrients[N.energy] ?? 0), 0);
  const yesterday = store.entriesOn(addDays(day, -1)).filter((e) => e.meal === meal);

  return (
    <section className="meal card">
      <header className="meal-head">
        <div className="meal-title">
          <h3>{MEAL_LABEL[meal]}</h3>
          <span className="muted">{entries.length ? `${kcal(total)} kcal` : 'Nothing logged'}</span>
        </div>
        <div className="meal-actions">
          {tools && (
            <div className="menu-wrap">
              <button className="icon-btn" aria-label={`${MEAL_LABEL[meal]} options`} aria-expanded={menu} onClick={() => setMenu(!menu)}>
                <Icon name="more" />
              </button>
              {menu && (
                <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
                  <button
                    role="menuitem"
                    disabled={!yesterday.length}
                    onClick={() => {
                      store.copyMealFromYesterday(day, meal);
                      setMenu(false);
                    }}
                  >
                    <Icon name="history" size={18} /> Copy yesterday's {MEAL_LABEL[meal].toLowerCase()}
                    {yesterday.length ? ` (${yesterday.length})` : ''}
                  </button>
                  <button
                    role="menuitem"
                    disabled={!entries.length}
                    onClick={() => {
                      setCopyTo(true);
                      setMenu(false);
                    }}
                  >
                    <Icon name="copy" size={18} /> Copy this meal to…
                  </button>
                  <button
                    role="menuitem"
                    disabled={!entries.length}
                    onClick={() => {
                      setSaveAs(true);
                      setMenu(false);
                    }}
                  >
                    <Icon name="bowl" size={18} /> Save as a meal
                  </button>
                </div>
              )}
            </div>
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
              <button className="entry" onClick={() => setEditing(e)}>
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
        <button className="link small pad-x" onClick={() => store.copyMealFromYesterday(day, meal)}>
          Copy yesterday's {MEAL_LABEL[meal].toLowerCase()} ({yesterday.length} item{yesterday.length > 1 ? 's' : ''})
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
  return (
    <Modal
      title={`Copy ${MEAL_LABEL[meal].toLowerCase()}`}
      onClose={onClose}
      footer={
        <button
          className="primary"
          disabled={!to}
          onClick={() => {
            store.copyEntries(ids, { day: to, meal: toMeal });
            onClose();
          }}
        >
          Copy {ids.length} item{ids.length > 1 ? 's' : ''}
        </button>
      }
    >
      <div className="form-grid">
        <label>
          To day
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Meal
          <MealSelect value={toMeal} onChange={setToMeal} />
        </label>
      </div>
    </Modal>
  );
}

function SaveMealDialog({ meal, ids, onClose }: { meal: Meal; ids: string[]; onClose: () => void }) {
  const [name, setName] = useState(`My ${MEAL_LABEL[meal].toLowerCase()}`);
  return (
    <Modal
      title="Save as a meal"
      onClose={onClose}
      footer={
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() => {
            store.saveMealFromEntries(name, ids);
            onClose();
          }}
        >
          Save
        </button>
      }
    >
      <p className="muted small">Saved meals appear under "Saved" when you add food, so you can log them again in one tap.</p>
      <label>
        Name
        <input autoFocus value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Entry editor
// ---------------------------------------------------------------------------

const GRAMS = '__g';

export function EntryEditor({ entry, onClose }: { entry: DiaryEntry; onClose: () => void }) {
  useStore();
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

  function save() {
    if (isQuick) store.update('diaryEntries', entry.id, { nutrients: quick, name: name.trim() || 'Quick add' });
    else
      store.update('diaryEntries', entry.id, {
        grams: totalGrams,
        servingLabel: serving === GRAMS ? null : serving,
        quantity: serving === GRAMS ? 1 : (qty ?? 1),
        nutrients,
      });
    if (day !== entry.date || meal !== entry.meal) store.moveEntry(entry.id, { day: day || entry.date, meal });
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
              onClose();
            }}
          >
            <Icon name="trash" size={18} /> Delete
          </button>
          <span className="spacer" />
          <button className="primary" onClick={save} disabled={!isQuick && !(totalGrams > 0)}>
            Save
          </button>
        </>
      }
    >
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
              <select value={serving} onChange={(e) => {
                const v = e.target.value;
                if (v === GRAMS) setQty(round(totalGrams, 1));
                else setQty(1);
                setServing(v);
              }}>
                <option value={GRAMS}>grams</option>
                {servings.map((s) => (
                  <option key={s.label} value={s.label}>
                    {s.label} ({grams(s.grams)} g)
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
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
      </div>
      <details className="disclosure" open={!!copy} onToggle={(e) => setCopy((e.target as HTMLDetailsElement).open ? (copy ?? { day: addDays(entry.date, 1), meal: entry.meal }) : null)}>
        <summary>Copy to another day</summary>
        {copy && (
          <div className="form-grid">
            <label>
              Day
              <input type="date" value={copy.day} onChange={(e) => setCopy({ ...copy, day: e.target.value })} />
            </label>
            <label>
              Meal
              <MealSelect value={copy.meal} onChange={(m) => setCopy({ ...copy, meal: m })} />
            </label>
            <button
              className="span-2"
              disabled={!copy.day}
              onClick={() => {
                store.copyEntries([entry.id], copy);
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
  onLogged: () => void;
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

  return (
    <div className="portion">
      <div className="portion-head">
        {onBack && (
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <Icon name="left" />
          </button>
        )}
        <div className="portion-title">
          <strong>{food.name}</strong>
          <span className="muted small">
            {[food.brand, SOURCE_LABEL[food.source]].filter(Boolean).join(' · ')} · {kcal(food.nutrients[N.energy])} kcal / 100 g
          </span>
        </div>
        <button className={`icon-btn ${fav ? 'fav' : ''}`} onClick={toggleFav} aria-pressed={fav} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}>
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
                {s.label} ({grams(s.grams)} g)
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
      <button
        className="primary block"
        disabled={!(totalGrams > 0)}
        onClick={() => {
          store.logFood({
            day,
            meal,
            food,
            grams: totalGrams,
            servingLabel: serving === GRAMS ? null : serving,
            quantity: serving === GRAMS ? 1 : (qty ?? 1),
          });
          onLogged();
        }}
      >
        Add to {MEAL_LABEL[meal].toLowerCase()}
      </button>
    </div>
  );
}

/** The user's stored copy of a food (itself, or the cached copy of a builtin/OFF food), if any. */
export function storedCopy(food: Food | FoodData): Food | undefined {
  const id = 'id' in food ? (food.id as string | undefined) : undefined;
  if (id && !id.startsWith('usda:')) return store.get('foods', id);
  const source = id?.startsWith('usda:') ? 'usda' : food.source;
  const sourceId = id?.startsWith('usda:') && food.sourceId == null ? id.slice(5) : food.sourceId;
  if (sourceId == null) return undefined;
  return store.all('foods').find((f) => f.source === source && f.sourceId === sourceId);
}

export function FoodRow({ food, onPick, hint }: { food: Food | FoodData; onPick: () => void; hint?: string }) {
  const fav = 'favorite' in food && food.favorite;
  return (
    <li>
      <button className="food-row" onClick={onPick}>
        <span className="entry-main">
          <span className="entry-name">
            {fav && <Icon name="star" size={14} filled />} {food.name}
          </span>
          <span className="entry-sub">{[hint, food.brand, SOURCE_LABEL[food.source]].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="entry-kcal">
          {kcal(food.nutrients[N.energy])}
          <small> /100g</small>
        </span>
      </button>
    </li>
  );
}
