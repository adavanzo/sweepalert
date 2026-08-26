/**
 * Design tokens imported 1:1 from the SweepAlert Claude Design source
 * (SweepAlert.dc.html). The design authored colors in oklch(); React Native's
 * StyleSheet does not understand oklch, so each token below carries the sRGB
 * hex/rgba equivalent. Both light and dark palettes are preserved.
 */

export type ThemeName = 'light' | 'dark';

export interface Palette {
  bg: string;
  card: string;
  card2: string;
  ink: string;
  dim: string;
  line: string;
  chrome: string;
  accent: string;
  accentT: string;
  ok: string;
  okT: string;
  warn: string;
  warnT: string;
  bad: string;
  badT: string;
}

export const LIGHT: Palette = {
  bg: '#efeeea',
  card: '#ffffff',
  card2: '#f7f6f3',
  ink: '#1b1a17',
  dim: '#7b7972',
  line: 'rgba(0,0,0,0.09)',
  chrome: '#dedcd6',
  // oklch(0.55 0.15 275)
  accent: '#5646c9',
  // oklch(0.95 0.028 275)
  accentT: '#ecebf7',
  // oklch(0.52 0.12 155)
  ok: '#2f7d54',
  // oklch(0.94 0.05 155)
  okT: '#e2f1e7',
  // oklch(0.58 0.13 70)
  warn: '#a37200',
  // oklch(0.95 0.06 80)
  warnT: '#f4ead2',
  // oklch(0.53 0.19 25)
  bad: '#b3261e',
  // oklch(0.94 0.05 25)
  badT: '#f7e4e1',
};

export const DARK: Palette = {
  bg: '#0e0e10',
  card: '#1a1a1d',
  card2: '#232327',
  ink: '#f2f1ee',
  dim: '#98968f',
  line: 'rgba(255,255,255,0.10)',
  chrome: '#000000',
  // oklch(0.74 0.13 275)
  accent: '#9a8bf0',
  // oklch(0.32 0.07 275)
  accentT: '#2b2551',
  // oklch(0.78 0.14 155)
  ok: '#6fd39a',
  // oklch(0.3 0.06 155)
  okT: '#173a28',
  // oklch(0.82 0.14 75)
  warn: '#e0b64c',
  // oklch(0.32 0.06 75)
  warnT: '#3a3016',
  // oklch(0.68 0.18 25)
  bad: '#f07a6b',
  // oklch(0.32 0.08 25)
  badT: '#3f201c',
};

export const PALETTES: Record<ThemeName, Palette> = {
  light: LIGHT,
  dark: DARK,
};

/** The five car paint swatches from the design (PAINTS). */
export const CAR_PAINTS = ['#2f6f8f', '#8a5c3b', '#3d6b4a', '#7a3f5f', '#4a4a52'];

/**
 * Fonts. The design uses Plus Jakarta Sans (UI) and IBM Plex Mono (labels /
 * countdowns). We fall back to the platform system + monospace fonts so the app
 * runs with zero asset setup; wiring the actual webfonts is documented in the
 * README (expo-font).
 */
export const FONT = {
  sans: undefined as string | undefined, // system default
  mono: undefined as string | undefined, // resolved per-platform below
};
