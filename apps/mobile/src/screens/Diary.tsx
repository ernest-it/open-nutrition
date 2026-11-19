import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, PanResponder, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { MEALS, N, addDays, type DiaryEntry, type Meal } from '@open-nutrition/shared';
import { CalendarModal, ChoiceModal, DayNav, EntryRow, MacroBars, MealHeader, PromptModal } from '../components';
import { MAX_WIDE_WIDTH, useLayout } from '../layout';
import { useNav } from '../nav';
import { removeWithUndo, useStore, useToday } from '../state';
import { Button, Card, Empty, IconButton, MEAL_LABELS, T, formatDay, haptic, kcal, styles, useTheme, useToast } from '../ui';
import { EntryEditor } from './Entry';

let lastDiaryDay: string | null = null;

export function DiaryScreen() {
  const t = useTheme();
  const store = useStore();
  const nav = useNav();
  const toast = useToast();
  const today = useToday();
  const { wide, tiny } = useLayout();
  const [day, setDayState] = useState(lastDiaryDay ?? today);
  const setDay = (d: string) => {
    lastDiaryDay = d;
    setDayState(d);
    setSelected(new Set());
    setOpenId(null);
    haptic.tap();
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'copy' | 'move' | 'meal' | 'save' | null>(null);
  const selecting = selected.size > 0;

  const entries = store.entriesOn(day);
  const totals = store.dayTotals(day);
  const targets = store.targetsOn(day);
  const yesterday = store.entriesOn(addDays(day, -1));
  const sections = MEALS.map((meal) => ({ meal, data: entries.filter((e) => e.meal === meal) }));
  const marked = useMemo(() => new Set(store.all('diaryEntries').map((e) => e.date)), [store.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Swipe left/right to change day. Captures only clearly horizontal drags so vertical scrolling is untouched.
  const dayRef = useRef(day);
  dayRef.current = day;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 30 && Math.abs(g.dx) > Math.abs(g.dy) * 2.5,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) > 60) setDay(addDays(dayRef.current, g.dx < 0 ? 1 : -1));
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const toggle = (id: string) => {
    haptic.tap();
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const open = (e: DiaryEntry) => {
    if (selecting) return toggle(e.id);
    if (wide) setOpenId(e.id);
    else nav.push({ name: 'entry', id: e.id });
  };

  const copyYesterday = (meal: Meal) => {
    const copied = store.copyMealFromYesterday(day, meal);
    haptic.success();
    toast({
      message: `Copied ${copied.length} item${copied.length === 1 ? '' : 's'} from the day before`,
      action: { label: 'Undo', onPress: () => copied.forEach((e) => store.remove('diaryEntries', e.id)) },
    });
  };

  // Hardware back leaves selection mode before it leaves the screen.
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(new Set());
      return true;
    });
    return () => sub.remove();
  }, [selecting]);
  const [toolbarH, setToolbarH] = useState(140);
  // Keep the last calendar mode while the dialog fades out (the title must not flip).
  const calModeRef = useRef<'copy' | 'move'>('copy');
  if (dialog === 'copy' || dialog === 'move') calModeRef.current = dialog;
  const calMode = calModeRef.current;

  const ids = [...selected];
  const count = (n: number) => `${n} entr${n === 1 ? 'y' : 'ies'}`;
  const deleteSelected = () => {
    const undo = removeWithUndo('diaryEntries', ids);
    if (openId && selected.has(openId)) setOpenId(null);
    setSelected(new Set());
    haptic.warn();
    toast({ message: `Deleted ${count(ids.length)}`, action: { label: 'Undo', onPress: undo } });
  };
  const header = (
    <View>
      <DayNav day={day} onChange={setDay} label={formatDay(day, !tiny)} marked={marked} />
      <Card>
        <View style={[styles.rowBetween, { marginBottom: 8 }]}>
          <T bold style={{ fontSize: 18 }}>
            {kcal(totals[N.energy])}
            {targets?.nutrients[N.energy] ? ` / ${kcal(targets.nutrients[N.energy])}` : ''} kcal
          </T>
          {day !== today && <Button small variant="ghost" title="Go to today" onPress={() => setDay(today)} />}
        </View>
        <MacroBars totals={totals} targets={targets?.nutrients} compact />
      </Card>
      {!selecting && entries.length > 0 && (
        <T small muted style={{ textAlign: 'center', marginTop: 2 }}>
          Long-press entries to select, copy or save them as a meal.
        </T>
      )}
    </View>
  );

  const list = (
    <View style={{ flex: 1 }} {...pan.panHandlers}>
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: tiny ? 12 : 16, paddingBottom: selecting ? toolbarH + 24 : 32 }}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => {
          const yCount = yesterday.filter((e) => e.meal === section.meal).length;
          return (
            <View style={[s.section, { borderColor: t.border, backgroundColor: t.surface }]}>
              <MealHeader
                meal={section.meal}
                total={store.mealTotals(day, section.meal)}
                onAdd={() => nav.openAdd({ day, meal: section.meal })}
                yesterdayCount={section.data.length ? 0 : yCount}
                onCopyYesterday={() => copyYesterday(section.meal)}
              />
            </View>
          );
        }}
        renderItem={({ item, index, section }) => (
          <View
            style={[
              s.item,
              { borderColor: t.border, backgroundColor: t.surface },
              index === section.data.length - 1 && s.last,
            ]}
          >
            <EntryRow
              entry={item}
              selecting={selecting}
              selected={selected.has(item.id) || openId === item.id}
              onPress={() => open(item)}
              onLongPress={() => toggle(item.id)}
            />
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.data.length ? <View style={{ height: 10 }} /> : (
            <View style={[s.item, s.last, { borderColor: t.border, backgroundColor: t.surface, marginBottom: 10 }]}>
              <T small muted style={{ padding: 8 }}>
                Nothing logged yet.
              </T>
            </View>
          )
        }
      />
      {selecting && (
        <View
          onLayout={(e) => setToolbarH(e.nativeEvent.layout.height)}
          style={[s.toolbar, { backgroundColor: t.surface, borderColor: t.border }]}
          accessibilityLabel="Selection actions"
        >
          <View style={[styles.rowBetween, { width: '100%', paddingLeft: 8 }]}>
            <T bold>{selected.size} selected</T>
            <IconButton icon="close" label="Cancel selection" color={t.muted} onPress={() => setSelected(new Set())} />
          </View>
          <View style={s.toolbarActions}>
            <Button small icon="copy" title="Copy to…" onPress={() => setDialog('copy')} />
            <Button small icon="move" title="Move to…" onPress={() => setDialog('move')} />
            <Button small icon="diary" title="Meal…" onPress={() => setDialog('meal')} />
            <Button small icon="bookmark" title="Save as meal" onPress={() => setDialog('save')} />
            <Button small icon="trash" variant="danger" title="Delete" onPress={deleteSelected} />
          </View>
        </View>
      )}
      <CalendarModal
        visible={dialog === 'copy' || dialog === 'move'}
        title={calMode === 'copy' ? `Copy ${count(ids.length)} to…` : `Move ${count(ids.length)} to…`}
        value={day}
        onClose={() => setDialog(null)}
        onPick={(d) => {
          if (dialog === 'copy') store.copyEntries(ids, { day: d });
          else ids.forEach((id) => store.moveEntry(id, { day: d }));
          toast(`${dialog === 'copy' ? 'Copied' : 'Moved'} ${count(ids.length)} to ${formatDay(d)}`);
          setDialog(null);
          setSelected(new Set());
          haptic.success();
        }}
      />
      <ChoiceModal
        visible={dialog === 'meal'}
        title={`Move ${count(ids.length)} to`}
        options={MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }))}
        onClose={() => setDialog(null)}
        onPick={(m) => {
          ids.forEach((id) => store.moveEntry(id, { meal: m }));
          toast(`Moved ${count(ids.length)} to ${MEAL_LABELS[m].toLowerCase()}`);
          setDialog(null);
          setSelected(new Set());
          haptic.success();
        }}
      />
      <PromptModal
        visible={dialog === 'save'}
        title="Save as a meal"
        message="Log the same foods again later in one tap, from Add → Saved meals."
        placeholder="e.g. Usual breakfast"
        onClose={() => setDialog(null)}
        onSubmit={(name) => {
          store.saveMealFromEntries(name, ids);
          toast(`Saved “${name}”`);
          setDialog(null);
          setSelected(new Set());
          haptic.success();
        }}
      />
    </View>
  );

  if (!wide) return list;
  const openEntry = openId ? store.get('diaryEntries', openId) : undefined;
  return (
    <View style={{ flex: 1, flexDirection: 'row', width: '100%', maxWidth: MAX_WIDE_WIDTH, alignSelf: 'center' }}>
      <View style={{ flex: 1 }}>{list}</View>
      <View style={[s.pane, { borderColor: t.border }]}>
        {openEntry ? (
          <PaneScroll>
            <EntryEditor key={openEntry.id} entry={openEntry} onDone={() => setOpenId(null)} />
          </PaneScroll>
        ) : (
          <Empty icon="diary" title="Select an entry" text="Tap an entry to edit its amount, move it to another meal or day, or delete it." />
        )}
      </View>
    </View>
  );
}

function PaneScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {children}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  section: { borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, paddingHorizontal: 8, paddingBottom: 4, marginTop: 6 },
  item: { borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8 },
  last: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, paddingBottom: 6 },
  toolbarActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  toolbar: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
    paddingTop: 2,
    gap: 4,
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  pane: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth },
});
