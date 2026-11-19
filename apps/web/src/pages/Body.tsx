import { useState } from 'react';
import {
  dayOf,
  formatLength,
  formatWeight,
  fromKg,
  MEASUREMENT_KINDS,
  toCm,
  toKg,
  weeklyRate,
  weightTrend,
  type MeasurementKind,
} from '@open-nutrition/shared';
import { SETTING_GOAL_WEIGHT, usePrefs, useStore } from '../state';
import { WeightChart } from '../charts';
import { Empty, Icon, NumberInput, Segmented } from '../ui';

const RANGES = [
  ['30', '1M'],
  ['90', '3M'],
  ['180', '6M'],
  ['365', '1Y'],
  ['all', 'All'],
] as const;
type Range = (typeof RANGES)[number][0];

const OTHER_KINDS = MEASUREMENT_KINDS.filter((k) => k !== 'body_weight' && k !== 'water');
const KIND_LABEL: Record<string, string> = {
  body_fat: 'Body fat',
  neck: 'Neck',
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
  left_bicep: 'Left bicep',
  right_bicep: 'Right bicep',
  left_thigh: 'Left thigh',
  right_thigh: 'Right thigh',
};

/** Noon local time on a YYYY-MM-DD day (today's entries use "now"). */
function takenAtFor(day: string, today: string): number {
  if (day === today) return Date.now();
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12).getTime();
}

export function BodyPage() {
  const store = useStore();
  const prefs = usePrefs();
  const wu = prefs.weightUnit;
  const today = store.today();
  const [value, setValue] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const [range, setRange] = useState<Range>('90');
  const [showAll, setShowAll] = useState(false);

  const weights = store.measurementsOf('body_weight');
  const goalKg = store.getSetting<number | null>(SETTING_GOAL_WEIGHT, null);
  const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 86_400_000;
  const trend = weightTrend(weights).filter((p) => p.takenAt >= cutoff);
  const display = trend.map((p) => ({ takenAt: p.takenAt, value: fromKg(p.value, wu), trend: fromKg(p.trend, wu) }));
  const recent = weights.filter((p) => p.takenAt >= Date.now() - 28 * 86_400_000);
  const rate = weeklyRate(recent);
  const latest = weights.at(-1);
  const latestTrend = trend.at(-1)?.trend;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Weight &amp; body</h1>
      </header>
      <div className="grid-2">
        <section className="card">
          <h3>Log weight</h3>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              if (value == null || value <= 0) return;
              store.addMeasurement('body_weight', toKg(value, wu), takenAtFor(day, today));
              setValue(null);
            }}
          >
            <label>
              Weight ({wu})
              <NumberInput value={value} onChange={setValue} placeholder={latest ? formatWeight(latest.value, wu) : ''} />
            </label>
            <label>
              Date
              <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
            </label>
            <button className="primary span-2" type="submit" disabled={!value}>
              Save weigh-in
            </button>
          </form>
        </section>
        <section className="card">
          <h3>Progress</h3>
          <dl className="stats">
            <div>
              <dt>Latest</dt>
              <dd>{latest ? `${formatWeight(latest.value, wu)} ${wu}` : '—'}</dd>
            </div>
            <div>
              <dt>7-day average</dt>
              <dd>{latestTrend != null ? `${formatWeight(latestTrend, wu)} ${wu}` : '—'}</dd>
            </div>
            <div>
              <dt>Weekly rate (4 wk)</dt>
              <dd>{rate != null ? `${rate > 0 ? '+' : ''}${formatWeight(rate, wu)} ${wu}/wk` : '—'}</dd>
            </div>
            <div>
              <dt>Goal</dt>
              <dd>
                <GoalInput goalKg={goalKg} unit={wu} onChange={(kg) => store.setSetting(SETTING_GOAL_WEIGHT, kg)} />
              </dd>
            </div>
          </dl>
          {goalKg != null && latestTrend != null && rate != null && Math.abs(rate) > 0.01 && Math.sign(goalKg - latestTrend) === Math.sign(rate) && (
            <p className="muted small">
              At this rate you'd reach your goal in about {Math.ceil(Math.abs(goalKg - latestTrend) / Math.abs(rate))} weeks.
            </p>
          )}
        </section>
      </div>

      <section className="card">
        <div className="row between">
          <h3>Trend</h3>
          <Segmented value={range} onChange={setRange} options={RANGES} label="Chart range" />
        </div>
        <WeightChart points={display} goal={goalKg != null ? fromKg(goalKg, wu) : null} unit={wu} />
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>Weigh-ins</h3>
          {weights.length ? (
            <>
              <ul className="list">
                {[...weights]
                  .reverse()
                  .slice(0, showAll ? undefined : 8)
                  .map((w) => (
                    <li key={w.id} className="list-row">
                      <span className="grow">{new Date(w.takenAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      <strong>
                        {formatWeight(w.value, wu)} {wu}
                      </strong>
                      <button className="icon-btn" aria-label="Delete weigh-in" onClick={() => store.remove('measurements', w.id)}>
                        <Icon name="trash" size={18} />
                      </button>
                    </li>
                  ))}
              </ul>
              {weights.length > 8 && (
                <button className="link small" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Show fewer' : `Show all ${weights.length}`}
                </button>
              )}
            </>
          ) : (
            <Empty>No weigh-ins yet. Weigh yourself at the same time of day for the smoothest trend.</Empty>
          )}
        </section>
        <OtherMeasurements today={today} />
      </div>
    </div>
  );
}

function GoalInput({ goalKg, unit, onChange }: { goalKg: number | null; unit: 'kg' | 'lb'; onChange: (kg: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<number | null>(goalKg != null ? +fromKg(goalKg, unit).toFixed(1) : null);
  if (!editing)
    return (
      <button className="link" onClick={() => setEditing(true)}>
        {goalKg != null ? `${formatWeight(goalKg, unit)} ${unit}` : 'Set goal'}
      </button>
    );
  return (
    <span className="row nowrap">
      <NumberInput value={v} onChange={setV} ariaLabel={`Goal weight in ${unit}`} className="w-num" />
      <button
        className="small"
        onClick={() => {
          onChange(v && v > 0 ? toKg(v, unit) : null);
          setEditing(false);
        }}
      >
        Save
      </button>
    </span>
  );
}

function OtherMeasurements({ today }: { today: string }) {
  const store = useStore();
  const prefs = usePrefs();
  const lu = prefs.lengthUnit;
  const [kind, setKind] = useState<MeasurementKind>('waist');
  const [value, setValue] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const unitOf = (k: string) => (k === 'body_fat' ? '%' : lu);
  const fmt = (k: string, v: number) => (k === 'body_fat' ? `${+v.toFixed(1)}` : formatLength(v, lu));
  const rows = OTHER_KINDS.map((k) => ({ kind: k, list: store.measurementsOf(k) })).filter((r) => r.list.length);
  return (
    <section className="card">
      <h3>Other measurements</h3>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (value == null || value <= 0) return;
          store.addMeasurement(kind, kind === 'body_fat' ? value : toCm(value, lu), takenAtFor(day, today));
          setValue(null);
        }}
      >
        <label>
          What
          <select value={kind} onChange={(e) => setKind(e.target.value as MeasurementKind)}>
            {OTHER_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Value ({unitOf(kind)})
          <NumberInput value={value} onChange={setValue} />
        </label>
        <label>
          Date
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
        </label>
        <button className="primary" type="submit" disabled={!value}>
          Save
        </button>
      </form>
      {rows.length ? (
        <ul className="list">
          {rows.map(({ kind: k, list }) => {
            const last = list.at(-1)!;
            const prev = list.at(-2);
            const delta = prev ? last.value - prev.value : null;
            return (
              <li key={k} className="list-row">
                <span className="grow">
                  {KIND_LABEL[k]}
                  <br />
                  <small className="muted">{dayOf(last.takenAt)}</small>
                </span>
                <strong>
                  {fmt(k, last.value)} {unitOf(k)}
                </strong>
                {delta != null && (
                  <small className="muted nowrap">
                    {delta > 0 ? '+' : ''}
                    {fmt(k, delta)}
                  </small>
                )}
                <button className="icon-btn" aria-label={`Delete latest ${KIND_LABEL[k]}`} onClick={() => store.remove('measurements', last.id)}>
                  <Icon name="trash" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>Track waist, hips, body fat and more to see changes the scale misses.</Empty>
      )}
    </section>
  );
}
