import { useState } from 'react';
import { Alert, View } from 'react-native';
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
import { usePrefs, useStore, useToday } from '../state';
import { Button, Card, Chips, Columns, H2, IconButton, NumInput, Screen, T, formatDate, formatDay, haptic, label, styles, useTheme, useToast } from '../ui';

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
    toast(`Logged ${value} ${unit}`);
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
        <NumInput value={goalDraft} onChange={setGoalDraft} accessibilityLabel="Goal weight" style={{ width: 80 }} />
        <T muted>{unit}</T>
        <Button
          small
          title="Set"
          onPress={() => {
            store.setSetting(GOAL_SETTING, goalDraft != null && goalDraft > 0 ? toKg(goalDraft, unit) : null);
            haptic.tap();
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
      <Card>
        {!list.length && <T muted>Your weigh-ins will appear here.</T>}
        {(showAll ? list : list.slice(0, 10)).map((w) => (
          <View key={w.id} style={[styles.rowBetween, { minHeight: 44 }]}>
            <T bold>
              {show(w.value)} {unit}
            </T>
            <T small muted style={{ flex: 1, textAlign: 'right' }}>
              {formatDate(w.takenAt)}
            </T>
            <IconButton
              icon="trash"
              label={`Delete weigh-in of ${formatDate(w.takenAt)}`}
              color={t.muted}
              onPress={() =>
                Alert.alert('Delete this weigh-in?', `${show(w.value)} ${unit} · ${formatDate(w.takenAt)}`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => store.remove('measurements', w.id) },
                ])
              }
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
  const [kind, setKind] = useState<MeasurementKind>('waist');
  const [value, setValue] = useState<number | null>(null);
  const isFat = kind === 'body_fat';
  const unit = isFat ? '%' : prefs.lengthUnit;
  const show = (v: number) => (isFat ? +v.toFixed(1) : +fromCm(v, prefs.lengthUnit).toFixed(1));
  const list = [...store.measurementsOf(kind)].reverse();
  const first = list[list.length - 1];
  const last = list[0];
  return (
    <View>
      <H2>Other measurements</H2>
      <Card>
        <Chips options={OTHER_KINDS.map((k) => ({ value: k, label: label(k) }))} value={kind} onChange={setKind} />
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          <NumInput value={value} onChange={setValue} accessibilityLabel={`${label(kind)} in ${unit}`} style={{ width: 96 }} />
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
            }}
          />
        </View>
        {first && last && first.id !== last.id && (
          <T small muted style={{ marginTop: 4 }}>
            Change since {formatDate(first.takenAt)}: {show(last.value) - show(first.value) > 0 ? '+' : ''}
            {+(show(last.value) - show(first.value)).toFixed(1)} {unit}
          </T>
        )}
        {list.slice(0, 12).map((m) => (
          <View key={m.id} style={[styles.rowBetween, { minHeight: 44 }]}>
            <T>
              {show(m.value)} {unit}
            </T>
            <T small muted style={{ flex: 1, textAlign: 'right' }}>
              {formatDay(dayOf(m.takenAt))}
            </T>
            <IconButton icon="trash" label="Delete measurement" color={t.muted} onPress={() => store.remove('measurements', m.id)} />
          </View>
        ))}
      </Card>
    </View>
  );
}
