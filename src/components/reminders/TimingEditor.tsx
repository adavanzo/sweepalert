/**
 * Inline editor card for a reminder's timing (custom add, or editing an
 * existing reminder). Steppers only — no picker/modal library — so it works in
 * Expo Go and on web. The model and its mapping live in services/reminderTiming.ts.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  DUPLICATE_MESSAGE,
  formatClock,
  labelFor,
  MAX_DAYS_BEFORE,
  parseClock,
  previewLine,
  ReminderTiming,
  STEP_MINUTES,
  TimingMode,
  toReminderFields,
  validate,
  warningFor,
} from '../../services/reminderTiming';
import { CLEANINGS_AHEAD, computeFireTime, getUpcomingCleanings } from '../../services/scheduling';
import { useTheme } from '../../theme/ThemeContext';
import { Channel, CleaningSchedule } from '../../types';
import { Button } from '../Button';
import { Mono, MonoLabel, T } from '../primitives';
import { ChannelPicker } from './ChannelPicker';

export interface TimingSave {
  label: string;
  offsetMinutes: number;
  timeOfDayOverride?: string;
  channel: Channel;
}

const DAY = 24 * 60;
const wrap = (v: number, n: number) => ((v % n) + n) % n;

export function TimingEditor({
  title,
  initial,
  initialChannel,
  schedule,
  nextCleaning,
  onSave,
  onCancel,
}: {
  title: string;
  initial: ReminderTiming;
  initialChannel: Channel;
  /** The car's schedule, when known (validation + preview). */
  schedule?: CleaningSchedule;
  nextCleaning?: number | null;
  /** Resolve false when the store refused it (duplicate timing). */
  onSave: (value: TimingSave) => boolean | Promise<boolean>;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const [days, setDays] = useState(initial.daysBefore);
  const [mode, setMode] = useState<TimingMode>(initial.mode);
  // Both values are kept so flipping the mode back and forth doesn't lose them.
  const [before, setBefore] = useState(initial.minutesBefore ?? 60);
  const [clock, setClock] = useState(parseClock(initial.clock) ?? 20 * 60);
  const [channel, setChannel] = useState<Channel>(initialChannel);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const timing: ReminderTiming =
    mode === 'at' ? { daysBefore: days, mode, clock: formatClock(clock) } : { daysBefore: days, mode, minutesBefore: before };
  const label = labelFor(timing);
  const error = validate(timing, schedule);
  const warning = error ? null : warningFor(timing, schedule);
  // The sweeps after the next one, so a too-late preview can name the first
  // alert that will really fire (the planner looks CLEANINGS_AHEAD ahead).
  const laterCleanings = useMemo(
    () => (schedule && nextCleaning != null ? getUpcomingCleanings(schedule, new Date(nextCleaning), CLEANINGS_AHEAD - 1) : []),
    [schedule, nextCleaning],
  );
  const preview = error
    ? null
    : previewLine(timing, schedule, nextCleaning, (cleaning, f) => computeFireTime(schedule!, cleaning, f), new Date(), laterCleanings);

  const edit = (fn: () => void) => {
    setSaveError(null);
    fn();
  };

  const save = async () => {
    if (error || saving) return;
    setSaving(true);
    try {
      const ok = await onSave({ label, ...toReminderFields(timing), channel });
      if (!ok) setSaveError(DUPLICATE_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  const bh = Math.floor(before / 60);
  const bm = before % 60;
  const cm = clock % 60;
  // 12-hour display to match the labels ("7pm"); stored value stays "HH:mm".
  const h24 = Math.floor(clock / 60);
  const clock12 = `${((h24 + 11) % 12) + 1}:${String(cm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;

  return (
    <View
      testID="timing-editor"
      style={{ padding: 15, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.accent, gap: 13 }}
    >
      <View style={{ gap: 3 }}>
        <MonoLabel>{title}</MonoLabel>
        <T testID="timing-label" style={{ fontSize: 17, fontWeight: '800', letterSpacing: -0.3 }}>{label}</T>
      </View>

      <StepRow
        title="Days before"
        value={days === 0 ? 'Same day' : days === 1 ? '1 day' : `${days} days`}
        idPrefix="timing-days"
        onMinus={() => edit(() => setDays((d) => Math.max(0, d - 1)))}
        onPlus={() => edit(() => setDays((d) => Math.min(MAX_DAYS_BEFORE, d + 1)))}
        minusDisabled={days <= 0}
        plusDisabled={days >= MAX_DAYS_BEFORE}
      />

      <View style={{ flexDirection: 'row', gap: 7 }}>
        <ModeBtn label="Before sweep" active={mode === 'before'} onPress={() => edit(() => setMode('before'))} testID="timing-mode-before" />
        <ModeBtn label="At a time" active={mode === 'at'} onPress={() => edit(() => setMode('at'))} testID="timing-mode-at" />
      </View>

      {mode === 'before' ? (
        <>
          <StepRow
            title="Hours before"
            value={`${bh} h`}
            idPrefix="timing-hours"
            onMinus={() => edit(() => setBefore((v) => wrap(Math.floor(v / 60) - 1, 24) * 60 + (v % 60)))}
            onPlus={() => edit(() => setBefore((v) => wrap(Math.floor(v / 60) + 1, 24) * 60 + (v % 60)))}
          />
          <StepRow
            title="Minutes before"
            value={`${String(bm).padStart(2, '0')} min`}
            idPrefix="timing-minutes"
            onMinus={() => edit(() => setBefore((v) => Math.floor(v / 60) * 60 + wrap((v % 60) - STEP_MINUTES, 60)))}
            onPlus={() => edit(() => setBefore((v) => Math.floor(v / 60) * 60 + wrap((v % 60) + STEP_MINUTES, 60)))}
          />
        </>
      ) : (
        <>
          <StepRow
            title="Hour"
            value={clock12}
            idPrefix="timing-hour"
            onMinus={() => edit(() => setClock((v) => wrap(v - 60, DAY)))}
            onPlus={() => edit(() => setClock((v) => wrap(v + 60, DAY)))}
          />
          <StepRow
            title="Minute"
            value={`:${String(cm).padStart(2, '0')}`}
            idPrefix="timing-minute"
            onMinus={() => edit(() => setClock((v) => Math.floor(v / 60) * 60 + wrap((v % 60) - STEP_MINUTES, 60)))}
            onPlus={() => edit(() => setClock((v) => Math.floor(v / 60) * 60 + wrap((v % 60) + STEP_MINUTES, 60)))}
          />
        </>
      )}

      <ChannelPicker active={channel} onChange={(v) => edit(() => setChannel(v))} testIDPrefix="timing-channel" />

      {preview ? (
        <Mono testID="timing-preview" style={{ fontSize: 12, color: c.dim }}>{preview}</Mono>
      ) : null}
      {error ? (
        <T testID="timing-error" style={{ fontSize: 12.5, color: c.bad, fontWeight: '600' }}>{error}</T>
      ) : null}
      {warning ? (
        <T testID="timing-warning" style={{ fontSize: 12, color: c.warn }}>{warning}</T>
      ) : null}
      {saveError ? (
        <T testID="timing-save-error" style={{ fontSize: 12.5, color: c.bad, fontWeight: '600' }}>{saveError}</T>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title="Cancel"
          variant="ghost"
          onPress={onCancel}
          testID="timing-cancel"
          accessibilityLabel="Cancel editing reminder"
          style={{ flex: 1, paddingVertical: 12 }}
          textStyle={{ fontSize: 14 }}
        />
        <Button
          title={saving ? 'Saving…' : 'Save'}
          onPress={save}
          testID="timing-save"
          accessibilityLabel="Save reminder"
          style={{ flex: 1, paddingVertical: 12, opacity: error ? 0.45 : 1 }}
          textStyle={{ fontSize: 14 }}
        />
      </View>
    </View>
  );
}

function StepRow({
  title,
  value,
  idPrefix,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  title: string;
  value: string;
  idPrefix: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <T style={{ fontSize: 13.5, fontWeight: '600', flex: 1 }}>{title}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <StepBtn glyph="−" onPress={onMinus} disabled={minusDisabled} testID={`${idPrefix}-minus`} label={`${title} decrease`} />
        <Mono testID={`${idPrefix}-value`} style={{ fontSize: 14, color: c.ink, minWidth: 72, textAlign: 'center' }}>{value}</Mono>
        <StepBtn glyph="+" onPress={onPlus} disabled={plusDisabled} testID={`${idPrefix}-plus`} label={`${title} increase`} />
      </View>
    </View>
  );
}

function StepBtn({ glyph, onPress, disabled, testID, label }: { glyph: string; onPress: () => void; disabled?: boolean; testID: string; label: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: c.line, backgroundColor: c.card2, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <T style={{ fontSize: 17, fontWeight: '600', color: c.ink, marginTop: -2 }}>{glyph}</T>
    </Pressable>
  );
}

function ModeBtn({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{ flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: active ? c.ink : c.line, backgroundColor: active ? c.ink : c.card2, alignItems: 'center' }}
    >
      <T style={{ fontSize: 12, fontWeight: '700', color: active ? c.bg : c.dim }}>{label}</T>
    </Pressable>
  );
}
