import { CleaningSchedule } from '../../types';
import { getNextCleaning } from '../../services/scheduling';
import { reverseGeocodeParts } from '../../services/location';
import { isWithinBoston } from '../coverage';
import { snapshotFallback, SNAPSHOT_BLOCKS } from '../snapshot';
import { fetchRowsForStreet, pickRow, PickOptions, rowToSchedule } from './bostonApi';
import { nearestSegment } from './samSegments';
import { neighborhoodAt } from './bostonNeighborhoods';
import { StreetCleaningProvider } from './types';

/**
 * Boston reference provider.
 *
 * Street resolution is geometry-first: it snaps the GPS point to the nearest
 * real road segment via Boston's live SAM layer (samSegments.ts) to get the
 * correct street *and side*, then looks that up in the name-keyed street-
 * sweeping open dataset (bostonApi.ts). If SAM is unreachable it falls back to
 * Apple reverse-geocoding for the street name; if the whole network is down it
 * falls back to the bundled offline snapshot — but only for a point right on a
 * snapshot block (SNAPSHOT_MAX_KM). Otherwise it returns null and the store
 * keeps the car's cached schedule.
 *
 * Returns null when the point is outside Boston coverage, or when the resolved
 * street simply has no sweeping schedule — never fabricated data.
 */
export class BostonProvider implements StreetCleaningProvider {
  readonly id = 'boston';
  readonly name = 'Boston (SAM geometry + Analyze Boston open data)';

  async getScheduleForLocation(lat: number, lng: number): Promise<CleaningSchedule | null> {
    // Out of coverage: no Boston data applies.
    if (!isWithinBoston(lat, lng)) return null;

    // No in-memory cache: the store owns caching (car.schedule) and can force a
    // fresh lookup; caching here only risks serving stale results after a fix.

    let street: string | undefined;
    let opts: PickOptions = {};

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
        console.log('[sweepalert:provider] point outside Boston — no coverage');
        return null;
      }
      if (seg) {
        street = seg.street;
        opts = {
          // Prefer the precise BPDA neighborhood over SAM's coarse municipality.
          neighborhood: hoodRes.name ?? seg.neighborhood,
          side: seg.side,
          crossStreets: seg.candidates, // nearby streets pin the exact block
        };
      }
    } catch (err) {
      console.warn('[BostonProvider] SAM lookup failed:', err);
    }

    // 2) Fallback: Apple reverse-geocode for a street name.
    if (!street) {
      try {
        const parts = await reverseGeocodeParts(lat, lng);
        street = parts.street;
        opts = { neighborhood: parts.neighborhood };
      } catch (err) {
        console.warn('[BostonProvider] reverse-geocode failed:', err);
      }
    }

    console.log(
      `[sweepalert:provider] resolved street="${street ?? 'none'}" side=${opts.side ?? '?'} ` +
        `nb=${opts.neighborhood ?? '?'} cross=[${(opts.crossStreets ?? []).slice(0, 5).join(', ')}]`,
    );

    if (street) {
      try {
        const rows = await fetchRowsForStreet(street);
        const row = pickRow(rows, opts);
        console.log(
          `[sweepalert:provider] ${rows.length} rows; picked ${row?.dist_name ?? '-'}/${row?.side ?? '-'}/` +
            `${row?.from ?? '-'}->${row?.to ?? '-'} => ${row ? rowToSchedule(row).scheduleLabel : 'none'}`,
        );
        return row ? rowToSchedule(row) : null;
      } catch (err) {
        // Network error querying the dataset -> offline snapshot.
        console.warn('[BostonProvider] sweeping query failed, using snapshot:', err);
        return this.fallback(lat, lng);
      }
    }

    // Couldn't resolve a street at all (likely fully offline) -> snapshot.
    return this.fallback(lat, lng);
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

  /** Distance-gated snapshot lookup; null when no snapshot block is nearby. */
  private fallback(lat: number, lng: number): CleaningSchedule | null {
    return snapshotFallback(lat, lng);
  }
}

/** Convenience: the addresses in the bundled snapshot (for demo/debug UI). */
export const BUNDLED_BOSTON_ADDRESSES = SNAPSHOT_BLOCKS.map((b) => b.address);
