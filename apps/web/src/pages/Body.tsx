import { useState } from 'react';
import { fromCm, fromKg, MEASUREMENT_KINDS, toCm, toKg, weeklyRate, weightTrend, type MeasurementKind } from '@open-nutrition/shared';
import { removeRows, restoreRows, SETTING_GOAL_WEIGHT, usePrefs, useStore } from '../state';
import { WeightChart } from '../charts';
import { useToast } from '../feedback';
import { DateField, Empty, fmt, formatDay, Icon, NumberInput, Segmented, signed } from '../ui';

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

/** 'Tue, Nov 17' this year, 'Tue, Nov 17, 2025' otherwise. */
const dateOf = (t: number) => {
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
};
/** "today" / "yesterday" lower-cased mid-sentence, other days as "Tue, Nov 17, 2026". */
const onDay = (day: string) => {
  const d = formatDay(day, true);
  return /^[A-Z][a-z]+$/.test(d) ? d.toLowerCase() : d;
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
  const toast = useToast();
  const wu = prefs.weightUnit;
  const today = store.today();
  const [value, setValue] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const [range, setRange] = useState<Range>('90');
  const [showAll, setShowAll] = useState(false);
  const w1 = (kg: number) => fmt(fromKg(kg, wu), 1, true);

  const weights = store.measurementsOf('body_weight');
  const goalKg = store.getSetting<number | null>(SETTING_GOAL_WEIGHT, null);
  const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * 86_400_000;
  const trend = weightTrend(weights).filter((p) => p.takenAt >= cutoff);
  const display = trend.map((p) => ({ takenAt: p.takenAt, value: fromKg(p.value, wu), trend: fromKg(p.trend, wu) }));
  const recent = weights.filter((p) => p.takenAt >= Date.now() - 28 * 86_400_000);
  const rate = weeklyRate(recent);
  const latest = weights.at(-1);
  const latestTrend = trend.at(-1)?.trend ?? (latest ? weightTrend(weights).at(-1)?.trend : undefined);

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
              const m = store.addMeasurement('body_weight', toKg(value, wu), takenAtFor(day, today));
              toast({
                message: `Saved ${fmt(value, 1)} ${wu} for ${onDay(day)}.`,
                tone: 'success',
                action: { label: 'Undo', onClick: () => removeRows('measurements', [m.id]) },
              });
              setValue(null);
              setDay(today);
            }}
          >
            <label>
              Weight ({wu})
              <NumberInput value={value} onChange={setValue} placeholder={latest ? w1(latest.value) : wu === 'kg' ? 'e.g. 72.5' : 'e.g. 160'} />
            </label>
            <label>
              Date
              <DateField value={day} onChange={setDay} max={today} title="Weigh-in date" />
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
              <dd>{latest ? `${w1(latest.value)} ${wu}` : '—'}</dd>
            </div>
            <div>
              <dt>7-day average</dt>
              <dd>{latestTrend != null ? `${w1(latestTrend)} ${wu}` : '—'}</dd>
            </div>
            <div>
              <dt>Weekly rate (4 wk)</dt>
              <dd>{rate != null ? `${signed(fromKg(rate, wu), 1)} ${wu}/wk` : '—'}</dd>
            </div>
            <div>
              <dt>Goal</dt>
              <dd>
                <GoalInput key={`${goalKg}-${wu}`} goalKg={goalKg} unit={wu} onChange={(kg) => store.setSetting(SETTING_GOAL_WEIGHT, kg)} />
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
                      <span className="grow">{dateOf(w.takenAt)}</span>
                      <strong className="num">
                        {w1(w.value)} {wu}
                      </strong>
                      <button
                        className="icon-btn"
                        aria-label={`Delete weigh-in from ${dateOf(w.takenAt)}`}
                        title="Delete"
                        onClick={() => {
                          store.remove('measurements', w.id);
                          toast({
                            message: `Deleted the ${w1(w.value)} ${wu} weigh-in.`,
                            action: { label: 'Undo', onClick: () => restoreRows('measurements', [w.id]) },
                          });
                        }}
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    </li>
                  ))}
              </ul>
              {weights.length > 8 && (
                <button className="link small" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
                  {showAll ? 'Show fewer' : `Show all ${weights.length.toLocaleString()}`}
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
      <button className="link" onClick={() => setEditing(true)} aria-label={goalKg != null ? `Goal ${fmt(fromKg(goalKg, unit), 1, true)} ${unit}. Edit` : 'Set a goal weight'}>
        {goalKg != null ? `${fmt(fromKg(goalKg, unit), 1, true)} ${unit}` : 'Set goal'}
        <Icon name="edit" size={14} />
      </button>
    );
  return (
    <form
      className="goal-form"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(v && v > 0 ? toKg(v, unit) : null);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditing(false);
      }}
    >
      <span className="inline-unit">
        <NumberInput value={v} onChange={setV} ariaLabel={`Goal weight in ${unit}`} className="w-num" autoFocus />
        <span>{unit}</span>
      </span>
      <span className="row nowrap">
        <button type="submit" className="small primary">
          Save
        </button>
        <button type="button" className="small" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </span>
    </form>
  );
}

function OtherMeasurements({ today }: { today: string }) {
  const store = useStore();
  const prefs = usePrefs();
  const toast = useToast();
  const lu = prefs.lengthUnit;
  const [kind, setKind] = useState<MeasurementKind>('waist');
  const [value, setValue] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const unitOf = (k: string) => (k === 'body_fat' ? '%' : lu);
  const show = (k: string, v: number) => (k === 'body_fat' ? v : fromCm(v, lu));
  const label = (k: string) => (KIND_LABEL[k] ?? k).toLowerCase();
  const rows = OTHER_KINDS.map((k) => ({ kind: k, list: store.measurementsOf(k) })).filter((r) => r.list.length);
  return (
    <section className="card">
      <h3>Other measurements</h3>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (value == null || value <= 0) return;
          const m = store.addMeasurement(kind, kind === 'body_fat' ? value : toCm(value, lu), takenAtFor(day, today));
          toast({
            message: `Saved ${label(kind)}: ${fmt(value, 1)} ${unitOf(kind)}.`,
            tone: 'success',
            action: { label: 'Undo', onClick: () => removeRows('measurements', [m.id]) },
          });
          setValue(null);
          setDay(today);
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
          <DateField value={day} onChange={setDay} max={today} title="Measurement date" />
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
                <span className="grow min0">
                  {KIND_LABEL[k]}
                  <br />
                  <small className="muted">{dateOf(last.takenAt)}</small>
                </span>
                <span className="measure-value">
                  <strong className="num">
                    {fmt(show(k, last.value), 1)} {unitOf(k)}
                  </strong>
                  {delta != null && (
                    <small className="muted nowrap" title="Change since the previous measurement">
                      {signed(show(k, delta), 1)} {unitOf(k)}
                    </small>
                  )}
                </span>
                <button
                  className="icon-btn"
                  aria-label={`Delete latest ${label(k)} measurement`}
                  title="Delete"
                  onClick={() => {
                    store.remove('measurements', last.id);
                    toast({
                      message: `Deleted the latest ${label(k)} measurement.`,
                      action: { label: 'Undo', onClick: () => restoreRows('measurements', [last.id]) },
                    });
                  }}
                >
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
