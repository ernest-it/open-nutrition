import { useState } from 'react';
import { Alert, FlatList, View } from 'react-native';
import {
  CORE_NUTRIENTS,
  N,
  NUTRIENTS,
  recipePer100g,
  recipePortionGrams,
  scaleNutrients,
  sumNutrients,
  type Food,
  type NutrientMap,
  type RecipeIngredient,
  type Serving,
} from '@open-nutrition/shared';
import { FoodRow, FoodSearch, defaultAmount, macroLine, sourceLabel } from '../components';
import { useLayout } from '../layout';
import { useNav } from '../nav';
import { useStore } from '../state';
import {
  Button,
  Card,
  Empty,
  H2,
  IconButton,
  Input,
  ListRow,
  NumField,
  NumInput,
  Screen,
  Segmented,
  Sheet,
  SheetHeader,
  T,
  Title,
  Toggle,
  haptic,
  kcal,
  styles,
  useTheme,
  useToast,
} from '../ui';

type FoodsTab = 'mine' | 'favorites' | 'recipes' | 'meals';
let lastTab: FoodsTab = 'mine';

export function FoodsScreen() {
  const store = useStore();
  const nav = useNav();
  const { tiny, wide } = useLayout();
  const [tab, setTabState] = useState<FoodsTab>(lastTab);
  const setTab = (v: FoodsTab) => {
    lastTab = v;
    setTabState(v);
  };
  const mine = store
    .all('foods')
    .filter((f) => f.source === 'custom' || f.source === 'off')
    .sort((a, b) => a.name.localeCompare(b.name));
  const favorites = store.favoriteFoods();
  const recipes = store.all('recipes').sort((a, b) => a.name.localeCompare(b.name));
  const meals = store.all('savedMeals').sort((a, b) => a.name.localeCompare(b.name));

  const head = (
    <View>
      <Title
        right={
          tab === 'recipes' ? (
            <Button small icon="plus" title="New recipe" variant="primary" onPress={() => nav.push({ name: 'recipeEdit' })} />
          ) : tab === 'mine' ? (
            <Button small icon="plus" title="New food" variant="primary" onPress={() => nav.push({ name: 'foodEdit' })} />
          ) : undefined
        }
      >
        Foods
      </Title>
      <Segmented
        options={[
          { value: 'mine', label: tiny ? 'Mine' : 'My foods' },
          { value: 'favorites', label: tiny ? 'Favs' : 'Favourites' },
          { value: 'recipes', label: 'Recipes' },
          { value: 'meals', label: 'Meals' },
        ]}
        value={tab}
        onChange={setTab}
      />
    </View>
  );

  const pad = { padding: tiny ? 12 : 16, paddingBottom: 32, width: '100%' as const, maxWidth: wide ? 900 : 720, alignSelf: 'center' as const };
  if (tab === 'mine' || tab === 'favorites') {
    const data = tab === 'mine' ? mine : favorites;
    return (
      <FlatList
        data={data}
        keyExtractor={(f) => f.id}
        contentContainerStyle={pad}
        ListHeaderComponent={head}
        renderItem={({ item }) => <FoodRow food={item} onPress={() => nav.push({ name: 'foodEdit', id: item.id })} />}
        ListEmptyComponent={
          tab === 'mine' ? (
            <Empty icon="food" title="No custom foods yet" text="Create foods from a label, or scan a barcode. Scanned products you log appear here too." />
          ) : (
            <Empty icon="star" title="No favourites yet" text="Tap the star on any food to keep it at the top of your search." />
          )
        }
      />
    );
  }
  if (tab === 'recipes') {
    return (
      <FlatList
        data={recipes}
        keyExtractor={(r) => r.id}
        contentContainerStyle={pad}
        ListHeaderComponent={head}
        renderItem={({ item }) => {
          const per = scaleNutrients(recipePer100g(item), recipePortionGrams(item));
          return (
            <ListRow
              title={item.name}
              subtitle={`${item.ingredients.length} ingredients · ${kcal(per[N.energy])} kcal per portion · ${+item.portions.toFixed(2)} portions`}
              onPress={() => nav.push({ name: 'recipeEdit', id: item.id })}
            />
          );
        }}
        ListEmptyComponent={<Empty icon="food" title="No recipes yet" text="Add the ingredients once, then log portions of it any time." />}
      />
    );
  }
  return (
    <FlatList
      data={meals}
      keyExtractor={(m) => m.id}
      contentContainerStyle={pad}
      ListHeaderComponent={head}
      renderItem={({ item }) => {
        const total = sumNutrients(item.items.map((i) => i.nutrients));
        return (
          <ListRow
            title={item.name}
            subtitle={`${item.items.length} items · ${kcal(total[N.energy])} kcal`}
            onPress={() => nav.push({ name: 'savedMeal', id: item.id })}
          />
        );
      }}
      ListEmptyComponent={<Empty icon="bookmark" title="No saved meals yet" text="In the Diary, long-press entries and choose “Save as meal”." />}
    />
  );
}

// ---- food editor ------------------------------------------------------------------------------------------

export function FoodEditScreen({ id, barcode, onDone }: { id?: string; barcode?: string; onDone: () => void }) {
  return (
    <Screen>
      <FoodEditor id={id} barcode={barcode} onSaved={onDone} onDeleted={onDone} />
    </Screen>
  );
}

/** Create or edit a food: name, brand, barcode, servings, nutrients per 100 g or per serving. */
export function FoodEditor({
  id,
  barcode,
  initialName,
  onSaved,
  onDeleted,
}: {
  id?: string;
  barcode?: string;
  initialName?: string;
  onSaved: (f: Food) => void;
  onDeleted?: () => void;
}) {
  const t = useTheme();
  const store = useStore();
  const toast = useToast();
  const existing = id ? store.get('foods', id) : undefined;
  const [name, setName] = useState(existing?.name ?? initialName ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [code, setCode] = useState(existing?.barcode ?? barcode ?? '');
  // A scanned product starts with one serving row: labels list nutrition per serving more often than per 100 g.
  const [servings, setServings] = useState<Serving[]>(() =>
    existing ? existing.servings.filter((sv) => sv.label !== '100 g') : barcode ? [{ label: '1 serving', grams: 0 } as Serving] : [],
  );
  const [basis, setBasis] = useState<'100g' | 'serving'>(barcode && !existing ? 'serving' : '100g');
  const [values, setValues] = useState<NutrientMap>(() => ({ ...(existing?.nutrients ?? {}) }));
  const [all, setAll] = useState(false);
  const [favorite, setFavorite] = useState(existing?.favorite ?? false);
  const basisServing = servings.find((sv) => sv.grams > 0 && sv.label.trim());
  const factor = basis === 'serving' && basisServing ? basisServing.grams / 100 : 1;

  const shown = (k: string) => (values[k] == null ? null : +(values[k]! * factor).toFixed(2));
  const setValue = (k: string, v: number | null) => {
    setValues((cur) => {
      const n = { ...cur };
      if (v == null) delete n[k];
      else n[k] = v / factor;
      return n;
    });
  };
  const defs = (all ? NUTRIENTS : CORE_NUTRIENTS).filter((d) => d.key !== N.energy);
  const valid = name.trim().length > 0 && values[N.energy] != null && (basis === '100g' || !!basisServing);

  function save() {
    const cleanServings = servings.filter((sv) => sv.label.trim() && sv.grams > 0).map((sv) => ({ label: sv.label.trim().slice(0, 100), grams: sv.grams }));
    const food = store.upsertFood({
      id: existing?.id,
      name: name.trim().slice(0, 300),
      brand: brand.trim() || null,
      barcode: code.replace(/\D/g, '') || null,
      source: existing?.source ?? 'custom',
      sourceId: existing?.sourceId ?? null,
      servings: [{ label: '100 g', grams: 100 }, ...cleanServings].slice(0, 50),
      nutrients: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
      favorite,
    });
    haptic.success();
    toast(existing ? 'Food updated' : 'Food created');
    onSaved(food);
  }

  return (
    <View>
      <T bold style={{ fontSize: 20, marginBottom: 4 }}>
        {existing ? 'Edit food' : 'New food'}
      </T>
      {existing && existing.source !== 'custom' && (
        <T small muted>
          Source: {sourceLabel(existing)}. Your edits apply to your copy only; past diary entries keep their values.
        </T>
      )}
      <Card>
        <Input value={name} onChangeText={setName} placeholder="Name (required)" accessibilityLabel="Name" />
        <Input value={brand} onChangeText={setBrand} placeholder="Brand (optional)" accessibilityLabel="Brand" />
        <Input value={code} onChangeText={setCode} placeholder="Barcode (optional)" keyboardType="number-pad" accessibilityLabel="Barcode" />
        <Toggle label="Favourite" value={favorite} onChange={setFavorite} />
      </Card>
      <H2
        right={<Button small icon="plus" title="Add serving" onPress={() => setServings((s) => [...s, { label: '', grams: 0 } as Serving])} />}
      >
        Servings
      </H2>
      <Card>
        <T small muted>
          100 g is always available. Add the sizes you use, e.g. “1 slice” = 28 g.
        </T>
        {servings.map((sv, i) => (
          <View key={i} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Input
                value={sv.label}
                onChangeText={(v) => setServings((list) => list.map((x, j) => (j === i ? { ...x, label: v } : x)))}
                placeholder="e.g. 1 bar"
                accessibilityLabel={`Serving ${i + 1} name`}
              />
            </View>
            <NumInput
              value={sv.grams || null}
              onChange={(v) => setServings((list) => list.map((x, j) => (j === i ? { ...x, grams: v ?? 0 } : x)))}
              accessibilityLabel={`Serving ${i + 1} grams`}
              style={{ width: 72 }}
            />
            <T muted>g</T>
            <IconButton icon="trash" label="Remove serving" color={t.danger} onPress={() => setServings((list) => list.filter((_, j) => j !== i))} />
          </View>
        ))}
      </Card>
      <H2>Nutrition</H2>
      <Card>
        <Segmented
          options={[
            { value: '100g', label: 'Per 100 g' },
            { value: 'serving', label: basisServing ? `Per ${basisServing.label}`.slice(0, 22) : 'Per serving' },
          ]}
          value={basis}
          onChange={(v) => {
            if (v === 'serving' && !basisServing) {
              setServings((s) => (s.length ? s : [{ label: '1 serving', grams: 0 } as Serving]));
            }
            setBasis(v);
          }}
        />
        {basis === 'serving' && !basisServing && (
          <T small color={t.warn}>
            Enter the serving’s weight in grams above first.
          </T>
        )}
        <NumField label="Calories" unit="kcal" value={shown(N.energy)} onChange={(v) => setValue(N.energy, v)} />
        {defs.map((d) => (
          <NumField key={d.key} label={d.name} unit={d.unit} value={shown(d.key)} onChange={(v) => setValue(d.key, v)} />
        ))}
        <Toggle label="Show all nutrients" value={all} onChange={setAll} />
        <T small muted>
          Leave a field empty if the label doesn’t list it (it counts as unknown, not zero).
        </T>
      </Card>
      <Button title={existing ? 'Save food' : 'Create food'} variant="primary" onPress={save} disabled={!valid} />
      {existing && (
        <Button
          title="Delete food"
          variant="danger"
          onPress={() =>
            Alert.alert('Delete this food?', 'Past diary entries keep their values.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  store.remove('foods', existing.id);
                  onDeleted?.();
                },
              },
            ])
          }
        />
      )}
    </View>
  );
}

// ---- recipes ------------------------------------------------------------------------------------------------

export function RecipeEditScreen({ id, onDone }: { id?: string; onDone: () => void }) {
  const t = useTheme();
  const store = useStore();
  const toast = useToast();
  const existing = id ? store.get('recipes', id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [portions, setPortions] = useState<number | null>(existing?.portions ?? 4);
  const [cooked, setCooked] = useState<number | null>(existing?.cookedGrams ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>(existing?.ingredients ?? []);
  const [picking, setPicking] = useState(false);
  const [favorite, setFavorite] = useState(existing?.favorite ?? false);

  const draft = { ingredients, portions: portions && portions > 0 ? portions : 1, cookedGrams: cooked && cooked > 0 ? cooked : null } as Parameters<typeof recipePer100g>[0];
  const perPortion = ingredients.length ? scaleNutrients(recipePer100g(draft), recipePortionGrams(draft)) : {};
  const total = sumNutrients(ingredients.map((i) => scaleNutrients(i.nutrients, i.grams)));
  const valid = name.trim() && ingredients.length > 0 && portions != null && portions > 0;

  function addIngredient(f: Food) {
    const a = defaultAmount(f);
    setIngredients((list) => [...list, { foodId: f.id.startsWith('usda:') ? null : f.id, name: f.name.slice(0, 300), grams: a.grams, nutrients: f.nutrients }]);
    setPicking(false);
    haptic.tap();
  }

  function save() {
    const data = {
      name: name.trim().slice(0, 300),
      ingredients,
      portions: portions!,
      cookedGrams: cooked && cooked > 0 ? cooked : null,
      notes: notes.trim() || null,
      favorite,
    };
    if (existing) store.update('recipes', existing.id, data);
    else store.insert('recipes', data);
    haptic.success();
    toast(existing ? 'Recipe saved' : 'Recipe created');
    onDone();
  }

  return (
    <Screen title={existing ? 'Edit recipe' : 'New recipe'}>
      <Card>
        <Input value={name} onChangeText={setName} placeholder="Recipe name" accessibilityLabel="Recipe name" />
        <NumField label="Portions it makes" value={portions} onChange={setPortions} />
        <NumField label="Cooked weight (optional)" unit="g" value={cooked} onChange={setCooked} />
        <T small muted>
          Weigh the finished dish to log it by grams; otherwise the raw ingredient weight is used.
        </T>
        <Toggle label="Favourite" value={favorite} onChange={setFavorite} />
      </Card>
      <H2 right={<Button small icon="plus" title="Add ingredient" variant="primary" onPress={() => setPicking(true)} />}>Ingredients</H2>
      <Card>
        {!ingredients.length && <T muted>No ingredients yet.</T>}
        {ingredients.map((ing, i) => (
          <View key={i} style={[styles.row, { paddingVertical: 4 }]}>
            <View style={{ flex: 1 }}>
              <T lines={2}>{ing.name}</T>
              <T small muted>
                {kcal(scaleNutrients(ing.nutrients, ing.grams)[N.energy])} kcal
              </T>
            </View>
            <NumInput
              value={ing.grams}
              onChange={(v) => v != null && v > 0 && setIngredients((list) => list.map((x, j) => (j === i ? { ...x, grams: v } : x)))}
              accessibilityLabel={`${ing.name} grams`}
              style={{ width: 70 }}
            />
            <T muted>g</T>
            <IconButton icon="trash" label={`Remove ${ing.name}`} color={t.danger} onPress={() => setIngredients((list) => list.filter((_, j) => j !== i))} />
          </View>
        ))}
      </Card>
      {ingredients.length > 0 && (
        <Card>
          <T bold>Per portion: {kcal(perPortion[N.energy])} kcal</T>
          <T muted>{macroLine(perPortion)}</T>
          <T small muted style={{ marginTop: 4 }}>
            Whole recipe: {kcal(total[N.energy])} kcal · {Math.round(recipePortionGrams(draft))} g per portion
          </T>
        </Card>
      )}
      <Input value={notes} onChangeText={setNotes} placeholder="Notes (optional)" multiline style={{ minHeight: 70, textAlignVertical: 'top' }} accessibilityLabel="Notes" />
      <Button title="Save recipe" variant="primary" onPress={save} disabled={!valid} />
      {existing && (
        <Button
          title="Delete recipe"
          variant="danger"
          onPress={() =>
            Alert.alert('Delete this recipe?', 'Past diary entries keep their values.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  store.remove('recipes', existing.id);
                  onDone();
                },
              },
            ])
          }
        />
      )}
      <Sheet visible={picking} onClose={() => setPicking(false)}>
        <SheetHeader title="Add ingredient" onClose={() => setPicking(false)} />
        <FoodSearch autoFocus onPick={addIngredient} />
      </Sheet>
    </Screen>
  );
}

// ---- saved meals --------------------------------------------------------------------------------------------

export function SavedMealScreen({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useTheme();
  const store = useStore();
  const m = store.get('savedMeals', id);
  const [name, setName] = useState(m?.name ?? '');
  if (!m) return <Empty title="This saved meal was deleted." />;
  const total = sumNutrients(m.items.map((i) => i.nutrients));
  return (
    <Screen title="Saved meal">
      <Card>
        <Input
          value={name}
          onChangeText={setName}
          onEndEditing={() => name.trim() && name.trim() !== m.name && store.update('savedMeals', m.id, { name: name.trim().slice(0, 200) })}
          placeholder="Name"
          accessibilityLabel="Saved meal name"
        />
        <T bold style={{ marginTop: 6 }}>
          {kcal(total[N.energy])} kcal
        </T>
        <T muted>{macroLine(total)}</T>
      </Card>
      <Card>
        {m.items.map((it, i) => (
          <View key={i} style={[styles.row, { paddingVertical: 4 }]}>
            <T style={{ flex: 1 }} lines={2}>
              {it.name}
            </T>
            <T muted>{kcal(it.nutrients[N.energy])}</T>
            <IconButton
              icon="trash"
              label={`Remove ${it.name}`}
              color={t.danger}
              disabled={m.items.length <= 1}
              onPress={() => store.update('savedMeals', m.id, { items: m.items.filter((_, j) => j !== i) })}
            />
          </View>
        ))}
      </Card>
      <Button
        title="Delete saved meal"
        variant="danger"
        onPress={() =>
          Alert.alert('Delete this saved meal?', undefined, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                store.remove('savedMeals', m.id);
                onDone();
              },
            },
          ])
        }
      />
    </Screen>
  );
}
