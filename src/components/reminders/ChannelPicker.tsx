import React from 'react';
import { Pressable, View } from 'react-native';

import { CHANNEL_LABELS, URGENT_HELP } from '../../services/notificationChannels';
import { useTheme } from '../../theme/ThemeContext';
import { Channel } from '../../types';
import { T } from '../primitives';

/**
 * Push / Urgent pair. `active` is the selected channel, or null when the
 * reminder is off (neither lights up). Shows what Urgent really does under the
 * buttons whenever it is selected.
 */
export function ChannelPicker({
  active,
  onChange,
  testIDPrefix,
}: {
  active: Channel | null;
  onChange: (channel: Channel) => void;
  testIDPrefix: string;
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 7 }}>
      <View style={{ flexDirection: 'row', gap: 7 }}>
        <ChannelBtn kind="push" active={active === 'push'} onPress={() => onChange('push')} testID={`${testIDPrefix}-push`} />
        <ChannelBtn kind="alarm" active={active === 'alarm'} onPress={() => onChange('alarm')} testID={`${testIDPrefix}-urgent`} />
      </View>
      {active === 'alarm' ? (
        <T testID={`${testIDPrefix}-urgent-help`} style={{ fontSize: 11, color: c.dim, lineHeight: 15 }}>
          {URGENT_HELP}
        </T>
      ) : null}
    </View>
  );
}

function ChannelBtn({ kind, active, onPress, testID }: { kind: Channel; active: boolean; onPress: () => void; testID: string }) {
  const { c } = useTheme();
  const on = kind === 'push'
    ? { bg: c.accentT, ink: c.accent, border: c.accent }
    : { bg: c.badT, ink: c.bad, border: c.bad };
  const off = { bg: c.card2, ink: c.dim, border: c.line };
  const s = active ? on : off;
  const label = CHANNEL_LABELS[kind];
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label} channel`}
      accessibilityState={{ selected: active }}
      style={{ flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: s.border, backgroundColor: s.bg, alignItems: 'center' }}
    >
      <T style={{ fontSize: 12, fontWeight: '600', color: s.ink }}>{label}</T>
    </Pressable>
  );
}
