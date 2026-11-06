/**
 * Small styled building blocks shared across screens. Kept deliberately thin —
 * they exist to carry the design tokens (rounded cards, mono labels, pills)
 * rather than to be a general UI kit.
 */
import React from 'react';
import { Pressable, StyleProp, Text, TextProps, TextStyle, View, ViewProps, ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

/** Card: white rounded surface with hairline border, the design's default panel. */
export function Card({ style, children, ...rest }: ViewProps) {
  const { c } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderColor: c.line,
          borderWidth: 1,
          borderRadius: 24,
          padding: 18,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

/** Uppercase IBM-Plex-Mono section label ("SCHEDULE FOR THIS BLOCK"). */
export function MonoLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const { c, mono } = useTheme();
  return (
    <Text
      style={[
        { fontFamily: mono, fontSize: 10.5, letterSpacing: 0.6, color: c.dim },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Monospace body text (plate numbers, next-sweep labels). */
export function Mono({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<TextStyle>; testID?: string }) {
  const { mono } = useTheme();
  return (
    <Text testID={testID} style={[{ fontFamily: mono }, style]}>
      {children}
    </Text>
  );
}

/** Sans text with sensible default color. */
export function T({ style, children, ...rest }: TextProps) {
  const { c } = useTheme();
  return (
    <Text style={[{ color: c.ink }, style]} {...rest}>
      {children}
    </Text>
  );
}

/** A soft-tinted status/pill chip. */
export function Pill({
  color,
  tint,
  children,
  style,
}: {
  color: string;
  tint: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 8,
          paddingLeft: 11,
          paddingRight: 13,
          borderRadius: 999,
          backgroundColor: tint,
        },
        style,
      ]}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontWeight: '700', fontSize: 12.5, color, letterSpacing: 0.2 }}>{children}</Text>
    </View>
  );
}

/** iOS-style on/off toggle track+knob from the design. */
export function Toggle({
  on,
  onPress,
  testID,
  accessibilityLabel,
}: {
  on: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  // Pressable (not onTouchEnd) so it also responds to mouse clicks on web.
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: on }}
      hitSlop={6}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        backgroundColor: on ? c.accent : c.line,
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#fff',
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
          elevation: 2,
        }}
      />
    </Pressable>
  );
}
