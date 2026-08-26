import React, { createContext, useContext, useMemo } from 'react';
import { Platform } from 'react-native';

import { PALETTES, Palette, ThemeName } from './tokens';
import { useStore } from '../state/store';

interface ThemeValue {
  name: ThemeName;
  c: Palette;
  /** Monospace family for the IBM Plex Mono labels/countdowns in the design. */
  mono: string;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })!;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const name = useStore((s) => s.theme);
  const value = useMemo<ThemeValue>(
    () => ({ name, c: PALETTES[name], mono: MONO, isDark: name === 'dark' }),
    [name],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used within ThemeProvider');
  return v;
}
