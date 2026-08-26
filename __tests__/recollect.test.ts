import { DateTime } from 'luxon';

import {
  buildScheduleFromEvents,
  houseNumber,
  parseEvents,
  RECOLLECT_CITIES,
} from '../src/data/providers/recollectMapping';
import { getNextCleaning } from '../src/services/scheduling';

const CAMBRIDGE = RECOLLECT_CITIES.cambridge;

// Real-shaped ReCollect response (flags carry the machine name + subject).
const rawJson = {
  events: [
    { day: '2026-09-02', flags: [{ name: 'street_sweeping_odd', subject: 'Street Sweeping Odd-side' }] },
    { day: '2026-09-03', flags: [{ name: 'street_sweeping_even', subject: 'Street Sweeping Even-side' }] },
    { day: '2026-09-07', flags: [{ name: 'holiday', subject: 'Labor Day' }] },
    { day: '2026-10-01', flags: [{ name: 'street_sweeping_even' }] },
    { day: '2026-10-07', flags: [{ name: 'street_sweeping_odd' }] },
  ],
};

describe('houseNumber', () => {
  it('extracts the leading number', () => {
    expect(houseNumber('147 Hampshire St, Cambridge')).toBe(147);
    expect(houseNumber('5 JFK St')).toBe(5);
    expect(houseNumber('Massachusetts Ave')).toBeUndefined();
  });
});

describe('parseEvents', () => {
  it('extracts sweeping events by side and drops holidays', () => {
    const evs = parseEvents(rawJson);
    expect(evs).toEqual([
      { day: '2026-09-02', side: 'odd' },
      { day: '2026-09-03', side: 'even' },
      { day: '2026-10-01', side: 'even' },
      { day: '2026-10-07', side: 'odd' },
    ]);
  });
});

describe('buildScheduleFromEvents', () => {
  it('picks the odd-side dates for an odd house number', () => {
    const s = buildScheduleFromEvents(parseEvents(rawJson), '147 Hampshire St, Cambridge', CAMBRIDGE, 147);
    expect(s.side).toBe('odd');
    expect(s.explicitDates).toEqual(['2026-09-02', '2026-10-07']);
    expect(s.address).toBe('147 Hampshire St');
    expect(s.city).toBe('Cambridge');
    expect(s.scheduleLabel).toContain('odd side');
  });

  it('picks the even-side dates for an even house number', () => {
    const s = buildScheduleFromEvents(parseEvents(rawJson), '150 Hampshire St, Cambridge', CAMBRIDGE, 150);
    expect(s.side).toBe('even');
    expect(s.explicitDates).toEqual(['2026-09-03', '2026-10-01']);
  });

  it('feeds the engine: next cleaning is the soonest future explicit date', () => {
    const s = buildScheduleFromEvents(parseEvents(rawJson), '147 Hampshire St, Cambridge', CAMBRIDGE, 147);
    const from = DateTime.fromISO('2026-09-15T09:00', { zone: CAMBRIDGE.timezone }).toJSDate();
    const next = getNextCleaning(s, from);
    // Odd dates are 9/2 (past) and 10/7 (future) -> 10/7 at 08:00.
    const d = DateTime.fromJSDate(next!, { zone: CAMBRIDGE.timezone });
    expect(d.toISODate()).toBe('2026-10-07');
    expect(d.hour).toBe(8);
  });

  it('returns null next-cleaning when all explicit dates are in the past', () => {
    const s = buildScheduleFromEvents(parseEvents(rawJson), '147 Hampshire St', CAMBRIDGE, 147);
    const from = DateTime.fromISO('2027-01-01T00:00', { zone: CAMBRIDGE.timezone }).toJSDate();
    expect(getNextCleaning(s, from)).toBeNull();
  });
});
