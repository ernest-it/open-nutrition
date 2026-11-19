import { useWindowDimensions } from 'react-native';

/**
 * Breakpoints (dp), shared with the web UI:
 * - compact  < 600: phones in portrait — one column, bottom tabs
 * - medium   600–899: large phones in landscape, foldables, small tablets — two columns, bottom tabs
 * - expanded ≥ 900: tablets, desktops — two columns plus a side navigation rail
 */
export type SizeClass = 'compact' | 'medium' | 'expanded';

export const BREAKPOINTS = { medium: 600, expanded: 900 } as const;
/** Readable line length for single-column content on wide screens. */
export const MAX_CONTENT_WIDTH = 720;
/** Max width of a two-pane layout before it is centred. */
export const MAX_WIDE_WIDTH = 1280;

export function sizeClassOf(width: number): SizeClass {
  if (width >= BREAKPOINTS.expanded) return 'expanded';
  if (width >= BREAKPOINTS.medium) return 'medium';
  return 'compact';
}

export interface Layout {
  width: number;
  height: number;
  size: SizeClass;
  landscape: boolean;
  /** Use two columns / two panes. */
  wide: boolean;
  /** Use the side navigation rail instead of the bottom tab bar (expanded, or a short landscape phone). */
  rail: boolean;
  /** Very small phone (≤ 360 dp wide): tighten paddings. */
  tiny: boolean;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const size = sizeClassOf(width);
  const landscape = width > height;
  return {
    width,
    height,
    size,
    landscape,
    wide: size !== 'compact',
    rail: size === 'expanded' || (landscape && height < 500),
    tiny: width <= 360,
  };
}
