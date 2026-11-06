import React from 'react';
import { Pressable, View } from 'react-native';

import { MonoLabel, T } from '../../components/primitives';
import { useTheme } from '../../theme/ThemeContext';

type Props = {
  /** Real nearby streets (alleys already excluded), nearest first. */
  streets: string[];
  /** The street the current schedule resolved to, shown as selected. */
  selected: string | undefined;
  onChoose: (street: string) => void;
};

/**
 * "Wrong street?" selector — GPS in a back alley can't tell which flanking
 * street you parked on (Boylston vs Newbury), so make it an obvious one-tap
 * choice rather than a silent guess. The parent decides when to show it.
 */
export function StreetPicker({ streets, selected, onChoose }: Props) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 8, marginTop: -6 }}>
      <MonoLabel>WHICH STREET DID YOU PARK ON?</MonoLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {streets.map((st) => {
          const on = selected === st;
          return (
            <Pressable
              key={st}
              onPress={() => onChoose(st)}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: on ? c.accent : c.line,
                backgroundColor: on ? c.accentT : c.card2,
              }}
            >
              <T style={{ fontSize: 12, fontWeight: '600', color: on ? c.accent : c.ink }}>{st}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
