import { useEffect, useState } from 'react';
import { N, menuItemToFood, type MenuImport } from '@open-nutrition/shared';
import { errorMessage, store } from '../state';
import { getAiStatus, importMenu } from '../foodApi';
import { InlineError, Spinner, useToast } from '../feedback';
import { Icon, kcal, Modal, Segmented } from '../ui';
import { formatUsd } from './AiLog';

/** True when the server can run AI requests (the import needs Claude). */
export function useAiAvailable(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void getAiStatus().then((s) => live && setOn(s.enabled));
    return () => {
      live = false;
    };
  }, []);
  return on;
}

const g = (v: number | null | undefined) => (v == null ? '–' : `${+v.toFixed(v < 10 ? 1 : 0)}`);

/**
 * Import from a nutrition page: a restaurant's own nutrition page (link or pasted text) is read
 * by Claude on the server, and the user picks which items to save as their foods.
 */
export function MenuImportDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'link' | 'paste'>('link');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ menu: MenuImport; costUsd: number } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');

  async function read(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await importMenu(mode === 'link' ? { url: url.trim() } : { text });
      setResult({ menu: r.menu, costUsd: r.costUsd });
      setPicked(new Set());
      if (!r.menu.items.length) setError(r.menu.notes[0] ?? 'No menu items with nutrition information were found on that page.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!result) return;
    const items = result.menu.items.filter((_, i) => picked.has(i));
    for (const it of items) store.upsertFood(menuItemToFood(it, result.menu.restaurant));
    toast({ message: `Saved ${items.length} ${items.length === 1 ? 'food' : 'foods'}${result.menu.restaurant ? ` from ${result.menu.restaurant}` : ''}. Find them under My foods.`, tone: 'success' });
    onClose();
  }

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = result ? result.menu.items.map((it, i) => ({ it, i })).filter(({ it }) => words.every((w) => it.name.toLowerCase().includes(w))) : [];
  const allShownPicked = shown.length > 0 && shown.every(({ i }) => picked.has(i));

  return (
    <Modal
      title="Import from a nutrition page"
      onClose={onClose}
      wide
      footer={
        result && result.menu.items.length ? (
          <button className="primary block" disabled={!picked.size} onClick={save}>
            Save {picked.size || ''} {picked.size === 1 ? 'food' : 'foods'}
          </button>
        ) : (
          <button className="primary block" disabled={busy || (mode === 'link' ? !url.trim() : text.trim().length < 50)} onClick={() => void read()}>
            {busy && <Spinner label="Reading the page" />} {busy ? 'Reading the page… (up to a minute)' : 'Read menu'}
          </button>
        )
      }
    >
      {!result || !result.menu.items.length ? (
        <form onSubmit={(e) => void read(e)}>
          <p className="muted small">
            Open the restaurant’s own nutrition page or nutrition PDF, copy its address and paste it here. Claude reads the page on your server and
            lists the items with their published numbers; you choose which to save.
          </p>
          <Segmented
            value={mode}
            onChange={setMode}
            label="Link or text"
            options={[
              ['link', 'Link'],
              ['paste', 'Paste text'],
            ]}
          />
          {mode === 'link' ? (
            <label>
              Nutrition page or PDF address
              <input type="url" inputMode="url" placeholder="https://www.example.com/nutrition" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
            </label>
          ) : (
            <label>
              Nutrition information (select the table on the page, copy, paste)
              <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Item, Calories, Fat (g), Carbs (g), Protein (g)…" />
            </label>
          )}
          <InlineError>{error}</InlineError>
          <p className="muted small">Counts as one AI request. Pages that build their menu with scripts can’t be read from a link; paste the text instead.</p>
        </form>
      ) : (
        <div>
          <p className="muted small">
            {result.menu.items.length} items{result.menu.restaurant ? ` from ${result.menu.restaurant}` : ''} · per serving as published · cost {formatUsd(result.costUsd)}
          </p>
          {result.menu.notes.map((n) => (
            <p key={n} className="note">
              {n}
            </p>
          ))}
          <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
            <div className="search-box" style={{ flex: 1 }}>
              <Icon name="search" size={18} />
              <input type="search" placeholder="Filter items" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter items" />
            </div>
            <button
              type="button"
              className="small-btn"
              onClick={() =>
                setPicked((p) => {
                  const next = new Set(p);
                  for (const { i } of shown) allShownPicked ? next.delete(i) : next.add(i);
                  return next;
                })
              }
            >
              {allShownPicked ? 'Clear' : 'Select all'}
            </button>
          </div>
          <ul className="list menu-import-list">
            {shown.map(({ it, i }) => (
              <li key={i}>
                <label className="menu-import-row">
                  <input
                    type="checkbox"
                    checked={picked.has(i)}
                    onChange={(e) =>
                      setPicked((p) => {
                        const next = new Set(p);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        return next;
                      })
                    }
                  />
                  <span className="entry-main">
                    <span className="entry-name">{it.name}</span>
                    <span className="entry-sub">
                      {it.serving} ({Math.round(it.servingGrams)} g{it.gramsEstimated ? ', estimated' : ''}) · P {g(it.nutrients[N.protein])} · C {g(it.nutrients[N.carbs])} · F{' '}
                      {g(it.nutrients[N.fat])}
                    </span>
                  </span>
                  <span className="entry-kcal">
                    {kcal(it.nutrients[N.energy] ?? 0)}
                    <small> kcal</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button type="button" className="link pad-y" onClick={() => setResult(null)}>
            <Icon name="left" size={18} /> Read a different page
          </button>
        </div>
      )}
    </Modal>
  );
}
