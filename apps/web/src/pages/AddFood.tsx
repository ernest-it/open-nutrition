import { useEffect, useState } from 'react';
import { isValidBarcode, kcalFromMacros, N, OFF_ATTRIBUTION, sumNutrients, type Food, type FoodData, type Meal, type NutrientMap } from '@open-nutrition/shared';
import type { AddRequest, AddTab } from '../addFood';
import { errorMessage, removeRows, restoreRows, useLoggedDays, usePrefs, useStore, store } from '../state';
import { getAiStatus, lookupBarcode, searchFoods, searchLocalFoods, type AiStatus, type BarcodeSource } from '../foodApi';
import { FoodPortion, FoodRow, MacroInputs, NutrientSummary, plural } from '../components';
import { InlineError, Spinner, useConfirm, useToast } from '../feedback';
import { FoodEditor } from './Foods';
import { AiLog } from './AiLog';
import { DateField, Empty, formatDay, Icon, kcal, MEAL_LABEL, MealSelect, Modal, type IconName } from '../ui';

export function AddFoodSheet({ request, onClose }: { request: AddRequest; onClose: () => void }) {
  const prefs = usePrefs();
  const [tab, setTab] = useState<AddTab>(request.tab ?? 'search');
  const [day, setDay] = useState(request.day);
  const [meal, setMeal] = useState<Meal>(request.meal);
  const [flash, setFlash] = useState<{ text: string; ids: string[] } | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const marked = useLoggedDays();

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
  const logged = (what: string, ids: string[], m: Meal = meal) => {
    const when = formatDay(day, true);
    setFlash({ text: `Added ${what} to ${MEAL_LABEL[m].toLowerCase()}, ${/^[A-Z][a-z]+$/.test(when) ? when.toLowerCase() : when}.`, ids });
  };

  return (
    <Modal title="Add food" onClose={onClose} wide>
      <div className="add-target">
        <label>
          Meal
          <MealSelect value={meal} onChange={setMeal} />
        </label>
        <label>
          Day
          <DateField value={day} onChange={setDay} marked={marked} />
        </label>
      </div>
      <div className="add-tabs" role="tablist" aria-label="How to add food">
        {tabs.map(([k, l, icon]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'on' : ''}
            onClick={(e) => {
              setTab(k);
              setFlash(null);
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }}
          >
            <Icon name={icon} size={18} />
            <span>{l}</span>
          </button>
        ))}
      </div>
      {flash && (
        <div className="flash" role="status">
          <Icon name="check" size={18} /> <span>{flash.text}</span>
          {flash.ids.length > 0 && (
            <button
              className="small ghost"
              onClick={() => {
                removeRows('diaryEntries', flash.ids);
                setFlash(null);
              }}
            >
              Undo
            </button>
          )}
          <button className="small" onClick={onClose}>
            Done
          </button>
        </div>
      )}
      <div role="tabpanel">
        {tab === 'search' && <SearchTab day={day} meal={meal} onLogged={logged} />}
        {tab === 'barcode' && <BarcodeTab day={day} meal={meal} onLogged={logged} />}
        {tab === 'photo' && showPhoto && ai && (
          <AiLog day={day} meal={meal} setMeal={setMeal} status={ai} prefs={prefs} onLogged={(ids, m) => logged(plural(ids.length, 'item'), ids, m)} />
        )}
        {tab === 'quick' && <QuickTab day={day} meal={meal} onLogged={logged} />}
        {tab === 'saved' && <SavedTab day={day} meal={meal} onLogged={logged} />}
      </div>
    </Modal>
  );
}

interface TabProps {
  day: string;
  meal: Meal;
  onLogged: (what: string, ids: string[], meal?: Meal) => void;
}

// ---------------------------------------------------------------------------

function SearchTab({ day, meal, onLogged }: TabProps) {
  useStore();
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Food[]>([]);
  const [loading, setLoading] = useState(false);
  /** The query the current `remote`/`error` belong to (avoids flashing "no matches" while typing). */
  const [settled, setSettled] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Food | FoodData | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setRemote([]);
      setError(null);
      setLoading(false);
      setSettled(text);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      searchFoods(text, 30, ctl.signal)
        .then((r) => {
          setRemote(r);
          setError(null);
          setSettled(text);
        })
        .catch((e) => {
          if (ctl.signal.aborted) return;
          setRemote([]);
          setError(errorMessage(e));
          setSettled(text);
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
        onLogged={(entry, m) => {
          onLogged(picked.name, [entry.id], m);
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
  const searching = text.length >= 2 && (loading || settled !== text);

  return (
    <div>
      <div className="search-box">
        <Icon name="search" size={20} />
        <input
          autoFocus
          type="search"
          placeholder="Search foods, e.g. “greek yogurt”"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search foods"
          enterKeyHint="search"
        />
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
          <h4 className="list-title">Food database {searching && <Spinner label="Searching" />}</h4>
          <InlineError>{error}</InlineError>
          {text.length < 2 ? (
            <p className="muted small">Keep typing to search the database.</p>
          ) : server.length > 0 ? (
            <ul className={`list ${searching ? 'stale' : ''}`}>
              {server.map((f) => (
                <FoodRow key={f.id} food={f} onPick={() => setPicked(f)} />
              ))}
            </ul>
          ) : (
            !searching &&
            !error && <Empty>No matches for “{text}”. Try fewer or different words, or create it as a custom food.</Empty>
          )}
        </>
      )}
      <button type="button" className="link pad-y" onClick={() => setCreating(true)}>
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
    if (busy) return;
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
        onLogged={(entry, m) => {
          onLogged(result.food!.name, [entry.id], m);
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
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          aria-label="Barcode"
          aria-invalid={!!error}
          enterKeyHint="search"
        />
        <button className="primary" type="submit" disabled={busy || !code.trim()}>
          {busy ? (
            <>
              <Spinner /> Looking up…
            </>
          ) : (
            'Look up'
          )}
        </button>
      </form>
      <InlineError>{error}</InlineError>
      <p className="muted small">Packaged foods are looked up in Open Food Facts, a free, community-made database.</p>
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

  function add(e?: React.FormEvent) {
    e?.preventDefault();
    if (!kcalValue) return;
    const entry = store.quickAdd({ day, meal, name, nutrients: { ...n, [N.energy]: kcalValue } });
    onLogged(name.trim() || `${kcal(kcalValue)} kcal`, [entry.id]);
    setName('');
    setN({});
  }

  return (
    <form onSubmit={add}>
      <p className="muted small">Know the numbers already? Type them in. Leave calories blank to work them out from the macros.</p>
      <label>
        Description (optional)
        <input value={name} maxLength={300} placeholder="e.g. Office birthday cake" onChange={(e) => setName(e.target.value)} />
      </label>
      <MacroInputs value={n} onChange={setN} />
      <button type="submit" className="primary block" disabled={!kcalValue}>
        {kcalValue ? `Add ${kcal(kcalValue)} kcal` : 'Add'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------

function SavedTab({ day, meal, onLogged }: TabProps) {
  const s = useStore();
  const ask = useConfirm();
  const toast = useToast();
  const meals = s.all('savedMeals').sort((a, b) => a.name.localeCompare(b.name));
  const [open, setOpen] = useState<string | null>(null);
  if (!meals.length)
    return <Empty>No saved meals yet. In your diary, open a meal's ⋯ menu and choose “Save as a meal” to log it again later in one tap.</Empty>;
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
                    {plural(m.items.length, 'item')} · {kcal(total[N.energy])} kcal
                  </span>
                </span>
                <span className={`chevron ${open === m.id ? 'open' : ''}`} aria-hidden="true">
                  <Icon name="right" size={18} />
                </span>
              </button>
              <button
                className="primary small-btn"
                aria-label={`Log ${m.name}`}
                onClick={() => {
                  const rows = s.logSavedMeal(m.id, day, meal);
                  onLogged(m.name, rows.map((r) => r.id));
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
                      <span className="muted nowrap">{kcal(it.nutrients[N.energy])} kcal</span>
                    </li>
                  ))}
                </ul>
                <NutrientSummary n={total} />
                <button
                  className="danger small"
                  onClick={async () => {
                    const ok = await ask({
                      title: 'Delete saved meal?',
                      body: <>“{m.name}” will be removed from Saved meals. Diary entries you already logged from it stay.</>,
                      confirmLabel: 'Delete',
                      destructive: true,
                    });
                    if (!ok) return;
                    s.remove('savedMeals', m.id);
                    toast({ message: `Deleted “${m.name}”.`, action: { label: 'Undo', onClick: () => restoreRows('savedMeals', [m.id]) } });
                  }}
                >
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
