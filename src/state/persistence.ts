/**
 * Pure persistence/seeding decisions for the store (no React Native / Expo
 * imports) so they are unit-testable under node — see __tests__/persistence.test.ts.
 */
import { blockById, haversineKm, SNAPSHOT_MAX_KM } from '../data/snapshot';
import { Car } from '../types';

/** Current persisted-state version (zustand persist `version`). */
export const PERSIST_VERSION = 4;

export interface SeedState {
  cars: Car[];
  showEmpty: boolean;
  /** True once demo cars were seeded (or the install already had cars). */
  seeded: boolean;
}

/**
 * Seed demo cars only on a genuine first launch: never seeded before, not in
 * the forced empty state, and no cars present. A user who deletes every car
 * keeps an empty list because `seeded` stays true.
 */
export function shouldSeed(s: SeedState): boolean {
  return !s.seeded && !s.showEmpty && s.cars.length === 0;
}

/**
 * zustand persist `migrate`. Mutates and returns the persisted blob.
 *  - < v3: drop cached schedules so cars re-resolve with the improved block
 *    matching (SAM cross-street disambiguation). Runs once per device.
 *  - < v4: introduces `seeded`. Any older install that already has a cars array
 *    has been through first launch, so mark it seeded (never re-seed it, even
 *    if the user had removed every car).
 *  - < v4: drop cached schedules that came from the offline snapshot for a car
 *    parked farther than SNAPSHOT_MAX_KM from that block. Older builds returned
 *    the nearest snapshot block at any distance (made-up data), and since the
 *    store now keeps a cached schedule when a lookup returns null, such a
 *    schedule would otherwise never be corrected.
 */
export function migratePersisted(persisted: unknown, fromVersion: number): unknown {
  const p = persisted as { cars?: Car[]; seeded?: boolean } | undefined;
  if (p?.cars && fromVersion < 3) {
    p.cars = p.cars.map((c) => ({ ...c, schedule: undefined, nextCleaning: undefined }));
  }
  if (p && Array.isArray(p.cars) && fromVersion < 4) {
    p.seeded = true;
    p.cars = p.cars.map((c) => (isFabricatedSnapshot(c) ? { ...c, schedule: undefined, nextCleaning: undefined } : c));
  }
  return p;
}

/** A cached snapshot schedule whose block is not actually where the car is. */
function isFabricatedSnapshot(c: Car): boolean {
  const block = c.schedule ? blockById(c.schedule.blockId) : undefined;
  if (!block) return false; // live data (or no schedule)
  if (!c.location) return true;
  return haversineKm(c.location.lat, c.location.lng, block.lat, block.lng) > SNAPSHOT_MAX_KM;
}
