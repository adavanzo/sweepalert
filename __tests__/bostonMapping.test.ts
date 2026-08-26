import { DateTime } from 'luxon';

import {
  normalizeStreet,
  pickRow,
  rowToSchedule,
  SweepRow,
  weeksOf,
} from '../src/data/providers/bostonMapping';
import { getNextCleaning } from '../src/services/scheduling';

// A real-shaped row from the Analyze Boston dataset: Back Bay, Even side,
// Monday, weeks 2 & 4, 08:00–12:00, seasonal.
const backBayEven: SweepRow = {
  _id: 10, main_id: 1010, st_name: 'Beacon St', dist_name: 'Back Bay (Even side)',
  side: 'Even', from: 'Arlington St', to: 'Massachusetts Ave', start_time: '08:00', end_time: '12:00',
  week_1: false, week_2: true, week_3: false, week_4: true, week_5: false,
  sunday: false, monday: true, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: false,
  every_day: false, year_round: false,
};

// Beacon Hill, Thursday every week, early AM, year-round.
const beaconHill: SweepRow = {
  _id: 3, main_id: 1003, st_name: 'Beacon St', dist_name: 'Beacon Hill',
  side: 'Even', from: 'Charles St', to: 'Arlington St', start_time: '02:00', end_time: '07:00',
  week_1: true, week_2: true, week_3: true, week_4: true, week_5: true,
  sunday: false, monday: false, tuesday: false, wednesday: false, thursday: true, friday: false, saturday: false,
  every_day: false, year_round: true,
};

describe('normalizeStreet', () => {
  it('treats abbreviated and spelled-out suffixes as equal', () => {
    expect(normalizeStreet('Beacon Street')).toBe(normalizeStreet('Beacon St'));
    expect(normalizeStreet('Commonwealth Avenue')).toBe('commonwealth ave');
  });
});

describe('weeksOf', () => {
  it('maps week_2 & week_4 to [2, 4]', () => {
    expect(weeksOf(backBayEven)).toEqual([2, 4]);
  });
  it('collapses all-weeks to "every" ([])', () => {
    expect(weeksOf(beaconHill)).toEqual([]);
  });
});

describe('CKAN string-boolean parsing (regression)', () => {
  // CKAN datastore_search returns Postgres booleans as the strings "t"/"f".
  // rowToSchedule must read those, not require real JS booleans (else every row
  // fell through to the Thursday default).
  const strRow = (over: Partial<Record<string, unknown>>): SweepRow =>
    ({
      _id: 1, main_id: 1, st_name: 'Boylston St', dist_name: 'Back Bay', side: 'Odd',
      from: 'Arlington St', to: 'Hereford St', start_time: '00:01', end_time: '07:00',
      week_1: 'f', week_2: 'f', week_3: 'f', week_4: 'f', week_5: 'f',
      sunday: 'f', monday: 'f', tuesday: 'f', wednesday: 'f', thursday: 'f', friday: 'f', saturday: 'f',
      every_day: 'f', year_round: 'f',
      ...over,
    }) as unknown as SweepRow;

  it('maps an all-days "t" row to daily, year-round (not "every Thu")', () => {
    const s = rowToSchedule(
      strRow({
        sunday: 't', monday: 't', tuesday: 't', wednesday: 't', thursday: 't', friday: 't', saturday: 't',
        week_1: 't', week_2: 't', week_3: 't', week_4: 't', week_5: 't', every_day: 't', year_round: 't',
      }),
    );
    expect(s.rules).toHaveLength(7);
    expect(s.scheduleLabel).toBe('Cleaned daily, 12:01am–7am');
    expect(s.seasonLabel).toContain('YEAR-ROUND');
  });

  it('maps a "1st & 3rd Monday" string row correctly', () => {
    const s = rowToSchedule(
      strRow({ monday: 't', week_1: 't', week_3: 't', start_time: '08:00', end_time: '12:00' }),
    );
    expect(s.rules).toEqual([{ weekday: 1, weeksOfMonth: [1, 3] }]);
    expect(s.scheduleLabel).toBe('Cleaned 1st & 3rd Mon, 8am–12pm');
    expect(s.seasonLabel).toContain('APR 1');
  });
});

describe('rowToSchedule', () => {
  it('translates the Back Bay seasonal Monday row', () => {
    const s = rowToSchedule(backBayEven);
    expect(s.rules).toEqual([{ weekday: 1, weeksOfMonth: [2, 4] }]);
    expect(s.windowStart).toBe('08:00');
    expect(s.side).toBe('even');
    expect(s.season).toEqual({ startMonth: 4, startDay: 1, endMonth: 11, endDay: 30 });
    expect(s.scheduleLabel).toBe('Cleaned 2nd & 4th Mon, 8am–12pm');
    expect(s.seasonLabel).toContain('APR 1');
  });

  it('translates the year-round Beacon Hill Thursday row', () => {
    const s = rowToSchedule(beaconHill);
    expect(s.rules).toEqual([{ weekday: 4, weeksOfMonth: [] }]);
    expect(s.season).toEqual({ startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 });
    expect(s.scheduleLabel).toBe('Cleaned every Thu, 2am–7am');
    expect(s.seasonLabel).toContain('YEAR-ROUND');
  });

  it('feeds the engine: next Back Bay sweep after a mid-August day', () => {
    const s = rowToSchedule(backBayEven);
    // 2026-08-12 is a Wednesday; next 2nd/4th Monday sweep is Mon Aug 17 (3rd Mon? no).
    // Mondays in Aug 2026: 3(1st),10(2nd),17(3rd),24(4th),31(5th). Weeks 2&4 => Aug 10 & 24.
    const next = getNextCleaning(s, DateTime.fromISO('2026-08-12T06:45', { zone: s.timezone }).toJSDate());
    expect(DateTime.fromJSDate(next!, { zone: s.timezone }).toISODate()).toBe('2026-08-24');
  });
});

describe('pickRow', () => {
  it('prefers a row whose district matches the neighborhood hint', () => {
    const picked = pickRow([backBayEven, beaconHill], { neighborhood: 'Beacon Hill' });
    expect(picked).toBe(beaconHill);
  });
  it('falls back to the first row without a hint', () => {
    expect(pickRow([backBayEven, beaconHill])).toBe(backBayEven);
  });
  it('narrows by side before anything else', () => {
    const oddRow: SweepRow = { ...backBayEven, side: 'Odd', dist_name: 'Back Bay (Odd side)' };
    const evenRow: SweepRow = { ...backBayEven, side: 'Even' };
    // Point is on the odd side -> the odd row wins even though even is first.
    expect(pickRow([evenRow, oddRow], { side: 'odd' })).toBe(oddRow);
  });
  it('keeps side-agnostic rows when no exact side match exists', () => {
    const bothRow: SweepRow = { ...backBayEven, side: '' };
    expect(pickRow([bothRow], { side: 'odd' })).toBe(bothRow);
  });

  it('pins the correct block via nearby cross streets (Boylston regression)', () => {
    // Same street + side, different blocks miles apart. The user is near
    // Arlington, so the Arlington-bounded daily block must win over the
    // Fenway/Thursday one — even though both are "Boylston St, Odd".
    const nearArlington: SweepRow = {
      ...backBayEven, st_name: 'Boylston St', side: 'Odd', from: 'Arlington St', to: 'Hereford St',
      week_1: true, week_2: true, week_3: true, week_4: true, week_5: true,
      sunday: true, monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true,
      every_day: true, year_round: true, start_time: '00:01', end_time: '07:00',
    };
    const farFenway: SweepRow = {
      ...backBayEven, st_name: 'Boylston St', side: 'Odd', from: 'Fenway', to: 'Park Dr',
      week_1: true, week_2: true, week_3: true, week_4: true, week_5: true,
      sunday: false, monday: false, tuesday: false, wednesday: false, thursday: true, friday: false, saturday: false,
      every_day: false, year_round: true, start_time: '05:00', end_time: '07:00',
    };
    const picked = pickRow([farFenway, nearArlington], {
      side: 'odd',
      crossStreets: ['Boylston St', 'Arlington St', 'Berkeley St', 'Newbury St'],
    });
    expect(picked).toBe(nearArlington);
  });

  it('uses neighborhood to rule out a same-name street across the city', () => {
    // Boylston St exists in Back Bay AND Jamaica Plain. Standing in Back Bay,
    // the Back Bay row must win — even though the JP row shares a cross street.
    const backBay: SweepRow = {
      ...backBayEven, st_name: 'Boylston St', dist_name: 'Back Bay', side: 'Even',
      from: 'Arlington St', to: 'Hereford St',
    };
    const jamaicaPlain: SweepRow = {
      ...backBayEven, st_name: 'Boylston St', dist_name: 'Jamaica Plain', side: 'Even',
      from: 'Centre St', to: 'Washington St',
    };
    const picked = pickRow([jamaicaPlain, backBay], {
      side: 'even',
      neighborhood: 'Back Bay',
      crossStreets: ['Washington St'], // a cross street the JP block also has
    });
    expect(picked).toBe(backBay);
  });
});
