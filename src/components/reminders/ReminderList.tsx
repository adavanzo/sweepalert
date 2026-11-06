/**
 * Reminder stack + "add a reminder" panel, shared by a car's ReminderEditor
 * screen and Settings → Default reminders. Tapping a reminder's label opens the
 * inline TimingEditor pre-filled; "Custom…" opens it for a new reminder.
 *
 * testIDs are index-based (`${idPrefix}-row-0`, …) so a UI test can drive them
 * without knowing generated reminder ids.
 */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ADDABLE_PRESETS, ReminderPreset } from '../../services/presets';
import { DUPLICATE_MESSAGE, fromReminder, ReminderTiming } from '../../services/reminderTiming';
import { useTheme } from '../../theme/ThemeContext';
import { Channel, CleaningSchedule } from '../../types';
import { MonoLabel, T, Toggle } from '../primitives';
import { ChannelPicker } from './ChannelPicker';
import { TimingEditor, TimingSave } from './TimingEditor';

export interface ReminderItem {
  id: string;
  label: string;
  offsetMinutes: number;
  timeOfDayOverride?: string;
  channel: Channel;
  /** Omitted for default reminders (no on/off toggle). */
  enabled?: boolean;
}

const NEW_TIMING: ReminderTiming = { daysBefore: 0, mode: 'before', minutesBefore: 45 };

export const presetTestID = (label: string) => `preset-chip-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

type Result = boolean | Promise<boolean>;

export function ReminderList({
  items,
  idPrefix,
  schedule,
  nextCleaning,
  onToggle,
  onRemove,
  onChannel,
  onAdd,
  onUpdate,
  emptyText,
}: {
  items: ReminderItem[];
  /** testID prefix, e.g. "reminder" or "default-reminder". */
  idPrefix: string;
  schedule?: CleaningSchedule;
  nextCleaning?: number | null;
  onToggle?: (id: string) => void;
  onRemove: (id: string) => void;
  onChannel: (id: string, channel: Channel) => void;
  onAdd: (preset: ReminderPreset) => Result;
  onUpdate: (id: string, value: TimingSave) => Result;
  emptyText?: string;
}) {
  const { c } = useTheme();
  // 'new' = custom add, else the id of the reminder being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const addPreset = async (p: ReminderPreset) => {
    setMessage(null);
    if (!(await onAdd(p))) setMessage(DUPLICATE_MESSAGE);
  };

  return (
    <>
      {items.length === 0 && emptyText ? (
        <T testID={`${idPrefix}-empty`} style={{ fontSize: 13, color: c.dim }}>{emptyText}</T>
      ) : null}

      {items.map((r, i) => {
        if (editing === r.id) {
          return (
            <TimingEditor
              key={r.id}
              title="EDIT REMINDER"
              initial={fromReminder(r)}
              initialChannel={r.channel}
              schedule={schedule}
              nextCleaning={nextCleaning}
              onCancel={() => setEditing(null)}
              onSave={async (v) => {
                const ok = await onUpdate(r.id, v);
                if (ok) setEditing(null);
                return ok;
              }}
            />
          );
        }
        const on = r.enabled ?? true;
        return (
          <View
            key={r.id}
            testID={`${idPrefix}-row-${i}`}
            style={{ padding: 15, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.line, gap: 13 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Pressable
                onPress={() => {
                  setMessage(null);
                  setEditing(r.id);
                }}
                testID={`${idPrefix}-label-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${r.label}`}
                style={{ flex: 1, gap: 2 }}
              >
                <T style={{ fontSize: 15, fontWeight: '700', color: on ? c.ink : c.dim }}>{r.label}</T>
                <T style={{ fontSize: 11, color: c.dim }}>Tap to change time</T>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {onToggle ? (
                  <Toggle
                    on={on}
                    onPress={() => onToggle(r.id)}
                    testID={`${idPrefix}-toggle-${i}`}
                    accessibilityLabel={`${r.label} on`}
                  />
                ) : null}
                <Pressable
                  onPress={() => {
                    if (editing === r.id) setEditing(null);
                    onRemove(r.id);
                  }}
                  testID={`${idPrefix}-remove-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${r.label}`}
                  style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: c.line, backgroundColor: c.card2, alignItems: 'center', justifyContent: 'center' }}
                >
                  <T style={{ fontSize: 14, color: c.dim, marginTop: -2 }}>−</T>
                </Pressable>
              </View>
            </View>
            <ChannelPicker
              active={on ? r.channel : null}
              onChange={(ch) => onChannel(r.id, ch)}
              testIDPrefix={`${idPrefix}-channel-${i}`}
            />
          </View>
        );
      })}

      {editing === 'new' ? (
        <TimingEditor
          title="CUSTOM REMINDER"
          initial={NEW_TIMING}
          initialChannel="push"
          schedule={schedule}
          nextCleaning={nextCleaning}
          onCancel={() => setEditing(null)}
          onSave={async (v) => {
            const ok = await onAdd(v);
            if (ok) setEditing(null);
            return ok;
          }}
        />
      ) : (
        <View style={{ padding: 16, borderRadius: 22, backgroundColor: c.card2, borderWidth: 1, borderColor: c.line, borderStyle: 'dashed', gap: 11 }}>
          <MonoLabel>ADD A REMINDER</MonoLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {ADDABLE_PRESETS.map((p) => (
              <Chip key={p.label} label={`+ ${p.label}`} onPress={() => addPreset(p)} testID={presetTestID(p.label)} a11y={`Add ${p.label}`} />
            ))}
            <Chip
              label="Custom…"
              onPress={() => {
                setMessage(null);
                setEditing('new');
              }}
              testID="preset-chip-custom"
              a11y="Add a custom reminder"
              accent
            />
          </View>
          {message ? (
            <T testID={`${idPrefix}-message`} style={{ fontSize: 12.5, color: c.bad, fontWeight: '600' }}>{message}</T>
          ) : null}
        </View>
      )}
    </>
  );
}

function Chip({ label, onPress, testID, a11y, accent }: { label: string; onPress: () => void; testID: string; a11y: string; accent?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={{ paddingVertical: 10, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: accent ? c.accent : c.line, backgroundColor: accent ? c.accentT : c.card }}
    >
      <T style={{ fontSize: 12.5, fontWeight: '600', color: accent ? c.accent : c.ink }}>{label}</T>
    </Pressable>
  );
}
