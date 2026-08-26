import { DateTime } from 'luxon';

import {
  computeFireTime,
  computeFireTimes,
  dayMatchesRules,
  getNextCleaning,
  inSeason,
  ordinalInMonth,
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

const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();

describe('ordinalInMonth', () => {
  it('classifies the nth weekday-of-month', () => {
    expect(ordinalInMonth(DateTime.fromISO('2026-08-03'))).toBe(1); // 1st Mon
    expect(ordinalInMonth(DateTime.fromISO('2026-08-17'))).toBe(3); // 3rd Mon
    expect(ordinalInMonth(DateTime.fromISO('2026-08-25'))).toBe(4); // 4th Tue
  });
});

describe('dayMatchesRules', () => {
  it('matches "every Thursday"', () => {
    const rules = [{ weekday: 4, weeksOfMonth: [] }];
    expect(dayMatchesRules(DateTime.fromISO('2026-08-13'), rules)).toBe(true); // Thu
    expect(dayMatchesRules(DateTime.fromISO('2026-08-14'), rules)).toBe(false); // Fri
  });

  it('matches "1st & 3rd Monday" only on those weeks', () => {
    const rules = [{ weekday: 1, weeksOfMonth: [1, 3] }];
    expect(dayMatchesRules(DateTime.fromISO('2026-08-03'), rules)).toBe(true); // 1st Mon
    expect(dayMatchesRules(DateTime.fromISO('2026-08-10'), rules)).toBe(false); // 2nd Mon
    expect(dayMatchesRules(DateTime.fromISO('2026-08-17'), rules)).toBe(true); // 3rd Mon
    expect(dayMatchesRules(DateTime.fromISO('2026-08-24'), rules)).toBe(false); // 4th Mon
  });
});

describe('inSeason', () => {
  const s = { startMonth: 4, startDay: 1, endMonth: 11, endDay: 30 };
  it('includes the boundary days', () => {
    expect(inSeason(DateTime.fromISO('2026-04-01'), s)).toBe(true);
    expect(inSeason(DateTime.fromISO('2026-11-30'), s)).toBe(true);
  });
  it('excludes off-season', () => {
    expect(inSeason(DateTime.fromISO('2026-03-31'), s)).toBe(false);
    expect(inSeason(DateTime.fromISO('2026-12-01'), s)).toBe(false);
    expect(inSeason(DateTime.fromISO('2026-01-15'), s)).toBe(false);
  });
  it('handles a wrapping season', () => {
    const w = { startMonth: 11, startDay: 1, endMonth: 2, endDay: 28 };
    expect(inSeason(DateTime.fromISO('2026-12-15'), w)).toBe(true);
    expect(inSeason(DateTime.fromISO('2026-01-15'), w)).toBe(true);
    expect(inSeason(DateTime.fromISO('2026-06-15'), w)).toBe(false);
  });
});

describe('getNextCleaning', () => {
  it('returns the same-day window when now is before the start', () => {
    // Wed 2026-08-12 06:45 -> next Thursday sweep is 2026-08-13 08:00
    const next = getNextCleaning(schedule(), at('2026-08-12T06:45:00'));
    expect(DateTime.fromJSDate(next!, { zone: TZ }).toISO()).toBe(
      DateTime.fromISO('2026-08-13T08:00:00', { zone: TZ }).toISO(),
    );
  });

  it('rolls forward once the window start has passed', () => {
    // Thursday 08:00:01 is past today's start -> next is the following Thursday
    const next = getNextCleaning(schedule(), at('2026-08-13T08:00:01'));
    expect(DateTime.fromJSDate(next!, { zone: TZ }).toISODate()).toBe('2026-08-20');
  });

  it('is strictly-after: exactly at the window start rolls to next week', () => {
    const next = getNextCleaning(schedule(), at('2026-08-13T08:00:00'));
    expect(DateTime.fromJSDate(next!, { zone: TZ }).toISODate()).toBe('2026-08-20');
  });

  it('honors 1st & 3rd Monday', () => {
    const s = schedule({ rules: [{ weekday: 1, weeksOfMonth: [1, 3] }], windowStart: '08:00' });
    const next = getNextCleaning(s, at('2026-08-04T09:00:00')); // Tue after 1st Mon
    expect(DateTime.fromJSDate(next!, { zone: TZ }).toISODate()).toBe('2026-08-17'); // 3rd Mon
  });

  it('skips the off-season and jumps to next April', () => {
    const next = getNextCleaning(schedule(), at('2026-12-15T09:00:00'));
    const d = DateTime.fromJSDate(next!, { zone: TZ });
    expect(d.month).toBe(4);
    expect(d.year).toBe(2027);
    expect(d.weekday % 7).toBe(4); // Thursday
    expect(d.hour).toBe(8);
  });

  it('lands on 8:00 local across the spring-forward DST boundary', () => {
    // US DST 2027 begins Sun 2027-03-14. Use a Mar sweep in a year-round season.
    const yearRound = schedule({
      rules: [{ weekday: 0, weeksOfMonth: [] }], // Sundays
      season: { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 },
    });
    const next = getNextCleaning(yearRound, at('2027-03-13T12:00:00'));
    const d = DateTime.fromJSDate(next!, { zone: TZ });
    expect(d.toISODate()).toBe('2027-03-14');
    expect(d.hour).toBe(8); // still 8am local despite the 2am->3am jump
    expect(d.offset).toBe(-4 * 60); // now on EDT
  });

  it('lands on 8:00 local across the fall-back DST boundary', () => {
    // US DST 2026 ends Sun 2026-11-01. Season ends Nov 30, so it is in-window.
    const next = getNextCleaning(
      schedule({ rules: [{ weekday: 0, weeksOfMonth: [] }] }),
      at('2026-10-31T12:00:00'),
    );
    const d = DateTime.fromJSDate(next!, { zone: TZ });
    expect(d.toISODate()).toBe('2026-11-01');
    expect(d.hour).toBe(8);
    expect(d.offset).toBe(-5 * 60); // now on EST
  });
});

describe('computeFireTime', () => {
  const cleaning = at('2026-08-13T08:00:00'); // Thu 8am

  it('subtracts a simple minute offset', () => {
    const fire = computeFireTime(schedule(), cleaning, { offsetMinutes: 120 });
    expect(DateTime.fromJSDate(fire, { zone: TZ }).toISO()).toBe(
      DateTime.fromISO('2026-08-13T06:00:00', { zone: TZ }).toISO(),
    );
  });

  it('"night before at 8pm" = 1 day offset pinned to 20:00', () => {
    const fire = computeFireTime(schedule(), cleaning, {
      offsetMinutes: 24 * 60,
      timeOfDayOverride: '20:00',
    });
    expect(DateTime.fromJSDate(fire, { zone: TZ }).toISODate()).toBe('2026-08-12'); // Wed
    expect(DateTime.fromJSDate(fire, { zone: TZ }).hour).toBe(20);
  });

  it('override survives a DST fall-back day', () => {
    // Cleaning Mon 2026-11-02 08:00; night-before lands on Sun 2026-11-01 (DST end)
    const c = at('2026-11-02T08:00:00');
    const fire = computeFireTime(schedule(), c, {
      offsetMinutes: 24 * 60,
      timeOfDayOverride: '20:00',
    });
    const d = DateTime.fromJSDate(fire, { zone: TZ });
    expect(d.toISODate()).toBe('2026-11-01');
    expect(d.hour).toBe(20);
    expect(d.offset).toBe(-5 * 60); // EST
  });
});

describe('computeFireTimes', () => {
  const cleaning = at('2026-08-13T08:00:00');
  const reminders: Reminder[] = [
    { id: 'a', carId: '1', label: 'Night before at 8pm', offsetMinutes: 1440, timeOfDayOverride: '20:00', channel: 'push', enabled: true },
    { id: 'b', carId: '1', label: '2 hours before', offsetMinutes: 120, channel: 'push', enabled: true },
    { id: 'c', carId: '1', label: '30 min before', offsetMinutes: 30, channel: 'alarm', enabled: false },
  ];

  it('skips disabled reminders and flags past fire times', () => {
    // 05:00 Thu: night-before (Wed 8pm) is past; 2h-before (6am) is still future.
    const now = at('2026-08-13T05:00:00');
    const out = computeFireTimes(schedule(), cleaning, reminders, now);
    expect(out.map((f) => f.reminder.id)).toEqual(['a', 'b']); // 'c' disabled
    expect(out.find((f) => f.reminder.id === 'a')!.past).toBe(true); // 8pm last night
    expect(out.find((f) => f.reminder.id === 'b')!.past).toBe(false); // 6am today
  });
});
