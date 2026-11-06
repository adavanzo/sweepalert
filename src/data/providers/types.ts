import { CleaningSchedule } from '../../types';

/**
 * Thrown by getScheduleForLocation when the provider could not determine the
 * answer (network down, service error, geocoder unavailable) and has no
 * trustworthy fallback. Distinct from a null result, which is an authoritative
 * "no schedule here": the store keeps a car's cached schedule on this error,
 * but clears it on null.
 */
export class LookupFailedError extends Error {
  /** The underlying error, if any (kept for logging). */
  readonly original?: unknown;

  constructor(message: string, original?: unknown) {
    super(message);
    this.name = 'LookupFailedError';
    this.original = original;
    // Keep instanceof working when compiled down to ES5 classes.
    Object.setPrototypeOf(this, LookupFailedError.prototype);
  }
}

/**
 * Pluggable street-cleaning schedule provider. Add a city by implementing this
 * interface and registering it (see data/providers/index.ts). See the README
 * "Adding a new city" section for a worked example.
 */
export interface StreetCleaningProvider {
  /** Stable id, e.g. "boston" / "boston-mock". */
  readonly id: string;
  /** Human name for settings/debug. */
  readonly name: string;

  /**
   * Resolve the cleaning schedule for a given coordinate by finding the nearest
   * street segment / block.
   *
   * Return null ONLY for an authoritative "no schedule here": the point is
   * outside the provider's coverage, or the resolved street/address has no
   * sweeping schedule. The store treats null as the truth and clears any cached
   * schedule for the car.
   *
   * Throw (preferably a LookupFailedError) when the answer could not be
   * determined — network down, service/HTTP error, geocoder unavailable — and
   * there is no trustworthy fallback (e.g. a nearby offline snapshot block).
   * The store then keeps the car's cached schedule.
   */
  getScheduleForLocation(lat: number, lng: number): Promise<CleaningSchedule | null>;

  /**
   * Given a schedule and a reference instant, compute the next cleaning
   * datetime, honoring the recurrence rules and the seasonal on/off window.
   * Returns null when there is no cleaning within the search horizon (e.g. deep
   * in the off-season with a short horizon).
   */
  getNextCleaning(schedule: CleaningSchedule, from: Date): Date | null;

  /**
   * Optional: resolve a schedule for an explicitly chosen street name, for a
   * "wrong street?" correction affordance. Providers without a name index can
   * omit this.
   */
  getScheduleForStreet?(
    street: string,
    opts?: {
      neighborhood?: string;
      side?: import('../../types').StreetSide;
      /** Nearby cross streets, to pin the correct block of the chosen street. */
      crossStreets?: string[];
    },
  ): Promise<CleaningSchedule | null>;
}
