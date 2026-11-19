import { useState } from 'react';
import { CORE_NUTRIENTS, N, NUTRIENTS, type Food, type FoodData, type NutrientMap, type Serving } from '@open-nutrition/shared';
import { restoreRows, store, useStore } from '../state';
import { SOURCE_LABEL, servingOption } from '../components';
import { InlineError, useConfirm, useToast } from '../feedback';
import { Empty, Icon, kcal, Modal, NumberInput, Segmented } from '../ui';

type View = 'custom' | 'favorites' | 'all';

export function FoodsPage() {
  const s = useStore();
  const toast = useToast();
  const [view, setView] = useState<View>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Food | 'new' | null>(null);
  const all = s.all('foods').sort((a, b) => a.name.localeCompare(b.name));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = all
    .filter((f) => (view === 'custom' ? f.source === 'custom' : view === 'favorites' ? f.favorite : true))
    .filter((f) => words.every((w) => `${f.name} ${f.brand ?? ''}`.toLowerCase().includes(w)));

  return (
    <div className="page">
      <header className="page-head">
        <h1>Foods</h1>
        <button className="primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> New food
        </button>
      </header>
      <div className="toolbar">
        <Segmented
          value={view}
          onChange={setView}
          label="Which foods"
          options={[
            ['all', 'All used'],
            ['custom', 'My foods'],
            ['favorites', 'Favourites'],
          ]}
        />
        <div className="search-box toolbar-search">
          <Icon name="search" size={18} />
          <input type="search" placeholder="Filter by name or brand" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter foods" />
        </div>
      </div>
      {list.length ? (
        <ul className="list cards-md">
          {list.map((f) => (
            <li key={f.id} className="food-item">
              <button className="food-row" onClick={() => setEditing(f)}>
                <span className="entry-main">
                  <span className="entry-name">{f.name}</span>
                  <span className="entry-sub">
                    {[f.brand, SOURCE_LABEL[f.source], f.servings.find((x) => x.label !== '100 g')?.label].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="entry-kcal">
                  {kcal(f.nutrients[N.energy])}
                  <small> kcal/100 g</small>
                </span>
              </button>
              <button
                className={`icon-btn ${f.favorite ? 'fav' : ''}`}
                aria-pressed={f.favorite}
                aria-label={f.favorite ? `Unfavourite ${f.name}` : `Favourite ${f.name}`}
                title={f.favorite ? 'Remove from favourites' : 'Add to favourites'}
                onClick={() => s.update('foods', f.id, { favorite: !f.favorite })}
              >
                <Icon name="star" filled={f.favorite} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          {words.length
            ? `No ${view === 'custom' ? 'custom foods' : view === 'favorites' ? 'favourites' : 'foods'} match “${q.trim()}”.`
            : view === 'custom'
            ? 'You haven’t created any foods yet. Add your own recipes, home-made dishes or anything missing from the database.'
            : view === 'favorites'
              ? 'Tap the star on any food to keep it at the top of your search.'
              : 'Foods you log are kept here.'}
        </Empty>
      )}
      {editing && (
        <FoodEditor
          food={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(f) => {
            setEditing(null);
            toast({ message: `Saved “${f.name}”.`, tone: 'success' });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FoodEditor({
  food,
  initial,
  onClose,
  onSaved,
}: {
  food?: Food;
  initial?: Partial<FoodData>;
  onClose: () => void;
  onSaved: (f: Food) => void;
}) {
  const base = { ...(food ?? {}), ...(initial ?? {}) } as Partial<FoodData>;
  const [name, setName] = useState(base.name ?? '');
  const [brand, setBrand] = useState(base.brand ?? '');
  const [barcode, setBarcode] = useState(base.barcode ?? '');
  const [servings, setServings] = useState<Serving[]>(() => (base.servings ?? []).filter((s) => s.label !== '100 g'));
  const [per100, setPer100] = useState<NutrientMap>({ ...(base.nutrients ?? {}) });
  const [basis, setBasis] = useState<number>(-1); // -1 = per 100 g, else serving index
  const [more, setMore] = useState(false);
  const [error, setError] = useState<{ field: 'name' | 'kcal'; text: string } | null>(null);
  const ask = useConfirm();
  const toast = useToast();

  const validServings = servings.filter((s) => s.label.trim() && s.grams > 0);
  const basisGrams = basis >= 0 ? (validServings[basis]?.grams ?? 100) : 100;
  const shown = more ? NUTRIENTS : CORE_NUTRIENTS;
  const display = (k: string) => (per100[k] == null ? null : +((per100[k]! * basisGrams) / 100).toFixed(4));
  const setValue = (k: string, v: number | null) =>
    setPer100((m) => {
      const next = { ...m };
      if (v == null) delete next[k];
      else next[k] = (v * 100) / basisGrams;
      return next;
    });

  function save() {
    if (!name.trim()) {
      setError({ field: 'name', text: 'Give the food a name.' });
      document.getElementById('food-name')?.focus();
      return;
    }
    if (per100[N.energy] == null) {
      setError({ field: 'kcal', text: 'Enter the calories.' });
      document.querySelector<HTMLElement>('[data-nutrient="' + N.energy + '"] input')?.focus();
      return;
    }
    const saved = store.upsertFood({
      id: food?.id,
      name: name.trim().slice(0, 300),
      brand: brand.trim() || null,
      barcode: barcode.replace(/\D/g, '') || null,
      source: food?.source ?? 'custom',
      sourceId: food?.sourceId ?? null,
      servings: [{ label: '100 g', grams: 100 }, ...validServings.map((s) => ({ label: s.label.trim().slice(0, 100), grams: s.grams }))],
      nutrients: Object.fromEntries(Object.entries(per100).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      favorite: food?.favorite ?? false,
    });
    onSaved(saved);
  }

  return (
    <Modal
      title={food ? 'Edit food' : 'New food'}
      onClose={onClose}
      wide
      footer={
        <>
          {food && (
            <button
              className="danger"
              onClick={async () => {
                const ok = await ask({
                  title: 'Delete this food?',
                  body: <>“{food.name}” will be removed from your foods. Diary entries that use it keep their numbers.</>,
                  confirmLabel: 'Delete food',
                  destructive: true,
                });
                if (!ok) return;
                store.remove('foods', food.id);
                toast({ message: `Deleted “${food.name}”.`, action: { label: 'Undo', onClick: () => restoreRows('foods', [food.id]) } });
                onClose();
              }}
            >
              <Icon name="trash" size={18} /> Delete
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      {food && food.source !== 'custom' && (
        <p className="note">This is your copy of a {SOURCE_LABEL[food.source]} food. Changes only affect your copy and future entries.</p>
      )}
      <div className="form-grid">
        <label className="span-2">
          Name
          <input
            id="food-name"
            autoFocus={!food}
            value={name}
            maxLength={300}
            onChange={(e) => {
              setName(e.target.value);
              if (error?.field === 'name') setError(null);
            }}
            placeholder="e.g. Mum's lentil soup"
            aria-invalid={error?.field === 'name'}
            aria-describedby={error?.field === 'name' ? 'food-error' : undefined}
          />
          {error?.field === 'name' && <InlineError id="food-error">{error.text}</InlineError>}
        </label>
        <label>
          Brand (optional)
          <input value={brand} maxLength={200} onChange={(e) => setBrand(e.target.value)} />
        </label>
        <label>
          Barcode (optional)
          <input inputMode="numeric" value={barcode} maxLength={32} onChange={(e) => setBarcode(e.target.value)} />
        </label>
      </div>

      <h4 className="list-title">Servings</h4>
      <p className="muted small">100 g is always available. Add the portions you use, like “1 bowl” or “1 slice”.</p>
      {servings.map((s, i) => (
        <div key={i} className="serving-row">
          <input
            value={s.label}
            placeholder="1 cup"
            aria-label="Serving name"
            maxLength={100}
            onChange={(e) => setServings((xs) => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <label className="inline-unit">
            <NumberInput value={s.grams || null} ariaLabel="Serving grams" onChange={(v) => setServings((xs) => xs.map((x, j) => (j === i ? { ...x, grams: v ?? 0 } : x)))} />
            <span>g</span>
          </label>
          <button
            className="icon-btn"
            aria-label="Remove serving"
            onClick={() => {
              setServings((xs) => xs.filter((_, j) => j !== i));
              setBasis(-1);
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ))}
      <button className="small" onClick={() => setServings((xs) => [...xs, { label: '', grams: 0 }])}>
        <Icon name="plus" size={16} /> Add serving
      </button>

      <div className="row between nutrients-head">
        <h4 className="list-title">Nutrition</h4>
        <label className="inline-label">
          Values are
          <select value={basis} onChange={(e) => setBasis(Number(e.target.value))}>
            <option value={-1}>per 100 g</option>
            {validServings.map((s, i) => (
              <option key={i} value={i}>
                per {servingOption(s)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="nutrient-inputs">
        {shown.map((n) => (
          <label key={n.key} data-nutrient={n.key} className={error?.field === 'kcal' && n.key === N.energy ? 'invalid' : ''}>
            <span>
              {n.name} <small>({n.unit})</small>
            </span>
            <NumberInput
              value={display(n.key)}
              onChange={(v) => {
                setValue(n.key, v);
                if (n.key === N.energy && error?.field === 'kcal') setError(null);
              }}
              ariaLabel={`${n.name} in ${n.unit}`}
            />
          </label>
        ))}
      </div>
      {error?.field === 'kcal' && <InlineError>{error.text}</InlineError>}
      <button className="link small" onClick={() => setMore(!more)} aria-expanded={more}>
        {more ? 'Show fewer nutrients' : `Show all ${NUTRIENTS.length} nutrients`}
      </button>
    </Modal>
  );
}
