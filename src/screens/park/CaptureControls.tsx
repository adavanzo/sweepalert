import React from 'react';
import { Pressable, View } from 'react-native';

import { Mono, T } from '../../components/primitives';
import { useTheme } from '../../theme/ThemeContext';

export type CaptureMode = 'gps' | 'nfc';

type Props = {
  capture: CaptureMode;
  located: boolean;
  accuracyM: number | null;
  permDenied: boolean;
  onUseGps: () => void;
  onUseNfc: () => void;
};

/**
 * The "location is off" retry banner plus the GPS / NFC capture buttons.
 * Rendered as a fragment so both stay direct children of the Screen and keep
 * its gap spacing exactly as before.
 */
export function CaptureControls({ capture, located, accuracyM, permDenied, onUseGps, onUseNfc }: Props) {
  const { c } = useTheme();
  return (
    <>
      {permDenied && (
        <Pressable
          onPress={onUseGps}
          style={{ padding: 12, borderRadius: 14, backgroundColor: c.warnT, borderWidth: 1, borderColor: c.warn }}
        >
          <T style={{ fontSize: 12.5, fontWeight: '600', color: c.warn }}>
            Location is off — drop the pin manually, or tap to try GPS again.
          </T>
        </Pressable>
      )}

      <View style={{ flexDirection: 'row', gap: 9 }}>
        <CaptureBtn
          active={capture === 'gps'}
          title={located ? 'Re-center on me' : 'Use my location'}
          sub={accuracyM != null ? `accurate to ±${Math.round(accuracyM)}m` : 'phone GPS'}
          onPress={onUseGps}
        />
        <CaptureBtn
          active={capture === 'nfc'}
          title="Tap NFC tag in car"
          sub="hands-free, no app"
          onPress={onUseNfc}
        />
      </View>
    </>
  );
}

function CaptureBtn({ active, title, sub, onPress }: { active: boolean; title: string; sub: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        padding: 13,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: active ? c.accent : c.line,
        backgroundColor: active ? c.accent : c.card,
      }}
    >
      <T style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : c.dim }}>{title}</T>
      <Mono style={{ fontSize: 11, marginTop: 2, color: active ? 'rgba(255,255,255,0.75)' : c.dim }}>{sub}</Mono>
    </Pressable>
  );
}
