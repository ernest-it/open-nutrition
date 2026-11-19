// The app's own dialogs, snackbars and inline banners (no system Alert / Toast anywhere).
//
// * <Dialog>       – a bottom sheet on phones, a centred card on wide screens and in landscape.
//                    Theme-, safe-area- and keyboard-aware; moves screen-reader focus to its title.
// * useConfirm()   – `await confirm({ title, destructive: true })` resolves to true / false.
// * useToast()     – a snackbar, optionally with an action (`Undo`). It is drawn by the top-most
//                    <ToastHost>, so it also shows above open sheets (each Sheet mounts a host).
// * <Banner>       – inline error / warning / info / success message with an optional action.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './icons';
import { BREAKPOINTS, useLayout } from './layout';
import { haptic, useTheme, type Theme } from './theme';

const ORIENTATIONS = ['portrait', 'landscape', 'landscape-left', 'landscape-right', 'portrait-upside-down'] as const;

// ---- dialog --------------------------------------------------------------------------------------

/** Bottom sheet on compact portrait screens; centred card on wide screens and in landscape. */
export function useDialogMode(): 'sheet' | 'center' {
  const { width, landscape } = useLayout();
  return width < BREAKPOINTS.medium && !landscape ? 'sheet' : 'center';
}

export function Dialog({
  visible,
  onClose,
  title,
  message,
  icon,
  tone = 'default',
  children,
  actions,
  dismissable = true,
  maxWidth = 440,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  icon?: IconName;
  tone?: 'default' | 'danger';
  children?: ReactNode;
  /** Buttons pinned under the (scrollable) body. */
  actions?: ReactNode;
  /** Tap on the scrim / hardware back closes it. */
  dismissable?: boolean;
  maxWidth?: number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const mode = useDialogMode();
  const titleRef = useRef<ComponentRef<typeof Text>>(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    // Move the screen reader to the dialog title.
    const timer = setTimeout(() => {
      if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
    }, 350);
    return () => clearTimeout(timer);
  }, [visible, anim]);

  const sheet = mode === 'sheet';
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [sheet ? 48 : 12, 0] });
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [sheet ? 1 : 0.97, 1] });
  const close = dismissable ? onClose : () => {};

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={[...ORIENTATIONS]}
    >
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View
          style={[
            fx.scrim,
            {
              justifyContent: sheet ? 'flex-end' : 'center',
              paddingTop: insets.top + (sheet ? 24 : 16),
              paddingBottom: sheet ? 0 : insets.bottom + 16,
              paddingLeft: insets.left + (sheet ? 0 : 16),
              paddingRight: insets.right + (sheet ? 0 : 16),
            },
          ]}
        >
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay }]}
            onPress={close}
            accessible={false}
            importantForAccessibility="no"
          />
          <Animated.View
            accessibilityViewIsModal
            style={[
              fx.card,
              {
                backgroundColor: t.surface,
                borderColor: t.border,
                maxWidth: sheet ? 560 : maxWidth,
                opacity: anim,
                transform: [{ translateY }, { scale }],
              },
              sheet
                ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0, paddingBottom: insets.bottom + 12 }
                : { paddingBottom: 16 },
            ]}
          >
            {sheet && <View style={[fx.handle, { backgroundColor: t.border }]} />}
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: sheet ? 8 : 20 }}>
              {icon && (
                <View style={[fx.iconWrap, { backgroundColor: tone === 'danger' ? t.dangerSoft : t.accentSoft }]}>
                  <Icon name={icon} size={22} color={tone === 'danger' ? t.danger : t.accent} />
                </View>
              )}
              {title != null && (
                <Text ref={titleRef} accessibilityRole="header" maxFontSizeMultiplier={1.5} style={[fx.title, { color: t.text }]}>
                  {title}
                </Text>
              )}
              {!!message && (
                <Text maxFontSizeMultiplier={1.6} style={[fx.message, { color: t.muted }]}>
                  {message}
                </Text>
              )}
              {children}
            </ScrollView>
            {actions && <View style={[fx.actions, { paddingHorizontal: 20 }]}>{actions}</View>}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A full-width button for dialog action rows (≥ 48 pt). */
export function DialogButton({
  title,
  onPress,
  variant = 'secondary',
  disabled,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const bg = { primary: t.accent, secondary: t.surface2, danger: t.dangerSolid }[variant];
  const fg = { primary: t.onAccent, secondary: t.text, danger: t.onDanger }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [fx.dialogBtn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }]}
    >
      <Text maxFontSizeMultiplier={1.4} numberOfLines={2} style={{ color: fg, fontSize: 16, fontWeight: '600', textAlign: 'center' }}>
        {title}
      </Text>
    </Pressable>
  );
}

// ---- confirm -------------------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button and a warning icon. */
  destructive?: boolean;
  icon?: IconName;
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;

// ---- toast ---------------------------------------------------------------------------------------

export interface ToastOptions {
  message: string;
  /** e.g. { label: 'Undo', onPress: restore } */
  action?: { label: string; onPress: () => void };
  tone?: 'default' | 'success' | 'error';
  /** ms; defaults to 2.8 s, or 6 s with an action (longer with a screen reader). */
  duration?: number;
}
type ToastFn = (o: string | ToastOptions) => void;
interface ToastState extends ToastOptions {
  key: number;
}

interface FeedbackCtx {
  toast: ToastFn;
  confirm: ConfirmFn;
  current: ToastState | null;
  hide: () => void;
  /** The open confirm dialog, if any. */
  pending: ConfirmOptions | null;
  answer: (v: boolean) => void;
  topHost: number | null;
  register: (id: number, base: boolean) => () => void;
}
const Ctx = createContext<FeedbackCtx | null>(null);

function useCtx(): FeedbackCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('FeedbackProvider is missing');
  return c;
}
export const useToast = (): ToastFn => useCtx().toast;
export const useConfirm = (): ConfirmFn => useCtx().confirm;

let hostSeq = 0;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const [hosts, setHosts] = useState<{ id: number; base: boolean }[]>([]);
  const [pending, setPending] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const screenReader = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then((v) => (screenReader.current = v));
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v) => (screenReader.current = v));
    return () => sub.remove();
  }, []);

  const toast = useCallback<ToastFn>((o) => {
    const opts = typeof o === 'string' ? { message: o } : o;
    seq.current += 1;
    const base = opts.duration ?? (opts.action ? 6000 : 2800);
    setCurrent({ ...opts, duration: screenReader.current ? Math.max(base * 2, 10000) : base, key: seq.current });
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(opts.action ? `${opts.message}. ${opts.action.label} available.` : opts.message);
  }, []);
  const hide = useCallback(() => setCurrent(null), []);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        if (opts.destructive) haptic.warn();
        setPending((prev) => {
          prev?.resolve(false);
          return { opts, resolve };
        });
      }),
    [],
  );
  const answer = useCallback((v: boolean) => {
    setPending((p) => {
      p?.resolve(v);
      return null;
    });
  }, []);

  const register = useCallback((id: number, base: boolean) => {
    setHosts((h) => [...h, { id, base }]);
    return () => setHosts((h) => h.filter((x) => x.id !== id));
  }, []);
  // The most recently mounted host wins; the provider's own (base) host only when there is no other.
  const topHost = ([...hosts].reverse().find((h) => !h.base) ?? hosts.find((h) => h.base))?.id ?? null;

  const pendingOpts = pending?.opts ?? null;
  const value = useMemo<FeedbackCtx>(
    () => ({ toast, confirm, current, hide, pending: pendingOpts, answer, topHost, register }),
    [toast, confirm, current, hide, pendingOpts, answer, topHost, register],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastHost bottom={16} base />
    </Ctx.Provider>
  );
}

/**
 * Where snackbars and confirm dialogs are drawn. The provider mounts one at the root, the tab
 * layout mounts one above the tab bar, and every Sheet mounts one inside its modal. Only the most
 * recently mounted host draws, so feedback always appears on top: never hidden behind a sheet, and
 * on iOS the dialog is presented from inside the open sheet (a second root-level modal can't be).
 */
export function ToastHost({ bottom, base = false }: { bottom: number; base?: boolean }) {
  const { current, hide, topHost, register } = useCtx();
  const [id] = useState(() => ++hostSeq);
  useEffect(() => register(id, base), [register, id, base]);
  if (topHost !== id) return null;
  return (
    <>
      {current && <Snackbar key={current.key} toast={current} onHide={hide} bottom={bottom} />}
      <ConfirmDialog />
    </>
  );
}

function ConfirmDialog() {
  const { pending, answer } = useCtx();
  // Keep the last options while the dialog fades out, so it never flashes empty.
  const last = useRef<ConfirmOptions | null>(null);
  if (pending) last.current = pending;
  const o = pending ?? last.current;
  return (
    <Dialog
      visible={!!pending}
      onClose={() => answer(false)}
      title={o?.title}
      message={o?.message}
      icon={o?.icon ?? (o?.destructive ? 'alert' : undefined)}
      tone={o?.destructive ? 'danger' : 'default'}
      maxWidth={400}
      actions={
        <>
          <View style={{ flex: 1 }}>
            <DialogButton title={o?.cancelLabel ?? 'Cancel'} onPress={() => answer(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <DialogButton title={o?.confirmLabel ?? 'OK'} variant={o?.destructive ? 'danger' : 'primary'} onPress={() => answer(true)} />
          </View>
        </>
      }
    />
  );
}

function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEvt, (e) => setH(e.endCoordinates.height));
    const b = Keyboard.addListener(hideEvt, () => setH(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return h;
}

function Snackbar({ toast, onHide, bottom }: { toast: ToastState; onHide: () => void; bottom: number }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  const anim = useRef(new Animated.Value(0)).current;
  const done = useRef(false);

  const dismiss = useCallback(() => {
    if (done.current) return;
    done.current = true;
    Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => onHide());
  }, [anim, onHide]);

  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timer = setTimeout(dismiss, toast.duration);
    return () => clearTimeout(timer);
  }, [anim, dismiss, toast.duration]);

  const icon: IconName | null = toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : null;
  return (
    <View
      pointerEvents="box-none"
      style={[fx.toastWrap, { bottom: Math.max(bottom + insets.bottom, kb + 12), left: insets.left + 12, right: insets.right + 12 }]}
    >
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[
          fx.toast,
          {
            backgroundColor: t.toastBg,
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          },
        ]}
      >
        {icon && <Icon name={icon} size={18} color={toast.tone === 'error' ? t.danger : t.toastAction} />}
        <Text maxFontSizeMultiplier={1.5} style={{ color: t.toastText, fontSize: 15, flex: 1, paddingVertical: 4 }}>
          {toast.message}
        </Text>
        {toast.action ? (
          <Pressable
            onPress={() => {
              haptic.tap();
              toast.action!.onPress();
              dismiss();
            }}
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [fx.toastAction, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text maxFontSizeMultiplier={1.4} style={{ color: t.toastAction, fontSize: 15, fontWeight: '700' }}>
              {toast.action.label}
            </Text>
          </Pressable>
        ) : (
          <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} style={fx.toastClose}>
            <Icon name="close" size={16} color={t.toastText} />
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

// ---- inline banner -----------------------------------------------------------------------------

export type BannerTone = 'error' | 'warn' | 'info' | 'success';

function toneColors(t: Theme, tone: BannerTone) {
  return {
    error: { bg: t.dangerSoft, fg: t.danger, icon: 'alert' as IconName },
    warn: { bg: t.warnSoft, fg: t.warn, icon: 'alert' as IconName },
    info: { bg: t.accentSoft, fg: t.accent, icon: 'info' as IconName },
    success: { bg: t.successSoft, fg: t.success, icon: 'check' as IconName },
  }[tone];
}

/** An inline message inside a screen or card. Errors are announced to screen readers. */
export function Banner({
  tone = 'error',
  title,
  message,
  children,
  action,
  onDismiss,
  style,
}: {
  tone?: BannerTone;
  title?: string;
  message?: string;
  children?: ReactNode;
  action?: { label: string; onPress: () => void };
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const c = toneColors(t, tone);
  const urgent = tone === 'error' || tone === 'warn';
  return (
    <View
      accessibilityRole={urgent ? 'alert' : undefined}
      accessibilityLiveRegion={urgent ? 'polite' : 'none'}
      style={[fx.banner, { backgroundColor: c.bg }, style]}
    >
      <View style={{ paddingTop: 1 }}>
        <Icon name={c.icon} size={18} color={c.fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {!!title && (
          <Text maxFontSizeMultiplier={1.6} style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>
            {title}
          </Text>
        )}
        {!!message && (
          <Text maxFontSizeMultiplier={1.6} style={{ color: t.text, fontSize: 13, lineHeight: 18 }}>
            {message}
          </Text>
        )}
        {children}
        {action && (
          <Pressable onPress={action.onPress} accessibilityRole="button" hitSlop={6} style={({ pressed }) => [fx.bannerAction, { opacity: pressed ? 0.6 : 1 }]}>
            <Text maxFontSizeMultiplier={1.4} style={{ color: c.fg, fontSize: 14, fontWeight: '700' }}>
              {action.label}
            </Text>
          </Pressable>
        )}
      </View>
      {onDismiss && (
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} style={fx.bannerClose}>
          <Icon name="close" size={16} color={t.muted} />
        </Pressable>
      )}
    </View>
  );
}

const fx = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center' },
  card: {
    width: '100%',
    maxHeight: '100%',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 8, marginBottom: 4 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  title: { fontSize: 19, fontWeight: '700', marginBottom: 4 },
  message: { fontSize: 15, lineHeight: 21, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: 10, paddingTop: 14 },
  dialogBtn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  toastWrap: { position: 'absolute', alignItems: 'center' },
  toast: {
    width: '100%',
    maxWidth: 520,
    minHeight: 48,
    borderRadius: 14,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  toastAction: { minHeight: 44, minWidth: 64, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  toastClose: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, marginVertical: 6, alignItems: 'flex-start' },
  bannerAction: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 2 },
  bannerClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginTop: -6, marginRight: -6 },
});
