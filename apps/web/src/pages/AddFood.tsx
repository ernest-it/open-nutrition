import { useEffect, useState } from 'react';
import { isValidBarcode, kcalFromMacros, N, OFF_ATTRIBUTION, sumNutrients, type Food, type FoodData, type Meal, type NutrientMap } from '@open-nutrition/shared';
import type { AddRequest, AddTab } from '../addFood';
import { errorMessage, usePrefs, useStore, store } from '../state';
import { getAiStatus, lookupBarcode, searchFoods, searchLocalFoods, type AiStatus, type BarcodeSource } from '../foodApi';
import { FoodPortion, FoodRow, MacroInputs, NutrientSummary } from '../components';
import { FoodEditor } from './Foods';
import { AiLog } from './AiLog';
import { dayLabel, Empty, Icon, kcal, MEAL_LABEL, MealSelect, Modal, type IconName } from '../ui';

export function AddFoodSheet({ request, onClose }: { request: AddRequest; onClose: () => void }) {
  const prefs = usePrefs();
  const [tab, setTab] = useState<AddTab>(request.tab ?? 'search');
  const [day, setDay] = useState(request.day);
  const [meal, setMeal] = useState<Meal>(request.meal);
  const [flash, setFlash] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);

  useEffect(() => {
    void getAiStatus().then(setAi);
  }, []);

  const showPhoto = !!ai?.enabled;
  const tabs: [AddTab, string, IconName][] = [
    ['search', 'Search', 'search'],
    ['barcode', 'Barcode', 'barcode'],
    ...(showPhoto ? ([['photo', 'Photo / describe', 'camera']] as [AddTab, string, IconName][]) : []),
    ['quick', 'Quick add', 'bolt'],
    ['saved', 'Saved meals', 'bowl'],
  ];
  const logged = (what: string, m: Meal = meal) => setFlash(`Added ${what} to ${MEAL_LABEL[m].toLowerCase()}, ${dayLabel(day).toLowerCase()}.`);

  return (
    <Modal title="Add food" onClose={onClose} wide>
      <div className="add-target">
        <label>
          Meal
          <MealSelect value={meal} onChange={setMeal} />
        </label>
        <label>
          Day
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
      </div>
      <div className="add-tabs" role="tablist">
        {tabs.map(([k, l, icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <Icon name={icon} size={18} />
            <span>{l}</span>
          </button>
        ))}
      </div>
      {flash && (
        <div className="flash" role="status">
          <Icon name="check" size={18} /> <span>{flash}</span>
          <button className="small" onClick={onClose}>
            Done
          </button>
        </div>
      )}
      {tab === 'search' && <SearchTab day={day} meal={meal} onLogged={logged} />}
      {tab === 'barcode' && <BarcodeTab day={day} meal={meal} onLogged={logged} />}
      {tab === 'photo' && showPhoto && ai && (
        <AiLog day={day} meal={meal} setMeal={setMeal} status={ai} prefs={prefs} onLogged={(n) => logged(`${n} item${n === 1 ? '' : 's'}`)} />
      )}
      {tab === 'quick' && <QuickTab day={day} meal={meal} onLogged={logged} />}
      {tab === 'saved' && <SavedTab day={day} meal={meal} onLogged={logged} />}
    </Modal>
  );
}

interface TabProps {
  day: string;
  meal: Meal;
  onLogged: (what: string) => void;
}

// ---------------------------------------------------------------------------

function SearchTab({ day, meal, onLogged }: TabProps) {
  useStore();
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Food[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Food | FoodData | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setRemote([]);
      setError(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      searchFoods(text, 30, ctl.signal)
        .then((r) => {
          setRemote(r);
          setError(null);
        })
        .catch((e) => {
          if (!ctl.signal.aborted) setError(errorMessage(e));
        })
        .finally(() => !ctl.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  if (picked)
    return (
      <FoodPortion
        food={picked}
        day={day}
        meal={meal}
        onBack={() => setPicked(null)}
        onLogged={() => {
          onLogged(picked.name);
          setPicked(null);
        }}
      />
    );

  const text = q.trim();
  const local = text ? searchLocalFoods(text) : [];
  const localUsda = new Set(local.filter((f) => f.source === 'usda').map((f) => f.sourceId));
  const server = remote.filter((f) => !localUsda.has(f.sourceId ?? f.id.replace('usda:', '')));
  const favs = store.favoriteFoods();
  const recents = store.recentFoods(20).filter((f) => !f.favorite);

  return (
    <div>
      <div className="search-box">
        <Icon name="search" size={20} />
        <input autoFocus type="search" placeholder="Search foods, e.g. “greek yogurt”" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search foods" />
      </div>
      {!text && (
        <>
          {favs.length > 0 && (
            <>
              <h4 className="list-title">Favourites</h4>
              <ul className="list">
                {favs.map((f) => (
                  <FoodRow key={f.id} food={f} onPick={() => setPicked(f)} />
                ))}
              </ul>
            </>
          )}
          <h4 className="list-title">Recent</h4>
          {recents.length ? (
            <ul className="list">
              {recents.map((f) => (
                <FoodRow key={f.id} food={f} onPick={() => setPicked(f)} />
              ))}
            </ul>
          ) : (
            <Empty>Foods you log will show up here for quick re-use.</Empty>
          )}
        </>
      )}
      {text && (
        <>
          {local.length > 0 && (
            <>
              <h4 className="list-title">Your foods</h4>
              <ul className="list">
                {local.map((f) => (
                  <FoodRow key={f.id} food={f} onPick={() => setPicked(f)} />
                ))}
              </ul>
            </>
          )}
          <h4 className="list-title">
            Food database {loading && <span className="spinner" aria-label="Loading" />}
          </h4>
          {error && <p className="error">{error}</p>}
          {server.length > 0 ? (
            <ul className="list">
              {server.map((f) => (
                <FoodRow key={f.id} food={f} onPick={() => setPicked(f)} />
              ))}
            </ul>
          ) : (
            !loading && !error && text.length >= 2 && <Empty>No matches in the database.</Empty>
          )}
        </>
      )}
      <button className="link pad-y" onClick={() => setCreating(true)}>
        <Icon name="plus" size={18} /> Create a custom food
      </button>
      {creating && (
        <FoodEditor
          initial={text ? { name: text } : undefined}
          onClose={() => setCreating(false)}
          onSaved={(f) => {
            setCreating(false);
            setPicked(f);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BarcodeTab({ day, meal, onLogged }: TabProps) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ food: Food | FoodData | null; source: BarcodeSource; code: string } | null>(null);
  const [creating, setCreating] = useState(false);

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    const c = code.replace(/\D/g, '');
    setError(null);
    setResult(null);
    if (!isValidBarcode(c)) {
      setError('That doesn’t look like a valid barcode. Check the digits (EAN-8, UPC or EAN-13).');
      return;
    }
    setBusy(true);
    try {
      setResult({ ...(await lookupBarcode(c)), code: c });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (result?.food)
    return (
      <FoodPortion
        food={result.food}
        day={day}
        meal={meal}
        onBack={() => setResult(null)}
        onLogged={() => {
          onLogged(result.food!.name);
          setResult(null);
          setCode('');
        }}
        note={result.source === 'off' || result.food.source === 'off' ? <p className="attribution">{OFF_ATTRIBUTION}</p> : undefined}
      />
    );

  return (
    <div>
      <form className="row" onSubmit={lookup}>
        <input
          autoFocus
          inputMode="numeric"
          pattern="[0-9 ]*"
          placeholder="Type the digits under the barcode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Barcode"
        />
        <button className="primary" type="submit" disabled={busy || !code.trim()}>
          {busy ? 'Looking up…' : 'Look up'}
        </button>
      </form>
      <p className="muted small">Packaged foods are looked up in Open Food Facts, a free, community-made database.</p>
      {error && <p className="error">{error}</p>}
      {result && !result.food && (
        <div className="card callout">
          <strong>Not found</strong>
          <span>Nobody has added {result.code} yet. You can create it from the label, and it will be remembered for next time.</span>
          <button className="primary" onClick={() => setCreating(true)}>
            Create food from label
          </button>
        </div>
      )}
      {creating && result && (
        <FoodEditor
          initial={{ barcode: result.code }}
          onClose={() => setCreating(false)}
          onSaved={(f) => {
            setCreating(false);
            setResult({ food: f, source: 'local', code: result.code });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuickTab({ day, meal, onLogged }: TabProps) {
  const [name, setName] = useState('');
  const [n, setN] = useState<NutrientMap>({});
  const kcalValue = n[N.energy] ?? (n[N.protein] != null || n[N.carbs] != null || n[N.fat] != null ? Math.round(kcalFromMacros(n)) : null);
  return (
    <div>
      <p className="muted small">Know the numbers already? Type them in. Leave calories blank to work them out from the macros.</p>
      <label>
        Description (optional)
        <input value={name} maxLength={300} placeholder="e.g. Office birthday cake" onChange={(e) => setName(e.target.value)} />
      </label>
      <MacroInputs value={n} onChange={setN} />
      <button
        className="primary block"
        disabled={!kcalValue}
        onClick={() => {
          store.quickAdd({ day, meal, name, nutrients: { ...n, [N.energy]: kcalValue ?? 0 } });
          onLogged(name.trim() || `${kcalValue} kcal`);
          setName('');
          setN({});
        }}
      >
        Add {kcalValue ? `${kcalValue} kcal` : ''}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SavedTab({ day, meal, onLogged }: TabProps) {
  const s = useStore();
  const meals = s.all('savedMeals').sort((a, b) => a.name.localeCompare(b.name));
  const [open, setOpen] = useState<string | null>(null);
  if (!meals.length)
    return <Empty>No saved meals yet. In your diary, open a meal's ⋯ menu and choose “Save as a meal” to reuse it later.</Empty>;
  return (
    <ul className="list">
      {meals.map((m) => {
        const total = sumNutrients(m.items.map((i) => i.nutrients));
        return (
          <li key={m.id} className="saved-meal">
            <div className="saved-row">
              <button className="entry grow" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id}>
                <span className="entry-main">
                  <span className="entry-name">{m.name}</span>
                  <span className="entry-sub">
                    {m.items.length} item{m.items.length === 1 ? '' : 's'} · {kcal(total[N.energy])} kcal
                  </span>
                </span>
              </button>
              <button
                className="primary small-btn"
                onClick={() => {
                  s.logSavedMeal(m.id, day, meal);
                  onLogged(m.name);
                }}
              >
                Log
              </button>
            </div>
            {open === m.id && (
              <div className="saved-detail">
                <ul className="plain">
                  {m.items.map((it, i) => (
                    <li key={i} className="row between">
                      <span className="grow ellipsis">{it.name}</span>
                      <span className="muted">{kcal(it.nutrients[N.energy])} kcal</span>
                    </li>
                  ))}
                </ul>
                <NutrientSummary n={total} />
                <button className="danger small" onClick={() => confirm(`Delete “${m.name}”?`) && s.remove('savedMeals', m.id)}>
                  <Icon name="trash" size={16} /> Delete saved meal
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
