/**
 * Scheduling engine.
 *
 * Pure functions over a CleaningSchedule — no React, no device APIs — so the
 * whole thing is unit-testable (see __tests__/scheduling.test.ts). All wall-clock
 * math goes through luxon in the schedule's IANA timezone so DST transitions and
 * "8:00 local means 8:00 local" hold on both sides of a clock change.
 */
import { DateTime } from 'luxon';

import { CleaningRule, CleaningSchedule, Reminder, Season } from '../types';

const SEARCH_HORIZON_DAYS = 420; // > 1 year, so a yearly season is always found

/** Ordinal occurrence (1st, 2nd, …) of this weekday within its month. */
export function ordinalInMonth(dt: DateTime): number {
  return Math.floor((dt.day - 1) / 7) + 1;
}

/** luxon weekday is 1=Mon..7=Sun; our model uses 0=Sun..6=Sat. */
function jsWeekday(dt: DateTime): number {
  return dt.weekday % 7;
}

/** Does this calendar day satisfy any of the recurrence rules? */
export function dayMatchesRules(dt: DateTime, rules: CleaningRule[]): boolean {
  const wd = jsWeekday(dt);
  const ord = ordinalInMonth(dt);
  return rules.some(
    (r) => r.weekday === wd && (r.weeksOfMonth.length === 0 || r.weeksOfMonth.includes(ord)),
  );
}

/** Is this day within the (inclusive) seasonal window? Handles wrap-around. */
export function inSeason(dt: DateTime, season: Season): boolean {
  const start = season.startMonth * 100 + season.startDay;
  const end = season.endMonth * 100 + season.endDay;
  const cur = dt.month * 100 + dt.day;
  if (start <= end) return cur >= start && cur <= end;
  // Wrapping season (e.g. Nov -> Feb): in-season if before end OR after start.
  return cur >= start || cur <= end;
}

/**
 * The next cleaning datetime strictly after `from`, or null within the horizon.
 * Scans day-by-day from `from`'s local day, taking the first in-season day that
 * matches a rule and whose window-start instant is still in the future.
 */
export function getNextCleaning(schedule: CleaningSchedule, from: Date): Date | null {
  const zone = schedule.timezone;
  const [sh, sm] = schedule.windowStart.split(':').map((n) => parseInt(n, 10));
  const fromMs = from.getTime();

  // Providers with a concrete calendar (ReCollect) carry explicit, already
  // holiday-adjusted dates — use the soonest future one directly.
  if (schedule.explicitDates && schedule.explicitDates.length) {
    let best: number | null = null;
    for (const d of schedule.explicitDates) {
      const dt = DateTime.fromISO(d, { zone }).set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const ms = dt.toMillis();
      if (ms > fromMs && (best === null || ms < best)) best = ms;
    }
    return best === null ? null : new Date(best);
  }

  const base = DateTime.fromJSDate(from, { zone }).startOf('day');

  for (let i = 0; i <= SEARCH_HORIZON_DAYS; i++) {
    const day = base.plus({ days: i });
    if (!inSeason(day, schedule.season)) continue;
    if (!dayMatchesRules(day, schedule.rules)) continue;
    const dt = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
    if (dt.toMillis() > fromMs) return dt.toJSDate();
  }
  return null;
}

/**
 * The instant a reminder should fire for a given cleaning datetime.
 *
 *  - offsetMinutes is subtracted from the cleaning instant.
 *  - if timeOfDayOverride ("HH:mm") is set, the resulting day's clock time is
 *    pinned to it (this is how "night before at 8pm" works: 1 day offset, then
 *    the clock forced to 20:00). The override is applied in the schedule's zone
 *    so it survives DST.
 */
export function computeFireTime(
  schedule: CleaningSchedule,
  cleaning: Date,
  reminder: Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'>,
): Date {
  const zone = schedule.timezone;
  let dt = DateTime.fromJSDate(cleaning, { zone }).minus({ minutes: reminder.offsetMinutes });
  if (reminder.timeOfDayOverride) {
    const [h, m] = reminder.timeOfDayOverride.split(':').map((n) => parseInt(n, 10));
    dt = dt.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  }
  return dt.toJSDate();
}

export interface FireTime {
  reminder: Reminder;
  fireAt: Date;
  /** True when the fire time is already in the past relative to `now`. */
  past: boolean;
}

/**
 * Fire times for every reminder on a car, relative to the next cleaning.
 * Disabled reminders are skipped. Callers typically schedule only `!past` ones.
 */
export function computeFireTimes(
  schedule: CleaningSchedule,
  cleaning: Date,
  reminders: Reminder[],
  now: Date = new Date(),
): FireTime[] {
  const nowMs = now.getTime();
  return reminders
    .filter((r) => r.enabled)
    .map((reminder) => {
      const fireAt = computeFireTime(schedule, cleaning, reminder);
      return { reminder, fireAt, past: fireAt.getTime() <= nowMs };
    });
}
