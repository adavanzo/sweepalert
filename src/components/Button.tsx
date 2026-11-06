import React from 'react';
import { Pressable, StyleProp, Text, TextStyle, ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

type Variant = 'primary' | 'ghost' | 'danger' | 'accentTint';

export function Button({
  title,
  onPress,
  variant = 'primary',
  style,
  textStyle,
  testID,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const { c } = useTheme();

  const bg: Record<Variant, string> = {
    primary: c.accent,
    ghost: c.card,
    danger: c.badT,
    accentTint: c.accentT,
  };
  const fg: Record<Variant, string> = {
    primary: '#fff',
    ghost: c.ink,
    danger: c.bad,
    accentTint: c.accent,
  };
  const border: Record<Variant, string | undefined> = {
    primary: undefined,
    ghost: c.line,
    danger: c.badT,
    accentTint: c.accent,
  };

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [
        {
          paddingVertical: 16,
          paddingHorizontal: 18,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg[variant],
          borderWidth: border[variant] ? 1 : 0,
          borderColor: border[variant],
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text style={[{ fontWeight: '700', fontSize: 15, color: fg[variant] }, textStyle]}>{title}</Text>
    </Pressable>
  );
}
