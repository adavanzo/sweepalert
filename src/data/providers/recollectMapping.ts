/**
 * Pure ReCollect event parsing + schedule mapping. No device/native imports, so
 * it is unit-testable (see __tests__/recollect.test.ts). Network + geocoding
 * live in recollect.ts.
 */
import { DateTime } from 'luxon';

import { CleaningSchedule, Season, StreetSide } from '../../types';

export interface ReCollectCity {
  id: string; // 'cambridge'
  city: string; // 'Cambridge'
  area: string; // ReCollect area, 'CambridgeMA'
  serviceId: number; // 762
  timezone: string; // 'America/New_York'
  season: Season; // sweeping season, e.g. Apr 1 – Dec 31
  /** "move by" deadline the reminders anchor to (Cambridge signs say 8am). */
  windowStart: string;
  windowEnd: string;
}

export const RECOLLECT_CITIES: Record<string, ReCollectCity> = {
  cambridge: {
    id: 'cambridge',
    city: 'Cambridge',
    area: 'CambridgeMA',
    serviceId: 762,
    timezone: 'America/New_York',
    season: { startMonth: 4, startDay: 1, endMonth: 12, endDay: 31 },
    windowStart: '08:00',
    windowEnd: '12:00',
  },
};

export interface SweepEvent {
  day: string; // "YYYY-MM-DD"
  side: StreetSide; // 'odd' | 'even' | 'both'
}

/** Parse the leading house number from a matched address ("147 Hampshire St, …"). */
export function houseNumber(name: string): number | undefined {
  const m = name.match(/^\s*(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
}

function sideForNumber(n?: number): StreetSide {
  if (n == null || !Number.isFinite(n)) return 'both';
  return n % 2 === 0 ? 'even' : 'odd';
}

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th'];

/** Human label from the concrete dates, e.g. "Monthly · odd side (≈ 1st Wed)". */
function describe(dates: string[], side: StreetSide, zone: string): string {
  const sideLabel = side === 'both' ? 'both sides' : `${side} side`;
  if (!dates.length) return `Monthly street cleaning · ${sideLabel}`;
  const dt = DateTime.fromISO(dates[0], { zone });
  const ordinal = ORD[Math.floor((dt.day - 1) / 7) + 1] ?? '';
  return `Monthly · ${sideLabel} (≈ ${ordinal} ${dt.toFormat('ccc')})`;
}

/** Parse ReCollect event JSON into {day, side} sweeping events (holidays dropped). */
export function parseEvents(json: unknown): SweepEvent[] {
  const evs = (json as { events?: unknown[] })?.events ?? [];
  const out: SweepEvent[] = [];
  for (const e of evs as { day?: string; flags?: unknown[] }[]) {
    if (!e.day) continue;
    for (const f of e.flags ?? []) {
      const name = typeof f === 'string' ? f : String((f as { name?: string })?.name ?? '');
      if (!name.startsWith('street_sweeping')) continue;
      const side: StreetSide = name.includes('odd') ? 'odd' : name.includes('even') ? 'even' : 'both';
      out.push({ day: e.day, side });
    }
  }
  return out;
}

/**
 * Build a CleaningSchedule from ReCollect events + the parked parcel. Selects
 * the side by house-number parity, keeps that side's dates, stores them as
 * explicitDates. Pure — no network.
 */
export function buildScheduleFromEvents(
  events: SweepEvent[],
  matchedName: string,
  cfg: ReCollectCity,
  streetNumber?: number,
): CleaningSchedule {
  const side = sideForNumber(streetNumber ?? houseNumber(matchedName));
  const relevant = side === 'both' ? events : events.filter((e) => e.side === side || e.side === 'both');
  const dates = [...new Set(relevant.map((e) => e.day))].sort();
  const address = matchedName.replace(/,\s*[^,]+$/, ''); // drop trailing ", Cambridge"

  return {
    blockId: `recollect-${cfg.id}-${side}-${address}`,
    rules: [],
    explicitDates: dates,
    windowStart: cfg.windowStart,
    windowEnd: cfg.windowEnd,
    side,
    season: cfg.season,
    timezone: cfg.timezone,
    address,
    blockLabel: `${cfg.city} · ${side === 'both' ? 'both sides' : `${side} side`}`,
    scheduleLabel: describe(dates, side, cfg.timezone),
    seasonLabel: 'APR – DEC · MONTHLY',
    city: cfg.city,
  };
}
