import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Button } from '../components/Button';
import { Mono, MonoLabel, T } from '../components/primitives';
import { Screen } from '../components/Screen';
import { CarsStackParamList } from '../navigation/types';
import { MAX_CARS, useStore } from '../state/store';
import { CAR_PAINTS } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

type Props = NativeStackScreenProps<CarsStackParamList, 'ManageCars'>;

export function ManageCarsScreen({ navigation }: Props) {
  const { c, mono } = useTheme();
  const cars = useStore((s) => s.cars);
  const addCar = useStore((s) => s.addCar);
  const loadError = useStore((s) => s.loadError);

  const [name, setName] = useState('');
  const [plate, setPlate] = useState('');
  const [paint, setPaint] = useState(0);

  const atLimit = cars.length >= MAX_CARS;

  const onAdd = async () => {
    // addCar returns null at MAX_CARS or on loadError (the form is hidden then anyway).
    if (!(await addCar({ name, plate: plate || undefined, color: CAR_PAINTS[paint] }))) return;
    setName('');
    setPlate('');
    setPaint(0);
    navigation.navigate('MyCars');
  };

  return (
    <Screen>
      <Pressable
        onPress={() => navigation.navigate('MyCars')}
        style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.card }}
      >
        <T style={{ fontSize: 12, fontWeight: '600', color: c.dim }}>← My cars</T>
      </Pressable>
      <T style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.7 }}>Manage cars</T>

      {cars.map((car) => (
        <View
          key={car.id}
          style={{ padding: 15, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: car.color }} />
          <View style={{ flex: 1, gap: 3 }}>
            <T style={{ fontSize: 15, fontWeight: '700' }}>{car.name}</T>
            <Mono style={{ fontSize: 11.5, color: c.dim }}>
              {car.plate} · {car.reminders.filter((r) => r.enabled).length} reminders
            </Mono>
          </View>
          <Pressable
            onPress={() => navigation.navigate('CarDetail', { carId: car.id })}
            style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.card2 }}
          >
            <T style={{ fontSize: 12, fontWeight: '600' }}>Edit</T>
          </Pressable>
        </View>
      ))}

      {atLimit || loadError ? (
        // MAX_CARS keeps every car within its share of iOS's 64 pending alerts;
        // while saved state failed to load, addCar refuses (state/store.ts).
        <View style={{ padding: 18, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 6 }}>
          <MonoLabel>NEW CAR</MonoLabel>
          <T style={{ fontSize: 13, color: c.dim }}>
            {loadError
              ? 'Couldn’t load your saved cars yet. Adding cars is paused until they load.'
              : `You’ve reached the ${MAX_CARS}-car limit. Remove a car to add another.`}
          </T>
        </View>
      ) : (
        <View style={{ padding: 18, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 14 }}>
          <MonoLabel>NEW CAR</MonoLabel>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Nickname — e.g. “Alli’s Subaru”"
            placeholderTextColor={c.dim}
            style={{ padding: 13, paddingHorizontal: 15, borderRadius: 14, backgroundColor: c.card2, fontSize: 14, color: c.ink }}
          />
          <TextInput
            value={plate}
            onChangeText={setPlate}
            autoCapitalize="characters"
            placeholder="MA plate"
            placeholderTextColor={c.dim}
            style={{ padding: 13, paddingHorizontal: 15, borderRadius: 14, backgroundColor: c.card2, fontSize: 14, color: c.ink, fontFamily: mono }}
          />
          <View style={{ gap: 9 }}>
            <T style={{ fontSize: 12.5, fontWeight: '600', color: c.dim }}>Color</T>
            <View style={{ flexDirection: 'row', gap: 9 }}>
              {CAR_PAINTS.map((hex, i) => (
                <Pressable
                  key={hex}
                  onPress={() => setPaint(i)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    backgroundColor: hex,
                    borderWidth: 2,
                    borderColor: paint === i ? c.accent : 'transparent',
                  }}
                />
              ))}
            </View>
          </View>
          <Button title="Add car" onPress={onAdd} style={{ borderRadius: 18, paddingVertical: 15 }} />
        </View>
      )}
    </Screen>
  );
}
