import { CleaningSchedule } from '../../types';

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
   * street segment / block. Should never throw for a well-formed coordinate —
   * return null when the location is outside the provider's coverage.
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
