import { View } from 'react-native';
import { MEALS, N, addDays, dayOf, formatWater, parseDay, toMl, type Meal } from '@open-nutrition/shared';
import { CalorieRing } from '../charts';
import { EntryRow, MacroBars, MealHeader } from '../components';
import { Icon } from '../icons';
import { useLayout } from '../layout';
import { useNav } from '../nav';
import { usePrefs, useStore, useToday } from '../state';
import { Button, Card, Columns, IconButton, MEAL_LABELS, ProgressBar, Screen, T, haptic, kcal, styles, useTheme, useToast } from '../ui';

export function TodayScreen() {
  const store = useStore();
  const nav = useNav();
  const toast = useToast();
  const day = useToday();
  const { wide, width } = useLayout();
  const entries = store.entriesOn(day);
  const totals = store.dayTotals(day);
  const targets = store.targetsOn(day);
  const budget = targets?.nutrients[N.energy] ?? 0;
  const eaten = totals[N.energy] ?? 0;
  const yesterday = store.entriesOn(addDays(day, -1));

  const summary = (
    <Card>
      <View style={[wide || width >= 420 ? { flexDirection: 'row', gap: 16, alignItems: 'center' } : { gap: 12 }]}>
        <View style={{ flex: wide || width >= 420 ? 1 : undefined, alignItems: 'center' }}>
          <CalorieRing eaten={eaten} budget={budget} max={wide ? 220 : 200} />
        </View>
        <View style={{ flex: wide || width >= 420 ? 1.2 : undefined, gap: 10 }}>
          <View style={styles.rowBetween}>
            <Stat label="Budget" value={budget ? kcal(budget) : '—'} />
            <Stat label="Eaten" value={kcal(eaten)} />
            <Stat label={eaten > budget && budget ? 'Over' : 'Left'} value={budget ? kcal(Math.abs(budget - eaten)) : '—'} />
          </View>
          <MacroBars totals={totals} targets={targets?.nutrients} compact />
        </View>
      </View>
      {!targets && <Button title="Set your targets" variant="ghost" icon="edit" onPress={() => nav.push({ name: 'targets' })} />}
    </Card>
  );

  const meals = (
    <View>
      {MEALS.map((meal) => {
        const list = entries.filter((e) => e.meal === meal);
        const yCount = yesterday.filter((e) => e.meal === meal).length;
        return (
          <Card key={meal} style={{ paddingVertical: 6, paddingHorizontal: 8 }}>
            <MealHeader
              meal={meal}
              total={store.mealTotals(day, meal)}
              onAdd={() => nav.openAdd({ day, meal })}
              yesterdayCount={list.length ? 0 : yCount}
              onCopyYesterday={() => copyYesterday(meal)}
            />
            {list.map((e) => (
              <EntryRow key={e.id} entry={e} onPress={() => nav.push({ name: 'entry', id: e.id })} />
            ))}
            {!list.length && (
              <T small muted style={{ paddingHorizontal: 6, paddingBottom: 6 }}>
                Nothing logged yet.
              </T>
            )}
          </Card>
        );
      })}
    </View>
  );

  function copyYesterday(meal: Meal) {
    const copied = store.copyMealFromYesterday(day, meal);
    haptic.success();
    toast({
      message: `Copied ${copied.length} item${copied.length === 1 ? '' : 's'} from yesterday’s ${MEAL_LABELS[meal].toLowerCase()}`,
      action: { label: 'Undo', onPress: () => copied.forEach((e) => store.remove('diaryEntries', e.id)) },
    });
  }

  return (
    <Screen title="Today" wide right={<T muted>{parseDay(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</T>}>
      <Columns
        left={
          <View>
            {summary}
            <WaterCard day={day} />
          </View>
        }
        right={meals}
      />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <T bold style={{ fontSize: 18 }} maxScale={1.4}>
        {value}
      </T>
      <T small muted maxScale={1.4}>
        {label}
      </T>
    </View>
  );
}

export function WaterCard({ day }: { day: string }) {
  const t = useTheme();
  const store = useStore();
  const prefs = usePrefs();
  const water = store.waterOn(day);
  const target = store.targetsOn(day)?.waterMl ?? null;
  const unit = prefs.waterUnit;
  const step = unit === 'ml' ? 250 : toMl(8, 'floz');
  const unitLabel = unit === 'ml' ? 'ml' : 'fl oz';
  const undo = () => {
    const last = store
      .measurementsOf('water')
      .filter((m) => dayOf(m.takenAt) === day)
      .pop();
    if (last) {
      store.remove('measurements', last.id);
      haptic.light();
    }
  };
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={[styles.row, { flex: 1 }]}>
          <Icon name="drop" size={22} color={t.water} />
          <View style={{ flex: 1 }}>
            <T bold>Water</T>
            <T small muted>
              {formatWater(water, unit)}
              {target ? ` / ${formatWater(target, unit)}` : ''} {unitLabel}
            </T>
          </View>
        </View>
        <IconButton icon="minus" label="Remove last drink" onPress={undo} disabled={water <= 0} bg={t.surface2} />
        <Button
          small
          title={`+${unit === 'ml' ? 250 : 8} ${unitLabel}`}
          variant="primary"
          accessibilityLabel={`Add ${unit === 'ml' ? 250 : 8} ${unitLabel} of water`}
          onPress={() => {
            store.addWater(step, day);
            haptic.light();
          }}
        />
      </View>
      {!!target && (
        <View style={{ marginTop: 10 }}>
          <ProgressBar value={water} max={target} color={t.water} />
        </View>
      )}
    </Card>
  );
}
