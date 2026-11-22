import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { FoodDbLoader } from './src/foods';
import { Icon, Logo, type IconName } from './src/icons';
import { useLayout } from './src/layout';
import { NavContext, type AddOptions, type Nav, type Route, type Tab } from './src/nav';
import { AccountContext, initStore, loadAccount, localDataSummary, saveAccount, store, useFirstSyncDone, useStore, useToday, type Account, type LocalDataSummary } from './src/state';
import { MoveLocalDataScreen } from './src/localData';
import { NUTRIENT_BY_KEY } from '@open-nutrition/shared';
import { FeedbackProvider, ToastHost } from './src/feedback';
import { Button, HeaderTitleContext, IconButton, T, haptic, useTheme } from './src/ui';
import { ConnectScreen } from './src/screens/Connect';
import { TodayScreen } from './src/screens/Today';
import { DiaryScreen } from './src/screens/Diary';
import { EntryScreen } from './src/screens/Entry';
import { AddSheet } from './src/screens/Add';
import { NutrientsScreen, TopFoodsScreen } from './src/screens/Nutrients';
import { BodyScreen } from './src/screens/Body';
import { FoodEditScreen, FoodsScreen, RecipeEditScreen, SavedMealScreen } from './src/screens/Foods';
import { MoreScreen, SettingsScreen } from './src/screens/Settings';
import { OnboardingScreen, ProfileScreen, TargetsScreen } from './src/screens/Profile';

export default function App() {
  // Paint the native root view in the theme background: no light flash behind modals or the keyboard in dark mode.
  const bg = useTheme().bg;
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(bg).catch(() => {});
  }, [bg]);
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadAccount().then(setAccount);
  }, []);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Set when a server account was just connected: local-only data is then offered for moving
  // (before onboarding, so a fresh account does not ask for a profile the phone already has).
  const justConnected = useRef(false);
  const [offer, setOffer] = useState<LocalDataSummary | null>(null);
  useEffect(() => {
    if (!account) return;
    setReady(false);
    setLoadError(null);
    initStore(account)
      .then(async () => {
        if (justConnected.current && account.server) setOffer(await localDataSummary());
        justConnected.current = false;
        setReady(true);
      })
      .catch((e: Error) => setLoadError(e.message || String(e)));
  }, [account, attempt]);

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <FoodDbLoader />
      <FeedbackProvider>
        {loadError ? (
          <LoadError message={loadError} onRetry={() => setAttempt((n) => n + 1)} />
        ) : account === undefined || (account && !ready) ? (
          <Loading />
        ) : account === null ? (
          <ThemedSafeArea>
            <ConnectScreen
              onDone={(a) => {
                void saveAccount(a);
                justConnected.current = !!a.server;
                setAccount(a);
              }}
            />
          </ThemedSafeArea>
        ) : (
          <AccountContext.Provider value={account}>
            {offer ? (
              <ThemedSafeArea>
                <MoveLocalDataScreen summary={offer} onDone={() => setOffer(null)} />
              </ThemedSafeArea>
            ) : (
              <Main
                onSignOut={async () => {
                  if (account.server) {
                    await fetch(`${account.server.baseUrl}/api/v1/auth/logout`, {
                      method: 'POST',
                      headers: { authorization: `Bearer ${account.server.token}` },
                    }).catch(() => {});
                    await store.reset();
                  }
                  await saveAccount(null);
                  setAccount(null);
                }}
              />
            )}
          </AccountContext.Provider>
        )}
      </FeedbackProvider>
    </SafeAreaProvider>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>{children}</View>;
}

/** Paints the status bar / home indicator areas in the theme background (no white/black bands). */
function ThemedSafeArea({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>{children}</SafeAreaView>;
}

function Loading() {
  const t = useTheme();
  return (
    <Center>
      <View style={{ alignItems: 'center', gap: 20 }}>
        <Logo size={88} />
        <ActivityIndicator size="large" color={t.accent} accessibilityLabel="Loading" />
      </View>
    </Center>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTheme();
  return (
    <Center>
      <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 24, maxWidth: 420 }}>
        <Icon name="alert" size={36} color={t.danger} />
        <T bold style={{ fontSize: 18, textAlign: 'center' }}>
          Could not open your data
        </T>
        <T muted style={{ textAlign: 'center' }}>
          {message}
        </T>
        <Button title="Try again" variant="primary" onPress={onRetry} style={{ marginTop: 8, minWidth: 160 }} />
      </View>
    </Center>
  );
}

type NavItem = { key: Tab | 'add'; label: string; icon: IconName };
const BOTTOM: NavItem[] = [
  { key: 'today', label: 'Today', icon: 'today' },
  { key: 'diary', label: 'Diary', icon: 'diary' },
  { key: 'add', label: 'Add', icon: 'plus' },
  { key: 'nutrients', label: 'Nutrients', icon: 'nutrients' },
  { key: 'more', label: 'More', icon: 'more' },
];
const RAIL: NavItem[] = [
  { key: 'add', label: 'Add', icon: 'plus' },
  { key: 'today', label: 'Today', icon: 'today' },
  { key: 'diary', label: 'Diary', icon: 'diary' },
  { key: 'nutrients', label: 'Nutrients', icon: 'nutrients' },
  { key: 'body', label: 'Body', icon: 'scale' },
  { key: 'foods', label: 'Foods', icon: 'food' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];
/** Rail column width (dp, excluding the left safe-area inset) and item heights per density mode. */
const RAIL_W = 80;
const RAIL_ITEM_H = { full: 60, compact: 46, icons: 44 } as const;
type RailMode = keyof typeof RAIL_ITEM_H;
/** Densest rail mode whose items all fit in vailable dp (the rail still scrolls if even icons don't fit). */
function railModeFor(available: number): RailMode {
  const n = RAIL.length;
  if (n * RAIL_ITEM_H.full + (n - 1) * 4 + 20 <= available) return 'full';
  if (n * RAIL_ITEM_H.compact + 10 <= available) return 'compact';
  return 'icons';
}
const MORE_TABS: Tab[] = ['more', 'body', 'foods', 'settings'];
const ROOTS: Record<Tab, Route> = {
  today: { name: 'today' },
  diary: { name: 'diary' },
  nutrients: { name: 'nutrients' },
  more: { name: 'more' },
  body: { name: 'body' },
  foods: { name: 'foods' },
  settings: { name: 'settings' },
};

/** Top-bar title of a pushed route (pushed screens then hide their own big title). */
function titleOf(route: Route): string {
  switch (route.name) {
    case 'entry':
      return 'Edit entry';
    case 'foodEdit':
      return route.id ? 'Edit food' : 'New food';
    case 'recipeEdit':
      return route.id ? 'Edit recipe' : 'New recipe';
    case 'savedMeal':
      return 'Saved meal';
    case 'targets':
      return 'Targets';
    case 'profile':
      return 'Profile';
    case 'topFoods':
      return NUTRIENT_BY_KEY[route.key]?.name ?? 'Top sources';
    case 'body':
      return 'Weight & body';
    case 'foods':
      return 'Foods & recipes';
    case 'settings':
      return 'Settings';
    default:
      return '';
  }
}

function Main({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const t = useTheme();
  const s = useStore();
  const today = useToday();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const firstSyncDone = useFirstSyncDone();
  const [tab, setTab] = useState<Tab>('today');
  const [stacks, setStacks] = useState<Record<Tab, Route[]>>(() =>
    Object.fromEntries(Object.entries(ROOTS).map(([k, r]) => [k, [r]])) as Record<Tab, Route[]>,
  );
  const [add, setAdd] = useState<AddOptions | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const stack = stacks[tab];
  const route = stack[stack.length - 1]!;

  const pop = useCallback(() => {
    setStacks((st) => (st[tab].length > 1 ? { ...st, [tab]: st[tab].slice(0, -1) } : st));
  }, [tab]);

  // A ref so that switchTab() followed by push() in the same tick targets the new tab.
  const tabRef = useRef<Tab>(tab);
  tabRef.current = tab;
  const nav: Nav = useMemo(
    () => ({
      push: (r) => setStacks((st) => ({ ...st, [tabRef.current]: [...st[tabRef.current], r] })),
      pop,
      replace: (r) => setStacks((st) => ({ ...st, [tabRef.current]: [...st[tabRef.current].slice(0, -1), r] })),
      switchTab: (next) => {
        tabRef.current = next;
        setTab(next);
        setStacks((st) => ({ ...st, [next]: st[next].slice(0, 1) }));
      },
      openAdd: (o) => setAdd(o),
    }),
    [pop],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        pop();
        return true;
      }
      if (tab !== 'today') {
        setTab('today');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, pop, tab]);

  // First run in a fresh store: set up the profile and targets (wait for the first sync in server mode).
  const needsOnboarding = !onboarded && firstSyncDone && !s.profile() && s.all('targets').length === 0;
  if (needsOnboarding) {
    return (
      <NavContext.Provider value={nav}>
        <ThemedSafeArea>
          <OnboardingScreen onDone={() => setOnboarded(true)} />
        </ThemedSafeArea>
      </NavContext.Provider>
    );
  }

  const selectTab = (key: Tab | 'add') => {
    haptic.tap();
    if (key === 'add') {
      setAdd({ day: today });
      return;
    }
    if (key === tab) setStacks((st) => ({ ...st, [tab]: st[tab].slice(0, 1) }));
    tabRef.current = key;
    setTab(key);
  };

  const pushed = stack.length > 1;
  const railMode = railModeFor(layout.height - insets.top - insets.bottom);
  const content = (
    <View style={{ flex: 1 }}>
      {pushed && (
        <View style={[styles.header, { borderColor: t.border, backgroundColor: t.bg }]}>
          <IconButton icon="chevronLeft" label="Back" onPress={pop} />
          <Text accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ flex: 1, color: t.text, fontSize: 18, fontWeight: '700' }}>
            {titleOf(route)}
          </Text>
        </View>
      )}
      <HeaderTitleContext.Provider value={pushed}>
        {/* Keyed by route so a pushed screen starts fresh (scroll position, drafts) instead of reusing the previous one. */}
        <View key={`${tab}:${stack.length}:${route.name}`} style={{ flex: 1 }}>
          {renderRoute(route, pop, onSignOut)}
        </View>
      </HeaderTitleContext.Provider>
      {/* Snackbars sit above the tab bar here (and above the keyboard). */}
      <ToastHost bottom={layout.rail ? 16 : 12} />
    </View>
  );

  return (
    <NavContext.Provider value={nav}>
      <View style={{ flex: 1, backgroundColor: t.bg, flexDirection: layout.rail ? 'row' : 'column' }}>
        {layout.rail ? (
          <View
            style={[
              styles.rail,
              { width: RAIL_W + insets.left, backgroundColor: t.surface, borderColor: t.border, paddingLeft: insets.left, paddingTop: insets.top, paddingBottom: insets.bottom },
            ]}
          >
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1, paddingVertical: railMode === 'full' ? 8 : 4, gap: railMode === 'full' ? 4 : 0, alignItems: 'center' }}
              showsVerticalScrollIndicator={railMode === 'icons'}
            >
              {RAIL.map((x) => {
                const active = x.key === tab;
                const isAdd = x.key === 'add';
                // The Add button never needs a caption; in 'icons' mode no item has one (they keep their accessibility label).
                const showLabel = !isAdd && railMode !== 'icons';
                return (
                  <Pressable
                    key={x.key}
                    onPress={() => selectTab(x.key)}
                    accessibilityRole={isAdd ? 'button' : 'tab'}
                    accessibilityLabel={isAdd ? 'Add food' : x.label}
                    accessibilityState={isAdd ? undefined : { selected: active }}
                    style={[styles.railItem, railMode !== 'full' && styles.railItemCompact, isAdd && { marginBottom: railMode === 'full' ? 4 : 2 }]}
                  >
                    <View
                      style={[
                        styles.railIcon,
                        railMode !== 'full' && styles.railIconCompact,
                        isAdd && styles.railAdd,
                        // Inactive items paint the rail colour rather than 'transparent': switching from transparent to a colour
                        // later can drop the rounded corners on Android, leaving a square highlight.
                        { backgroundColor: isAdd ? t.accent : active ? t.accentSoft : t.surface },
                      ]}
                    >
                      <Icon name={x.icon} size={22} color={isAdd ? t.onAccent : active ? t.accent : t.muted} />
                    </View>
                    {showLabel && (
                      <Text
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.2}
                        style={{ fontSize: railMode === 'full' ? 11 : 10, color: active ? t.accent : t.muted, fontWeight: active ? '700' : '500' }}
                      >
                        {x.label}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, paddingTop: insets.top, paddingRight: insets.right, paddingLeft: layout.rail ? 0 : insets.left, paddingBottom: layout.rail ? insets.bottom : 0 }}>
          {content}
        </View>
        {!layout.rail && (
          <View style={[styles.tabBar, { backgroundColor: t.surface, borderColor: t.border, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
            {BOTTOM.map((x) => {
              const active = x.key === tab || (x.key === 'more' && MORE_TABS.includes(tab));
              if (x.key === 'add') {
                return (
                  <View key="add" style={styles.tab}>
                    <Pressable
                      onPress={() => selectTab('add')}
                      accessibilityRole="button"
                      accessibilityLabel="Add food"
                      style={({ pressed }) => [styles.addBtn, { backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 }]}
                    >
                      <Icon name="plus" size={28} color={t.onAccent} strokeWidth={2.5} />
                    </Pressable>
                  </View>
                );
              }
              return (
                <Pressable
                  key={x.key}
                  style={styles.tab}
                  onPress={() => selectTab(x.key)}
                  accessibilityRole="tab"
                  accessibilityLabel={x.label}
                  accessibilityState={{ selected: active }}
                >
                  <Icon name={x.icon} size={22} color={active ? t.accent : t.muted} />
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    maxFontSizeMultiplier={1.2}
                    style={{ fontSize: 11, color: active ? t.accent : t.muted, fontWeight: active ? '700' : '500' }}
                  >
                    {x.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      {add && <AddSheet options={add} onClose={() => setAdd(null)} />}
    </NavContext.Provider>
  );
}

function renderRoute(route: Route, pop: () => void, onSignOut: () => Promise<void>) {
  switch (route.name) {
    case 'today':
      return <TodayScreen />;
    case 'diary':
      return <DiaryScreen />;
    case 'nutrients':
      return <NutrientsScreen />;
    case 'more':
      return <MoreScreen />;
    case 'body':
      return <BodyScreen />;
    case 'foods':
      return <FoodsScreen />;
    case 'settings':
      return <SettingsScreen onSignOut={onSignOut} />;
    case 'entry':
      return <EntryScreen id={route.id} onDone={pop} />;
    case 'foodEdit':
      return <FoodEditScreen id={route.id} barcode={route.barcode} onDone={pop} />;
    case 'recipeEdit':
      return <RecipeEditScreen id={route.id} onDone={pop} />;
    case 'savedMeal':
      return <SavedMealScreen id={route.id} onDone={pop} />;
    case 'targets':
      return <TargetsScreen onDone={pop} />;
    case 'profile':
      return <ProfileScreen onDone={pop} />;
    case 'topFoods':
      return <TopFoodsScreen nutrient={route.key} from={route.from} to={route.to} />;
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 54, paddingVertical: 4, paddingHorizontal: 2, gap: 2 },
  addBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  rail: { borderRightWidth: StyleSheet.hairlineWidth },
  railItem: { alignItems: 'center', justifyContent: 'center', minHeight: RAIL_ITEM_H.full, width: RAIL_W, paddingVertical: 4, gap: 2 },
  railItemCompact: { minHeight: RAIL_ITEM_H.compact, paddingVertical: 1, gap: 1 },
  railIcon: { width: 52, height: 34, borderRadius: 17, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  railIconCompact: { height: 28, borderRadius: 14 },
  railAdd: { height: 44, borderRadius: 22, width: 56 },
});
