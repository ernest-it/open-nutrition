import { useState } from 'react';
import { daySchema, MEALS, N } from '@open-nutrition/shared';
import { navigate } from '../router';
import { useBreakpoint, useLoggedDays, useStore } from '../state';
import { MealSection, NutrientSummary, plural } from '../components';
import { WaterCard } from './Today';
import { Bar, Calendar, DayNav, dayLabel, kcal, Modal } from '../ui';

export function DiaryPage({ day: routeDay }: { day?: string }) {
  const store = useStore();
  const bp = useBreakpoint();
  const day = routeDay && daySchema.safeParse(routeDay).success ? routeDay : store.today();
  const [calOpen, setCalOpen] = useState(false);
  const go = (d: string) => navigate(`diary/${d}`);
  const entries = store.entriesOn(day);
  const totals = store.dayTotals(day);
  const target = store.targetsOn(day);
  const budget = target?.nutrients[N.energy] ?? 0;
  const marked = useLoggedDays();

  const calendar = <Calendar value={day} marked={marked} onPick={(d) => { go(d); setCalOpen(false); }} />;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Diary</h1>
        <DayNav day={day} onChange={go} onOpenCalendar={() => setCalOpen(true)} />
      </header>
      <div className="split">
        <div className="split-side">
          {bp === 'expanded' && <section className="card">{calendar}</section>}
          <section className="card">
            <h3>{dayLabel(day, true)}</h3>
            <NutrientSummary n={totals} />
            {budget > 0 && <Bar value={totals[N.energy] ?? 0} max={budget} status={(totals[N.energy] ?? 0) > budget * 1.1 ? 'over' : 'ok'} label="Calories" />}
            <p className="muted small">
              {budget > 0 ? `${kcal(totals[N.energy])} of ${kcal(budget)} kcal · ` : ''}
              {entries.length ? plural(entries.length, 'item') : 'Nothing logged yet'}
            </p>
            <a className="link small" href={`#/nutrients/${day}`}>
              Full nutrient report →
            </a>
          </section>
          {bp !== 'compact' && <WaterCard day={day} goalMl={target?.waterMl ?? null} />}
        </div>
        <div className="split-main">
          {MEALS.map((m) => (
            <MealSection key={m} day={day} meal={m} entries={entries.filter((e) => e.meal === m)} />
          ))}
          {bp === 'compact' && <WaterCard day={day} goalMl={target?.waterMl ?? null} />}
        </div>
      </div>
      {calOpen && (
        <Modal title="Pick a day" onClose={() => setCalOpen(false)} variant="compact">
          {calendar}
        </Modal>
      )}
    </div>
  );
}
