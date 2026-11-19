import { useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  N,
  OFF_ATTRIBUTION,
  recipePer100g,
  recipePortionGrams,
  scaleNutrients,
  sumNutrients,
  type Food,
  type FoodData,
  type Meal,
  type NutrientMap,
} from '@open-nutrition/shared';
import { AmountEditor, FoodRow, FoodSearch, MealPicker, NutrientTable, amountLabel, defaultAmount, macroLine, sourceLabel, type Amount } from '../components';
import { storedCopy, toggleFavorite } from '../foods';
import { Icon, type IconName } from '../icons';
import { useLayout } from '../layout';
import { AddNavContext, useAddNav, type AddNav, type AddOptions, type AddRoute } from '../nav';
import { usePrefs, useStore } from '../state';
import {
  Badge,
  Button,
  Card,
  Empty,
  H2,
  IconButton,
  KeyboardAware,
  MEAL_LABELS,
  Segmented,
  Sheet,
  SheetHeader,
  Stepper,
  T,
  formatDay,
  haptic,
  kcal,
  mealForNow,
  styles,
  useTheme,
  useToast,
} from '../ui';
import { QuickFields } from './Entry';
import { AiLogScreen } from './AiLog';
import { ScanScreen } from './Scan';
import { FoodEditor } from './Foods';

/** The center "+" sheet. Has its own small stack so nested flows never stack modals. */
export function AddSheet({ options, onClose }: { options: AddOptions; onClose: () => void }) {
  const toast = useToast();
  const [meal, setMeal] = useState<Meal>(options.meal ?? mealForNow());
  const first: AddRoute = { name: options.start && options.start !== 'search' ? options.start : 'hub' } as AddRoute;
  const [stack, setStack] = useState<AddRoute[]>([first]);
  const route = stack[stack.length - 1]!;
  const nav: AddNav = useMemo(
    () => ({
      day: options.day,
      meal,
      setMeal,
      push: (r) => setStack((s) => [...s, r]),
      pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      replace: (r) => setStack((s) => [...s.slice(0, -1), r]),
      close: (message) => {
        if (message) {
          haptic.success();
          toast(message);
        }
        onClose();
      },
    }),
    [meal, options.day, onClose, toast],
  );
  const back = stack.length > 1 ? nav.pop : undefined;
  return (
    <Sheet onClose={back ?? onClose}>
      <AddNavContext.Provider value={nav}>
        <KeyboardAware>
          {route.name === 'hub' && <Hub />}
          {route.name === 'food' && <FoodDetail food={route.food} onBack={back} />}
          {route.name === 'scan' && <ScanScreen onBack={back} />}
          {route.name === 'ai' && <AiLogScreen onBack={back} />}
          {route.name === 'quick' && <QuickAdd onBack={back} />}
          {route.name === 'saved' && <SavedList onBack={back} />}
          {route.name === 'recipe' && <RecipeLog id={route.id} onBack={back} />}
          {route.name === 'savedMeal' && <SavedMealLog id={route.id} onBack={back} />}
          {route.name === 'newFood' && (
            <>
              <SheetHeader title="New food" onBack={back} onClose={onClose} />
              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
                <FoodEditor barcode={route.barcode} initialName={route.initialName} onSaved={(f) => nav.replace({ name: 'food', food: f })} />
              </ScrollView>
            </>
          )}
        </KeyboardAware>
      </AddNavContext.Provider>
    </Sheet>
  );
}

function AddTitle({ title, onBack }: { title?: string; onBack?: () => void }) {
  const nav = useAddNav();
  return <SheetHeader title={title ?? `Add to ${MEAL_LABELS[nav.meal]} · ${formatDay(nav.day)}`} onBack={onBack} onClose={() => nav.close()} />;
}

// ---- hub -----------------------------------------------------------------------------------------------

function Hub() {
  const t = useTheme();
  const nav = useAddNav();
  const store = useStore();
  const prefs = usePrefs();
  const { tiny } = useLayout();
  const favorites = store.favoriteFoods();
  const favIds = new Set(favorites.map((f) => f.id));
  const recents = store.recentFoods(25).filter((f) => !favIds.has(f.id));
  const tiles: { icon: IconName; label: string; route: AddRoute; hint?: string }[] = [
    { icon: 'barcode', label: 'Scan', route: { name: 'scan' } },
    { icon: 'sparkle', label: 'Photo / describe', route: { name: 'ai' }, hint: prefs.aiEnabled ? undefined : 'off' },
    { icon: 'bolt', label: 'Quick add', route: { name: 'quick' } },
    { icon: 'bookmark', label: 'Meals & recipes', route: { name: 'saved' } },
  ];
  const header = (
    <View>
      <View style={[s.tiles, { gap: tiny ? 6 : 8 }]}>
        {tiles.map((x) => (
          <Pressable
            key={x.label}
            onPress={() => nav.push(x.route)}
            accessibilityRole="button"
            accessibilityLabel={x.label}
            style={({ pressed }) => [s.tile, { backgroundColor: pressed ? t.surface2 : t.surface, borderColor: t.border }]}
          >
            <Icon name={x.icon} size={24} color={t.accent} />
            <T small style={{ textAlign: 'center' }} lines={2} maxScale={1.3}>
              {x.label}
            </T>
            {x.hint && (
              <T small muted maxScale={1.2} style={{ fontSize: 11 }}>
                {x.hint}
              </T>
            )}
          </Pressable>
        ))}
      </View>
      {favorites.length > 0 && <ListLabel>Favourites</ListLabel>}
      {favorites.map((f) => (
        <FoodRow key={f.id} food={f} onPress={() => nav.push({ name: 'food', food: f })} />
      ))}
      {recents.length > 0 && <ListLabel>Recent</ListLabel>}
      {recents.map((f) => (
        <FoodRow key={f.id} food={f} onPress={() => nav.push({ name: 'food', food: f })} />
      ))}
      {!favorites.length && !recents.length && (
        <Empty icon="search" title="Search 8,000+ foods" text="Generic foods from USDA FoodData Central work offline. Foods you log show up here next time." />
      )}
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <AddTitle />
      <View style={{ paddingHorizontal: 12 }}>
        <MealPicker value={nav.meal} onChange={nav.setMeal} />
      </View>
      <FoodSearch
        onPick={(f) => nav.push({ name: 'food', food: f })}
        header={header}
        emptyContent={(q) =>
          q ? (
            <View style={{ marginTop: 8 }}>
              <Button title={`Create “${q}” as a food`} icon="plus" onPress={() => nav.push({ name: 'newFood', initialName: q })} />
              <Button title="Quick add calories instead" variant="ghost" onPress={() => nav.push({ name: 'quick' })} />
            </View>
          ) : null
        }
      />
    </View>
  );
}

function ListLabel({ children }: { children: ReactNode }) {
  return (
    <T small muted bold style={{ marginTop: 14, marginBottom: 2, marginLeft: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {children}
    </T>
  );
}

// ---- food detail -------------------------------------------------------------------------------------------

export function FoodDetail({ food: initial, onBack }: { food: Food | FoodData; onBack?: () => void }) {
  const t = useTheme();
  const nav = useAddNav();
  const store = useStore();
  const copy = storedCopy(store, initial);
  const food: Food | FoodData = copy ?? initial;
  const [amount, setAmount] = useState<Amount>(() => defaultAmount(food));
  const totals = scaleNutrients(food.nutrients, amount.grams);
  const targets = store.targetsOn(nav.day)?.nutrients;
  const favorite = !!copy?.favorite;

  function add() {
    store.logFood({
      day: nav.day,
      meal: nav.meal,
      food: food as Food,
      grams: amount.grams,
      servingLabel: amountLabel(food, amount),
      quantity: amount.serving < 0 ? 1 : amount.quantity,
    });
    nav.close(`Added ${food.name.split(',')[0]} to ${MEAL_LABELS[nav.meal].toLowerCase()}`);
  }

  return (
    <View style={{ flex: 1 }}>
      <AddTitle title="Food" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <View style={{ flex: 1 }}>
            <T bold style={{ fontSize: 20 }}>
              {food.name}
            </T>
            <View style={[styles.row, { flexWrap: 'wrap', marginTop: 4 }]}>
              {food.brand && <T muted>{food.brand}</T>}
              <Badge text={sourceLabel(food)} />
              {food.barcode && (
                <T small muted>
                  {food.barcode}
                </T>
              )}
            </View>
          </View>
          <IconButton
            icon={favorite ? 'starFilled' : 'star'}
            label={favorite ? 'Remove from favourites' : 'Add to favourites'}
            color={favorite ? t.warn : t.muted}
            onPress={() => {
              toggleFavorite(store, food as Food);
              haptic.tap();
            }}
          />
        </View>
        <Card>
          <View style={[styles.rowBetween, { flexWrap: 'wrap', marginBottom: 6 }]}>
            <T bold style={{ fontSize: 24 }}>
              {kcal(totals[N.energy])} kcal
            </T>
            <T muted>{macroLine(totals)}</T>
          </View>
          <AmountEditor food={food} value={amount} onChange={setAmount} />
          <T small muted style={{ marginTop: 10 }}>
            Meal
          </T>
          <MealPicker value={nav.meal} onChange={nav.setMeal} />
          <Button title={`Add to ${MEAL_LABELS[nav.meal]}`} variant="primary" icon="plus" onPress={add} disabled={!(amount.grams > 0)} />
        </Card>
        <H2>Nutrients{amount.grams > 0 ? ` in ${+amount.grams.toFixed(1)} g` : ''}</H2>
        <Card>
          <NutrientTable nutrients={totals} targets={targets} />
        </Card>
        {food.source === 'off' && (
          <Pressable onPress={() => void Linking.openURL('https://world.openfoodfacts.org')} accessibilityRole="link">
            <T small muted style={{ marginTop: 8 }}>
              {OFF_ATTRIBUTION}
            </T>
          </Pressable>
        )}
        {food.source === 'usda' && (
          <T small muted style={{ marginTop: 8 }}>
            Nutrient data: USDA FoodData Central (public domain).
          </T>
        )}
      </ScrollView>
    </View>
  );
}

// ---- quick add -------------------------------------------------------------------------------------------------

function QuickAdd({ onBack }: { onBack?: () => void }) {
  const nav = useAddNav();
  const store = useStore();
  const [name, setName] = useState('');
  const [nutrients, setNutrients] = useState<NutrientMap>({});
  const kcalValue = nutrients[N.energy];
  return (
    <View style={{ flex: 1 }}>
      <AddTitle title="Quick add" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <T small muted>
          Type the numbers straight in, for example from a menu or a label. Leave macros empty if you don’t know them.
        </T>
        <Card>
          <QuickFields name={name} setName={setName} nutrients={nutrients} setNutrients={setNutrients} />
          <T small muted style={{ marginTop: 6 }}>
            Meal
          </T>
          <MealPicker value={nav.meal} onChange={nav.setMeal} />
          <Button
            title={`Add to ${MEAL_LABELS[nav.meal]}`}
            variant="primary"
            disabled={kcalValue == null && nutrients[N.protein] == null && nutrients[N.carbs] == null && nutrients[N.fat] == null}
            onPress={() => {
              const n = { ...nutrients };
              if (n[N.energy] == null) n[N.energy] = 4 * (n[N.protein] ?? 0) + 4 * (n[N.carbs] ?? 0) + 9 * (n[N.fat] ?? 0);
              store.quickAdd({ day: nav.day, meal: nav.meal, name, nutrients: n });
              nav.close(`Added ${Math.round(n[N.energy] ?? 0)} kcal to ${MEAL_LABELS[nav.meal].toLowerCase()}`);
            }}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

// ---- saved meals & recipes -------------------------------------------------------------------------------------

function SavedList({ onBack }: { onBack?: () => void }) {
  const nav = useAddNav();
  const store = useStore();
  const [tab, setTab] = useState<'meals' | 'recipes'>('meals');
  const meals = store.all('savedMeals').sort((a, b) => a.name.localeCompare(b.name));
  const recipes = store.all('recipes').sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  return (
    <View style={{ flex: 1 }}>
      <AddTitle title="Saved meals & recipes" onBack={onBack} />
      <View style={{ paddingHorizontal: 12 }}>
        <Segmented
          options={[
            { value: 'meals', label: `Meals (${meals.length})` },
            { value: 'recipes', label: `Recipes (${recipes.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: 8, paddingBottom: 32 }}>
        {tab === 'meals' &&
          (meals.length ? (
            meals.map((m) => {
              const total = sumNutrients(m.items.map((i) => i.nutrients));
              return (
                <FoodLikeRow
                  key={m.id}
                  title={m.name}
                  subtitle={`${m.items.length} item${m.items.length === 1 ? '' : 's'} · ${kcal(total[N.energy])} kcal`}
                  onPress={() => nav.push({ name: 'savedMeal', id: m.id })}
                />
              );
            })
          ) : (
            <Empty icon="bookmark" title="No saved meals yet" text="In the Diary, long-press entries and choose “Save as meal”." />
          ))}
        {tab === 'recipes' &&
          (recipes.length ? (
            recipes.map((r) => {
              const per = scaleNutrients(recipePer100g(r), recipePortionGrams(r));
              return (
                <FoodLikeRow
                  key={r.id}
                  title={r.name}
                  subtitle={`${kcal(per[N.energy])} kcal per portion · makes ${+r.portions.toFixed(2)}`}
                  onPress={() => nav.push({ name: 'recipe', id: r.id })}
                />
              );
            })
          ) : (
            <Empty icon="food" title="No recipes yet" text="Create recipes under More → Foods & recipes." />
          ))}
      </ScrollView>
    </View>
  );
}

function FoodLikeRow({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.listRow, { backgroundColor: pressed ? t.surface2 : 'transparent' }]}>
      <View style={{ flex: 1 }}>
        <T lines={2}>{title}</T>
        <T small muted>
          {subtitle}
        </T>
      </View>
      <Icon name="chevronRight" size={18} color={t.muted} />
    </Pressable>
  );
}

function SavedMealLog({ id, onBack }: { id: string; onBack?: () => void }) {
  const nav = useAddNav();
  const store = useStore();
  const m = store.get('savedMeals', id);
  if (!m) return <Empty title="This saved meal was deleted." />;
  const total = sumNutrients(m.items.map((i) => i.nutrients));
  return (
    <View style={{ flex: 1 }}>
      <AddTitle title={m.name} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Card>
          <View style={[styles.rowBetween, { flexWrap: 'wrap' }]}>
            <T bold style={{ fontSize: 22 }}>
              {kcal(total[N.energy])} kcal
            </T>
            <T muted>{macroLine(total)}</T>
          </View>
          {m.items.map((it, i) => (
            <View key={i} style={[styles.rowBetween, { paddingVertical: 6 }]}>
              <T style={{ flex: 1 }} lines={2}>
                {it.name}
              </T>
              <T muted>{kcal(it.nutrients[N.energy])}</T>
            </View>
          ))}
          <MealPicker value={nav.meal} onChange={nav.setMeal} />
          <Button
            title={`Add all to ${MEAL_LABELS[nav.meal]}`}
            variant="primary"
            onPress={() => {
              store.logSavedMeal(m.id, nav.day, nav.meal);
              nav.close(`Added “${m.name}”`);
            }}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

function RecipeLog({ id, onBack }: { id: string; onBack?: () => void }) {
  const nav = useAddNav();
  const store = useStore();
  const r = store.get('recipes', id);
  const [mode, setMode] = useState<'portions' | 'grams'>('portions');
  const [portions, setPortions] = useState(1);
  const [grams, setGrams] = useState(() => (r ? Math.round(recipePortionGrams(r)) : 100));
  if (!r) return <Empty title="This recipe was deleted." />;
  const g = mode === 'portions' ? portions * recipePortionGrams(r) : grams;
  const totals = scaleNutrients(recipePer100g(r), g);
  return (
    <View style={{ flex: 1 }}>
      <AddTitle title={r.name} onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Card>
          <View style={[styles.rowBetween, { flexWrap: 'wrap' }]}>
            <T bold style={{ fontSize: 22 }}>
              {kcal(totals[N.energy])} kcal
            </T>
            <T muted>{macroLine(totals)}</T>
          </View>
          {r.cookedGrams != null && (
            <Segmented
              options={[
                { value: 'portions', label: 'Portions' },
                { value: 'grams', label: 'Grams' },
              ]}
              value={mode}
              onChange={setMode}
            />
          )}
          {mode === 'portions' ? (
            <Stepper label="Portions" value={portions} step={0.5} onChange={setPortions} unit={`of ${+r.portions.toFixed(2)}`} />
          ) : (
            <Stepper label="Grams" value={grams} step={10} onChange={setGrams} unit="g" />
          )}
          <MealPicker value={nav.meal} onChange={nav.setMeal} />
          <Button
            title={`Add to ${MEAL_LABELS[nav.meal]}`}
            variant="primary"
            disabled={!(g > 0)}
            onPress={() => {
              store.logRecipe(mode === 'portions' ? { day: nav.day, meal: nav.meal, recipeId: r.id, portions } : { day: nav.day, meal: nav.meal, recipeId: r.id, grams });
              nav.close(`Added ${r.name}`);
            }}
          />
        </Card>
        <H2>Nutrients</H2>
        <Card>
          <NutrientTable nutrients={totals} />
        </Card>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  tiles: { flexDirection: 'row', paddingHorizontal: 8, marginTop: 4, marginBottom: 4 },
  tile: { flex: 1, minHeight: 76, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 4 },
});
