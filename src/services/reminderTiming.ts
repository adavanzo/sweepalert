/**
 * Editor model for a reminder's timing, and its mapping onto the two fields the
 * scheduling engine reads (Reminder.offsetMinutes + timeOfDayOverride, see
 * computeFireTime in scheduling.ts). Pure, so it is unit-tested in
 * __tests__/reminderTiming.test.ts.
 *
 *  - mode 'before': fire `daysBefore` calendar days + `minutesBefore` before
 *    the sweep starts ("1 day, 2 hours before").
 *      offsetMinutes = daysBefore * 1440 + minutesBefore, no override.
 *  - mode 'at': fire at a wall-clock time `daysBefore` days before the sweep
 *    day ("Night before at 8pm", "2 days before at 7pm").
 *      offsetMinutes = daysBefore * 1440, timeOfDayOverride = clock.
 *
 * Same-day clock times (mode 'at', daysBefore 0): valid only when the clock is
 * before the sweep's windowStart. With a known schedule validate() rejects a
 * clock at/after it. Without one (global defaults, or a car with no schedule
 * yet) it is allowed, warningFor() explains the caveat, and the planner
 * (planCarNotifications) skips any fire time that would land after the sweep
 * started, so a car parked on an earlier block never gets a late alert.
 */
import { DateTime } from 'luxon';

import { CleaningSchedule, Reminder } from '../types';

export type TimingMode = 'before' | 'at';

export interface ReminderTiming {
  /** Calendar days before the sweep day, 0–7. */
  daysBefore: number;
  mode: TimingMode;
  /** mode 'before': extra minutes before the sweep start, 0–1435 in 5-min steps. */
  minutesBefore?: number;
  /** mode 'at': wall-clock "HH:mm" in 5-min steps. */
  clock?: string;
}

export const MAX_DAYS_BEFORE = 7;
export const STEP_MINUTES = 5;
/** 23h55: the largest minutesBefore (a full day is a daysBefore step). */
export const MAX_MINUTES_BEFORE = 24 * 60 - STEP_MINUTES;

const DAY = 24 * 60;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseClock(clock: string | undefined): number | null {
  const m = clock ? CLOCK_RE.exec(clock) : null;
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

export function formatClock(minutesOfDay: number): string {
  const v = ((minutesOfDay % DAY) + DAY) % DAY;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** Engine fields for a timing. */
export function toReminderFields(t: ReminderTiming): Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'> {
  if (t.mode === 'at') {
    return { offsetMinutes: t.daysBefore * DAY, timeOfDayOverride: t.clock ?? '20:00' };
  }
  return { offsetMinutes: t.daysBefore * DAY + (t.minutesBefore ?? 0), timeOfDayOverride: undefined };
}

/**
 * Timing for an existing reminder (or preset). Round-trips everything
 * toReminderFields produces. A legacy override with a non-whole-day offset
 * (never produced by the app) keeps its whole days.
 */
export function fromReminder(r: Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'>): ReminderTiming {
  const offset = Math.max(0, Math.round(r.offsetMinutes));
  const daysBefore = Math.floor(offset / DAY);
  if (r.timeOfDayOverride) return { daysBefore, mode: 'at', clock: r.timeOfDayOverride };
  return { daysBefore, mode: 'before', minutesBefore: offset - daysBefore * DAY };
}

/** "8pm", "7:30am", "12pm" (noon), "12am" (midnight). */
export function clockLabel(clock: string): string {
  const v = parseClock(clock);
  if (v == null) return clock;
  const h = Math.floor(v / 60);
  const m = v % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

function daysPart(d: number): string {
  return d === 1 ? '1 day' : `${d} days`;
}

/** "30 min", "1 hour", "2 hours", "1 hr 30 min". */
function durationPart(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h} hr ${m} min`;
}

/** Short, natural label; matches the preset labels where they coincide. */
export function labelFor(t: ReminderTiming): string {
  if (t.mode === 'at') {
    const time = clockLabel(t.clock ?? '20:00');
    const v = parseClock(t.clock) ?? 0;
    if (t.daysBefore === 0) return `Day of at ${time}`;
    if (t.daysBefore === 1) return v >= 17 * 60 ? `Night before at ${time}` : `Day before at ${time}`;
    return `${t.daysBefore} days before at ${time}`;
  }
  const min = t.minutesBefore ?? 0;
  if (t.daysBefore === 0) return min === 0 ? 'At sweep start' : `${durationPart(min)} before`;
  if (min === 0) return `${daysPart(t.daysBefore)} before`;
  return `${daysPart(t.daysBefore)}, ${durationPart(min)} before`;
}

/** Error message for an invalid timing, else null. */
export function validate(t: ReminderTiming, schedule?: Pick<CleaningSchedule, 'windowStart'>): string | null {
  if (!Number.isInteger(t.daysBefore) || t.daysBefore < 0) return 'Days before can’t be negative.';
  if (t.daysBefore > MAX_DAYS_BEFORE) return `At most ${MAX_DAYS_BEFORE} days before.`;
  if (t.mode === 'before') {
    const m = t.minutesBefore ?? 0;
    if (!Number.isInteger(m) || m < 0) return 'Time before can’t be negative.';
    if (m > MAX_MINUTES_BEFORE) return 'Use days for 24 hours or more.';
    if (m % STEP_MINUTES !== 0) return `Use ${STEP_MINUTES}-minute steps.`;
    return null;
  }
  if (t.mode !== 'at') return 'Choose “Before sweep” or “At a time”.';
  const clock = parseClock(t.clock);
  if (clock == null) return 'Pick a valid time.';
  if (clock % STEP_MINUTES !== 0) return `Use ${STEP_MINUTES}-minute steps.`;
  if (t.daysBefore === 0 && schedule) {
    const start = parseClock(schedule.windowStart);
    if (start != null && clock >= start) {
      return `Sweeping starts at ${clockLabel(schedule.windowStart)}. Pick an earlier time or the day before.`;
    }
  }
  return null;
}

/** Non-blocking caveat (a same-day time with no schedule to check against). */
export function warningFor(t: ReminderTiming, schedule?: Pick<CleaningSchedule, 'windowStart'>): string | null {
  if (t.mode === 'at' && t.daysBefore === 0 && !schedule) {
    return 'Same-day times only fire when they’re before the sweep starts.';
  }
  return null;
}

/** Same engine timing (ignores label/channel): used to prevent duplicates. */
export function sameTiming(
  a: Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'>,
  b: Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'>,
): boolean {
  return a.offsetMinutes === b.offsetMinutes && (a.timeOfDayOverride || undefined) === (b.timeOfDayOverride || undefined);
}

export const DUPLICATE_MESSAGE = 'You already have a reminder at that time.';

/**
 * "Fires Wed 7:00 PM for the Thu 8:00 AM sweep", for the car's next cleaning
 * (epoch ms) in the schedule's zone. Null when there is nothing to preview.
 *
 * Mirrors planCarNotifications: a fire time at/before `now` is never
 * scheduled, so when the next sweep's alert has already gone by the line says
 * so and names the first fire time that will happen, taken from
 * `laterCleanings` (the following sweeps, soonest first).
 */
export function previewLine(
  t: ReminderTiming,
  schedule: Pick<CleaningSchedule, 'timezone'> | undefined,
  nextCleaning: number | null | undefined,
  fireTime: (cleaning: Date, fields: Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'>) => Date,
  now: Date = new Date(),
  laterCleanings: Date[] = [],
): string | null {
  if (!schedule || nextCleaning == null) return null;
  const fields = toReminderFields(t);
  const cleaning = new Date(nextCleaning);
  const fire = fireTime(cleaning, fields);
  const zone = schedule.timezone;
  const fmt = (d: Date, f = 'ccc h:mm a') => DateTime.fromJSDate(d, { zone }).toFormat(f);
  const c = fmt(cleaning);
  if (fire.getTime() > cleaning.getTime()) return `After the ${c} sweep starts — won’t fire`;
  if (fire.getTime() > now.getTime()) return `Fires ${fmt(fire)} for the ${c} sweep`;
  for (const later of laterCleanings) {
    if (later.getTime() <= cleaning.getTime()) continue;
    const f = fireTime(later, fields);
    if (f.getTime() > now.getTime() && f.getTime() <= later.getTime()) {
      return `Too late for the ${c} sweep — first fires ${fmt(f, 'ccc LLL d h:mm a')}`;
    }
  }
  return `Too late for the ${c} sweep`;
}
