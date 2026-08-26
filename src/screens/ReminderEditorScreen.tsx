import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, View } from 'react-native';

import { MonoLabel, T, Toggle } from '../components/primitives';
import { Screen } from '../components/Screen';
import { CarsStackParamList } from '../navigation/types';
import { ADDABLE_PRESETS } from '../services/presets';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeContext';
import { Channel } from '../types';

type Props = NativeStackScreenProps<CarsStackParamList, 'ReminderEditor'>;

export function ReminderEditorScreen({ route, navigation }: Props) {
  const { c } = useTheme();
  const { carId } = route.params;
  const car = useStore((s) => s.cars.find((x) => x.id === carId));
  const toggleReminder = useStore((s) => s.toggleReminder);
  const removeReminder = useStore((s) => s.removeReminder);
  const setChannel = useStore((s) => s.setReminderChannel);
  const addReminder = useStore((s) => s.addReminder);

  if (!car) {
    return (
      <Screen>
        <T>Car not found.</T>
      </Screen>
    );
  }

  return (
    <Screen>
      <Pressable
        onPress={() => navigation.navigate('CarDetail', { carId })}
        style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.card }}
      >
        <T style={{ fontSize: 12, fontWeight: '600', color: c.dim }}>← {car.name}</T>
      </Pressable>

      <View style={{ gap: 5 }}>
        <T style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.7 }}>Reminders</T>
        <T style={{ fontSize: 13, color: c.dim, lineHeight: 18 }}>
          Stack as many as you want. These override your global defaults for {car.name}.
        </T>
      </View>

      {car.reminders.map((r) => {
        const push = r.channel === 'push' && r.enabled;
        const alarm = r.channel === 'alarm' && r.enabled;
        return (
          <View
            key={r.id}
            style={{ padding: 15, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 13 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <T style={{ fontSize: 15, fontWeight: '700', color: r.enabled ? c.ink : c.dim, flex: 1 }}>{r.label}</T>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Toggle on={r.enabled} onPress={() => toggleReminder(carId, r.id)} />
                <Pressable
                  onPress={() => removeReminder(carId, r.id)}
                  style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: c.line, backgroundColor: c.card2, alignItems: 'center', justifyContent: 'center' }}
                >
                  <T style={{ fontSize: 14, color: c.dim, marginTop: -2 }}>−</T>
                </Pressable>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              <ChannelBtn label="Push" active={push} onPress={() => setChannel(carId, r.id, 'push')} kind="push" />
              <ChannelBtn label="Critical alert" active={alarm} onPress={() => setChannel(carId, r.id, 'alarm')} kind="alarm" />
            </View>
          </View>
        );
      })}

      <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.card2, borderWidth: 1, borderColor: c.line, borderStyle: 'dashed', gap: 11 }}>
        <MonoLabel>ADD A REMINDER</MonoLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {ADDABLE_PRESETS.map((p) => (
            <Pressable
              key={p.label}
              onPress={() => addReminder(carId, p)}
              style={{ paddingVertical: 10, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.card }}
            >
              <T style={{ fontSize: 12.5, fontWeight: '600' }}>+ {p.label}</T>
            </Pressable>
          ))}
        </View>
      </View>
    </Screen>
  );
}

function ChannelBtn({
  label,
  active,
  onPress,
  kind,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  kind: Channel;
}) {
  const { c } = useTheme();
  const on = kind === 'push'
    ? { bg: c.accentT, ink: c.accent, border: c.accent }
    : { bg: c.badT, ink: c.bad, border: c.bad };
  const off = { bg: c.card2, ink: c.dim, border: c.line };
  const s = active ? on : off;
  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: s.border, backgroundColor: s.bg, alignItems: 'center' }}
    >
      <T style={{ fontSize: 12, fontWeight: '600', color: s.ink }}>{label}</T>
    </Pressable>
  );
}
