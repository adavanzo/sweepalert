import { DateTime } from 'luxon';

import {
  finalizePlan,
  getUpcomingCleanings,
  IOS_PENDING_LIMIT,
  MAX_PER_CAR,
  perCarCap,
  planCarNotifications,
} from '../src/services/scheduling';
import { CleaningSchedule, Reminder } from '../src/types';

const TZ = 'America/New_York';

function schedule(overrides: Partial<CleaningSchedule> = {}): CleaningSchedule {
  return {
    blockId: 'test',
    rules: [{ weekday: 4, weeksOfMonth: [] }], // every Thursday
    windowStart: '08:00',
    windowEnd: '12:00',
    side: 'even',
    season: { startMonth: 4, startDay: 1, endMonth: 11, endDay: 30 },
    timezone: TZ,
    address: '112 Beacon St',
    blockLabel: 'Beacon Hill',
    scheduleLabel: 'Every Thursday, 8am–12pm',
    seasonLabel: 'APR 1 – NOV 30',
    ...overrides,
  };
}

function reminder(id: string, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id,
    carId: 'car1',
    label: id,
    offsetMinutes: 60,
    channel: 'push',
    enabled: true,
    ...overrides,
  };
}

const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const iso = (d: Date) => DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-MM-dd'T'HH:mm");

describe('getUpcomingCleanings', () => {
  it('returns the next N rule-based cleanings strictly after `from`', () => {
    // Thu 2026-08-13 at 08:00 exactly -> excluded (strictly after).
    const got = getUpcomingCleanings(schedule(), at('2026-08-13T08:00'), 3).map(iso);
    expect(got).toEqual(['2026-08-20T08:00', '2026-08-27T08:00', '2026-09-03T08:00']);
  });

  it('rolls across the season end into next April', () => {
    // Last in-season Thursday of 2026 is Nov 26; next season starts Apr 1 2027.
    const got = getUpcomingCleanings(schedule(), at('2026-11-20T12:00'), 3).map(iso);
    expect(got).toEqual(['2026-11-26T08:00', '2027-04-01T08:00', '2027-04-08T08:00']);
  });

  it('walks an explicitDates schedule in order and stops when exhausted', () => {
    const s = schedule({ explicitDates: ['2026-09-15', '2026-08-18', '2026-10-20', '2026-07-01'] });
    expect(getUpcomingCleanings(s, at('2026-08-01T00:00'), 5).map(iso)).toEqual([
      '2026-08-18T08:00',
      '2026-09-15T08:00',
      '2026-10-20T08:00',
    ]);
    expect(getUpcomingCleanings(s, at('2026-08-01T00:00'), 2)).toHaveLength(2);
  });

  it('returns [] for count 0', () => {
    expect(getUpcomingCleanings(schedule(), at('2026-08-01T00:00'), 0)).toEqual([]);
  });
});

describe('planCarNotifications', () => {
  const now = at('2026-08-12T12:00'); // Wed; next cleaning Thu 08-13 08:00

  it('plans one fire time per reminder for each of the next cleanings, soonest first', () => {
    const car = {
      schedule: schedule(),
      reminders: [
        reminder('nightBefore', { offsetMinutes: 24 * 60, timeOfDayOverride: '20:00' }),
        reminder('hourBefore', { offsetMinutes: 60 }),
      ],
    };
    const plan = planCarNotifications(car, now);
    expect(plan.map((p) => `${p.reminder.id} ${iso(p.fireAt)} for ${iso(p.cleaning)}`)).toEqual([
      'nightBefore 2026-08-12T20:00 for 2026-08-13T08:00',
      'hourBefore 2026-08-13T07:00 for 2026-08-13T08:00',
      'nightBefore 2026-08-19T20:00 for 2026-08-20T08:00',
      'hourBefore 2026-08-20T07:00 for 2026-08-20T08:00',
      'nightBefore 2026-08-26T20:00 for 2026-08-27T08:00',
      'hourBefore 2026-08-27T07:00 for 2026-08-27T08:00',
    ]);
  });

  it('skips fire times already in the past', () => {
    // 21:00 Wed: tonight's 20:00 "night before" for Thursday has passed.
    const car = {
      schedule: schedule(),
      reminders: [reminder('nightBefore', { offsetMinutes: 24 * 60, timeOfDayOverride: '20:00' })],
    };
    const plan = planCarNotifications(car, at('2026-08-12T21:00'));
    expect(plan.map((p) => iso(p.fireAt))).toEqual(['2026-08-19T20:00', '2026-08-26T20:00']);
  });

  it('skips disabled reminders', () => {
    const car = {
      schedule: schedule(),
      reminders: [reminder('on'), reminder('off', { enabled: false })],
    };
    const plan = planCarNotifications(car, now);
    expect(plan).toHaveLength(3);
    expect(plan.every((p) => p.reminder.id === 'on')).toBe(true);
  });

  it('finalizePlan dedupes identical fire times per reminder and sorts soonest first', () => {
    // getUpcomingCleanings never yields duplicate cleanings, so exercise the
    // dedupe step directly with colliding (reminder, fireAt) inputs.
    const r = reminder('r');
    const other = reminder('other');
    const c1 = at('2026-08-20T08:00');
    const c2 = at('2026-08-27T08:00');
    const t = at('2026-08-19T20:00');
    const plan = finalizePlan(
      [
        { reminder: r, cleaning: c2, fireAt: at('2026-08-26T20:00') },
        { reminder: r, cleaning: c1, fireAt: t },
        { reminder: r, cleaning: c2, fireAt: t }, // same reminder + fireAt -> dropped
        { reminder: other, cleaning: c1, fireAt: t }, // different reminder -> kept
      ],
      10,
    );
    expect(plan.map((p) => `${p.reminder.id} ${iso(p.fireAt)} ${iso(p.cleaning)}`)).toEqual([
      'r 2026-08-19T20:00 2026-08-20T08:00',
      'other 2026-08-19T20:00 2026-08-20T08:00',
      'r 2026-08-26T20:00 2026-08-27T08:00',
    ]);
  });

  it('caps the plan per car, keeping the soonest', () => {
    const reminders = Array.from({ length: 10 }, (_, i) => reminder(`r${i}`, { offsetMinutes: 10 * (i + 1) }));
    const car = { schedule: schedule(), reminders };
    const plan = planCarNotifications(car, now);
    expect(plan).toHaveLength(MAX_PER_CAR); // 10 reminders x 3 cleanings = 30 -> 16
    const times = plan.map((p) => p.fireAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // Everything for the first cleaning (10) is kept before any of the third.
    expect(plan.filter((p) => iso(p.cleaning) === '2026-08-13T08:00')).toHaveLength(10);
    expect(plan.some((p) => iso(p.cleaning) === '2026-08-27T08:00')).toBe(false);
  });

  it('plans nothing without a schedule', () => {
    expect(planCarNotifications({ schedule: undefined, reminders: [reminder('r')] }, now)).toEqual([]);
  });
});

describe('perCarCap', () => {
  it('uses MAX_PER_CAR for up to 4 cars', () => {
    for (const n of [0, 1, 4]) expect(perCarCap(n)).toBe(MAX_PER_CAR);
  });

  it('shrinks so the total stays within the iOS pending limit', () => {
    for (const n of [5, 6, 10, 64]) expect(perCarCap(n) * n).toBeLessThanOrEqual(IOS_PENDING_LIMIT);
    expect(perCarCap(5)).toBe(12);
  });

  it('always keeps at least one per car', () => {
    expect(perCarCap(100)).toBe(1);
  });
});
