import { ActivityType, PlaceCategory } from '../models/types';

export type ThemeMode = 'dark' | 'light';

export interface Palette {
  bg: string;
  surface: string;
  card: string;
  border: string;
  muted: string;
  text: string;
  textSub: string;
  textDim: string;
  accent: string;
  overlay: string; // translucent panel bg for chips floating over the map
}

// ── Dark (default) ──
export const T_DARK: Palette = {
  bg: '#080E1C',
  surface: '#0D1526',
  card: '#111D30',
  border: '#1A2E4A',
  muted: '#233048',
  text: '#E8EFF8',
  textSub: '#7A92B0',
  textDim: '#3D5470',
  accent: '#3B8EF0',
  overlay: 'rgba(8,14,28,0.9)',
};

// ── Light ──
// Same blue brand on a cool light canvas. bg is the most tinted (canvas),
// surface/card grow lighter toward white, inverting the dark scale.
export const T_LIGHT: Palette = {
  bg: '#EAEFF6',
  surface: '#F7FAFD',
  card: '#FFFFFF',
  border: '#DCE4EF',
  muted: '#C8D4E3',
  text: '#0B1422', // ~16:1 on white
  textSub: '#3C4F66', // ~8:1 — readable secondary text
  textDim: '#5A6E86', // ~5:1 — legible tertiary/labels (was ~2.5:1)
  accent: '#1D6FE0', // ~4.8:1 — AA as text and behind white
  overlay: 'rgba(247,250,253,0.94)',
};

// Active palette. `T` keeps being a live reference so existing `T.bg` usage
// works; call setThemeMode() to swap the values in place.
export let T: Palette = { ...T_DARK };
export let themeMode: ThemeMode = 'dark';

// ── Activity colors (deepened in light mode so lines read on a light map) ──
export const ACTIVITY_COLORS_DARK: Record<ActivityType, string> = {
  stationary: '#475B7A',
  walking: '#10B981',
  running: '#EF4444',
  cycling: '#3B8EF0',
  driving: '#8B5CF6',
  bus: '#F59E0B',
  train: '#EC4899',
  airplane: '#06B6D4',
  unknown: '#6B7280',
};

export const ACTIVITY_COLORS_LIGHT: Record<ActivityType, string> = {
  stationary: '#64748B',
  walking: '#059669',
  running: '#DC2626',
  cycling: '#1D6FE0',
  driving: '#7C3AED',
  bus: '#D97706',
  train: '#DB2777',
  airplane: '#0891B2',
  unknown: '#6B7280',
};

export const PLACE_COLORS_DARK: Record<PlaceCategory, string> = {
  home: '#10B981',
  work: '#3B8EF0',
  food: '#F59E0B',
  shopping: '#EC4899',
  transit: '#8B5CF6',
  fitness: '#EF4444',
  entertainment: '#06B6D4',
  other: '#6B7280',
};

export const PLACE_COLORS_LIGHT: Record<PlaceCategory, string> = {
  home: '#059669',
  work: '#1D6FE0',
  food: '#D97706',
  shopping: '#DB2777',
  transit: '#7C3AED',
  fitness: '#DC2626',
  entertainment: '#0891B2',
  other: '#6B7280',
};

// Active maps (mutated in place by setThemeMode).
export let ACTIVITY_COLORS: Record<ActivityType, string> = {
  ...ACTIVITY_COLORS_DARK,
};
export let PLACE_COLORS: Record<PlaceCategory, string> = { ...PLACE_COLORS_DARK };

// Mapbox base style to pair with each palette. Colorful tiles: full-color
// Streets for light, the colorful Navigation Night basemap for dark.
export const MAP_STYLE_URL: Record<ThemeMode, string> = {
  dark: 'mapbox://styles/mapbox/navigation-night-v1',
  light: 'mapbox://styles/mapbox/streets-v12',
};

export function setThemeMode(mode: ThemeMode): void {
  themeMode = mode;
  Object.assign(T, mode === 'light' ? T_LIGHT : T_DARK);
  Object.assign(
    ACTIVITY_COLORS,
    mode === 'light' ? ACTIVITY_COLORS_LIGHT : ACTIVITY_COLORS_DARK,
  );
  Object.assign(
    PLACE_COLORS,
    mode === 'light' ? PLACE_COLORS_LIGHT : PLACE_COLORS_DARK,
  );
}

export const PLACE_ICONS: Record<PlaceCategory, string> = {
  home: '⌂',
  work: '⚙',
  food: '◉',
  shopping: '⬡',
  transit: '⬟',
  fitness: '◈',
  entertainment: '◆',
  other: '◎',
};
