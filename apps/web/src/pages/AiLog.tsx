import { useEffect, useRef, useState } from 'react';
import {
  AI_MODELS,
  N,
  rescaleReviewItem,
  resolveEstimate,
  reviewItemToLog,
  sumNutrients,
  swapReviewItemFood,
  typicalMealCostUsd,
  type Food,
  type Meal,
  type Prefs,
  type ReviewItem,
} from '@open-nutrition/shared';
import { errorMessage, setPrefs, store } from '../state';
import { downscaleImage, requestEstimate, searchFoods, searchLocalFoods, sha256Base64, type AiEstimateResponse, type AiStatus } from '../foodApi';
import { FoodRow, MacroLine, NutrientSummary } from '../components';
import { Empty, grams, Icon, kcal, MEAL_LABEL, MealSelect, NumberInput } from '../ui';
import { InlineError, Spinner } from '../feedback';

export const formatUsd = (v: number) => (v < 0.01 ? `${(v * 100).toFixed(2)}¢` : v < 1 ? `${(v * 100).toFixed(1)}¢` : `$${v.toFixed(2)}`);
export const modelLabel = (id: string) => AI_MODELS.find((m) => m.id === id)?.label.split(' — ')[0] ?? id;

export function AiPrivacyNote() {
  return (
    <p className="note">
      <strong>Privacy:</strong> your photo and description go to your Open Nutrition server, which sends them to Anthropic's Claude to
      estimate the meal. The photo is not saved anywhere; only a fingerprint of it and the estimate are kept in your diary. Your
      browser never talks to Anthropic and never holds an API key.
    </p>
  );
}

export function pickModel(status: AiStatus, prefs: Prefs): string {
  if (!status.models.length || status.models.includes(prefs.aiModel)) return prefs.aiModel;
  return status.defaultModel || status.models[0]!;
}

type Item = ReviewItem & { key: number };

export function AiLog({
  day,
  meal,
  setMeal,
  status,
  prefs,
  onLogged,
}: {
  day: string;
  meal: Meal;
  setMeal: (m: Meal) => void;
  status: AiStatus;
  prefs: Prefs;
  onLogged: (ids: string[], meal: Meal) => void;
}) {
  const [photo, setPhoto] = useState<{ base64: string; dataUrl: string } | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiEstimateResponse | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [swapping, setSwapping] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  // Guards against a second request while one is running (a double click must not be billed twice).
  const sending = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const model = pickModel(status, prefs);
  const limitReached = status.monthlyLimit > 0 && status.usedThisMonth >= status.monthlyLimit;

  if (!prefs.aiEnabled)
    return (
      <div className="card callout">
        <strong>Log a meal from a photo or a description</strong>
        <span>
          Snap your plate or type what you ate (“two eggs, toast with butter, black coffee”). Claude estimates the foods and portions, then
          you review everything before it's saved.
        </span>
        <AiPrivacyNote />
        <p className="muted small">
          Uses {modelLabel(model)} · roughly {formatUsd(typicalMealCostUsd(model))} per meal, paid by whoever runs this server.
        </p>
        <button className="primary" onClick={() => setPrefs({ aiEnabled: true })}>
          Turn on AI meal logging
        </button>
      </div>
    );

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    try {
      setBusy('Preparing photo…');
      setPhoto(await downscaleImage(f, 1024, 0.85));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function estimate() {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    setBusy(status.webSearch ? 'Claude is looking at your meal and looking up brands… (up to a minute)' : 'Claude is looking at your meal…');
    try {
      const r = await requestEstimate({
        imageBase64: photo?.base64,
        mediaType: photo ? 'image/jpeg' : undefined,
        description: description.trim() || undefined,
        model,
        effort: prefs.aiEffort,
        webSearch: prefs.aiWebSearch,
      });
      setBusy('Matching foods to the database…');
      const resolved = await resolveEstimate(r.estimate, (q) => searchFoods(q, 10));
      setResult(r);
      setItems(resolved.map((it, i) => ({ ...it, key: i })));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  async function addAll() {
    if (!result || adding) return;
    setAdding(true);
    const photoHash = photo ? await sha256Base64(photo.base64) : null;
    const row = store.recordAiEstimate({
      date: day,
      meal,
      photoHash,
      description: description.trim() ? description.trim().slice(0, 4000) : null,
      model: result.model,
      response: result.estimate,
      accepted: items.map(({ key: _k, matchedFood, ...it }) => ({ ...it, matchedFoodId: matchedFood?.id ?? null, matchedFoodName: matchedFood?.name ?? null })),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    const ids = items.map((it) => store.logFood({ day, meal, ...reviewItemToLog(it), aiEstimateId: row.id }).id);
    onLogged(ids, meal);
    reset();
    setAdding(false);
  }

  function reset() {
    setResult(null);
    setItems([]);
    setPhoto(null);
    setDescription('');
    setSwapping(null);
  }

  const update = (key: number, fn: (it: Item) => Item) => setItems((xs) => xs.map((x) => (x.key === key ? fn(x) : x)));

  if (result) {
    const total = sumNutrients(items.map((i) => i.nutrients));
    return (
      <div className="review">
        <div className="review-head">
          <h3>Review before adding</h3>
          <span className="muted small">
            {modelLabel(result.model)}
            {result.webSearches ? ` · ${result.webSearches} web ${result.webSearches === 1 ? 'search' : 'searches'}` : ''} · cost {formatUsd(result.costUsd)}
          </span>
        </div>
        {result.estimate.assumptions.length > 0 && (
          <ul className="assumptions">
            {result.estimate.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        )}
        {items.length === 0 && <Empty>No items left. Start over to try again.</Empty>}
        <ul className="review-items">
          {items.map((it) => (
            <li key={it.key} className="review-item">
              <div className="row between nowrap">
                <div className="grow min0">
                  <strong className="ellipsis-2">{it.name}</strong>
                  <div className="muted small">
                    <span className={`conf conf-${it.confidence}`}>{it.confidence} confidence</span> ·{' '}
                    <ItemSource item={it} />
                  </div>
                </div>
                <strong className="nowrap">{kcal(it.nutrients[N.energy])} kcal</strong>
              </div>
              <div className="grams-row">
                <label className="grams-input">
                  <span className="sr-only">Grams</span>
                  <NumberInput value={Math.round(it.grams)} onChange={(v) => v != null && update(it.key, (x) => ({ ...rescaleReviewItem(x, v), key: x.key }))} ariaLabel={`Grams of ${it.name}`} />
                  <span>g</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={Math.max(100, Math.round(it.grams * 2.5))}
                  step={5}
                  value={Math.round(it.grams)}
                  onChange={(e) => update(it.key, (x) => ({ ...rescaleReviewItem(x, Number(e.target.value)), key: x.key }))}
                  aria-label={`Portion of ${it.name}`}
                />
              </div>
              {!!it.portionOptions?.length && (
                <div className="portion-options" role="group" aria-label={`How much ${it.name} was it?`}>
                  <span className="muted small">How much was it?</span>
                  {it.portionOptions.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={`small ${Math.round(p.grams) === Math.round(it.grams) ? 'active' : ''}`}
                      aria-pressed={Math.round(p.grams) === Math.round(it.grams)}
                      onClick={() => update(it.key, (x) => ({ ...rescaleReviewItem(x, p.grams), key: x.key }))}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              <MacroLine n={it.nutrients} className="small" />
              {it.notes && <p className="muted small">{it.notes}</p>}
              <div className="row">
                <button className="small" onClick={() => setSwapping(swapping === it.key ? null : it.key)}>
                  <Icon name="search" size={16} /> {swapping === it.key ? 'Cancel' : 'Swap food'}
                </button>
                <button className="small danger" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>
                  <Icon name="trash" size={16} /> Remove
                </button>
              </div>
              {swapping === it.key && (
                <SwapSearch
                  initial={it.usdaQuery || it.name}
                  onPick={(f) => {
                    update(it.key, (x) => ({ ...swapReviewItemFood(x, f), key: x.key }));
                    setSwapping(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
        <NutrientSummary n={total} />
        <div className="form-grid">
          <label>
            Meal
            <MealSelect value={meal} onChange={setMeal} />
          </label>
          <div className="actions-end">
            <button onClick={reset}>Start over</button>
            <button className="primary" disabled={!items.length || adding} onClick={() => void addAll()}>
              Add {items.length} to {MEAL_LABEL[meal].toLowerCase()}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-input">
      <div className={`photo-drop ${photo ? 'has-photo' : ''}`}>
        {photo ? (
          <>
            <img src={photo.dataUrl} alt="Your meal" />
            <button className="small" onClick={() => setPhoto(null)}>
              Remove photo
            </button>
          </>
        ) : (
          <button className="photo-pick" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <Icon name="camera" size={32} />
            <span>Take or choose a photo</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      <label>
        Describe it (optional with a photo)
        <textarea
          value={description}
          maxLength={2000}
          placeholder="e.g. chicken burrito bowl, half the rice, no sour cream"
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <p className="muted small">What you write wins over what's in the photo, so mention portions or swaps you know about.</p>
      <InlineError>{error}</InlineError>
      {limitReached && <InlineError>You've used all {status.monthlyLimit} AI estimates for this month.</InlineError>}
      <button className="primary block" disabled={!!busy || limitReached || (!photo && !description.trim())} onClick={() => void estimate()}>
        {busy ? (
          <>
            <Spinner /> {busy}
          </>
        ) : (
          'Estimate meal'
        )}
      </button>
      <p className="muted small">
        {modelLabel(model)} · about {formatUsd(typicalMealCostUsd(model))} per meal
        {status.webSearch ? ', more when brands are looked up' : ''}
        {status.monthlyLimit > 0 && ` · ${status.usedThisMonth} of ${status.monthlyLimit} used this month`}
      </p>
      <AiPrivacyNote />
    </div>
  );
}

/** Where an item's numbers come from: a published page, the food database, or the model's own estimate. */
function ItemSource({ item }: { item: ReviewItem }) {
  if (item.source === 'web' && item.sourceUrl)
    return (
      <span>
        published numbers:{' '}
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
          {item.sourceName || 'source'}
        </a>
      </span>
    );
  if (!item.usedAi && item.matchedFood) return <span>USDA match: {item.matchedFood.name}</span>;
  return <span className="badge">{item.brand ? 'AI estimate · no published numbers found' : 'AI estimate'}</span>;
}

function SwapSearch({ initial, onPick }: { initial: string; onPick: (f: Food) => void }) {
  const [q, setQ] = useState(initial);
  const [foods, setFoods] = useState<Food[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      searchFoods(text, 12, ctl.signal)
        .then((r) => {
          setFoods([...searchLocalFoods(text, 5), ...r]);
          setError(null);
        })
        .catch((e) => !ctl.signal.aborted && setError(errorMessage(e)));
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);
  return (
    <div className="swap">
      <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search for a replacement food" />
      <InlineError>{error}</InlineError>
      {!foods.length && !error && q.trim().length >= 2 && <p className="muted small">Searching…</p>}
      <ul className="list scroll" hidden={!foods.length}>
        {foods.map((f) => (
          <FoodRow key={f.id} food={f} onPick={() => onPick(f)} hint={`${grams(f.nutrients[N.protein])} g protein`} />
        ))}
      </ul>
    </div>
  );
}
