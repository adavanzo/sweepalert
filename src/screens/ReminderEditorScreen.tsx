import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, View } from 'react-native';

import { T } from '../components/primitives';
import { ReminderList } from '../components/reminders/ReminderList';
import { Screen } from '../components/Screen';
import { CarsStackParamList } from '../navigation/types';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeContext';

type Props = NativeStackScreenProps<CarsStackParamList, 'ReminderEditor'>;

export function ReminderEditorScreen({ route, navigation }: Props) {
  const { c } = useTheme();
  const { carId } = route.params;
  const car = useStore((s) => s.cars.find((x) => x.id === carId));
  const toggleReminder = useStore((s) => s.toggleReminder);
  const removeReminder = useStore((s) => s.removeReminder);
  const setChannel = useStore((s) => s.setReminderChannel);
  const addReminder = useStore((s) => s.addReminder);
  const updateReminder = useStore((s) => s.updateReminder);

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
        testID="reminders-back"
        accessibilityRole="button"
        accessibilityLabel={`Back to ${car.name}`}
        style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.card }}
      >
        <T style={{ fontSize: 12, fontWeight: '600', color: c.dim }}>← {car.name}</T>
      </Pressable>

      <View style={{ gap: 5 }}>
        <T style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.7 }}>Reminders</T>
        <T style={{ fontSize: 13, color: c.dim, lineHeight: 18 }}>
          New cars start with your default reminders (Settings). Changes here only affect {car.name}.
        </T>
      </View>

      <ReminderList
        key={carId}
        items={car.reminders}
        idPrefix="reminder"
        schedule={car.schedule}
        nextCleaning={car.nextCleaning}
        onToggle={(id) => toggleReminder(carId, id)}
        onRemove={(id) => removeReminder(carId, id)}
        onChannel={(id, ch) => setChannel(carId, id, ch)}
        onAdd={(p) => addReminder(carId, p)}
        onUpdate={(id, v) => updateReminder(carId, id, v)}
        emptyText="No reminders yet — you won't be alerted for this car."
      />
    </Screen>
  );
}
