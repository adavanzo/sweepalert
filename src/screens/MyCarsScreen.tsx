import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '../components/Button';
import { Mono, Pill, T } from '../components/primitives';
import { Screen } from '../components/Screen';
import { useNow } from '../hooks/useNow';
import { CarsStackParamList, RootTabParamList } from '../navigation/types';
import { decorateCar } from '../services/format';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeContext';

type Props = NativeStackScreenProps<CarsStackParamList, 'MyCars'>;

export function MyCarsScreen({ navigation }: Props) {
  const { c } = useTheme();
  const now = useNow();
  const cars = useStore((s) => s.cars);
  const showEmpty = useStore((s) => s.showEmpty);
  const loadError = useStore((s) => s.loadError);

  const views = useMemo(
    () => (showEmpty ? [] : cars.map((car) => decorateCar(car, now, c))),
    [cars, now, c, showEmpty],
  );

  const worst = views.reduce((a, v) => Math.min(a, v.msLeft), Infinity);
  const headline =
    views.length === 0
      ? 'Nothing parked'
      : worst < 2 * 3600_000
        ? 'One car needs to move right now.'
        : worst < 24 * 3600_000
          ? 'One sweep coming up in the next day.'
          : 'All clear for the next few days.';

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ gap: 4, flex: 1 }}>
          <T style={{ fontSize: 28, fontWeight: '800', letterSpacing: -0.8 }}>My cars</T>
          <T style={{ fontSize: 13, color: c.dim }}>{headline}</T>
        </View>
        <Pressable
          onPress={() => navigation.navigate('ManageCars')}
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            borderWidth: 1,
            borderColor: c.line,
            backgroundColor: c.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <T style={{ fontSize: 22, marginTop: -2 }}>+</T>
        </Pressable>
      </View>

      {loadError ? (
        // Saved state failed to load; the store blocks writes and retries on
        // foreground (state/store.ts onAppActive), so this clears by itself.
        <View style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.warnT }}>
          <T style={{ fontSize: 13, fontWeight: '600', color: c.warn }}>Couldn&apos;t load your saved cars. Retrying…</T>
        </View>
      ) : null}

      {loadError && views.length === 0 ? null : views.length === 0 ? (
        // (No add/park prompts while saved state is unreadable: the store
        // refuses those until a retry succeeds.)
        <EmptyState onPark={() => navigation.getParent<BottomTabNavigationProp<RootTabParamList>>()?.navigate('Park', { autoLocate: Date.now() })} onAdd={() => navigation.navigate('ManageCars')} />
      ) : (
        <>
          {views.map((v) => (
            <Pressable
              key={v.car.id}
              onPress={() => navigation.navigate('CarDetail', { carId: v.car.id })}
              style={{
                borderRadius: 26,
                backgroundColor: c.card,
                borderWidth: 1,
                borderColor: c.line,
                padding: 16,
                gap: 14,
              }}
            >
              <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                <CarThumb color={v.status.color} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: v.car.color }} />
                    <T numberOfLines={1} style={{ fontSize: 17, fontWeight: '700', letterSpacing: -0.3 }}>
                      {v.car.name}
                    </T>
                  </View>
                  <T style={{ fontSize: 13, fontWeight: '500', color: c.dim }}>{v.spot}</T>
                  <Mono style={{ fontSize: 11.5, color: c.dim }}>{v.nextLabel}</Mono>
                </View>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 13,
                  borderTopWidth: 1,
                  borderTopColor: c.line,
                }}
              >
                <Pill color={v.status.color} tint={v.status.tint}>
                  {v.status.label}
                </Pill>
                <Mono style={{ fontSize: 15, fontWeight: '700', color: v.status.color }}>{v.countdown}</Mono>
              </View>
            </Pressable>
          ))}
          <Button title="＋  Park a car here" onPress={() => navigation.getParent<BottomTabNavigationProp<RootTabParamList>>()?.navigate('Park', { autoLocate: Date.now() })} />
        </>
      )}
    </Screen>
  );
}

function CarThumb({ color }: { color: string }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: 78,
        height: 78,
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: c.card2,
        borderWidth: 1,
        borderColor: c.line,
      }}
    >
      <View style={{ position: 'absolute', left: 0, right: 0, top: '26%', height: 9, backgroundColor: c.line }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: '66%', height: 5, backgroundColor: c.line }} />
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: '38%', width: 7, backgroundColor: c.line }} />
      <View
        style={{
          position: 'absolute',
          left: '34%',
          top: '22%',
          width: 16,
          height: 16,
          borderRadius: 8,
          borderWidth: 3,
          borderColor: c.card,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function EmptyState({ onPark, onAdd }: { onPark: () => void; onAdd: () => void }) {
  const { c, mono } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 22, paddingTop: 24 }}>
      <View
        style={{
          width: '100%',
          height: 190,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: c.line,
          borderStyle: 'dashed',
          backgroundColor: c.card2,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <T style={{ fontFamily: mono, fontSize: 11, color: c.dim }}>[ map of your block ]</T>
      </View>
      <View style={{ gap: 9, alignItems: 'center' }}>
        <T style={{ fontSize: 22, fontWeight: '800', letterSpacing: -0.5 }}>No cars yet</T>
        <T style={{ fontSize: 14, color: c.dim, textAlign: 'center', lineHeight: 21 }}>
          Add the car you park on the street. SweepAlert reads the cleaning schedule for that block and
          reminds you before the sweeper shows up.
        </T>
      </View>
      <Button title="＋  Park a car here" onPress={onPark} style={{ width: '100%' }} />
      <Button title="Add a car without parking it" variant="ghost" onPress={onAdd} style={{ width: '100%' }} />
    </View>
  );
}
