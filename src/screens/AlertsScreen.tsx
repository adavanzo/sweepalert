import React, { useMemo } from 'react';
import { View } from 'react-native';

import { Button } from '../components/Button';
import { Mono, T } from '../components/primitives';
import { Screen } from '../components/Screen';
import { useNow } from '../hooks/useNow';
import { decorateCar } from '../services/format';
import { firePreview } from '../services/notifications';
import { useStore } from '../state/store';
import { useTheme } from '../theme/ThemeContext';

interface AlertRow {
  title: string;
  body: string;
  when: string;
  color: string;
}

export function AlertsScreen() {
  const { c } = useTheme();
  const now = useNow(30_000);
  const cars = useStore((s) => s.cars);

  // Build an activity feed from real car state (soonest sweeps first).
  const alerts: AlertRow[] = useMemo(() => {
    const rows: AlertRow[] = cars
      .map((car) => {
        const v = decorateCar(car, now, c);
        if (!v.hasSchedule) return null;
        const label = v.nextLabel.replace('NEXT SWEEP ', '');
        if (v.status.key === 'now') {
          return { title: `Move your ${car.name}`, body: `${v.spot}. Sweep imminent — ${v.countdown} left.`, when: 'now', color: c.bad };
        }
        if (v.status.key === 'soon') {
          return { title: `${car.name} — sweep soon`, body: `Next sweep ${label}. Move within ${v.countdown}.`, when: 'today', color: c.warn };
        }
        return { title: `${car.name} is safe`, body: `Next sweep ${label}. Nothing to do yet.`, when: 'upcoming', color: c.ok };
      })
      .filter(Boolean) as AlertRow[];

    rows.push({
      title: 'Season awareness on',
      body: 'Boston sweeps roughly April 1 – Nov 30. Off-season sweeps are skipped automatically.',
      when: 'info',
      color: c.accent,
    });
    return rows;
  }, [cars, now, c]);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <T style={{ fontSize: 26, fontWeight: '800', letterSpacing: -0.7 }}>Alerts</T>
        <T style={{ fontSize: 13, color: c.dim }}>Everything SweepAlert is watching.</T>
      </View>

      <Button title="Preview a push notification" variant="accentTint" onPress={() => firePreview(cars[0])} style={{ paddingVertical: 15 }} />

      {alerts.map((a, i) => (
        <View key={i} style={{ padding: 15, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, flexDirection: 'row', gap: 12 }}>
          <View style={{ width: 8, borderRadius: 999, backgroundColor: a.color }} />
          <View style={{ flex: 1, gap: 5 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <T style={{ fontSize: 14, fontWeight: '700', flex: 1 }}>{a.title}</T>
              <Mono style={{ fontSize: 10.5, color: c.dim }}>{a.when}</Mono>
            </View>
            <T style={{ fontSize: 12.5, color: c.dim, lineHeight: 17 }}>{a.body}</T>
          </View>
        </View>
      ))}
    </Screen>
  );
}
