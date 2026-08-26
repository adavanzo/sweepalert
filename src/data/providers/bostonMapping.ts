/**
 * Pure translation between raw Analyze Boston CKAN rows and our CleaningSchedule.
 * No device/native imports here so it is fully unit-testable (see
 * __tests__/bostonMapping.test.ts). Network + config live in bostonApi.ts.
 */
import { CleaningRule, CleaningSchedule, Season, StreetSide } from '../../types';

const TZ = 'America/New_York';
const SEASON_SEASONAL: Season = { startMonth: 4, startDay: 1, endMonth: 11, endDay: 30 };
const SEASON_YEAR_ROUND: Season = { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 };

/** Raw CKAN row shape (only the fields we consume). */
export interface SweepRow {
  _id: number;
  main_id: number;
  st_name: string;
  dist_name: string;
  side: string; // "Even" | "Odd" | "" | ...
  from: string;
  to: string;
  start_time: string; // "HH:MM"
  end_time: string;
  // CKAN returns Postgres booleans as the strings "t"/"f" (not JS booleans),
  // so these are typed loosely and read through truthy().
  week_1: SweepBool; week_2: SweepBool; week_3: SweepBool; week_4: SweepBool; week_5: SweepBool;
  sunday: SweepBool; monday: SweepBool; tuesday: SweepBool; wednesday: SweepBool;
  thursday: SweepBool; friday: SweepBool; saturday: SweepBool;
  every_day: SweepBool;
  year_round: SweepBool;
}

/** A boolean column as CKAN may return it: real boolean, or "t"/"f"/"true"/"1". */
export type SweepBool = boolean | string | number | null | undefined;

/** Robust truthiness for CKAN boolean columns ("t"/"f" strings or real booleans). */
export function truthy(v: SweepBool): boolean {
  return v === true || v === 't' || v === 'true' || v === 1 || v === '1';
}

/** Normalize a street name for tolerant comparison ("Beacon Street" == "Beacon St"). */
export function normalizeStreet(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bplace\b/g, 'pl')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bsquare\b/g, 'sq')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\bcourt\b/g, 'ct')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\s+/g, ' ')
    .trim();
}

const DAY_FLAGS: [keyof SweepRow, number, string][] = [
  ['sunday', 0, 'Sun'],
  ['monday', 1, 'Mon'],
  ['tuesday', 2, 'Tue'],
  ['wednesday', 3, 'Wed'],
  ['thursday', 4, 'Thu'],
  ['friday', 5, 'Fri'],
  ['saturday', 6, 'Sat'],
];

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th'];

export function weeksOf(row: SweepRow): number[] {
  const weeks = [row.week_1, row.week_2, row.week_3, row.week_4, row.week_5];
  const on = weeks.map((v, i) => (truthy(v) ? i + 1 : 0)).filter(Boolean);
  // All weeks (or none marked, or explicitly every_day) == every occurrence.
  return on.length === 0 || on.length === 5 || truthy(row.every_day) ? [] : on;
}

export function sideOf(row: SweepRow): StreetSide {
  const s = (row.side || '').toLowerCase();
  if (s.startsWith('even')) return 'even';
  if (s.startsWith('odd')) return 'odd';
  if (s.startsWith('north')) return 'north';
  if (s.startsWith('south')) return 'south';
  if (s.startsWith('east')) return 'east';
  if (s.startsWith('west')) return 'west';
  return 'both';
}

/** "8:00" -> "8am", "12:00" -> "12pm", "00:01" -> "12:01am". */
export function clockLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function describe(rules: CleaningRule[], row: SweepRow): string {
  const weeks = rules[0]?.weeksOfMonth ?? [];
  const window = `${clockLabel(row.start_time)}–${clockLabel(row.end_time)}`;
  // All seven weekdays every week == daily sweeping (common on arterials).
  if (rules.length === 7 && weeks.length === 0) return `Cleaned daily, ${window}`;
  const days = rules.map((r) => DAY_FLAGS.find((d) => d[1] === r.weekday)?.[2] ?? '').filter(Boolean);
  const weekPart = weeks.length ? weeks.map((w) => ORDINALS[w]).join(' & ') + ' ' : 'every ';
  return `Cleaned ${weekPart}${days.join(' & ')}, ${window}`;
}

/** Convert a live CKAN row into our CleaningSchedule. */
export function rowToSchedule(row: SweepRow): CleaningSchedule {
  const weeks = weeksOf(row);
  const rules: CleaningRule[] = DAY_FLAGS.filter(([flag]) => truthy(row[flag])).map(([, weekday]) => ({
    weekday,
    weeksOfMonth: weeks,
  }));
  // Defensive: if the row somehow has no day set, treat as every Thursday.
  if (rules.length === 0) rules.push({ weekday: 4, weeksOfMonth: [] });

  const sideLabel = row.side ? `${sideOf(row)} side` : 'both sides';
  const segment = [row.from, row.to].filter(Boolean).join(' → ');

  return {
    blockId: `bos-${row.main_id ?? row._id}`,
    rules,
    windowStart: row.start_time,
    windowEnd: row.end_time,
    side: sideOf(row),
    season: truthy(row.year_round) ? SEASON_YEAR_ROUND : SEASON_SEASONAL,
    timezone: TZ,
    address: row.st_name,
    blockLabel: [row.dist_name, [sideLabel, segment].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
    scheduleLabel: describe(rules, row),
    seasonLabel: truthy(row.year_round) ? 'YEAR-ROUND SWEEPING' : 'APR 1 – NOV 30 · SEASONAL',
  };
}

export interface PickOptions {
  /** Neighborhood hint (from SAM), used to disambiguate cross-city streets. */
  neighborhood?: string;
  /** Which side of the street the point is on (from SAM geometry). */
  side?: StreetSide;
  /**
   * Street names near the point (from SAM). A sweeping segment is bounded by two
   * cross streets (`from`/`to`); the correct block is the one whose bounds are
   * near you — this is what pins the right block among a street's many segments.
   */
  crossStreets?: string[];
}

/** Does a row's district match the point's neighborhood? Tolerant substring match. */
function neighborhoodMatches(row: SweepRow, neighborhood: string): boolean {
  const d = (row.dist_name || '').toLowerCase();
  const n = neighborhood.toLowerCase();
  if (!d || !n) return false;
  // dist_name is often more specific ("Back Bay (Even side)", "North Dorchester").
  return d.includes(n) || (n.length > 2 && d.length > 2 && n.includes(d));
}

/**
 * Choose the sweeping row that applies to a point:
 *   1. side must match (Even/Odd from SAM geometry; side-agnostic rows always apply),
 *   2. score the rest by neighborhood + nearby cross streets and take the best.
 *
 * A street like Boylston has ~14 segments spread across Back Bay, Downtown,
 * Jamaica Plain and the Fenway. Neighborhood (point-in-polygon) rules out the
 * wrong parts of the city; the bounding cross streets then pin the exact block.
 * Neighborhood is weighted above a single cross-street so a same-neighborhood
 * block always beats a mere name coincidence elsewhere.
 */
export function pickRow(rows: SweepRow[], opts: PickOptions = {}): SweepRow | null {
  if (rows.length === 0) return null;

  let pool = rows;
  if (opts.side && opts.side !== 'both') {
    const sideMatch = rows.filter((r) => {
      const s = sideOf(r);
      return s === opts.side || s === 'both';
    });
    if (sideMatch.length) pool = sideMatch;
  }

  const nb = opts.neighborhood?.trim();
  const near =
    opts.crossStreets && opts.crossStreets.length
      ? new Set(opts.crossStreets.map(normalizeStreet).filter(Boolean))
      : null;

  if (nb || near) {
    const score = (r: SweepRow) =>
      (nb && neighborhoodMatches(r, nb) ? 3 : 0) +
      (near ? (near.has(normalizeStreet(r.from || '')) ? 1 : 0) + (near.has(normalizeStreet(r.to || '')) ? 1 : 0) : 0);
    const best = Math.max(...pool.map(score));
    if (best > 0) pool = pool.filter((r) => score(r) === best);
  }
  return pool[0];
}
