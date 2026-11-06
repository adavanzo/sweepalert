/**
 * Scheduling engine.
 *
 * Pure functions over a CleaningSchedule — no React, no device APIs — so the
 * whole thing is unit-testable (see __tests__/scheduling.test.ts). All wall-clock
 * math goes through luxon in the schedule's IANA timezone so DST transitions and
 * "8:00 local means 8:00 local" hold on both sides of a clock change.
 */
import { DateTime } from 'luxon';

import { Car, CleaningRule, CleaningSchedule, Reminder, Season } from '../types';

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
 *  - offsetMinutes is subtracted from the cleaning instant. Whole days
 *    (offsetMinutes / 1440) are subtracted as calendar days in the schedule's
 *    zone and the remainder as elapsed minutes, so "1 day before" an 8:00 sweep
 *    is 8:00 the previous day even across a DST change (not 7:00 or 9:00).
 *  - if timeOfDayOverride ("HH:mm") is set, the resulting day's clock time is
 *    pinned to it (this is how "night before at 8pm" works: 1 day offset, then
 *    the clock forced to 20:00). The override is applied in the schedule's zone
 *    so it survives DST.
 *
 * See services/reminderTiming.ts for the editor's model of these two fields.
 */
export function computeFireTime(
  schedule: CleaningSchedule,
  cleaning: Date,
  reminder: Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'>,
): Date {
  const zone = schedule.timezone;
  const days = Math.floor(reminder.offsetMinutes / 1440);
  const minutes = reminder.offsetMinutes - days * 1440;
  let dt = DateTime.fromJSDate(cleaning, { zone }).minus({ days }).minus({ minutes });
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
 * Fire times for every reminder on a car, relative to one cleaning.
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

/**
 * The next `count` cleanings strictly after `from`, soonest first. Works for
 * both rules-based and explicitDates schedules by stepping getNextCleaning
 * forward from each result (so season wrap-around rolls into next April).
 */
export function getUpcomingCleanings(schedule: CleaningSchedule, from: Date, count: number): Date[] {
  const out: Date[] = [];
  let cursor = from;
  while (out.length < count) {
    const next = getNextCleaning(schedule, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/**
 * How many upcoming cleanings each car's reminders are scheduled for. Pre-
 * scheduling a few sweeps means alerts keep firing even if the user never
 * reopens the app (each launch/refresh rolls the window forward again).
 */
export const CLEANINGS_AHEAD = 3;

/** iOS keeps only the 64 soonest pending local notifications per app. */
export const IOS_PENDING_LIMIT = 64;

/**
 * Upper bound on pending OS notifications per car. iOS silently drops anything
 * past IOS_PENDING_LIMIT, so we keep the soonest few per car rather than let a
 * single car with many reminders crowd out the others. With more than 4 cars
 * the effective cap shrinks further (see perCarCap).
 */
export const MAX_PER_CAR = 16;

/**
 * Most cars the app tracks. perCarCap floors at 1 alert per car, so past 64
 * cars the total would exceed IOS_PENDING_LIMIT; 16 keeps every car at >= 4
 * alerts (64 / 16) — enough for the next couple of sweeps. The store's addCar
 * refuses beyond this.
 */
export const MAX_CARS = 16;

/**
 * Per-car notification budget for `carCount` cars: an even share of the iOS
 * limit, at most MAX_PER_CAR, and at least 1 (so every car keeps its soonest
 * alert; with MAX_CARS enforced the share never drops below 4).
 */
export function perCarCap(carCount: number): number {
  return Math.max(1, Math.min(MAX_PER_CAR, Math.floor(IOS_PENDING_LIMIT / Math.max(1, carCount))));
}

export interface PlannedNotification {
  reminder: Reminder;
  /** The cleaning this notification warns about. */
  cleaning: Date;
  fireAt: Date;
}

/**
 * Pure notification plan for a car: which (reminder, cleaning, fireAt) triples
 * to schedule. Covers the next CLEANINGS_AHEAD cleanings, skips disabled
 * reminders and fire times at/before `now`, dedupes identical fireAt per
 * reminder, and keeps the soonest `maxPerCar`. Sorted soonest first.
 */
export function planCarNotifications(
  car: Pick<Car, 'schedule' | 'reminders'>,
  now: Date = new Date(),
  cleaningsAhead: number = CLEANINGS_AHEAD,
  maxPerCar: number = MAX_PER_CAR,
): PlannedNotification[] {
  const schedule = car.schedule;
  if (!schedule) return [];
  const plan: PlannedNotification[] = [];
  for (const cleaning of getUpcomingCleanings(schedule, now, cleaningsAhead)) {
    for (const f of computeFireTimes(schedule, cleaning, car.reminders, now)) {
      // A same-day clock override at/after the sweep start (e.g. "day of at
      // 9am" for an 8am sweep, possible after a re-park to a block with an
      // earlier window) would warn after the fact: skip it.
      if (f.fireAt.getTime() > cleaning.getTime()) continue;
      if (!f.past) plan.push({ reminder: f.reminder, cleaning, fireAt: f.fireAt });
    }
  }
  return finalizePlan(plan, maxPerCar);
}

/**
 * Dedupe identical (reminder, fireAt) pairs (keeping the first), sort soonest
 * first, and keep the soonest `max`. Exported for tests.
 */
export function finalizePlan(plan: PlannedNotification[], max: number): PlannedNotification[] {
  const seen = new Set<string>();
  const out = plan.filter((p) => {
    const key = `${p.reminder.id}@${p.fireAt.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return out.slice(0, max);
}
