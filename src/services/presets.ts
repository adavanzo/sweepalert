import { Channel } from '../types';

/** A reminder preset: label + how it maps onto the scheduling engine. */
export interface ReminderPreset {
  label: string;
  offsetMinutes: number;
  timeOfDayOverride?: string;
  channel: Channel;
}

/**
 * Presets surfaced in the UI. The first three are the seeded defaults on the
 * demo cars; the rest populate the "add a reminder" chips in the editor. These
 * mirror the labels in the SweepAlert design.
 */
export const REMINDER_PRESETS: ReminderPreset[] = [
  { label: 'Night before at 8pm', offsetMinutes: 24 * 60, timeOfDayOverride: '20:00', channel: 'push' },
  { label: '1 day before', offsetMinutes: 24 * 60, channel: 'push' },
  { label: '3 hours before', offsetMinutes: 3 * 60, channel: 'push' },
  { label: '2 hours before', offsetMinutes: 2 * 60, channel: 'push' },
  { label: '1 hour before', offsetMinutes: 60, channel: 'alarm' },
  { label: '30 min before', offsetMinutes: 30, channel: 'alarm' },
  { label: '15 min before', offsetMinutes: 15, channel: 'push' },
  { label: 'At sweep start', offsetMinutes: 0, channel: 'alarm' },
];

/** The chips shown in the reminder editor's "add a reminder" section. */
export const ADDABLE_PRESETS = REMINDER_PRESETS.filter((p) =>
  ['1 day before', '3 hours before', '1 hour before', '15 min before', 'At sweep start'].includes(
    p.label,
  ),
);

/** A global default reminder (Settings): a preset with a stable id for editing. */
export interface DefaultReminder extends ReminderPreset {
  id: string;
}

/** What new installs (and pre-v5 installs, via migration) start with. */
export function initialDefaultReminders(): DefaultReminder[] {
  return [{ id: 'def_night_before', label: 'Night before at 8pm', offsetMinutes: 24 * 60, timeOfDayOverride: '20:00', channel: 'push' }];
}

export function presetByLabel(label: string): ReminderPreset | undefined {
  return REMINDER_PRESETS.find((p) => p.label === label);
}
