import { useState } from 'react';
import {
  addDays,
  CORE_NUTRIENTS,
  formatNutrient,
  N,
  nutrientStatus,
  parseDay,
  sumNutrients,
  topFoodsFor,
  type NutrientDef,
  type NutrientStatus,
} from '@open-nutrition/shared';
import { useStore } from '../state';
import { Empty, Icon, Segmented } from '../ui';

type Period = 'day' | 'week' | 'month';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeOf(anchor: string, period: Period): [string, string] {
  if (period === 'day') return [anchor, anchor];
  const d = parseDay(anchor);
  if (period === 'week') {
    const start = addDays(anchor, -((d.getDay() + 6) % 7));
    return [start, addDays(start, 6)];
  }
  return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
}

function shift(anchor: string, period: Period, n: number): string {
  if (period === 'day') return addDays(anchor, n);
  if (period === 'week') return addDays(anchor, 7 * n);
  const d = parseDay(anchor);
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

function rangeLabel([a, b]: [string, string], period: Period): string {
  const da = parseDay(a);
  if (period === 'day') return da.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (period === 'month') return da.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const db = parseDay(b);
  return `${da.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${db.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function statusOf(def: NutrientDef, value: number, target: number): NutrientStatus {
  if (def.key === N.energy) {
    if (!(target > 0)) return 'ok';
    return value > target * 1.1 ? 'over' : value < target * 0.8 ? 'under' : 'ok';
  }
  return nutrientStatus(value, target, def.limit === true);
}

const STATUS_TEXT: Record<NutrientStatus, string> = { under: 'Low', ok: 'On track', over: 'Over' };

export function NutrientsPage() {
  const store = useStore();
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(store.today());
  const [open, setOpen] = useState<string | null>(null);
  const range = rangeOf(anchor, period);
  const entries = store.all('diaryEntries').filter((e) => e.date >= range[0] && e.date <= range[1]);
  const days = new Set(entries.map((e) => e.date)).size;
  const total = sumNutrients(entries.map((e) => e.nutrients));
  const avg = (k: string) => (days ? (total[k] ?? 0) / days : 0);
  const targetDay = range[1] < store.today() ? range[1] : store.today() < range[0] ? range[0] : store.today();
  const targets = store.targetsOn(targetDay)?.nutrients ?? {};

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Nutrients</h1>
        <Segmented
          value={period}
          onChange={setPeriod}
          label="Report period"
          options={[
            ['day', 'Day'],
            ['week', 'Week'],
            ['month', 'Month'],
          ]}
        />
      </header>
      <div className="day-nav wide">
        <button className="icon-btn" onClick={() => setAnchor(shift(anchor, period, -1))} aria-label="Previous period">
          <Icon name="left" />
        </button>
        <div className="day-label static">
          <span>{rangeLabel(range, period)}</span>
          <small>{period === 'day' ? `${entries.length} item${entries.length === 1 ? '' : 's'} logged` : `Daily average over ${days} logged day${days === 1 ? '' : 's'}`}</small>
        </div>
        <button className="icon-btn" onClick={() => setAnchor(shift(anchor, period, 1))} aria-label="Next period">
          <Icon name="right" />
        </button>
      </div>
      {!Object.keys(targets).length && (
        <a className="card callout" href="#/settings/targets">
          <strong>No targets yet</strong>
          <span>Set up your targets in Settings to see how each nutrient compares.</span>
        </a>
      )}
      {!entries.length ? (
        <Empty>Nothing logged in this period.</Empty>
      ) : (
        <section className="card flush">
          <div className="legend status-legend">
            <span className="st-under">Low</span>
            <span className="st-ok">On track</span>
            <span className="st-over">Over a limit</span>
            <span className="muted">Tick = target</span>
          </div>
          <ul className="nutrient-list">
            {CORE_NUTRIENTS.map((def) => {
              const v = avg(def.key);
              const t = targets[def.key] ?? 0;
              const st = statusOf(def, v, t);
              const pct = t > 0 ? Math.min(v / t, 1.5) / 1.5 : 0;
              const isOpen = open === def.key;
              const top = isOpen ? topFoodsFor(entries, def.key, 8) : [];
              return (
                <li key={def.key} className={`nutrient st-${t > 0 ? st : 'none'}`}>
                  <button className="nutrient-row" onClick={() => setOpen(isOpen ? null : def.key)} aria-expanded={isOpen}>
                    <span className="n-name">
                      {def.name}
                      {def.limit && <small className="muted"> limit</small>}
                    </span>
                    <span className="n-value">
                      {formatNutrient(def.key, v)}
                      {t > 0 && <small className="muted"> / {formatNutrient(def.key, t)}</small>}
                    </span>
                    <span className="n-bar" aria-hidden="true">
                      <span className="n-fill" style={{ width: `${(t > 0 ? pct : 0) * 100}%` }} />
                      {t > 0 && <span className="n-tick" />}
                    </span>
                    <span className="n-status">{t > 0 ? `${STATUS_TEXT[st]} · ${Math.round((v / t) * 100)}%` : 'No target'}</span>
                  </button>
                  {isOpen && (
                    <div className="top-foods">
                      <h4>Top sources {period !== 'day' && <small className="muted">(totals for the period)</small>}</h4>
                      {top.length ? (
                        <ol>
                          {top.map((f) => (
                            <li key={f.name}>
                              <span>{f.name}</span>
                              <span className="muted nowrap">
                                {formatNutrient(def.key, f.amount)} · {Math.round(f.share * 100)}%
                              </span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="muted small">None of the logged foods have data for {def.name.toLowerCase()}.</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
