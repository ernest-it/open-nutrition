import { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  MEASUREMENT_KINDS,
  dayOf,
  fromCm,
  fromKg,
  parseDay,
  toCm,
  toKg,
  weeklyRate,
  weightTrend,
  type MeasurementKind,
} from '@open-nutrition/shared';
import { TrendChart } from '../charts';
import { CalendarModal } from '../components';
import { removeWithUndo, usePrefs, useStore, useToday } from '../state';
import { Button, Card, Chips, Columns, Empty, H2, IconButton, NumInput, Screen, T, formatDay, haptic, label, styles, useTheme, useToast } from '../ui';

/** Same key as the web app: a number in kg (or null), so the goal line syncs. */
const GOAL_SETTING = 'goalWeightKg';
type Range = '30' | '90' | '180' | '365' | 'all';
const DAY_MS = 86_400_000;

/** Noon on a local day (so a back-dated entry lands on that day in every time zone math). */
const noonOf = (day: string) => parseDay(day).getTime() + 12 * 3_600_000;

export function BodyScreen() {
  const t = useTheme();
  const store = useStore();
  const prefs = usePrefs();
  const toast = useToast();
  const today = useToday();
  const unit = prefs.weightUnit;
  const [value, setValue] = useState<number | null>(null);
  const [day, setDay] = useState(today);
  const [calendar, setCalendar] = useState(false);
  const [range, setRange] = useState<Range>('90');
  const [showAll, setShowAll] = useState(false);
  const goal = store.getSetting<number | null>(GOAL_SETTING, null);
  const [goalDraft, setGoalDraft] = useState<number | null>(goal != null ? +fromKg(goal, unit).toFixed(1) : null);
  // Follow the stored goal (synced from another device, or a unit change).
  useEffect(() => setGoalDraft(goal != null ? +fromKg(goal, unit).toFixed(1) : null), [goal, unit]);

  const weights = store.measurementsOf('body_weight');
  const cutoff = range === 'all' ? 0 : Date.now() - Number(range) * DAY_MS;
  const inRange = weights.filter((w) => w.takenAt >= cutoff);
  const trendAll = weightTrend(weights.map((w) => ({ takenAt: w.takenAt, value: w.value })), 7);
  const trend = trendAll.filter((p) => p.takenAt >= cutoff);
  const recent = weights.filter((w) => w.takenAt >= Date.now() - 28 * DAY_MS);
  const rate = weeklyRate(recent.map((w) => ({ takenAt: w.takenAt, value: w.value })));
  const latest = weights[weights.length - 1];
  const latestTrend = trendAll[trendAll.length - 1]?.trend;
  const show = (kg: number) => +fromKg(kg, unit).toFixed(1);
  const profile = store.profile();

  function add() {
    if (value == null || !(value > 0)) return;
    store.addMeasurement('body_weight', toKg(value, unit), day === today ? Date.now() : noonOf(day));
    setValue(null);
    haptic.success();
    toast(`Logged ${value} ${unit}${day === today ? '' : ` for ${formatDay(day)}`}`);
  }

  function deleteWeighIn(id: string, text: string) {
    const undo = removeWithUndo('measurements', [id]);
    haptic.light();
    toast({ message: `Deleted weigh-in · ${text}`, action: { label: 'Undo', onPress: undo } });
  }

  const chart = (
    <Card>
      <View style={[styles.rowBetween, { flexWrap: 'wrap' }]}>
        <View>
          <T small muted>
            Trend (7-day average)
          </T>
          <T bold style={{ fontSize: 26 }}>
            {latestTrend != null ? `${show(latestTrend)} ${unit}` : '—'}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T small muted>
            Weekly rate (4 weeks)
          </T>
          <T bold style={{ fontSize: 18 }}>
            {rate != null ? `${rate > 0 ? '+' : ''}${+fromKg(rate, unit).toFixed(2)} ${unit}/wk` : '—'}
          </T>
          {profile && (
            <T small muted>
              plan: {profile.goalKgPerWeek > 0 ? '+' : ''}
              {+fromKg(profile.goalKgPerWeek, unit).toFixed(2)} {unit}/wk
            </T>
          )}
        </View>
      </View>
      <Chips
        options={[
          { value: '30', label: '1 M' },
          { value: '90', label: '3 M' },
          { value: '180', label: '6 M' },
          { value: '365', label: '1 Y' },
          { value: 'all', label: 'All' },
        ]}
        value={range}
        onChange={setRange}
      />
      {inRange.length ? (
        <TrendChart
          points={inRange.map((w) => ({ x: w.takenAt, y: fromKg(w.value, unit) }))}
          trend={trend.map((p) => ({ x: p.takenAt, y: fromKg(p.trend, unit) }))}
          goal={goal != null ? fromKg(goal, unit) : null}
          unit={unit}
          format={(v) => `${+v.toFixed(1)}`}
        />
      ) : (
        <T muted style={{ paddingVertical: 24, textAlign: 'center' }}>
          No weigh-ins in this range yet.
        </T>
      )}
      <View style={[styles.row, { marginTop: 8, flexWrap: 'wrap' }]}>
        <T style={{ flex: 1 }}>Goal weight</T>
        <NumInput value={goalDraft} onChange={setGoalDraft} placeholder="—" accessibilityLabel={`Goal weight in ${unit}`} style={{ width: 80 }} />
        <T muted>{unit}</T>
        <Button
          small
          title={goalDraft != null && goalDraft > 0 ? 'Set' : 'Clear'}
          disabled={(goalDraft != null && goalDraft > 0 ? +toKg(goalDraft, unit).toFixed(2) : null) === (goal != null ? +goal.toFixed(2) : null)}
          onPress={() => {
            const next = goalDraft != null && goalDraft > 0 ? toKg(goalDraft, unit) : null;
            store.setSetting(GOAL_SETTING, next);
            haptic.tap();
            toast(next != null ? `Goal set to ${goalDraft} ${unit}` : 'Goal cleared');
          }}
        />
      </View>
    </Card>
  );

  const entry = (
    <Card>
      <T bold>Log weight</T>
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 6 }]}>
        <NumInput value={value} onChange={setValue} placeholder={latest ? String(show(latest.value)) : unit} accessibilityLabel={`Weight in ${unit}`} style={{ width: 96 }} />
        <T muted>{unit}</T>
        <Button small icon="calendar" title={formatDay(day)} onPress={() => setCalendar(true)} />
        <Button title="Add" variant="primary" onPress={add} disabled={value == null || !(value > 0)} style={{ flexGrow: 1 }} />
      </View>
      <CalendarModal
        visible={calendar}
        value={day}
        onClose={() => setCalendar(false)}
        onPick={(d) => {
          setDay(d);
          setCalendar(false);
        }}
      />
    </Card>
  );

  const list = [...weights].reverse();
  const history = (
    <View>
      <H2>Weigh-ins</H2>
      <Card style={{ paddingVertical: 6 }}>
        {!list.length && <Empty icon="scale" title="No weigh-ins yet" text="Log your weight above; the trend line smooths out day-to-day swings." />}
        {(showAll ? list : list.slice(0, 10)).map((w) => (
          <View key={w.id} style={[styles.rowBetween, { minHeight: 48 }]}>
            <T muted style={{ flex: 1 }}>
              {formatDay(dayOf(w.takenAt))}
            </T>
            <T bold>
              {show(w.value)} {unit}
            </T>
            <IconButton
              icon="trash"
              label={`Delete weigh-in of ${formatDay(dayOf(w.takenAt))}`}
              color={t.muted}
              onPress={() => deleteWeighIn(w.id, `${show(w.value)} ${unit}`)}
            />
          </View>
        ))}
        {list.length > 10 && <Button small variant="ghost" title={showAll ? 'Show fewer' : `Show all ${list.length}`} onPress={() => setShowAll(!showAll)} />}
      </Card>
    </View>
  );

  return (
    <Screen title="Weight & body" wide>
      <Columns
        ratio={1.3}
        left={
          <View>
            {chart}
            {entry}
          </View>
        }
        right={
          <View>
            {history}
            <OtherMeasurements />
          </View>
        }
      />
    </Screen>
  );
}

const OTHER_KINDS = MEASUREMENT_KINDS.filter((k) => k !== 'body_weight' && k !== 'water');

function OtherMeasurements() {
  const t = useTheme();
  const store = useStore();
  const prefs = usePrefs();
  const toast = useToast();
  const [kind, setKind] = useState<MeasurementKind>('waist');
  const [value, setValue] = useState<number | null>(null);
  const isFat = kind === 'body_fat';
  const unit = isFat ? '%' : prefs.lengthUnit;
  const show = (v: number) => (isFat ? +v.toFixed(1) : +fromCm(v, prefs.lengthUnit).toFixed(1));
  const list = [...store.measurementsOf(kind)].reverse();
  const first = list[list.length - 1];
  const last = list[0];
  const change = first && last && first.id !== last.id ? +(show(last.value) - show(first.value)).toFixed(1) : null;
  return (
    <View>
      <H2>Other measurements</H2>
      <Card>
        <Chips options={OTHER_KINDS.map((k) => ({ value: k, label: label(k) }))} value={kind} onChange={setKind} />
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <NumInput value={value} onChange={setValue} placeholder={last ? String(show(last.value)) : unit} accessibilityLabel={`${label(kind)} in ${unit}`} style={{ width: 96 }} />
          <T muted>{unit}</T>
          <Button
            title="Add"
            variant="primary"
            disabled={value == null || !(value > 0)}
            style={{ flexGrow: 1 }}
            onPress={() => {
              store.addMeasurement(kind, isFat ? value! : toCm(value!, prefs.lengthUnit));
              setValue(null);
              haptic.success();
              toast(`Logged ${label(kind).toLowerCase()} ${value} ${unit}`);
            }}
          />
        </View>
        {change != null && first && (
          <T small muted style={{ marginTop: 4 }}>
            Change since {formatDay(dayOf(first.takenAt))}: {change > 0 ? '+' : ''}
            {change} {unit}
          </T>
        )}
        {!list.length && (
          <T small muted style={{ paddingVertical: 10 }}>
            No {label(kind).toLowerCase()} measurements yet.
          </T>
        )}
        {list.slice(0, 12).map((m) => (
          <View key={m.id} style={[styles.rowBetween, { minHeight: 48 }]}>
            <T muted style={{ flex: 1 }}>
              {formatDay(dayOf(m.takenAt))}
            </T>
            <T bold>
              {show(m.value)} {unit}
            </T>
            <IconButton
              icon="trash"
              label={`Delete ${label(kind).toLowerCase()} of ${formatDay(dayOf(m.takenAt))}`}
              color={t.muted}
              onPress={() => {
                const undo = removeWithUndo('measurements', [m.id]);
                haptic.light();
                toast({ message: `Deleted ${label(kind).toLowerCase()} · ${show(m.value)} ${unit}`, action: { label: 'Undo', onPress: undo } });
              }}
            />
          </View>
        ))}
      </Card>
    </View>
  );
}
