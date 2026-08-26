import { DarkTheme, DefaultTheme, NavigationContainer, Theme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
import { useStore } from './src/state/store';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

function navTheme(isDark: boolean, bg: string, card: string, ink: string, accent: string): Theme {
  const base = isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: { ...base.colors, background: bg, card, text: ink, primary: accent, border: 'transparent' },
  };
}

function Inner() {
  const { c, isDark } = useTheme();
  const init = useStore((s) => s.init);

  // Kick the engine on cold start (also re-run by the persist rehydrate hook).
  useEffect(() => {
    init();
  }, [init]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NavigationContainer theme={navTheme(isDark, c.bg, c.card, c.ink, c.accent)}>
        <RootNavigator />
      </NavigationContainer>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Inner />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
