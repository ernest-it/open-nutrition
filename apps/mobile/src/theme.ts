import { useColorScheme } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { NutrientStatus } from '@open-nutrition/shared';

/** Every colour the app uses. Nothing outside this file should hard-code a colour. */
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
  successSoft: string;
  danger: string;
  dangerSoft: string;
  /** Fill of destructive buttons (text on it is `onDanger`). */
  dangerSolid: string;
  onDanger: string;
  warn: string;
  warnSoft: string;
  doneRow: string;
  protein: string;
  carbs: string;
  fat: string;
  water: string;
  track: string;
  /** Switch thumb. */
  thumb: string;
  /** Scrim behind dialogs and sheets. */
  overlay: string;
  /** Snackbar: an inverted surface so it stands out in both themes. */
  toastBg: string;
  toastText: string;
  toastAction: string;
  /** Camera viewfinder chrome (always on a dark image). */
  media: string;
  onMedia: string;
  mediaScrim: string;
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
  success: '#15803d',
  successSoft: '#e6f4ea',
  danger: '#d42a2a',
  dangerSoft: '#fdeceb',
  dangerSolid: '#d42a2a',
  onDanger: '#ffffff',
  warn: '#a85a00',
  warnSoft: '#fff3e2',
  doneRow: '#e8f6ec',
  protein: '#0d9488',
  carbs: '#d97706',
  fat: '#8b5cf6',
  water: '#0284c7',
  track: '#e6e9ee',
  thumb: '#ffffff',
  overlay: 'rgba(12,14,18,0.45)',
  toastBg: '#20242c',
  toastText: '#f4f5f7',
  toastAction: '#9db9ff',
  media: '#000000',
  onMedia: '#ffffff',
  mediaScrim: 'rgba(0,0,0,0.55)',
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
  accent: '#6b98ff',
  accentSoft: '#1d2b4d',
  // Dark text on the light accent keeps filled buttons readable (white on light blue is < 4.5:1).
  onAccent: '#08122b',
  doneRow: '#16301f',
  success: '#22c55e',
  successSoft: '#13291b',
  danger: '#f26b6b',
  dangerSoft: '#3a1a1c',
  dangerSolid: '#c93434',
  onDanger: '#ffffff',
  warn: '#f59e0b',
  warnSoft: '#3a2a10',
  protein: '#2dd4bf',
  carbs: '#fbbf24',
  fat: '#a78bfa',
  water: '#38bdf8',
  track: '#2a2f39',
  thumb: '#ffffff',
  overlay: 'rgba(0,0,0,0.62)',
  toastBg: '#e8eaee',
  toastText: '#14161a',
  toastAction: '#2459d6',
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
