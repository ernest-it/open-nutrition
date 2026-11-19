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
  /** Logo square (fixed brand green in both themes; the glyph on it is onBrand). */
  brand: string;
  onBrand: string;
  onMedia: string;
  mediaScrim: string;
}

// Colours follow the web app's tokens (apps/web/src/styles.css) so both clients look like one product:
// green accent, blue / orange / green macros.
const light: Theme = {
  dark: false,
  bg: '#f5f6f3',
  surface: '#ffffff',
  surface2: '#eef0ec',
  text: '#15181a',
  // A touch darker than the web's #6b7178 so small muted text keeps 4.5:1 on the page background.
  muted: '#5f656b',
  border: '#dfe2dc',
  accent: '#127a52',
  accentSoft: '#dcf1e6',
  onAccent: '#ffffff',
  success: '#1d8a55',
  successSoft: '#e2f3e9',
  danger: '#c43c3b',
  dangerSoft: '#fbeaea',
  dangerSolid: '#c43c3b',
  onDanger: '#ffffff',
  warn: '#b26a00',
  warnSoft: '#fdf1df',
  doneRow: '#e2f3e9',
  protein: '#2a78d6',
  carbs: '#eb6834',
  fat: '#1baf7a',
  water: '#2a8fd6',
  track: '#e3e6e0',
  thumb: '#ffffff',
  overlay: 'rgba(12,16,14,0.45)',
  toastBg: '#1d2321',
  toastText: '#f1f3f1',
  toastAction: '#7fdcae',
  media: '#000000',
  brand: '#127a52',
  onBrand: '#ffffff',
  onMedia: '#ffffff',
  mediaScrim: 'rgba(0,0,0,0.55)',
};
const dark: Theme = {
  ...light,
  dark: true,
  bg: '#101312',
  surface: '#181c1b',
  surface2: '#222826',
  text: '#eceeec',
  muted: '#99a19c',
  border: '#2c3331',
  accent: '#35b47d',
  accentSoft: '#173b2b',
  // Dark text on the light accent keeps filled buttons readable (white on light green is < 4.5:1).
  onAccent: '#06140d',
  doneRow: '#15301f',
  success: '#3cbf7f',
  successSoft: '#15301f',
  danger: '#ec6b6a',
  dangerSoft: '#3a1a1a',
  dangerSolid: '#c43c3b',
  onDanger: '#ffffff',
  warn: '#e0a03a',
  warnSoft: '#3a2a10',
  protein: '#3987e5',
  carbs: '#d95926',
  fat: '#199e70',
  water: '#4ba6ea',
  track: '#2c3330',
  thumb: '#ffffff',
  overlay: 'rgba(0,0,0,0.62)',
  toastBg: '#e9ece9',
  toastText: '#141816',
  toastAction: '#0d6343',
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
