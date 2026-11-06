import { DateTime } from 'luxon';

import { ADDABLE_PRESETS, REMINDER_PRESETS } from '../src/services/presets';
import {
  clockLabel,
  fromReminder,
  labelFor,
  previewLine,
  ReminderTiming,
  sameTiming,
  toReminderFields,
  validate,
  warningFor,
} from '../src/services/reminderTiming';
import { computeFireTime, planCarNotifications } from '../src/services/scheduling';
import { CleaningSchedule, Reminder } from '../src/types';

const TZ = 'America/New_York';
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
const local = (d: Date) => DateTime.fromJSDate(d, { zone: TZ }).toFormat("yyyy-LL-dd'T'HH:mm ZZZZ");

function schedule(overrides: Partial<CleaningSchedule> = {}): CleaningSchedule {
  return {
    blockId: 'test',
    rules: [{ weekday: 1, weeksOfMonth: [] }], // every Monday
    windowStart: '08:00',
    windowEnd: '12:00',
    side: 'even',
    season: { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 },
    timezone: TZ,
    address: '1 Test St',
    blockLabel: 'Test',
    scheduleLabel: 'Every Monday',
    seasonLabel: 'YEAR-ROUND',
    ...overrides,
  };
}

const fire = (t: ReminderTiming, cleaningIso: string) => local(computeFireTime(schedule(), at(cleaningIso), toReminderFields(t)));

describe('presets round-trip', () => {
  it.each(REMINDER_PRESETS.map((p) => [p.label, p] as const))('%s', (_label, p) => {
    const t = fromReminder(p);
    expect(toReminderFields(t)).toEqual({ offsetMinutes: p.offsetMinutes, timeOfDayOverride: p.timeOfDayOverride });
    expect(labelFor(t)).toBe(p.label);
    expect(validate(t, schedule())).toBeNull();
  });

  it('every addable preset is valid', () => {
    for (const p of ADDABLE_PRESETS) expect(validate(fromReminder(p))).toBeNull();
  });

  it('round-trips custom timings', () => {
    const cases: ReminderTiming[] = [
      { daysBefore: 2, mode: 'at', clock: '19:00' },
      { daysBefore: 0, mode: 'at', clock: '06:30' },
      { daysBefore: 1, mode: 'before', minutesBefore: 120 },
      { daysBefore: 7, mode: 'before', minutesBefore: 1435 },
      { daysBefore: 3, mode: 'before', minutesBefore: 0 },
    ];
    for (const t of cases) expect(fromReminder(toReminderFields(t))).toEqual(t);
  });
});

describe('toReminderFields', () => {
  it('maps "before" to a plain offset and "at" to whole days + override', () => {
    expect(toReminderFields({ daysBefore: 1, mode: 'before', minutesBefore: 120 })).toEqual({
      offsetMinutes: 1440 + 120,
      timeOfDayOverride: undefined,
    });
    expect(toReminderFields({ daysBefore: 2, mode: 'at', clock: '19:00' })).toEqual({
      offsetMinutes: 2880,
      timeOfDayOverride: '19:00',
    });
  });
});

describe('labelFor', () => {
  it.each<[ReminderTiming, string]>([
    [{ daysBefore: 1, mode: 'at', clock: '20:00' }, 'Night before at 8pm'],
    [{ daysBefore: 1, mode: 'at', clock: '21:30' }, 'Night before at 9:30pm'],
    [{ daysBefore: 1, mode: 'at', clock: '07:00' }, 'Day before at 7am'],
    [{ daysBefore: 2, mode: 'at', clock: '19:00' }, '2 days before at 7pm'],
    [{ daysBefore: 0, mode: 'at', clock: '06:30' }, 'Day of at 6:30am'],
    [{ daysBefore: 3, mode: 'at', clock: '12:00' }, '3 days before at 12pm'],
    [{ daysBefore: 0, mode: 'before', minutesBefore: 0 }, 'At sweep start'],
    [{ daysBefore: 0, mode: 'before', minutesBefore: 45 }, '45 min before'],
    [{ daysBefore: 0, mode: 'before', minutesBefore: 60 }, '1 hour before'],
    [{ daysBefore: 0, mode: 'before', minutesBefore: 90 }, '1 hr 30 min before'],
    [{ daysBefore: 1, mode: 'before', minutesBefore: 0 }, '1 day before'],
    [{ daysBefore: 2, mode: 'before', minutesBefore: 0 }, '2 days before'],
    [{ daysBefore: 1, mode: 'before', minutesBefore: 120 }, '1 day, 2 hours before'],
  ])('%j -> %s', (t, label) => {
    expect(labelFor(t)).toBe(label);
  });

  it('formats midnight and noon', () => {
    expect(clockLabel('00:00')).toBe('12am');
    expect(clockLabel('12:05')).toBe('12:05pm');
  });
});

describe('validate', () => {
  const s = schedule({ windowStart: '08:00' });

  it('rejects a same-day clock at or after the sweep start', () => {
    expect(validate({ daysBefore: 0, mode: 'at', clock: '08:00' }, s)).toMatch(/starts at 8am/);
    expect(validate({ daysBefore: 0, mode: 'at', clock: '09:15' }, s)).toMatch(/earlier time/);
    expect(validate({ daysBefore: 0, mode: 'at', clock: '07:55' }, s)).toBeNull();
    // The day before is always fine, whatever the clock.
    expect(validate({ daysBefore: 1, mode: 'at', clock: '23:55' }, s)).toBeNull();
  });

  it('allows a same-day clock without a schedule, with a warning', () => {
    const t: ReminderTiming = { daysBefore: 0, mode: 'at', clock: '09:00' };
    expect(validate(t)).toBeNull();
    expect(warningFor(t)).toMatch(/before the sweep starts/);
    expect(warningFor(t, s)).toBeNull();
    expect(warningFor({ daysBefore: 1, mode: 'at', clock: '09:00' })).toBeNull();
  });

  it('rejects negative, oversized and off-step values', () => {
    expect(validate({ daysBefore: -1, mode: 'before', minutesBefore: 0 })).not.toBeNull();
    expect(validate({ daysBefore: 8, mode: 'before', minutesBefore: 0 })).not.toBeNull();
    expect(validate({ daysBefore: 1.5, mode: 'before', minutesBefore: 0 })).not.toBeNull();
    expect(validate({ daysBefore: 0, mode: 'before', minutesBefore: -5 })).not.toBeNull();
    expect(validate({ daysBefore: 0, mode: 'before', minutesBefore: 1440 })).not.toBeNull();
    expect(validate({ daysBefore: 0, mode: 'before', minutesBefore: 7 })).not.toBeNull();
    expect(validate({ daysBefore: 0, mode: 'before', minutesBefore: 1435 })).toBeNull();
    expect(validate({ daysBefore: 1, mode: 'at', clock: '25:00' })).not.toBeNull();
    expect(validate({ daysBefore: 1, mode: 'at', clock: '19:03' })).not.toBeNull();
    expect(validate({ daysBefore: 1, mode: 'at' })).not.toBeNull();
    expect(validate({ daysBefore: 7, mode: 'at', clock: '19:00' })).toBeNull();
  });
});

describe('sameTiming', () => {
  it('compares offset and override, treating empty as none', () => {
    expect(sameTiming({ offsetMinutes: 60 }, { offsetMinutes: 60, timeOfDayOverride: '' })).toBe(true);
    expect(sameTiming({ offsetMinutes: 1440 }, { offsetMinutes: 1440, timeOfDayOverride: '20:00' })).toBe(false);
  });
});

describe('computeFireTime with custom timings (America/New_York)', () => {
  it('fires at the expected instants on an ordinary week', () => {
    // Thu 2026-10-15 08:00 EDT
    expect(fire({ daysBefore: 1, mode: 'at', clock: '19:00' }, '2026-10-15T08:00')).toBe('2026-10-14T19:00 EDT');
    expect(fire({ daysBefore: 2, mode: 'at', clock: '19:00' }, '2026-10-15T08:00')).toBe('2026-10-13T19:00 EDT');
    expect(fire({ daysBefore: 0, mode: 'at', clock: '06:30' }, '2026-10-15T08:00')).toBe('2026-10-15T06:30 EDT');
    expect(fire({ daysBefore: 0, mode: 'before', minutesBefore: 45 }, '2026-10-15T08:00')).toBe('2026-10-15T07:15 EDT');
    expect(fire({ daysBefore: 1, mode: 'before', minutesBefore: 120 }, '2026-10-15T08:00')).toBe('2026-10-14T06:00 EDT');
  });

  it('keeps wall-clock times across the fall-back change (Sun 2026-11-01)', () => {
    // Mon 2026-11-02 08:00 EST; the day before is the 25-hour DST-end day.
    expect(fire({ daysBefore: 1, mode: 'before', minutesBefore: 0 }, '2026-11-02T08:00')).toBe('2026-11-01T08:00 EST');
    expect(fire({ daysBefore: 1, mode: 'before', minutesBefore: 120 }, '2026-11-02T08:00')).toBe('2026-11-01T06:00 EST');
    expect(fire({ daysBefore: 2, mode: 'at', clock: '19:00' }, '2026-11-02T08:00')).toBe('2026-10-31T19:00 EDT');
    // Sub-day offsets are elapsed time: 3 hours before 02:30 EST on the change day.
    expect(fire({ daysBefore: 0, mode: 'before', minutesBefore: 180 }, '2026-11-01T02:30')).toBe('2026-11-01T00:30 EDT');
  });

  it('keeps wall-clock times across the spring-forward change (Sun 2027-03-14)', () => {
    // Mon 2027-03-15 08:00 EDT; the day before is the 23-hour DST-start day.
    expect(fire({ daysBefore: 1, mode: 'at', clock: '19:00' }, '2027-03-15T08:00')).toBe('2027-03-14T19:00 EDT');
    expect(fire({ daysBefore: 1, mode: 'before', minutesBefore: 0 }, '2027-03-15T08:00')).toBe('2027-03-14T08:00 EDT');
    expect(fire({ daysBefore: 2, mode: 'before', minutesBefore: 60 }, '2027-03-15T08:00')).toBe('2027-03-13T07:00 EST');
  });
});

describe('planner guard', () => {
  it('skips a same-day override that lands after the sweep start', () => {
    const reminder = (id: string, f: Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'>): Reminder => ({
      id,
      carId: 'c',
      label: id,
      channel: 'push',
      enabled: true,
      ...f,
    });
    const plan = planCarNotifications(
      {
        schedule: schedule({ explicitDates: ['2099-05-04'] }),
        reminders: [
          reminder('late', toReminderFields({ daysBefore: 0, mode: 'at', clock: '09:00' })),
          reminder('early', toReminderFields({ daysBefore: 0, mode: 'at', clock: '07:00' })),
          reminder('start', toReminderFields({ daysBefore: 0, mode: 'before', minutesBefore: 0 })),
        ],
      },
      at('2099-05-01T00:00'),
    );
    expect(plan.map((p) => p.reminder.id)).toEqual(['early', 'start']);
  });
});

describe('previewLine', () => {
  const s = schedule();
  const fn = (c: Date, f: Pick<Reminder, 'offsetMinutes' | 'timeOfDayOverride'>) => computeFireTime(s, c, f);

  it('describes the fire time for the next sweep', () => {
    const next = at('2026-10-15T08:00').getTime(); // Thursday
    expect(previewLine({ daysBefore: 1, mode: 'at', clock: '19:00' }, s, next, fn, at('2026-10-14T12:00'))).toBe(
      'Fires Wed 7:00 PM for the Thu 8:00 AM sweep',
    );
  });

  it('says when the next sweep\'s alert has already gone by, and names the first real one', () => {
    // Every Monday at 8:00. Now is Sunday 9 PM: "Night before at 8pm" for
    // Monday's sweep passed an hour ago, so the planner skips it.
    const next = at('2026-10-19T08:00');
    const later = [at('2026-10-26T08:00'), at('2026-11-02T08:00')];
    const now = at('2026-10-18T21:00');
    const t: ReminderTiming = { daysBefore: 1, mode: 'at', clock: '20:00' };
    expect(previewLine(t, s, next.getTime(), fn, now, later)).toBe(
      'Too late for the Mon 8:00 AM sweep — first fires Sun Oct 25 8:00 PM',
    );
    // Matches the planner's first alert.
    const plan = planCarNotifications(
      { schedule: s, reminders: [{ id: 'r', carId: 'c', label: 'x', channel: 'push', enabled: true, ...toReminderFields(t) }] },
      now,
    );
    expect(plan[0].fireAt.getTime()).toBe(at('2026-10-25T20:00').getTime());
    // Without later sweeps it still doesn't claim a past time.
    expect(previewLine(t, s, next.getTime(), fn, now)).toBe('Too late for the Mon 8:00 AM sweep');
    // Before the fire time it previews normally.
    expect(previewLine(t, s, next.getTime(), fn, at('2026-10-18T19:00'), later)).toBe(
      'Fires Sun 8:00 PM for the Mon 8:00 AM sweep',
    );
  });

  it('is null without a next cleaning', () => {
    expect(previewLine({ daysBefore: 1, mode: 'at', clock: '19:00' }, s, null, fn)).toBeNull();
    expect(previewLine({ daysBefore: 1, mode: 'at', clock: '19:00' }, undefined, 1, fn)).toBeNull();
  });
});
