import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { addDays, parseDay, todayLocal, type Meal, type NutrientStatus } from '@open-nutrition/shared';
import { Icon, type IconName } from './icons';
import { MAX_CONTENT_WIDTH, useLayout } from './layout';

export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  success: string;
  danger: string;
  warn: string;
  doneRow: string;
  protein: string;
  carbs: string;
  fat: string;
  water: string;
  track: string;
}

const light: Theme = {
  dark: false,
  bg: '#f4f5f7',
  surface: '#ffffff',
  surface2: '#eef0f3',
  text: '#14161a',
  muted: '#5f6673',
  border: '#dde1e6',
  accent: '#2f6df6',
  accentSoft: '#e3ebfe',
  onAccent: '#ffffff',
  success: '#16a34a',
  danger: '#dc2626',
  warn: '#c26a04',
  doneRow: '#e8f6ec',
  protein: '#0d9488',
  carbs: '#d97706',
  fat: '#8b5cf6',
  water: '#0284c7',
  track: '#e6e9ee',
};
const dark: Theme = {
  ...light,
  dark: true,
  bg: '#111318',
  surface: '#1b1e25',
  surface2: '#252932',
  text: '#e8eaee',
  muted: '#9aa1ad',
  border: '#2e333d',
  accent: '#4f86ff',
  accentSoft: '#1d2b4d',
  doneRow: '#16301f',
  success: '#22c55e',
  danger: '#f05252',
  warn: '#f59e0b',
  protein: '#2dd4bf',
  carbs: '#fbbf24',
  fat: '#a78bfa',
  water: '#38bdf8',
  track: '#2a2f39',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export function statusColor(t: Theme, s: NutrientStatus): string {
  return s === 'over' ? t.danger : s === 'under' ? t.warn : t.success;
}

// ---- haptics (best effort; never throw) -------------------------------------------------------

export const haptic = {
  tap: () => void Haptics.selectionAsync().catch(() => {}),
  light: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warn: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
};

// ---- containers ----------------------------------------------------------------------------------

/** Pads for the keyboard on both platforms (Android is edge-to-edge, so the window no longer resizes). */
export function KeyboardAware({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? undefined : 'padding'} style={[{ flex: 1 }, style]}>
      {children}
    </KeyboardAvoidingView>
  );
}

/**
 * A scrolling screen with a centred, width-capped content column. `wide` raises the cap for
 * two-column layouts. Keyboard-aware: iOS adjusts the scroll insets, Android pads the view.
 */
export function Screen({
  children,
  title,
  right,
  wide,
  padBottom = 32,
}: {
  children: ReactNode;
  title?: string;
  right?: ReactNode;
  wide?: boolean;
  padBottom?: number;
}) {
  const t = useTheme();
  const { tiny } = useLayout();
  return (
    <KeyboardAware>
      <ScrollView
        style={{ backgroundColor: t.bg }}
        contentContainerStyle={[
          styles.screen,
          { padding: tiny ? 12 : 16, paddingBottom: padBottom, maxWidth: wide ? 1280 : MAX_CONTENT_WIDTH },
        ]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {title != null && <Title right={right}>{title}</Title>}
        {children}
      </ScrollView>
    </KeyboardAware>
  );
}

export function Title({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.rowBetween, { flexWrap: 'wrap' }]}>
      <Text accessibilityRole="header" style={[styles.h1, { color: t.text, flexShrink: 1 }]} maxFontSizeMultiplier={1.6}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** Two columns on wide layouts, stacked on compact ones. */
export function Columns({ left, right, ratio = 1, gap = 16 }: { left: ReactNode; right: ReactNode; ratio?: number; gap?: number }) {
  const { wide } = useLayout();
  if (!wide) {
    return (
      <View>
        {left}
        {right}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap, alignItems: 'flex-start' }}>
      <View style={{ flex: ratio, minWidth: 0 }}>{left}</View>
      <View style={{ flex: 1, minWidth: 0 }}>{right}</View>
    </View>
  );
}

/**
 * Full-screen sheet. Android draws modals edge-to-edge, so pad for the status bar there; iOS
 * page sheets already sit below it. Both need room for the home indicator / gesture bar and
 * landscape cut-outs.
 */
export function Sheet({ visible = true, onClose, children }: { visible?: boolean; onClose: () => void; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right', 'portrait-upside-down']}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: t.bg,
          paddingTop: (Platform.OS === 'android' ? insets.top : 0) + 4,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        }}
      >
        <View style={styles.sheetBody}>{children}</View>
      </View>
    </Modal>
  );
}

/** Header row for a sheet: title plus a close (or back) button, all ≥ 44 pt. */
export function SheetHeader({ title, onClose, onBack, right }: { title: string; onClose?: () => void; onBack?: () => void; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.rowBetween, { paddingHorizontal: 8, minHeight: 52 }]}>
      <View style={{ width: 48 }}>{onBack && <IconButton icon="chevronLeft" label="Back" onPress={onBack} />}</View>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}
        style={{ flex: 1, textAlign: 'center', color: t.text, fontSize: 17, fontWeight: '700' }}
      >
        {title}
      </Text>
      <View style={{ minWidth: 48, alignItems: 'flex-end' }}>{right ?? (onClose && <IconButton icon="close" label="Close" onPress={onClose} />)}</View>
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const t = useTheme();
  const s = [styles.card, { backgroundColor: t.surface, borderColor: t.border }, style];
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s, pressed && { opacity: 0.7 }]}>
      {children}
    </Pressable>
  ) : (
    <View style={s}>{children}</View>
  );
}

// ---- controls ------------------------------------------------------------------------------------

type Variant = 'default' | 'primary' | 'success' | 'danger' | 'ghost';
export function Button({
  title,
  onPress,
  variant = 'default',
  small,
  disabled,
  icon,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  small?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const bg = { default: t.surface2, primary: t.accent, success: t.success, danger: 'transparent', ghost: 'transparent' }[variant];
  const fg = { default: t.text, primary: t.onAccent, success: '#fff', danger: t.danger, ghost: t.accent }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={small ? 6 : 0}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={small ? 16 : 18} color={fg} />}
      <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 14 : 15, textAlign: 'center', flexShrink: 1 }} maxFontSizeMultiplier={1.5}>
        {title}
      </Text>
    </Pressable>
  );
}

/** A 44×44 pt icon-only button. */
export function IconButton({
  icon,
  label,
  onPress,
  color,
  bg,
  size = 22,
  disabled,
  onLongPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  bg?: string;
  size?: number;
  disabled?: boolean;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: bg ?? 'transparent', opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={size} color={color ?? t.accent} />
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.muted}
      maxFontSizeMultiplier={1.6}
      {...props}
      style={[styles.input, { color: t.text, backgroundColor: t.surface, borderColor: t.border }, props.style]}
    />
  );
}

/** Numeric input that tolerates partial text ("1.", "") while typing. */
export function NumInput({
  value,
  onChange,
  style,
  placeholder,
  accessibilityLabel,
  integer,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  style?: StyleProp<TextStyle>;
  placeholder?: string;
  accessibilityLabel?: string;
  integer?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    const parsed = Number(text.replace(',', '.'));
    if (value == null ? text !== '' : parsed !== value) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      value={text}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      selectTextOnFocus
      placeholder={placeholder}
      accessibilityLabel={accessibilityLabel}
      onChangeText={(s) => {
        setText(s);
        const v = s.replace(',', '.');
        if (v.trim() === '') onChange(null);
        else if (!Number.isNaN(Number(v))) onChange(Number(v));
      }}
      style={[styles.num, style]}
    />
  );
}

/** A labelled numeric field: "Label [ 123 ] unit". */
export function NumField({
  label: lbl,
  value,
  onChange,
  unit,
  integer,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  unit?: string;
  integer?: boolean;
}) {
  return (
    <View style={[styles.row, { minHeight: 48 }]}>
      <T style={{ flex: 1 }}>{lbl}</T>
      <NumInput value={value} onChange={onChange} accessibilityLabel={lbl} integer={integer} style={{ width: 92 }} />
      {unit != null && (
        <T muted style={{ width: 40 }}>
          {unit}
        </T>
      )}
    </View>
  );
}

/** − value + stepper with an editable centre. */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  unit,
  label: lbl,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  unit?: string;
  label: string;
}) {
  const t = useTheme();
  const round = (v: number) => Math.round(v * 100) / 100;
  return (
    <View style={styles.row}>
      <IconButton icon="minus" label={`Decrease ${lbl}`} bg={t.surface2} onPress={() => onChange(Math.max(min, round(value - step)))} />
      <NumInput value={value} onChange={(v) => v != null && onChange(Math.max(min, v))} accessibilityLabel={lbl} style={{ width: 76 }} />
      <IconButton icon="plus" label={`Increase ${lbl}`} bg={t.surface2} onPress={() => onChange(round(value + step))} />
      {unit && <T muted>{unit}</T>}
    </View>
  );
}

export function T({
  children,
  muted,
  small,
  bold,
  style,
  lines,
  maxScale,
  color,
}: {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
  bold?: boolean;
  style?: StyleProp<TextStyle>;
  lines?: number;
  maxScale?: number;
  color?: string;
}) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={lines}
      maxFontSizeMultiplier={maxScale}
      style={[{ color: color ?? (muted ? t.muted : t.text), fontSize: small ? 13 : 15, fontWeight: bold ? '700' : '400' }, style]}
    >
      {children}
    </Text>
  );
}

export function H2({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.rowBetween, { marginTop: 16, marginBottom: 6 }]}>
      <Text accessibilityRole="header" style={[styles.h2, { color: t.text, flexShrink: 1 }]}>
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Chips<V extends string>({
  options,
  value,
  onChange,
  wrap,
}: {
  options: { value: V; label: string }[];
  value: V | null;
  onChange: (v: V) => void;
  wrap?: boolean;
}) {
  const t = useTheme();
  const chips = options.map((o) => (
    <Pressable
      key={o.value}
      onPress={() => {
        haptic.tap();
        onChange(o.value);
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: value === o.value }}
      hitSlop={{ top: 4, bottom: 4 }}
      style={[styles.chip, { borderColor: value === o.value ? t.accent : t.border, backgroundColor: value === o.value ? t.accent : t.surface }]}
    >
      <Text style={{ color: value === o.value ? t.onAccent : t.text, fontSize: 14 }} maxFontSizeMultiplier={1.4}>
        {o.label}
      </Text>
    </Pressable>
  ));
  if (wrap) return <View style={[styles.chips, { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6 }]}>{chips}</View>;
  return (
    // flexGrow/flexShrink 0: inside a flex column (e.g. above a FlatList) the row would otherwise
    // be squeezed and clip the chip labels.
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={{ alignItems: 'center' }}>
      {chips}
    </ScrollView>
  );
}

/** Equal-width segmented control. */
export function Segmented<V extends string>({ options, value, onChange }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  const t = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: t.surface2 }]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              haptic.tap();
              onChange(o.value);
            }}
            style={[styles.segment, on && { backgroundColor: t.surface, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth }]}
          >
            <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ color: on ? t.text : t.muted, fontWeight: on ? '700' : '500', fontSize: 14 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ label: lbl, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => {
        haptic.tap();
        onChange(!value);
      }}
      style={[styles.rowBetween, { minHeight: 48, paddingVertical: 6 }]}
    >
      <View style={{ flex: 1 }}>
        <T>{lbl}</T>
        {hint && (
          <T small muted>
            {hint}
          </T>
        )}
      </View>
      <View style={[styles.switchTrack, { backgroundColor: value ? t.accent : t.track }]}>
        <View style={[styles.switchThumb, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

export function ProgressBar({ value, max, color, height = 8 }: { value: number; max: number; color: string; height?: number }) {
  const t = useTheme();
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.track, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

/** A tappable list row (≥ 48 pt high). */
export function ListRow({
  title,
  subtitle,
  right,
  left,
  onPress,
  onLongPress,
  selected,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  left?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected != null ? { selected } : undefined}
      style={({ pressed }) => [styles.listRow, { backgroundColor: selected ? t.accentSoft : pressed ? t.surface2 : 'transparent' }]}
    >
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T lines={2}>{title}</T>
        {!!subtitle && (
          <T small muted lines={2}>
            {subtitle}
          </T>
        )}
      </View>
      {right}
    </Pressable>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

export function Empty({ icon, title, text, children }: { icon?: IconName; title: string; text?: string; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 16, gap: 6 }}>
      {icon && <Icon name={icon} size={36} color={t.muted} strokeWidth={1.6} />}
      <T bold style={{ textAlign: 'center' }}>
        {title}
      </T>
      {text && (
        <T small muted style={{ textAlign: 'center' }}>
          {text}
        </T>
      )}
      {children}
    </View>
  );
}

/** Small rounded label ("AI estimate", "USDA"). */
export function Badge({ text, color }: { text: string; color?: string }) {
  const t = useTheme();
  const c = color ?? t.muted;
  return (
    <View style={[styles.badge, { borderColor: c }]}>
      <Text style={{ color: c, fontSize: 11, fontWeight: '600' }} maxFontSizeMultiplier={1.3}>
        {text}
      </Text>
    </View>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const t = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: tone === 'warn' ? (t.dark ? '#3a2a10' : '#fff5e6') : t.accentSoft }]}>
      <Icon name="info" size={18} color={tone === 'warn' ? t.warn : t.accent} />
      <View style={{ flex: 1 }}>{typeof children === 'string' ? <T small>{children}</T> : children}</View>
    </View>
  );
}

// ---- toast ---------------------------------------------------------------------------------------

const ToastContext = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback(
    (m: string) => {
      setMsg(m);
      clearTimeout(timer.current);
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setMsg(null));
      }, 2200);
    },
    [opacity],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg != null && (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[styles.toast, { opacity, bottom: insets.bottom + 84, backgroundColor: t.dark ? '#e8eaee' : '#1b1e25' }]}
        >
          <Text style={{ color: t.dark ? '#111318' : '#fff', fontSize: 14 }}>{msg}</Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

// ---- formatting ------------------------------------------------------------------------------------

export const MEAL_LABELS: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' };
export const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** A sensible default meal for the time of day. */
export function mealForNow(now = new Date()): Meal {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 10.5) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17 && h < 21.5) return 'dinner';
  return 'snack';
}

/** "Today", "Yesterday", "Tomorrow" or "Tue, Nov 18". */
export function formatDay(day: string, long = false): string {
  const today = todayLocal();
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  if (day === addDays(today, 1)) return 'Tomorrow';
  const d = parseDay(day);
  return d.toLocaleDateString(undefined, {
    weekday: long ? 'long' : 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const kcal = (v: number | undefined | null) => Math.round(v ?? 0).toLocaleString();
export const grams1 = (v: number | undefined | null) => `${+(v ?? 0).toFixed(v != null && Math.abs(v) < 10 ? 1 : 0)}`;

export const styles = StyleSheet.create({
  // Content is capped and centred so tablets don't get edge-to-edge lines.
  screen: { width: '100%', alignSelf: 'center' },
  sheetBody: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  chips: { flexGrow: 0, flexShrink: 0, marginVertical: 6 },
  h1: { fontSize: 28, fontWeight: '700', marginVertical: 8 },
  h2: { fontSize: 19, fontWeight: '700' },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, marginVertical: 6 },
  btn: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    flexDirection: 'row',
    gap: 6,
  },
  btnSmall: { minHeight: 36, paddingVertical: 6, paddingHorizontal: 12, marginVertical: 0 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 16, marginVertical: 4, minHeight: 44 },
  num: { minWidth: 62, textAlign: 'center', paddingVertical: 8, marginVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9, marginRight: 6, minHeight: 38, justifyContent: 'center' },
  segmented: { flexDirection: 'row', borderRadius: 10, padding: 3, marginVertical: 6 },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 4 },
  switchTrack: { width: 50, height: 30, borderRadius: 15, padding: 3, justifyContent: 'center' },
  switchThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, alignSelf: 'flex-start' },
  notice: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, marginVertical: 6, alignItems: 'flex-start' },
  toast: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, maxWidth: '90%' },
});
