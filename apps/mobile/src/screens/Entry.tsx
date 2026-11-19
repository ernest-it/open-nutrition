import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { N, multiplyNutrients, recipePortionGrams, type DiaryEntry, type Meal, type NutrientMap } from '@open-nutrition/shared';
import { AmountEditor, CalendarModal, MealPicker, NutrientTable, macroLine, sourceLabel, type Amount } from '../components';
import { removeWithUndo, useStore } from '../state';
import { Badge, Button, Card, Empty, H2, Input, NumField, Screen, Stepper, T, formatDay, haptic, kcal, styles, useOnce, useTheme, useToast } from '../ui';

/** Edit one diary entry: amount, meal, day (move or copy), delete. */
export function EntryScreen({ id, onDone }: { id: string; onDone: () => void }) {
  const store = useStore();
  const entry = store.get('diaryEntries', id);
  if (!entry) return <Empty icon="diary" title="This entry was deleted." />;
  return (
    <Screen>
      <EntryEditor key={entry.id} entry={entry} onDone={onDone} />
    </Screen>
  );
}

export function EntryEditor({ entry, onDone }: { entry: DiaryEntry; onDone: () => void }) {
  const t = useTheme();
  const store = useStore();
  const toast = useToast();
  const food = entry.foodId ? store.get('foods', entry.foodId) : undefined;
  const recipe = entry.recipeId ? store.get('recipes', entry.recipeId) : undefined;
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [calendar, setCalendar] = useState<'move' | 'copy' | null>(null);
  const [calTitle, setCalTitle] = useState('Move to…');
  useEffect(() => {
    if (calendar) setCalTitle(calendar === 'copy' ? 'Copy to…' : 'Move to…');
  }, [calendar]);

  // Amount editing (food entries): servings from the food, or the entry's own label.
  const servings = food?.servings.length
    ? food.servings
    : [{ label: '100 g', grams: 100 }, ...(entry.servingLabel && entry.grams && entry.quantity > 0 && entry.servingLabel !== '100 g' ? [{ label: entry.servingLabel, grams: entry.grams / entry.quantity }] : [])];
  const initialAmount = (): Amount => {
    const i = servings.findIndex((s) => s.label === entry.servingLabel);
    if (i >= 0 && servings[i]!.label !== '100 g') return { serving: i, quantity: entry.quantity, grams: entry.grams ?? 0 };
    return { serving: -1, quantity: 1, grams: entry.grams ?? 0 };
  };
  const [amount, setAmount] = useState<Amount>(initialAmount);
  const [portions, setPortions] = useState(entry.quantity || 1);
  const [quick, setQuick] = useState<NutrientMap>(entry.nutrients);
  const [quickName, setQuickName] = useState(entry.name);
  useEffect(() => setMeal(entry.meal), [entry.meal]);

  const isQuick = entry.source === 'quick' || entry.grams == null;
  const isRecipe = entry.source === 'recipe';
  const newGrams = isRecipe ? (recipe ? portions * recipePortionGrams(recipe) : (entry.grams ?? 0) * (portions / (entry.quantity || 1))) : amount.grams;
  const preview: NutrientMap = isQuick
    ? quick
    : entry.grams && entry.grams > 0
      ? multiplyNutrients(entry.nutrients, newGrams / entry.grams)
      : entry.nutrients;

  const newLabel = isQuick || isRecipe ? entry.servingLabel : amount.serving < 0 ? null : (servings[amount.serving]?.label ?? null);
  const dirty =
    meal !== entry.meal ||
    (isQuick
      ? quickName.trim() !== entry.name || JSON.stringify(quick) !== JSON.stringify(entry.nutrients)
      : isRecipe
        ? portions !== entry.quantity
        : Math.abs(amount.grams - (entry.grams ?? 0)) > 1e-6 || newLabel !== entry.servingLabel);
  const canSave = isQuick ? Object.keys(quick).length > 0 : newGrams > 0;
  const once = useOnce();

  /** Write the edited amount / meal to the entry (also used before moving or copying it). */
  function persist() {
    if (!dirty || !canSave) return false;
    if (isQuick) {
      store.update('diaryEntries', entry.id, { name: quickName.trim() || 'Quick add', nutrients: quick });
    } else if (isRecipe) {
      store.update('diaryEntries', entry.id, {
        grams: newGrams,
        quantity: portions,
        servingLabel: portions === 1 ? '1 portion' : `${+portions.toFixed(2)} portions`,
        nutrients: preview,
      });
    } else {
      store.update('diaryEntries', entry.id, {
        grams: amount.grams,
        quantity: amount.serving < 0 ? 1 : amount.quantity,
        servingLabel: amount.serving < 0 ? null : (servings[amount.serving]?.label ?? null),
        nutrients: preview,
      });
    }
    if (meal !== entry.meal) store.moveEntry(entry.id, { meal });
    return true;
  }

  function save() {
    once.run(() => {
      if (persist()) {
        haptic.success();
        toast('Entry updated');
      }
      onDone();
    });
  }

  function remove() {
    once.run(() => {
      const undo = removeWithUndo('diaryEntries', [entry.id]);
      haptic.warn();
      toast({ message: `Deleted ${entry.name}`, action: { label: 'Undo', onPress: undo } });
      onDone();
    });
  }

  return (
    <View>
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 4 }]}>
        <Badge text={entry.source === 'quick' ? 'Quick add' : entry.source === 'recipe' ? 'Recipe' : sourceLabel({ source: entry.source })} color={t.accent} />
        <T small muted>
          {formatDay(entry.date, true)}
        </T>
      </View>
      {!isQuick && (
        <T bold style={{ fontSize: 20, marginVertical: 6 }}>
          {entry.name}
        </T>
      )}
      <Card>
        <View style={[styles.rowBetween, { marginBottom: 6 }]}>
          <T bold style={{ fontSize: 22 }}>
            {kcal(preview[N.energy])} kcal
          </T>
          <T muted>{macroLine(preview)}</T>
        </View>
        {isQuick ? (
          <View>
            <QuickFields name={quickName} setName={setQuickName} nutrients={quick} setNutrients={setQuick} />
          </View>
        ) : isRecipe ? (
          <View>
            <T small muted>
              Portions
            </T>
            <Stepper label="Portions" value={portions} step={0.5} onChange={setPortions} />
          </View>
        ) : (
          <AmountEditor food={{ servings }} value={amount} onChange={setAmount} />
        )}
        <T small muted style={{ marginTop: 10 }}>
          Meal
        </T>
        <MealPicker value={meal} onChange={setMeal} />
        <Button title={dirty ? 'Save changes' : 'Done'} variant="primary" icon="check" onPress={save} disabled={!canSave} />
      </Card>
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 4 }]}>
        <Button small icon="move" title="Move to another day" onPress={() => setCalendar('move')} />
        <Button small icon="copy" title="Copy to another day" onPress={() => setCalendar('copy')} />
        <Button small icon="trash" variant="danger" title="Delete" onPress={remove} />
      </View>
      {!isQuick && (
        <>
          <H2>Nutrients</H2>
          <Card>
            <NutrientTable nutrients={preview} targets={store.targetsOn(entry.date)?.nutrients} />
          </Card>
        </>
      )}
      <CalendarModal
        visible={calendar != null}
        title={calTitle}
        value={entry.date}
        onClose={() => setCalendar(null)}
        onPick={(day) => {
          const mode = calendar;
          setCalendar(null);
          // Unsaved amount / meal edits go with the entry instead of being silently dropped.
          const saved = persist();
          if (mode === 'copy') {
            store.copyEntries([entry.id], { day, meal });
            toast(`${saved ? 'Saved and copied' : 'Copied'} to ${formatDay(day)}`);
          } else {
            store.moveEntry(entry.id, { day, meal });
            toast(`${saved ? 'Saved and moved' : 'Moved'} to ${formatDay(day)}`);
            onDone();
          }
          haptic.success();
        }}
      />
    </View>
  );
}

/** Calories + macros (and an optional name) for quick-add entries. */
export function QuickFields({
  name,
  setName,
  nutrients,
  setNutrients,
}: {
  name: string;
  setName: (s: string) => void;
  nutrients: NutrientMap;
  setNutrients: (m: NutrientMap) => void;
}) {
  const set = (k: string, v: number | null) => {
    const next = { ...nutrients };
    if (v == null) delete next[k];
    else next[k] = v;
    setNutrients(next);
  };
  return (
    <View>
      <Input value={name} onChangeText={setName} placeholder="Name (optional), e.g. Coffee with milk" accessibilityLabel="Name" />
      <NumField label="Calories" unit="kcal" value={nutrients[N.energy] ?? null} onChange={(v) => set(N.energy, v)} />
      <NumField label="Protein" unit="g" value={nutrients[N.protein] ?? null} onChange={(v) => set(N.protein, v)} />
      <NumField label="Carbohydrates" unit="g" value={nutrients[N.carbs] ?? null} onChange={(v) => set(N.carbs, v)} />
      <NumField label="Fat" unit="g" value={nutrients[N.fat] ?? null} onChange={(v) => set(N.fat, v)} />
    </View>
  );
}
