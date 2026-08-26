/**
 * Presentation helpers shared by the screens. Mirrors the design's fmt() /
 * statusOf() / decorate() so the UI reads the same way as the prototype, but
 * driven by the real scheduling engine instead of static seed data.
 */
import { DateTime } from 'luxon';

import { Car } from '../types';
import { Palette } from '../theme/tokens';
import { getNextCleaning } from './scheduling';

const H = 3600_000;

/** Compact countdown string: "2d 4h", "5h 12m", or "18m 07s". */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'moving now';
  const d = Math.floor(ms / 86400_000);
  const h = Math.floor((ms % 86400_000) / H);
  const m = Math.floor((ms % H) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export type StatusKey = 'now' | 'soon' | 'safe';

export interface StatusStyle {
  key: StatusKey;
  label: string;
  color: string; // solid accent color from palette
  tint: string; // soft tint background
}

/** Threshold logic identical to the design: <2h move now, <30h soon, else safe. */
export function statusOf(ms: number, c: Palette): StatusStyle {
  if (ms < 2 * H) return { key: 'now', label: 'Move now', color: c.bad, tint: c.badT };
  if (ms < 30 * H) return { key: 'soon', label: 'Move soon', color: c.warn, tint: c.warnT };
  return { key: 'safe', label: 'Safe', color: c.ok, tint: c.okT };
}

export interface CarView {
  car: Car;
  msLeft: number;
  status: StatusStyle;
  /** "112 Beacon St · Beacon Hill" */
  spot: string;
  /** "NEXT SWEEP THU, AUG 13 8:00AM" */
  nextLabel: string;
  countdown: string;
  activeReminderCount: number;
  hasSchedule: boolean;
}

/** Build a view-model for a car relative to `now`. */
export function decorateCar(car: Car, now: number, c: Palette): CarView {
  const hasSchedule = !!car.schedule && car.nextCleaning != null;
  const msLeft = car.nextCleaning != null ? car.nextCleaning - now : Number.POSITIVE_INFINITY;
  // Parked outside coverage (location but no schedule) is a neutral state, not
  // "Safe" — don't imply a green all-clear when we simply have no data.
  const status: StatusStyle = hasSchedule
    ? statusOf(msLeft, c)
    : { key: 'safe', label: car.location ? 'No schedule' : 'Not parked', color: c.dim, tint: c.card2 };
  const zone = car.schedule?.timezone ?? 'America/New_York';

  let nextLabel = 'NOT PARKED';
  if (hasSchedule && car.nextCleaning != null) {
    const dt = DateTime.fromMillis(car.nextCleaning, { zone });
    const day = dt.toFormat('ccc, LLL d').toUpperCase();
    const time = dt.toFormat('h:mma').toLowerCase();
    nextLabel = `NEXT SWEEP ${day} ${time}`;
  } else if (car.schedule) {
    nextLabel = 'OFF-SEASON · NO SWEEP SCHEDULED';
  } else if (car.location) {
    nextLabel = 'OUTSIDE COVERAGE · NO SCHEDULE';
  }

  const region = car.schedule?.blockLabel.split(' · ')[0] ?? '';
  const spot = car.location
    ? [car.location.address, region].filter(Boolean).join(' · ')
    : 'No parking spot saved';

  return {
    car,
    msLeft,
    status,
    spot,
    nextLabel,
    countdown: hasSchedule ? formatCountdown(msLeft) : '—',
    activeReminderCount: car.reminders.filter((r) => r.enabled).length,
    hasSchedule,
  };
}

/** Upcoming sweep rows for the detail screen, from the schedule's rules. */
export function upcomingSweeps(car: Car, count = 4): { date: string; window: string }[] {
  if (!car.schedule) return [];
  const zone = car.schedule.timezone;
  const [eh, em] = car.schedule.windowEnd.split(':').map((n) => parseInt(n, 10));
  const out: { date: string; window: string }[] = [];
  // Walk forward using the engine repeatedly.
  let from = new Date();
  for (let i = 0; i < count; i++) {
    const next = getNextCleaning(car.schedule, from);
    if (!next) break;
    const start = DateTime.fromJSDate(next, { zone });
    const end = start.set({ hour: eh, minute: em });
    out.push({
      date: start.toFormat('ccc, LLL d'),
      window: `${start.toFormat('h:mma').toLowerCase()} – ${end.toFormat('h:mma').toLowerCase()}`,
    });
    from = new Date(next.getTime() + 60_000); // step just past this one
  }
  return out;
}
