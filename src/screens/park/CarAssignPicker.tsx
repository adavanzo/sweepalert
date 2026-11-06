import React from 'react';
import { Pressable, View } from 'react-native';

import { T } from '../../components/primitives';
import { useTheme } from '../../theme/ThemeContext';
import { Car } from '../../types';

type Props = {
  cars: Car[];
  assignId: string | undefined;
  onAssign: (carId: string) => void;
};

/** "Assign to" row of car chips; one is selected at a time. */
export function CarAssignPicker({ cars, assignId, onAssign }: Props) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <T style={{ fontSize: 13, fontWeight: '500', color: c.dim }}>Assign to</T>
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap', flexShrink: 1, justifyContent: 'flex-end' }}>
        {cars.map((car) => {
          const on = assignId === car.id;
          return (
            <Pressable
              key={car.id}
              onPress={() => onAssign(car.id)}
              style={{
                paddingVertical: 9,
                paddingHorizontal: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: on ? c.accent : c.line,
                backgroundColor: on ? c.accent : c.card,
              }}
            >
              <T style={{ fontSize: 12, fontWeight: '600', color: on ? '#fff' : c.dim }}>{car.name}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
