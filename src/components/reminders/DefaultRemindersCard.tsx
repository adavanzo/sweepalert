/**
 * Settings → Default reminders: the stack every new car starts with, plus
 * "Apply to all cars" behind an inline confirm row (Alert.alert is a no-op on
 * web, so the confirmation lives in the card itself).
 */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { CHANNEL_LABELS } from '../../services/notificationChannels';
import { useStore } from '../../state/store';
import { useTheme } from '../../theme/ThemeContext';
import { MonoLabel, T } from '../primitives';
import { ReminderList } from './ReminderList';

const UNAVAILABLE_MESSAGE = 'Saved data is unavailable — default reminders can’t be changed right now.';

export function DefaultRemindersCard() {
  const { c } = useTheme();
  const defaults = useStore((s) => s.defaultReminders);
  const carCount = useStore((s) => s.cars.length);
  const loadError = useStore((s) => s.loadError);
  const addDefault = useStore((s) => s.addDefaultReminder);
  const updateDefault = useStore((s) => s.updateDefaultReminder);
  const removeDefault = useStore((s) => s.removeDefaultReminder);
  const setDefaultChannel = useStore((s) => s.setDefaultReminderChannel);
  const applyAll = useStore((s) => s.applyDefaultsToAllCars);

  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  const apply = async () => {
    setApplying(true);
    try {
      const ok = await applyAll();
      setStatus(
        ok
          ? { text: `Applied to ${carCount} ${carCount === 1 ? 'car' : 'cars'}.`, ok: true }
          : { text: 'Couldn’t apply while saved data is unavailable.', ok: false },
      );
    } finally {
      setApplying(false);
      setConfirming(false);
    }
  };

  return (
    <View testID="defaults-card" style={{ padding: 18, borderRadius: 22, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 13 }}>
      <MonoLabel>DEFAULT REMINDERS</MonoLabel>
      <T style={{ fontSize: 13, color: c.dim, lineHeight: 19 }}>
        Every new car starts with these. Editing them doesn’t change cars you already have — use “Apply to all cars” for that.
      </T>

      {loadError ? (
        // The store refuses every defaults write while saved state is
        // unavailable; show them read-only with the real reason rather than
        // an editable list whose taps fail as "duplicate" or do nothing.
        <>
          {defaults.map((d, i) => (
            <View
              key={d.id}
              testID={`default-reminder-row-${i}`}
              style={{ padding: 15, borderRadius: 20, backgroundColor: c.card2, borderWidth: 1, borderColor: c.line, flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}
            >
              <T style={{ fontSize: 15, fontWeight: '700', color: c.dim, flex: 1 }}>{d.label}</T>
              <T style={{ fontSize: 12, color: c.dim }}>{CHANNEL_LABELS[d.channel]}</T>
            </View>
          ))}
          <T testID="default-reminder-unavailable" style={{ fontSize: 12.5, color: c.bad, fontWeight: '600' }}>
            {UNAVAILABLE_MESSAGE}
          </T>
        </>
      ) : (
        <ReminderList
          items={defaults}
          idPrefix="default-reminder"
          onRemove={removeDefault}
          onChannel={setDefaultChannel}
          onAdd={addDefault}
          onUpdate={updateDefault}
          emptyText="No defaults — new cars will start with no reminders."
        />
      )}

      {carCount > 0 && !loadError ? (
        confirming ? (
          <View testID="defaults-apply-confirm-row" style={{ padding: 13, borderRadius: 16, backgroundColor: c.badT, gap: 10 }}>
            <T style={{ fontSize: 13, fontWeight: '600', color: c.bad }}>
              Replace the reminders on all {carCount} {carCount === 1 ? 'car' : 'cars'} with these defaults?
            </T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <SmallBtn label="Cancel" onPress={() => setConfirming(false)} testID="defaults-apply-cancel" />
              <SmallBtn label={applying ? 'Applying…' : 'Replace all'} onPress={applying ? () => undefined : apply} testID="defaults-apply-confirm" danger />
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              setStatus(null);
              setConfirming(true);
            }}
            testID="defaults-apply-all"
            accessibilityRole="button"
            accessibilityLabel="Apply default reminders to all cars"
            style={{ padding: 13, borderRadius: 16, borderWidth: 1, borderColor: c.line, backgroundColor: c.card2, alignItems: 'center' }}
          >
            <T style={{ fontSize: 13.5, fontWeight: '700' }}>Apply to all cars</T>
          </Pressable>
        )
      ) : null}
      {status ? (
        <T testID="defaults-apply-status" style={{ fontSize: 12.5, color: status.ok ? c.ok : c.bad, fontWeight: '600' }}>
          {status.text}
        </T>
      ) : null}
    </View>
  );
}

function SmallBtn({ label, onPress, testID, danger }: { label: string; onPress: () => void; testID: string; danger?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: danger ? c.bad : c.line, backgroundColor: danger ? c.bad : c.card, alignItems: 'center' }}
    >
      <T style={{ fontSize: 12.5, fontWeight: '700', color: danger ? '#fff' : c.ink }}>{label}</T>
    </Pressable>
  );
}
