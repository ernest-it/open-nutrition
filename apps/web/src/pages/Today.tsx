import { dayOf, formatWater, fromMl, MEALS, N, parseDay, toMl } from '@open-nutrition/shared';
import { usePrefs, useStore } from '../state';
import { CalorieRing } from '../charts';
import { MealSection } from '../components';
import { Bar, grams, Icon, kcal } from '../ui';

const MACROS = [
  [N.protein, 'Protein', 'm-p'],
  [N.carbs, 'Carbs', 'm-c'],
  [N.fat, 'Fat', 'm-f'],
] as const;

export function TodayPage() {
  const store = useStore();
  const day = store.today();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Today</h1>
          <p className="muted">{parseDay(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </header>
      <DaySummary day={day} />
    </div>
  );
}

/** Ring + macros + water beside the meal list (two columns on wide screens). */
export function DaySummary({ day }: { day: string }) {
  const store = useStore();
  const entries = store.entriesOn(day);
  const totals = store.dayTotals(day);
  const target = store.targetsOn(day);
  const t = target?.nutrients ?? {};
  const budget = t[N.energy] ?? 0;
  return (
    <div className="split">
      <div className="split-side">
        {!target && (
          <a className="card callout" href="#/settings/targets">
            <strong>Set your daily targets</strong>
            <span>Answer a few questions and we'll suggest calories, macros and nutrient goals. You can change every number.</span>
          </a>
        )}
        <section className="card summary">
          <CalorieRing eaten={totals[N.energy] ?? 0} budget={budget} />
          <dl className="ring-stats">
            <div>
              <dt>Budget</dt>
              <dd>{budget ? kcal(budget) : '—'}</dd>
            </div>
            <div>
              <dt>Eaten</dt>
              <dd>{kcal(totals[N.energy])}</dd>
            </div>
            <div>
              <dt>{budget && (totals[N.energy] ?? 0) > budget ? 'Over' : 'Left'}</dt>
              <dd>{budget ? kcal(Math.abs(budget - (totals[N.energy] ?? 0))) : '—'}</dd>
            </div>
          </dl>
          <div className="macros">
            {MACROS.map(([k, label, cls]) => {
              const v = totals[k] ?? 0;
              const tg = t[k] ?? 0;
              return (
                <div key={k} className={`macro ${cls}`}>
                  <div className="macro-top">
                    <span>{label}</span>
                    <span className="muted">
                      {grams(v)}
                      {tg ? ` / ${grams(tg)}` : ''} g{tg ? ` · ${Math.round((v / tg) * 100)}%` : ''}
                    </span>
                  </div>
                  <Bar value={v} max={tg || Math.max(v, 1)} label={label} />
                </div>
              );
            })}
          </div>
        </section>
        <WaterCard day={day} goalMl={target?.waterMl ?? null} />
      </div>
      <div className="split-main">
        {MEALS.map((m) => (
          <MealSection key={m} day={day} meal={m} entries={entries.filter((e) => e.meal === m)} />
        ))}
      </div>
    </div>
  );
}

export function WaterCard({ day, goalMl }: { day: string; goalMl: number | null }) {
  const store = useStore();
  const prefs = usePrefs();
  const unit = prefs.waterUnit;
  const ml = store.waterOn(day);
  const step = unit === 'ml' ? 250 : toMl(8, 'floz');
  const goal = goalMl ?? 2000;
  const glasses = Math.max(1, Math.round(goal / step));
  const filled = Math.floor(ml / step);
  const lastToday = store
    .measurementsOf('water')
    .filter((m) => dayOf(m.takenAt) === day)
    .at(-1);
  const u = unit === 'ml' ? 'ml' : 'fl oz';
  return (
    <section className="card water">
      <div className="water-head">
        <h3>
          <Icon name="drop" size={20} /> Water
        </h3>
        <span className="muted">
          {formatWater(ml, unit)} / {formatWater(goal, unit)} {u}
        </span>
      </div>
      <div className="glasses" aria-hidden="true">
        {Array.from({ length: Math.min(glasses, 16) }, (_, i) => (
          <i key={i} className={i < filled ? 'on' : ''} />
        ))}
      </div>
      <div className="row">
        <button className="icon-btn" disabled={!lastToday} onClick={() => lastToday && store.remove('measurements', lastToday.id)} aria-label="Undo last drink">
          <Icon name="minus" />
        </button>
        <button className="grow" onClick={() => store.addWater(step, day)}>
          +{+fromMl(step, unit).toFixed(0)} {u}
        </button>
        <button className="grow" onClick={() => store.addWater(step * 2, day)}>
          +{+fromMl(step * 2, unit).toFixed(0)} {u}
        </button>
      </div>
    </section>
  );
}
