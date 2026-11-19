import { View } from 'react-native';
import { MEALS, N, addDays, dayOf, parseDay, toMl, type Meal } from '@open-nutrition/shared';
import { CalorieRing, useMeasuredWidth } from '../charts';
import { EntryRow, MacroBars, MealCard } from '../components';
import { Icon } from '../icons';
import { useLayout } from '../layout';
import { useNav } from '../nav';
import { usePrefs, useStore, useToday } from '../state';
import { Button, Card, Columns, IconButton, MEAL_LABELS, ProgressBar, Screen, T, fmtWater, haptic, kcal, styles, useTheme, useToast } from '../ui';

export function TodayScreen() {
  const store = useStore();
  const nav = useNav();
  const toast = useToast();
  const day = useToday();
  const { wide, width, height } = useLayout();
  const [cardW, onCardLayout] = useMeasuredWidth();
  const entries = store.entriesOn(day);
  const totals = store.dayTotals(day);
  const targets = store.targetsOn(day);
  const budget = targets?.nutrients[N.energy] ?? 0;
  const eaten = totals[N.energy] ?? 0;
  const yesterday = store.entriesOn(addDays(day, -1));

  // Ring beside the numbers only when the card itself is wide enough (its pane, not the window, decides).
  const sideBySide = (cardW || width) >= 440;
  const summary = (
    <Card>
      <View onLayout={onCardLayout} style={[sideBySide ? { flexDirection: 'row', gap: 16, alignItems: 'center' } : { gap: 12 }]}>
        <View style={{ flex: sideBySide ? 1 : undefined, minWidth: 0, alignItems: 'center' }}>
          <CalorieRing eaten={eaten} budget={budget} max={sideBySide ? 220 : height < 500 ? 170 : 200} />
        </View>
        <View style={{ flex: sideBySide ? 1.2 : undefined, minWidth: 0, gap: 10 }}>
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
          <MealCard
            key={meal}
            meal={meal}
            total={store.mealTotals(day, meal)}
            entries={list}
            onAdd={() => nav.openAdd({ day, meal })}
            yesterdayCount={yCount}
            onCopyYesterday={() => copyYesterday(meal)}
            renderRow={(e) => <EntryRow entry={e} onPress={() => nav.push({ name: 'entry', id: e.id })} />}
          />
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
              {fmtWater(water, unit)}
              {target ? ` / ${fmtWater(target, unit)}` : ''} {unitLabel}
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
