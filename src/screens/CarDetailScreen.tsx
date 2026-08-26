import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';

import { Button } from '../components/Button';
import { Card, Mono, MonoLabel, T } from '../components/primitives';
import { Screen } from '../components/Screen';
import { useNow } from '../hooks/useNow';
import { CarsStackParamList, RootTabParamList } from '../navigation/types';
import { decorateCar, upcomingSweeps } from '../services/format';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeContext';

type Props = NativeStackScreenProps<CarsStackParamList, 'CarDetail'>;

export function CarDetailScreen({ route, navigation }: Props) {
  const { c } = useTheme();
  const now = useNow();
  const { carId } = route.params;
  const car = useStore((s) => s.cars.find((x) => x.id === carId));
  const removeCar = useStore((s) => s.removeCar);
  const refreshCar = useStore((s) => s.refreshCar);
  const [checking, setChecking] = useState(false);

  const recheck = async () => {
    setChecking(true);
    try {
      await refreshCar(carId, true); // force a fresh live lookup, bypassing cache
    } finally {
      setChecking(false);
    }
  };

  const view = useMemo(() => (car ? decorateCar(car, now, c) : null), [car, now, c]);
  const upcoming = useMemo(() => (car ? upcomingSweeps(car) : []), [car]);

  if (!car || !view) {
    return (
      <Screen>
        <T>Car not found.</T>
      </Screen>
    );
  }

  const confirmDelete = () => {
    Alert.alert('Delete car', `Remove ${car.name} and its reminders?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeCar(car.id);
          navigation.navigate('MyCars');
        },
      },
    ]);
  };

  return (
    <Screen>
      <Pressable
        onPress={() => navigation.navigate('MyCars')}
        style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: c.line, backgroundColor: c.card }}
      >
        <T style={{ fontSize: 12, fontWeight: '600', color: c.dim }}>← My cars</T>
      </Pressable>

      {/* Status hero */}
      <View style={{ padding: 20, borderRadius: 26, backgroundColor: view.status.tint, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: car.color }} />
          <T style={{ fontSize: 24, fontWeight: '800', letterSpacing: -0.6 }}>{car.name}</T>
        </View>
        <T style={{ fontSize: 13.5, fontWeight: '500', color: c.dim }}>{view.spot}</T>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
          <Mono style={{ fontSize: 34, fontWeight: '700', color: view.status.color, letterSpacing: -1 }}>
            {view.countdown}
          </Mono>
          <T style={{ fontSize: 13, fontWeight: '700', color: view.status.color }}>{view.status.label}</T>
        </View>
        <Mono style={{ fontSize: 11.5, color: c.dim }}>{view.nextLabel}</Mono>
      </View>

      {/* Schedule */}
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <MonoLabel>SCHEDULE FOR THIS BLOCK</MonoLabel>
          <Pressable onPress={recheck} disabled={checking} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {checking && <ActivityIndicator size="small" color={c.accent} />}
            <T style={{ fontSize: 12, fontWeight: '600', color: c.accent }}>
              {checking ? 'Checking…' : 'Re-check ↻'}
            </T>
          </Pressable>
        </View>
        <T style={{ fontSize: 15, fontWeight: '700' }}>{car.schedule?.scheduleLabel ?? 'Not parked yet'}</T>
        {car.schedule && <Mono style={{ fontSize: 12, color: c.dim }}>{car.schedule.seasonLabel}</Mono>}
        <View style={{ height: 1, backgroundColor: c.line }} />
        <MonoLabel>UPCOMING</MonoLabel>
        <View style={{ gap: 9 }}>
          {upcoming.map((u, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T style={{ fontSize: 13.5, fontWeight: '600' }}>{u.date}</T>
              <Mono style={{ fontSize: 12, color: c.dim }}>{u.window}</Mono>
            </View>
          ))}
          {upcoming.length === 0 && <T style={{ fontSize: 13, color: c.dim }}>No upcoming sweeps in season.</T>}
        </View>
      </Card>

      {/* Reminders summary -> editor */}
      <Pressable onPress={() => navigation.navigate('ReminderEditor', { carId })}>
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <MonoLabel>ACTIVE REMINDERS</MonoLabel>
            <T style={{ fontSize: 12, fontWeight: '600', color: c.accent }}>Edit →</T>
          </View>
          <View style={{ gap: 8 }}>
            {car.reminders.map((r) => (
              <View
                key={r.id}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 11,
                  paddingHorizontal: 13,
                  borderRadius: 14,
                  backgroundColor: c.card2,
                }}
              >
                <T style={{ fontSize: 13, fontWeight: '600', color: r.enabled ? c.ink : c.dim }}>{r.label}</T>
                <Mono style={{ fontSize: 11, color: c.dim }}>
                  {r.enabled ? (r.channel === 'push' ? 'PUSH' : 'CRITICAL') : 'OFF'}
                </Mono>
              </View>
            ))}
          </View>
        </Card>
      </Pressable>

      <View style={{ flexDirection: 'row', gap: 9 }}>
        <Button
          title="Move spot"
          variant="ghost"
          onPress={() => navigation.getParent<BottomTabNavigationProp<RootTabParamList>>()?.navigate('Park', { carId })}
          style={{ flex: 1 }}
        />
        <Button title="Delete car" variant="danger" onPress={confirmDelete} style={{ flex: 1 }} />
      </View>
    </Screen>
  );
}
