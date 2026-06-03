import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { create } from 'zustand';
import {
  Palette,
  ThemeMode,
  T_DARK,
  T_LIGHT,
  setThemeMode,
} from '../utils/theme';
import { database } from '../services/database';

const THEME_SETTING_KEY = 'themeMode';

function paletteFor(mode: ThemeMode): Palette {
  return mode === 'light' ? T_LIGHT : T_DARK;
}

interface ThemeStore {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

// Read the persisted choice synchronously at module load so the very first
// render already uses the right palette (no flash). Mutate the live `T` too.
function loadInitialMode(): ThemeMode {
  try {
    const saved = database.getSetting(THEME_SETTING_KEY);
    if (saved === 'light' || saved === 'dark') {
      setThemeMode(saved);
      return saved;
    }
  } catch {
    // DB not ready yet — default below; App re-applies after init.
  }
  return 'dark';
}

export const useThemeStore = create<ThemeStore>(set => ({
  mode: loadInitialMode(),

  setMode: mode => {
    setThemeMode(mode); // mutate live T / color maps before re-render
    try {
      database.setSetting(THEME_SETTING_KEY, mode);
    } catch {
      // ignore persistence failure; in-memory switch still applies
    }
    set({ mode });
  },

  toggle: () =>
    set(state => {
      const next: ThemeMode = state.mode === 'light' ? 'dark' : 'light';
      setThemeMode(next);
      try {
        database.setSetting(THEME_SETTING_KEY, next);
      } catch {}
      return { mode: next };
    }),
}));

/**
 * Re-apply the persisted mode once the DB is guaranteed initialized (call from
 * App after database.init()). Safe no-op if nothing was saved.
 */
export function hydrateThemeMode(): void {
  try {
    const saved = database.getSetting(THEME_SETTING_KEY);
    if (saved === 'light' || saved === 'dark') {
      useThemeStore.getState().setMode(saved);
    }
  } catch {}
}

/**
 * Build a StyleSheet from the active palette and re-memoize it whenever the
 * theme mode flips. `factory` must be a stable module-level function.
 */
export function useThemedStyles<R extends StyleSheet.NamedStyles<R>>(
  factory: (t: Palette) => R,
): R {
  const mode = useThemeStore(s => s.mode);
  return useMemo(() => factory(paletteFor(mode)), [mode, factory]);
}

/** Current palette (for inline style values inside render). */
export function useThemePalette(): Palette {
  const mode = useThemeStore(s => s.mode);
  return paletteFor(mode);
}
