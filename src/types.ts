/**
 * Core domain model, persisted locally (see state/store.ts).
 *
 * Mirrors the spec's data model:
 *   Car { id, name, color, location?, createdAt }
 *   ParkingSpot { carId, lat, lng, address, blockId, savedAt }
 *   CleaningSchedule { blockId, rules, windowStart, windowEnd, side }
 *   Reminder { id, carId, offsetMinutes, timeOfDayOverride?, channel, enabled }
 */

export type StreetSide =
  | 'even'
  | 'odd'
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'both';

/**
 * Notification delivery channel. `alarm` is shown as "Urgent": iOS time-sensitive
 * (when entitled) + Android high-priority channel; see services/notificationChannels.ts.
 * The stored value stays 'alarm' so saved reminders keep working without a migration.
 */
export type Channel = 'push' | 'alarm';

/** A single recurrence rule: a weekday plus which weeks of the month it fires. */
export interface CleaningRule {
  /** 0 = Sunday … 6 = Saturday (JS Date.getDay convention). */
  weekday: number;
  /**
   * Which ordinal occurrences within the month, e.g. [1, 3] for "1st & 3rd".
   * An empty array means every matching weekday ("every Thursday").
   */
  weeksOfMonth: number[];
}

/** Inclusive seasonal on/off window (Boston sweeps ~Apr 1 – Nov 30). */
export interface Season {
  startMonth: number; // 1-12
  startDay: number;
  endMonth: number;
  endDay: number;
}

export interface CleaningSchedule {
  blockId: string;
  rules: CleaningRule[];
  /** Local wall-clock "HH:mm" of the cleaning window in `timezone`. */
  windowStart: string;
  windowEnd: string;
  side: StreetSide;
  season: Season;
  /** IANA timezone, e.g. "America/New_York". Drives DST-correct math. */
  timezone: string;

  /**
   * Explicit cleaning dates ("YYYY-MM-DD"), for providers that publish a concrete
   * calendar rather than recurrence rules (e.g. Cambridge via ReCollect, which is
   * already holiday-adjusted). When present, the engine uses these instead of
   * `rules`. Each date's cleaning instant is that day at `windowStart`.
   */
  explicitDates?: string[];

  // ---- Display metadata (denormalized for the UI) ----
  address: string;
  blockLabel: string;
  scheduleLabel: string;
  seasonLabel: string;
  /** City this schedule came from, for the UI ("Boston", "Cambridge"). */
  city?: string;
}

export interface ParkingSpot {
  carId: string;
  lat: number;
  lng: number;
  address: string;
  blockId: string;
  savedAt: number; // epoch ms
}

export interface Reminder {
  id: string;
  carId: string;
  /** Human label shown in the UI ("2 hours before"). */
  label: string;
  /** Minutes before the cleaning datetime. */
  offsetMinutes: number;
  /**
   * Optional "HH:mm" clock override applied to the day the offset lands on.
   * e.g. offsetMinutes = 1440 + timeOfDayOverride = "20:00" => "night before at 8pm".
   */
  timeOfDayOverride?: string;
  channel: Channel;
  enabled: boolean;
  /** OS notification identifier once scheduled (for cancel/reschedule). */
  notificationId?: string;
}

export interface Car {
  id: string;
  name: string;
  /** Paint swatch hex. */
  color: string;
  /** MA-style plate string, display only. */
  plate: string;
  location?: ParkingSpot;
  /** Cached schedule for the parked block. */
  schedule?: CleaningSchedule;
  /** Next computed cleaning datetime (epoch ms), or null when off-season/none. */
  nextCleaning?: number | null;
  reminders: Reminder[];
  createdAt: number;
}
