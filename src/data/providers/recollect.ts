/**
 * ReCollect-backed provider for cities whose street-sweeping schedule lives in
 * ReCollect (recollect.net) rather than open data — currently Cambridge (and
 * Somerville uses the same system, pending its service id).
 *
 * ReCollect publishes a concrete, holiday-adjusted calendar per address, so
 * unlike Boston there are no recurrence rules to compute — we read the actual
 * upcoming dates and store them as `explicitDates`. Flow:
 *   reverse-geocode -> address-suggest (place_id) -> events (dated, per side)
 * The parked parcel's house-number parity selects odd- vs even-side dates.
 *
 * NOTE: ReCollect's API is unofficial/undocumented and can change without
 * notice. Only "address not found in this city's area" is an authoritative
 * null; network/HTTP/parse errors and an unavailable geocoder throw
 * LookupFailedError so the store keeps the car's cached schedule instead of
 * wiping it. Pure parsing/mapping lives in recollectMapping.ts (unit-tested).
 */
import { DateTime } from 'luxon';

import { CleaningSchedule } from '../../types';
import { fetchWithTimeout } from '../../services/http';
import { log } from '../../services/log';
import { getNextCleaning } from '../../services/scheduling';
import { reverseGeocodeParts } from '../../services/location';
import {
  buildScheduleFromEvents,
  houseNumber,
  parseEvents,
  ReCollectCity,
  SweepEvent,
} from './recollectMapping';
import { LookupFailedError, StreetCleaningProvider } from './types';

export * from './recollectMapping';

const API = 'https://api.recollect.net/api';
const HORIZON_DAYS = 200;

interface SuggestMatch {
  name: string;
  place_id: string;
}

async function addressSuggest(area: string, query: string): Promise<SuggestMatch | null> {
  const url = `${API}/areas/${area}/services/sweeping/address-suggest?q=${encodeURIComponent(query)}&locale=en-US`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`ReCollect suggest HTTP ${res.status}`);
  const arr = (await res.json()) as { name: string; place_id: string; type?: string }[];
  if (!Array.isArray(arr) || !arr.length) return null;
  const m = arr.find((x) => x.type === 'parcel') ?? arr[0];
  return m?.place_id ? { name: m.name, place_id: m.place_id } : null;
}

async function fetchEvents(placeId: string, serviceId: number, timezone: string): Promise<SweepEvent[]> {
  const after = DateTime.now().setZone(timezone).toISODate();
  const before = DateTime.now().setZone(timezone).plus({ days: HORIZON_DAYS }).toISODate();
  const url =
    `${API}/places/${placeId}/services/${serviceId}/events` +
    `?nomerge=1&hide=reminder_only&after=${after}&before=${before}&locale=en-US`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`ReCollect events HTTP ${res.status}`);
  return parseEvents(await res.json());
}

export class ReCollectProvider implements StreetCleaningProvider {
  readonly id: string;
  readonly name: string;

  constructor(private readonly cfg: ReCollectCity) {
    this.id = `recollect-${cfg.id}`;
    this.name = `${cfg.city} (ReCollect)`;
  }

  async getScheduleForLocation(lat: number, lng: number): Promise<CleaningSchedule | null> {
    try {
      const parts = await reverseGeocodeParts(lat, lng);
      // reverseGeocodeParts swallows geocoder failures and returns only a
      // "lat, lng" label (no street, no city). Searching ReCollect for that
      // would come back "not found" and look authoritative — it isn't.
      if (!parts.street && !parts.city) throw new LookupFailedError('reverse-geocode unavailable');
      const query = parts.full;
      const match = await addressSuggest(this.cfg.area, query);
      if (!match) return null; // address not in this city's ReCollect area
      const events = await fetchEvents(match.place_id, this.cfg.serviceId, this.cfg.timezone);
      const num = parts.streetNumber ?? houseNumber(match.name);
      const schedule = buildScheduleFromEvents(events, match.name, this.cfg, num);
      log.debug(
        `[sweepalert:recollect] ${this.cfg.city} ${match.name} side=${schedule.side} ` +
          `dates=[${(schedule.explicitDates ?? []).slice(0, 3).join(', ')}...]`,
      );
      return schedule;
    } catch (err) {
      log.warn(`[ReCollect:${this.cfg.id}] lookup failed:`, err);
      throw err instanceof LookupFailedError ? err : new LookupFailedError(`ReCollect ${this.cfg.city} lookup failed`, err);
    }
  }

  getNextCleaning(schedule: CleaningSchedule, from: Date): Date | null {
    return getNextCleaning(schedule, from);
  }
}
