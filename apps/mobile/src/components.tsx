import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CORE_NUTRIENTS,
  MEALS,
  N,
  NUTRIENTS,
  NUTRIENT_BY_KEY,
  addDays,

  parseDay,
  todayLocal,
  type DiaryEntry,
  type Food,
  type FoodData,
  type Meal,
  type NutrientMap,
  type Serving,
} from '@open-nutrition/shared';
import { Icon } from './icons';
import { searchFoods } from './foods';
import { useStore } from './state';
import {
  Badge,
  Dialog,
  DialogButton,
  Chips,
  IconButton,
  Input,
  MEAL_LABELS,
  NumInput,
  ProgressBar,
  T,
  Toggle,
  fmtNutrient,
  grams1,
  haptic,
  kcal,
  styles,
  useTheme,
} from './ui';

export function MealPicker({ value, onChange }: { value: Meal; onChange: (m: Meal) => void }) {
  return <Chips options={MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }))} value={value} onChange={onChange} wrap />;
}

/** Protein / carbs / fat: grams eaten against target. */
export function MacroBars({ totals, targets, compact }: { totals: NutrientMap; targets: NutrientMap | undefined; compact?: boolean }) {
  const t = useTheme();
  const rows = [
    { key: N.protein, name: 'Protein', color: t.protein },
    { key: N.carbs, name: 'Carbs', color: t.carbs },
    { key: N.fat, name: 'Fat', color: t.fat },
  ];
  return (
    <View style={{ gap: compact ? 6 : 10 }}>
      {rows.map((r) => {
        const v = totals[r.key] ?? 0;
        const target = targets?.[r.key] ?? 0;
        const pct = target > 0 ? Math.round((v / target) * 100) : null;
        return (
          <View
            key={r.key}
            accessible
            accessibilityLabel={target > 0 ? `${r.name}: ${Math.round(v)} of ${Math.round(target)} grams` : `${r.name}: ${Math.round(v)} grams`}
          >
            <View style={[styles.rowBetween, { marginBottom: 3 }]}>
              <T small bold>
                {r.name}
              </T>
              <T small muted>
                {Math.round(v)}
                {target > 0 ? ` / ${Math.round(target)} g` : ' g'}
                {pct != null ? ` · ${pct}%` : ''}
              </T>
            </View>
            {/* Without a target there is nothing to measure against: show an empty track, not a full bar. */}
            <ProgressBar value={target > 0 ? v : 0} max={target || 1} color={r.color} height={compact ? 6 : 8} />
          </View>
        );
      })}
    </View>
  );
}

/** "P 32 · C 40 · F 12" */
export function macroLine(n: NutrientMap): string {
  return `P ${grams1(n[N.protein])} · C ${grams1(n[N.carbs])} · F ${grams1(n[N.fat])}`;
}

export function entryAmount(e: DiaryEntry): string {
  if (e.source === 'quick') return 'Quick add';
  const parts: string[] = [];
  if (e.servingLabel && e.servingLabel !== '100 g' && !e.servingLabel.endsWith('portion') && !e.servingLabel.endsWith('portions')) {
    parts.push(`${+e.quantity.toFixed(2)} × ${e.servingLabel}`);
  } else if (e.servingLabel) parts.push(e.servingLabel === '100 g' ? `${grams1(e.grams)} g` : e.servingLabel);
  if (e.grams != null && !parts.some((p) => p.endsWith(' g'))) parts.push(`${grams1(e.grams)} g`);
  return parts.join(' · ');
}

export const EntryRow = memo(function EntryRow({
  entry,
  onPress,
  onLongPress,
  selected,
  selecting,
}: {
  entry: DiaryEntry;
  onPress: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  selecting?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={selecting ? { selected: !!selected } : undefined}
      accessibilityLabel={`${entry.name}, ${kcal(entry.nutrients[N.energy])} calories, ${entryAmount(entry)}`}
      style={({ pressed }) => [
        styles.listRow,
        { paddingHorizontal: 6, backgroundColor: selected ? t.accentSoft : pressed ? t.surface2 : 'transparent' },
      ]}
    >
      {selecting && (
        <View style={[s.check, { borderColor: selected ? t.accent : t.border, backgroundColor: selected ? t.accent : 'transparent' }]}>
          {selected && <Icon name="check" size={14} color={t.onAccent} strokeWidth={3} />}
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T lines={2}>{entry.name}</T>
        <View style={[styles.row, { gap: 6, flexWrap: 'wrap' }]}>
          <T small muted>
            {entryAmount(entry)}
          </T>
          {entry.source === 'ai' && <Badge text="AI" color={t.accent} />}
        </View>
      </View>
      <T bold>{kcal(entry.nutrients[N.energy])}</T>
    </Pressable>
  );
});

/** Header of a meal section: name, calories, copy-yesterday and add actions. */
export function MealHeader({
  meal,
  total,
  onAdd,
  onCopyYesterday,
  yesterdayCount,
}: {
  meal: Meal;
  total: NutrientMap;
  onAdd: () => void;
  onCopyYesterday?: () => void;
  yesterdayCount?: number;
}) {
  const t = useTheme();
  return (
    <View style={[styles.rowBetween, { paddingVertical: 8, paddingLeft: 14, paddingRight: 10, gap: 4 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T bold style={{ fontSize: 17 }}>
          {MEAL_LABELS[meal]}
        </T>
        <T small muted>
          {(total[N.energy] ?? 0) > 0 ? `${kcal(total[N.energy])} kcal · ${macroLine(total)}` : '0 kcal'}
        </T>
      </View>
      {onCopyYesterday && !!yesterdayCount && (
        <IconButton icon="copy" label={`Copy yesterday's ${MEAL_LABELS[meal].toLowerCase()} (${yesterdayCount} items)`} onPress={onCopyYesterday} color={t.muted} />
      )}
      <IconButton icon="plus" label={`Add to ${MEAL_LABELS[meal]}`} onPress={onAdd} bg={t.accentSoft} />
    </View>
  );
}

/** 1 dp line between rows (hairlines vanish at some fractional positions on Android, so rows looked unevenly separated). */
export function RowSeparator({ inset = 14 }: { inset?: number }) {
  const t = useTheme();
  return <View style={{ height: 1, marginHorizontal: inset, backgroundColor: t.border }} />;
}

/**
 * One meal as a card: header (name, totals, copy-yesterday and a 44 pt add button with room around
 * it) followed by its entries, each separated by the same line. Used by Today and Diary.
 */
export function MealCard({
  meal,
  total,
  entries,
  onAdd,
  yesterdayCount,
  onCopyYesterday,
  renderRow,
}: {
  meal: Meal;
  total: NutrientMap;
  entries: DiaryEntry[];
  onAdd: () => void;
  yesterdayCount?: number;
  onCopyYesterday?: () => void;
  renderRow: (e: DiaryEntry) => ReactElement;
}) {
  const t = useTheme();
  return (
    <View style={[styles.card, s.mealCard, { backgroundColor: t.surface, borderColor: t.border }]}>
      <MealHeader meal={meal} total={total} onAdd={onAdd} yesterdayCount={entries.length ? 0 : yesterdayCount} onCopyYesterday={onCopyYesterday} />
      {entries.map((e) => (
        <View key={e.id}>
          <RowSeparator />
          <View style={{ paddingHorizontal: 8, paddingVertical: 2 }}>{renderRow(e)}</View>
        </View>
      ))}
      {!entries.length && (
        <T small muted style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
          Nothing logged yet.
        </T>
      )}
      {entries.length > 0 && <View style={{ height: 6 }} />}
    </View>
  );
}

export function sourceLabel(f: Pick<Food, 'source'>): string {
  return { usda: 'USDA', off: 'Open Food Facts', custom: 'My food', ai: 'AI' }[f.source];
}

export const FoodRow = memo(function FoodRow({ food, onPress, right }: { food: Food | FoodData; onPress: () => void; right?: ReactElement }) {
  const t = useTheme();
  const kcal100 = food.nutrients[N.energy];
  const serving = food.servings.find((sv) => sv.label !== '100 g');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${food.name}${food.brand ? `, ${food.brand}` : ''}`}
      style={({ pressed }) => [styles.listRow, { backgroundColor: pressed ? t.surface2 : 'transparent' }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={[styles.row, { gap: 6 }]}>
          {food.favorite && <Icon name="starFilled" size={14} color={t.warn} />}
          <T lines={2} style={{ flexShrink: 1 }}>
            {food.name}
          </T>
        </View>
        <T small muted lines={1}>
          {[food.brand, kcal100 != null ? `${kcal(kcal100)} kcal / 100 g` : null, serving ? `${serving.label} = ${grams1(serving.grams)} g` : null, sourceLabel(food)]
            .filter(Boolean)
            .join(' · ')}
        </T>
      </View>
      {right ?? <Icon name="chevronRight" size={18} color={t.muted} />}
    </Pressable>
  );
});

/**
 * Search box + results list (FlatList). Empty query shows `emptyContent` (recents etc.).
 * Searches the user's foods and the bundled USDA database, offline.
 */
export function FoodSearch({
  onPick,
  autoFocus,
  header,
  emptyContent,
  initialQuery = '',
}: {
  onPick: (f: Food) => void;
  autoFocus?: boolean;
  header?: ReactElement;
  emptyContent?: (q: string) => ReactElement | null;
  initialQuery?: string;
}) {
  const t = useTheme();
  const store = useStore();
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<Food[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setResults([]);
      return;
    }
    const my = ++seq.current;
    setBusy(true);
    const timer = setTimeout(() => {
      searchFoods(store, text)
        .then((r) => {
          if (my === seq.current) setResults(r);
        })
        .catch(() => {})
        .finally(() => {
          if (my === seq.current) setBusy(false);
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [q, store]);

  const searching = q.trim().length > 0;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 12 }}>
        <View>
          <Input
            value={q}
            onChangeText={setQ}
            placeholder="Search foods (e.g. oats, banana)"
            autoFocus={autoFocus}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search foods"
            style={{ paddingLeft: 38, paddingRight: 44 }}
          />
          {/* Icon, spinner and clear button sit inside the field so nothing shifts while typing. */}
          <View pointerEvents="none" style={s.searchIcon}>
            <Icon name="search" size={18} color={t.muted} />
          </View>
          <View style={s.searchRight}>
            {busy ? (
              <ActivityIndicator color={t.muted} />
            ) : q ? (
              <Pressable onPress={() => setQ('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={6} style={s.clearBtn}>
                <Icon name="close" size={18} color={t.muted} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
      <FlatList
        data={searching ? results : []}
        keyExtractor={(f) => f.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={14}
        windowSize={7}
        contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 24 }}
        ListHeaderComponent={!searching ? header : undefined}
        renderItem={({ item }) => <FoodRow food={item} onPress={() => onPick(item)} />}
        ListEmptyComponent={
          searching ? (
            busy ? undefined : (
              <View style={{ padding: 16 }}>
                <T muted>No foods match “{q.trim()}”.</T>
                {emptyContent?.(q.trim())}
              </View>
            )
          ) : (
            (emptyContent?.('') ?? undefined)
          )
        }
      />
    </View>
  );
}

// ---- amount (serving × quantity or grams) -----------------------------------------------------------

export interface Amount {
  /** Index into servings, or -1 for plain grams. */
  serving: number;
  quantity: number;
  grams: number;
}

export function servingsOf(food: Pick<Food, 'servings'>): Serving[] {
  const list = food.servings.length ? food.servings : [{ label: '100 g', grams: 100 }];
  return list;
}

/** Initial amount: the first non-100 g serving if there is one, else 100 g. */
export function defaultAmount(food: Pick<Food, 'servings'>): Amount {
  const sv = servingsOf(food);
  const i = sv.findIndex((x) => x.label !== '100 g');
  if (i >= 0) return { serving: i, quantity: 1, grams: sv[i]!.grams };
  return { serving: -1, quantity: 1, grams: 100 };
}

export function amountLabel(food: Pick<Food, 'servings'>, a: Amount): string | null {
  if (a.serving < 0) return null;
  return servingsOf(food)[a.serving]?.label ?? null;
}

export function AmountEditor({ food, value, onChange }: { food: Pick<Food, 'servings'>; value: Amount; onChange: (a: Amount) => void }) {
  const t = useTheme();
  const sv = servingsOf(food);
  const options = [
    { value: '-1', label: 'Grams' },
    ...sv.map((s, i) => ({ value: String(i), label: s.label === '100 g' ? '100 g' : `${s.label} (${grams1(s.grams)} g)` })),
  ];
  const step = value.serving < 0 ? 10 : value.quantity < 1 ? 0.25 : 0.5;
  const setQty = (q: number) => {
    const qty = Math.max(0, Math.round(q * 100) / 100);
    if (value.serving < 0) onChange({ ...value, quantity: 1, grams: qty });
    else onChange({ ...value, quantity: qty, grams: qty * sv[value.serving]!.grams });
  };
  const shown = value.serving < 0 ? value.grams : value.quantity;
  return (
    <View>
      <T small muted>
        Serving
      </T>
      <Chips
        options={options}
        value={String(value.serving)}
        onChange={(v) => {
          const i = Number(v);
          if (i < 0) onChange({ serving: -1, quantity: 1, grams: Math.round(value.grams) || 100 });
          else onChange({ serving: i, quantity: 1, grams: sv[i]!.grams });
        }}
      />
      <View style={[styles.row, { flexWrap: 'wrap', marginTop: 4 }]}>
        <IconButton icon="minus" label="Less" bg={t.surface2} onPress={() => setQty(shown - step)} />
        <NumInput value={+shown.toFixed(2)} onChange={(v) => v != null && setQty(v)} accessibilityLabel={value.serving < 0 ? 'Grams' : 'Quantity'} style={{ width: 84 }} />
        <IconButton icon="plus" label="More" bg={t.surface2} onPress={() => setQty(shown + step)} />
        <T muted style={{ flexShrink: 1 }}>
          {value.serving < 0 ? 'g' : `× ${sv[value.serving]!.label}  =  ${grams1(value.grams)} g`}
        </T>
      </View>
    </View>
  );
}

// ---- nutrient table ---------------------------------------------------------------------------------

export function NutrientTable({ nutrients, targets }: { nutrients: NutrientMap; targets?: NutrientMap }) {
  const t = useTheme();
  const [all, setAll] = useState(false);
  const defs = (all ? NUTRIENTS : CORE_NUTRIENTS).filter((d) => d.key !== N.energy);
  const known = defs.filter((d) => nutrients[d.key] != null);
  const missing = defs.length - known.length;
  return (
    <View>
      {known.map((d) => {
        const v = nutrients[d.key]!;
        const target = targets?.[d.key];
        const indent = d.group === 'carb' || d.group === 'fat';
        return (
          <View key={d.key} style={[styles.rowBetween, { paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.border }]}>
            <T small={!['macro'].includes(d.group)} bold={d.group === 'macro'} style={{ paddingLeft: indent ? 12 : 0, flex: 1 }}>
              {d.name}
            </T>
            <T small muted={false}>
              {fmtNutrient(d.key, v)}
              {target ? <Text style={{ color: t.muted }}>{`  ${Math.round((v / target) * 100)}%`}</Text> : null}
            </T>
          </View>
        );
      })}
      {missing > 0 && (
        <T small muted style={{ marginTop: 4 }}>
          {missing} nutrient{missing === 1 ? '' : 's'} not listed for this food (shown as unknown, not zero).
        </T>
      )}
      <Toggle label="Show all nutrients" value={all} onChange={setAll} />
    </View>
  );
}

export const nutrientName = (key: string) => NUTRIENT_BY_KEY[key]?.name ?? key;

// ---- calendar -------------------------------------------------------------------------------------------

/** Month-grid date picker (a bottom sheet on phones, a dialog on wide screens). `marked` days get a dot. */
export function CalendarModal({
  visible,
  value,
  onPick,
  onClose,
  marked,
  title = 'Pick a day',
}: {
  visible: boolean;
  value: string;
  onPick: (day: string) => void;
  onClose: () => void;
  marked?: Set<string>;
  title?: string;
}) {
  const t = useTheme();
  const [month, setMonth] = useState(() => value.slice(0, 7));
  useEffect(() => {
    if (visible) setMonth(value.slice(0, 7));
  }, [visible, value]);
  const cells = useMemo(() => {
    const first = parseDay(`${month}-01`);
    const startDow = (first.getDay() + 6) % 7; // Monday first
    const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = Array.from({ length: startDow }, () => null);
    for (let d = 1; d <= daysIn; d++) out.push(`${month}-${String(d).padStart(2, '0')}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);
  const shift = (n: number) => {
    const d = parseDay(`${month}-01`);
    const m = new Date(d.getFullYear(), d.getMonth() + n, 1);
    setMonth(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  };
  const today = todayLocal();
  const monthName = parseDay(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  // Narrow weekday names, Monday first, in the device language (2024-01-01 was a Monday).
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' })), []);
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title={title}
      maxWidth={400}
      actions={
        <>
          <View style={{ flex: 1 }}>
            <DialogButton title="Today" onPress={() => onPick(today)} />
          </View>
          <View style={{ flex: 1 }}>
            <DialogButton title="Cancel" onPress={onClose} />
          </View>
        </>
      }
    >
      <View style={styles.rowBetween}>
        <IconButton icon="chevronLeft" label="Previous month" onPress={() => shift(-1)} />
        <T bold maxScale={1.4} style={{ fontSize: 16 }}>
          {monthName}
        </T>
        <IconButton icon="chevronRight" label="Next month" onPress={() => shift(1)} />
      </View>
      <View style={s.grid}>
        {weekdays.map((d, i) => (
          <View key={`h${i}`} style={[s.cell, { height: 28 }]} importantForAccessibility="no-hide-descendants">
            <T small muted maxScale={1.2}>
              {d}
            </T>
          </View>
        ))}
        {cells.map((day, i) => {
          if (!day) return <View key={`e${i}`} style={s.cell} />;
          const sel = day === value;
          const isToday = day === today;
          return (
            <Pressable
              key={day}
              onPress={() => {
                haptic.tap();
                onPick(day);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${parseDay(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}${marked?.has(day) ? ', has entries' : ''}`}
              accessibilityState={{ selected: sel }}
              style={s.cell}
            >
              {({ pressed }) => (
                <View
                  style={[
                    s.dayCircle,
                    {
                      backgroundColor: sel ? t.accent : pressed ? t.surface2 : 'transparent',
                      borderWidth: isToday && !sel ? 1.5 : 0,
                      borderColor: t.accent,
                    },
                  ]}
                >
                  <Text maxFontSizeMultiplier={1.2} style={{ color: sel ? t.onAccent : isToday ? t.accent : t.text, fontSize: 15, fontWeight: sel || isToday ? '700' : '400' }}>
                    {Number(day.slice(8))}
                  </Text>
                  <View style={[s.dot, { backgroundColor: marked?.has(day) ? (sel ? t.onAccent : t.accent) : 'transparent' }]} />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </Dialog>
  );
}

/** ‹ day › navigator with a tappable date that opens the calendar. */
export function DayNav({ day, onChange, label: lbl, marked }: { day: string; onChange: (d: string) => void; label: string; marked?: Set<string> }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.rowBetween}>
      <IconButton icon="chevronLeft" label="Previous day" onPress={() => onChange(addDays(day, -1))} />
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${lbl}. Open calendar`} style={[styles.row, s.dayBtn]}>
        <Icon name="calendar" size={18} color={t.accent} />
        <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ color: t.text, fontSize: 17, fontWeight: '700', flexShrink: 1 }}>
          {lbl}
        </Text>
      </Pressable>
      <IconButton icon="chevronRight" label="Next day" onPress={() => onChange(addDays(day, 1))} />
      <CalendarModal
        visible={open}
        value={day}
        marked={marked}
        onClose={() => setOpen(false)}
        onPick={(d) => {
          setOpen(false);
          onChange(d);
        }}
      />
    </View>
  );
}

/** Text prompt in the app's own dialog (the system text prompt is iOS-only and unthemed). */
export function PromptModal({
  visible,
  title,
  message,
  placeholder,
  initial = '',
  confirm = 'Save',
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
  confirm?: string;
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    if (visible) setText(initial);
  }, [visible, initial]);
  const value = text.trim();
  const submit = () => {
    if (value) onSubmit(value);
  };
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title={title}
      message={message}
      actions={
        <>
          <View style={{ flex: 1 }}>
            <DialogButton title="Cancel" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <DialogButton title={confirm} variant="primary" onPress={submit} disabled={!value} />
          </View>
        </>
      }
    >
      <Input
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        accessibilityLabel={title}
        autoFocus
        maxLength={200}
        returnKeyType="done"
        onSubmitEditing={submit}
        style={{ marginTop: 8 }}
      />
    </Dialog>
  );
}

/** A list of choices in the app's own dialog. */
export function ChoiceModal<V extends string>({
  visible,
  title,
  options,
  onPick,
  onClose,
  value,
}: {
  visible: boolean;
  title: string;
  options: { value: V; label: string }[];
  onPick: (v: V) => void;
  onClose: () => void;
  value?: V;
}) {
  const t = useTheme();
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title={title}
      actions={
        <View style={{ flex: 1 }}>
          <DialogButton title="Cancel" onPress={onClose} />
        </View>
      }
    >
      <View style={{ marginTop: 4 }}>
        {options.map((o) => {
          const sel = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => {
                haptic.tap();
                onPick(o.value);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: sel }}
              style={({ pressed }) => [styles.listRow, { backgroundColor: pressed ? t.surface2 : sel ? t.accentSoft : 'transparent' }]}
            >
              <T style={{ flex: 1 }}>{o.label}</T>
              {sel && <Icon name="check" size={18} color={t.accent} />}
            </Pressable>
          );
        })}
      </View>
    </Dialog>
  );
}

const s = StyleSheet.create({
  mealCard: { padding: 0, overflow: 'hidden' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  cell: { width: `${100 / 7}%`, height: 46, alignItems: 'center', justifyContent: 'center' },
  dayCircle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
  dayBtn: { flex: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
  searchIcon: { position: 'absolute', left: 12, top: 4, bottom: 4, justifyContent: 'center' },
  searchRight: { position: 'absolute', right: 0, top: 4, bottom: 4, width: 44, alignItems: 'center', justifyContent: 'center' },
  clearBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
