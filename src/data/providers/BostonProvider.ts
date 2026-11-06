import { CleaningSchedule } from '../../types';
import { getNextCleaning } from '../../services/scheduling';
import { reverseGeocodeParts } from '../../services/location';
import { log } from '../../services/log';
import { isWithinBoston } from '../coverage';
import { snapshotFallback, SNAPSHOT_BLOCKS } from '../snapshot';
import { fetchRowsForStreet, pickRow, PickOptions, rowToSchedule } from './bostonApi';
import { nearestSegment } from './samSegments';
import { neighborhoodAt } from './bostonNeighborhoods';
import { LookupFailedError, StreetCleaningProvider } from './types';

/**
 * Boston reference provider.
 *
 * Street resolution is geometry-first: it snaps the GPS point to the nearest
 * real road segment via Boston's live SAM layer (samSegments.ts) to get the
 * correct street *and side*, then looks that up in the name-keyed street-
 * sweeping open dataset (bostonApi.ts). If SAM is unreachable it falls back to
 * Apple reverse-geocoding for the street name; if the whole network is down it
 * falls back to the bundled offline snapshot — but only for a point right on a
 * snapshot block (SNAPSHOT_MAX_KM). Otherwise it throws LookupFailedError and
 * the store keeps the car's cached schedule.
 *
 * Returns null (authoritative) only when the point is outside Boston coverage,
 * or when the street SAM resolved simply has no sweeping schedule — never
 * fabricated data. A street name from the geocoder fallback is only a guess
 * (unnormalized, or a neighbouring street), so a miss on it is not a "no".
 */
/** Result of BostonProvider.lookup: the schedule plus why a null is null. */
export interface BostonLookup {
  schedule: CleaningSchedule | null;
  /**
   * The point is inside a known Boston neighborhood (BPDA polygons resolved).
   * Lets the router trust a "no row for this street" null even when it could
   * not geocode the city itself.
   */
  inBoston: boolean;
}

export class BostonProvider implements StreetCleaningProvider {
  readonly id = 'boston';
  readonly name = 'Boston (SAM geometry + Analyze Boston open data)';

  async getScheduleForLocation(lat: number, lng: number): Promise<CleaningSchedule | null> {
    return (await this.lookup(lat, lng)).schedule;
  }

  /** getScheduleForLocation plus whether the point is confirmed inside Boston. */
  async lookup(lat: number, lng: number): Promise<BostonLookup> {
    // Out of coverage: no Boston data applies.
    if (!isWithinBoston(lat, lng)) return { schedule: null, inBoston: false };

    // No in-memory cache: the store owns caching (car.schedule) and can force a
    // fresh lookup; caching here only risks serving stale results after a fix.

    let street: string | undefined;
    let opts: PickOptions = {};
    // True when `street` came from SAM geometry (trustworthy), false when it
    // came from the reverse-geocode fallback.
    let streetFromSam = false;
    let inBoston = false;

    // 1) Geometry-first: nearest real road segment via SAM (accurate street+side),
    //    plus the enclosing neighborhood (point-in-polygon) to disambiguate
    //    streets that repeat across the city. Both run in parallel.
    try {
      const [seg, hoodRes] = await Promise.all([
        nearestSegment(lat, lng).catch(() => null),
        // Distinguish "resolved, not in Boston" from "service failed".
        neighborhoodAt(lat, lng)
          .then((name) => ({ ok: true, name }))
          .catch(() => ({ ok: false, name: null as string | null })),
      ]);
      // If the point is confirmed inside NO Boston neighborhood, it's another
      // city (Cambridge, Somerville, Brookline…). The Boston sweeping data does
      // not apply — bail so a same-named street elsewhere can't match a Boston
      // row and show a bogus schedule.
      if (hoodRes.ok && !hoodRes.name) {
        log.debug('[sweepalert:provider] point outside Boston — no coverage');
        return { schedule: null, inBoston: false };
      }
      inBoston = !!hoodRes.name;
      if (seg) {
        street = seg.street;
        streetFromSam = true;
        opts = {
          // Prefer the precise BPDA neighborhood over SAM's coarse municipality.
          neighborhood: hoodRes.name ?? seg.neighborhood,
          side: seg.side,
          crossStreets: seg.candidates, // nearby streets pin the exact block
        };
      }
    } catch (err) {
      log.warn('[BostonProvider] SAM lookup failed:', err);
    }

    // 2) Fallback: Apple reverse-geocode for a street name.
    if (!street) {
      try {
        const parts = await reverseGeocodeParts(lat, lng);
        street = parts.street;
        opts = { neighborhood: parts.neighborhood };
      } catch (err) {
        log.warn('[BostonProvider] reverse-geocode failed:', err);
      }
    }

    // Street names are location data: debug only.
    log.debug(
      `[sweepalert:provider] resolved street="${street ?? 'none'}" side=${opts.side ?? '?'} ` +
        `nb=${opts.neighborhood ?? '?'} cross=[${(opts.crossStreets ?? []).slice(0, 5).join(', ')}]`,
    );

    if (street) {
      try {
        const rows = await fetchRowsForStreet(street);
        const row = pickRow(rows, opts);
        log.debug(
          `[sweepalert:provider] ${rows.length} rows; picked ${row?.dist_name ?? '-'}/${row?.side ?? '-'}/` +
            `${row?.from ?? '-'}->${row?.to ?? '-'} => ${row ? rowToSchedule(row).scheduleLabel : 'none'}`,
        );
        if (row) return { schedule: rowToSchedule(row), inBoston };
        // No row for a SAM-resolved street: authoritative "no schedule here".
        // For a geocoder-guessed street it may just be the wrong name: snapshot,
        // else unknown (keeps the car's cached schedule).
        if (streetFromSam) return { schedule: null, inBoston };
        return { schedule: this.fallback(lat, lng), inBoston };
      } catch (err) {
        // Network error querying the dataset -> offline snapshot, else unknown.
        log.warn('[BostonProvider] sweeping query failed, trying snapshot:', err);
        return { schedule: this.fallback(lat, lng, err), inBoston };
      }
    }

    // Couldn't resolve a street at all (SAM + geocode both failed, likely fully
    // offline) -> snapshot, else unknown.
    return { schedule: this.fallback(lat, lng), inBoston };
  }

  /**
   * Resolve a schedule for an explicitly chosen street name — used by the "wrong
   * street?" correction UI so the user can override the auto-detected street.
   */
  async getScheduleForStreet(street: string, opts: PickOptions = {}): Promise<CleaningSchedule | null> {
    const row = pickRow(await fetchRowsForStreet(street), opts);
    return row ? rowToSchedule(row) : null;
  }

  getNextCleaning(schedule: CleaningSchedule, from: Date): Date | null {
    return getNextCleaning(schedule, from);
  }

  /**
   * Distance-gated snapshot lookup for when the live lookup could not answer.
   * A snapshot block within SNAPSHOT_MAX_KM is a valid answer; with none nearby
   * we genuinely don't know, so throw (never return null here — null would tell
   * the store "no schedule" and wipe the car's cached one).
   */
  private fallback(lat: number, lng: number, cause?: unknown): CleaningSchedule {
    const snap = snapshotFallback(lat, lng);
    if (snap) return snap;
    throw new LookupFailedError('Boston lookup failed and no offline snapshot block is nearby', cause);
  }
}

/** Convenience: the addresses in the bundled snapshot (for demo/debug UI). */
export const BUNDLED_BOSTON_ADDRESSES = SNAPSHOT_BLOCKS.map((b) => b.address);
