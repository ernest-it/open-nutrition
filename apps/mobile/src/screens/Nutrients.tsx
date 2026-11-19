import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  CORE_NUTRIENTS,
  N,
  NUTRIENTS,
  NUTRIENT_BY_KEY,
  addDays,
  daysForAverage,
  parseDay,
  statusFor,
  sumNutrients,
  topFoodsFor,
  type DiaryEntry,
  type NutrientKey,
  type NutritionStore,
} from '@open-nutrition/shared';
import { DailyBars } from '../charts';
import { Icon } from '../icons';
import { useLayout } from '../layout';
import { useNav } from '../nav';
import { useStore, useToday } from '../state';
import { Button, Card, Empty, IconButton, ProgressBar, Screen, Segmented, SplitView, T, Title, Toggle, fmtNutrient, formatDay, statusColor, styles, useTheme } from '../ui';

type Period = 'day' | 'week' | 'month';
let lastPeriod: Period = 'day';
let lastAnchor: string | null = null;

const pad = (n: number) => String(n).padStart(2, '0');

export function rangeFor(period: Period, anchor: string): { from: string; to: string } {
  if (period === 'day') return { from: anchor, to: anchor };
  const d = parseDay(anchor);
  if (period === 'week') {
    const mondayOffset = (d.getDay() + 6) % 7;
    const from = addDays(anchor, -mondayOffset);
    return { from, to: addDays(from, 6) };
  }
  const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return { from, to: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(last)}` };
}

function shiftAnchor(period: Period, anchor: string, dir: 1 | -1): string {
  if (period === 'day') return addDays(anchor, dir);
  if (period === 'week') return addDays(anchor, 7 * dir);
  const d = parseDay(anchor);
  const m = new Date(d.getFullYear(), d.getMonth() + dir, 1);
  return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-01`;
}

export function entriesBetween(store: NutritionStore, from: string, to: string): DiaryEntry[] {
  return store.all('diaryEntries').filter((e) => e.date >= from && e.date <= to);
}

function rangeLabel(period: Period, from: string, to: string): string {
  if (period === 'day') return formatDay(from, true);
  if (period === 'month') return parseDay(from).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const f = parseDay(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const t = parseDay(to).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${f} – ${t}`;
}

export function NutrientsScreen() {
  const t = useTheme();
  const store = useStore();
  const nav = useNav();
  const today = useToday();
  const { wide, tiny } = useLayout();
  const [period, setPeriodState] = useState<Period>(lastPeriod);
  const [anchor, setAnchorState] = useState(lastAnchor ?? today);
  const [all, setAll] = useState(false);
  const [focus, setFocus] = useState<NutrientKey | null>(null);
  const setPeriod = (p: Period) => {
    lastPeriod = p;
    setPeriodState(p);
  };
  const setAnchor = (a: string) => {
    lastAnchor = a;
    setAnchorState(a);
  };

  const { from, to } = rangeFor(period, anchor);
  const entries = entriesBetween(store, from, to);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const loggedDays = new Set(entries.map((e) => e.date));
  // Week / month averages run over logged days, leaving out today while it is still in progress
  // (unless it is the only logged day), so a half-logged day doesn't drag every average down.
  const avgDays = period === 'day' ? [from] : daysForAverage([...loggedDays].sort(), today);
  const todayLeftOut = period !== 'day' && loggedDays.has(today) && !avgDays.includes(today);
  const avgSet = new Set(avgDays);
  const n = Math.max(1, avgDays.length);
  const totals = sumNutrients(entries.filter((e) => avgSet.has(e.date)).map((e) => e.nutrients));
  const avg: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals)) avg[k] = v / n;
  const targets = store.targetsOn(to > today ? today : to)?.nutrients ?? {};
  const defs = all ? NUTRIENTS : CORE_NUTRIENTS;

  const perDayKcal = days.map((d) => entries.filter((e) => e.date === d).reduce((a, e) => a + (e.nutrients[N.energy] ?? 0), 0));
  const dayLabels = days.map((d) => (period === 'week' ? parseDay(d).toLocaleDateString(undefined, { weekday: 'narrow' }) : String(Number(d.slice(8)))));

  const openFoods = (key: NutrientKey) => {
    if (wide) setFocus(key);
    else nav.push({ name: 'topFoods', key, from, to });
  };

  const report = (
    <View>
      <Title>Nutrients</Title>
      <Segmented
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
        value={period}
        onChange={setPeriod}
      />
      <View style={styles.rowBetween}>
        <IconButton icon="chevronLeft" label="Previous period" onPress={() => setAnchor(shiftAnchor(period, anchor, -1))} />
        <View style={{ flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
          <T bold style={{ textAlign: 'center', fontSize: 16 }} lines={1}>
            {rangeLabel(period, from, to)}
          </T>
          {(today < from || today > to) && (
            <Pressable onPress={() => setAnchor(today)} accessibilityRole="button" hitSlop={8} style={{ minHeight: 28, justifyContent: 'center' }}>
              <T small color={t.accent} bold>
                Back to {period === 'day' ? 'today' : period === 'week' ? 'this week' : 'this month'}
              </T>
            </Pressable>
          )}
        </View>
        <IconButton icon="chevronRight" label="Next period" onPress={() => setAnchor(shiftAnchor(period, anchor, 1))} />
      </View>
      {period !== 'day' && (
        <Card>
          <T small muted>
            Calories per day
          </T>
          <DailyBars values={perDayKcal} labels={dayLabels} target={targets[N.energy]} color={t.accent} />
          <T small muted style={{ marginTop: 4 }}>
            Bars below are the average per logged day ({avgDays.length} of {days.length} days{todayLeftOut ? '' : ' logged'}).
          </T>
          {todayLeftOut && (
            <View style={[styles.row, { gap: 6, marginTop: 2 }]}>
              <Icon name="info" size={14} color={t.muted} />
              <T small muted style={{ flexShrink: 1 }}>
                Today not included: it is still in progress.
              </T>
            </View>
          )}
        </Card>
      )}
      {!entries.length ? (
        <Empty icon="nutrients" title="Nothing logged in this period" text="Log a meal and its vitamins, minerals and macros show up here.">
          {from <= today && today <= to && <Button title="Log food" icon="plus" variant="primary" onPress={() => nav.openAdd({ day: today })} style={{ marginTop: 8 }} />}
        </Empty>
      ) : (
        <Card>
          {defs.map((d) => {
            const v = avg[d.key];
            const target = targets[d.key];
            // Shared rule with the web: calories use the 80–110% band; null means there is no target.
            const status = v != null ? statusFor(d.key, v, target) : null;
            const hasTarget = target != null && target > 0;
            const amount = v != null ? fmtNutrient(d.key, v) : 'No data';
            return (
              <Pressable
                key={d.key}
                onPress={() => openFoods(d.key)}
                accessibilityRole="button"
                accessibilityLabel={`${d.name}: ${v != null ? fmtNutrient(d.key, v) : 'no data'}${hasTarget ? ` of ${fmtNutrient(d.key, target)}` : ''}${status ? `, ${status === 'ok' ? 'on target' : status}` : ''}. Show top foods`}
                style={({ pressed }) => [{ paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8 }, (pressed || focus === d.key) && { backgroundColor: t.surface2 }]}
              >
                <View style={[styles.rowBetween, { marginBottom: 4, flexWrap: 'wrap' }]}>
                  <T bold={d.group === 'energy' || d.group === 'macro'} style={{ flexShrink: 1 }}>
                    {d.name}
                    {d.limit ? <T small muted>{tiny ? '' : '  (limit)'}</T> : null}
                  </T>
                  <T small muted>
                    {amount}
                    {hasTarget && v != null ? ` / ${fmtNutrient(d.key, target)} · ${Math.round((v / target) * 100)}%` : ''}
                  </T>
                </View>
                {/* No target or no data: an empty track (nothing to measure against), never a full bar. */}
                <ProgressBar value={status && v != null ? v : 0} max={hasTarget ? target : 1} color={status ? statusColor(t, status) : t.muted} />
              </Pressable>
            );
          })}
          <Toggle label="Show all nutrients" value={all} onChange={setAll} />
          <View style={[styles.row, { flexWrap: 'wrap', marginTop: 4 }]}>
            <Legend color={t.success} text="on target" />
            <Legend color={t.warn} text="under" />
            <Legend color={t.danger} text="over" />
          </View>
          <T small muted style={{ marginTop: 4 }}>
            Tap a nutrient to see which foods supplied it.
          </T>
        </Card>
      )}
    </View>
  );

  if (!wide) return <Screen>{report}</Screen>;
  return (
    <SplitView
      ratio={1.2}
      left={
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          {report}
        </ScrollView>
      }
      right={
        focus ? (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
            <TopFoods nutrient={focus} from={from} to={to} />
          </ScrollView>
        ) : (
          <Empty icon="nutrients" title="Pick a nutrient" text="Tap any nutrient to see the foods that supplied it in this period." />
        )
      }
    />
  );
}
function Legend({ color, text }: { color: string; text: string }) {
  return (
    <View style={[styles.row, { gap: 4, marginRight: 8 }]}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <T small muted>
        {text}
      </T>
    </View>
  );
}

export function TopFoodsScreen({ nutrient, from, to }: { nutrient: NutrientKey; from: string; to: string }) {
  return (
    <Screen>
      <TopFoods nutrient={nutrient} from={from} to={to} />
    </Screen>
  );
}

function TopFoods({ nutrient, from, to }: { nutrient: NutrientKey; from: string; to: string }) {
  const t = useTheme();
  const store = useStore();
  const def = NUTRIENT_BY_KEY[nutrient];
  const entries = entriesBetween(store, from, to);
  const top = topFoodsFor(entries, nutrient, 15);
  const range = from === to ? formatDay(from, true) : `${formatDay(from)} – ${formatDay(to)}`;
  const unknown = entries.filter((e) => e.nutrients[nutrient] == null).length;
  return (
    <View>
      <Title>{def?.name ?? nutrient}</Title>
      <T muted>Top sources · {range}</T>
      {!top.length ? (
        <Empty icon="nutrients" title="No logged food supplied this nutrient" />
      ) : (
        <Card>
          {top.map((f) => (
            <View key={f.name} style={{ paddingVertical: 6 }}>
              <View style={[styles.rowBetween, { marginBottom: 3 }]}>
                <T style={{ flex: 1 }} lines={2}>
                  {f.name}
                </T>
                <T small muted>
                  {fmtNutrient(nutrient, f.amount)} · {Math.round(f.share * 100)}%
                </T>
              </View>
              <ProgressBar value={f.share} max={1} color={t.accent} height={6} />
            </View>
          ))}
        </Card>
      )}
      {unknown > 0 && (
        <T small muted style={{ marginTop: 6 }}>
          {unknown} logged item{unknown === 1 ? '' : 's'} had no data for this nutrient (counted as unknown).
        </T>
      )}
    </View>
  );
}
