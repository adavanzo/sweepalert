import React from 'react';
import { View } from 'react-native';

import { Mono, MonoLabel, T } from '../../components/primitives';
import { useTheme } from '../../theme/ThemeContext';
import { CleaningSchedule } from '../../types';

export type DetectedInfo = { addr: string; block: string; sched: string; season: string };

type Props = {
  unsupported: boolean;
  detected: DetectedInfo;
  schedule: CleaningSchedule | null;
  geocoding: boolean;
  /** Rendered at the bottom of the card (the "Assign to" car picker). */
  children?: React.ReactNode;
};

/** The detected block + schedule, or an out-of-coverage notice. */
export function DetectedBlockCard({ unsupported, detected, schedule, geocoding, children }: Props) {
  const { c } = useTheme();
  return (
    <View style={{ padding: 18, borderRadius: 24, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 14 }}>
      {unsupported ? (
        <>
          <View style={{ gap: 5 }}>
            <MonoLabel>OUTSIDE COVERAGE</MonoLabel>
            <T style={{ fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>Not supported here yet</T>
            <T style={{ fontSize: 13, fontWeight: '500', color: c.dim }}>
              {detected.addr}
            </T>
          </View>
          <View style={{ padding: 14, borderRadius: 16, backgroundColor: c.warnT, gap: 6 }}>
            <T style={{ fontSize: 14, fontWeight: '700', color: c.warn }}>
              SweepAlert covers Boston and Cambridge. This spot is outside both.
            </T>
            <Mono style={{ fontSize: 11.5, color: c.dim }}>
              You can still save where you parked, but there are no cleaning reminders for this area.
            </Mono>
          </View>
        </>
      ) : (
        <>
          <View style={{ gap: 5 }}>
            <MonoLabel>DETECTED BLOCK</MonoLabel>
            <T style={{ fontSize: 18, fontWeight: '700', letterSpacing: -0.3 }}>{detected.addr}</T>
            {!!detected.block && (
              <T style={{ fontSize: 13, fontWeight: '500', color: c.dim }}>{detected.block}</T>
            )}
          </View>
          {schedule ? (
            <View style={{ padding: 14, borderRadius: 16, backgroundColor: c.accentT, gap: 6 }}>
              <T style={{ fontSize: 14, fontWeight: '700', color: c.accent }}>{detected.sched}</T>
              <Mono style={{ fontSize: 11.5, color: c.dim }}>{detected.season}</Mono>
            </View>
          ) : (
            <View style={{ padding: 14, borderRadius: 16, backgroundColor: c.card2, gap: 6 }}>
              <T style={{ fontSize: 13, fontWeight: '600', color: c.dim }}>
                {geocoding ? 'Looking up the cleaning schedule…' : 'No street-cleaning data for this location.'}
              </T>
              {!geocoding && (
                <Mono style={{ fontSize: 11, color: c.dim }}>
                  SweepAlert covers Boston and Cambridge. If you’re in Boston, try picking the street below.
                </Mono>
              )}
            </View>
          )}
        </>
      )}
      {children}
    </View>
  );
}
