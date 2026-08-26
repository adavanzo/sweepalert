/**
 * Multi-city provider registry + router.
 *
 * `getProvider()` returns a routing meta-provider: it reverse-geocodes the point
 * to a city and delegates to that city's provider (Boston = open data; Cambridge
 * = ReCollect). Adding a city = implement StreetCleaningProvider and add a route.
 */
import { CleaningSchedule } from '../../types';
import { getNextCleaning } from '../../services/scheduling';
import { reverseGeocodeParts } from '../../services/location';
import { BostonProvider } from './BostonProvider';
import { MockProvider } from './MockProvider';
import { ReCollectProvider, RECOLLECT_CITIES } from './recollect';
import { PickOptions } from './bostonMapping';
import { StreetCleaningProvider } from './types';

export * from './types';

/**
 * Routes a coordinate to the correct city provider. Boston self-gates to its
 * real boundary (returns null outside), so Boston is the safe default; a point
 * the geocoder tags as Cambridge goes to the Cambridge (ReCollect) provider.
 */
class GreaterBostonProvider implements StreetCleaningProvider {
  readonly id = 'greater-boston';
  readonly name = 'Greater Boston';

  private boston = new BostonProvider();
  private cambridge = new ReCollectProvider(RECOLLECT_CITIES.cambridge);

  async getScheduleForLocation(lat: number, lng: number): Promise<CleaningSchedule | null> {
    const city = (await reverseGeocodeParts(lat, lng)).city?.toLowerCase() ?? '';
    if (city.includes('cambridge')) return this.cambridge.getScheduleForLocation(lat, lng);
    // Boston (and anything else) -> Boston, which returns null when out of its
    // boundary, so we never fabricate a schedule for an unsupported area.
    return this.boston.getScheduleForLocation(lat, lng);
  }

  getNextCleaning(schedule: CleaningSchedule, from: Date): Date | null {
    return getNextCleaning(schedule, from);
  }

  // Street-name override is a Boston feature (SAM-driven); ReCollect is parcel-based.
  getScheduleForStreet(street: string, opts?: PickOptions): Promise<CleaningSchedule | null> {
    return this.boston.getScheduleForStreet(street, opts);
  }
}

const REGISTRY: Record<string, () => StreetCleaningProvider> = {
  'greater-boston': () => new GreaterBostonProvider(),
  boston: () => new BostonProvider(),
  'boston-mock': () => new MockProvider(),
};

/** The active provider: the multi-city router. */
export const ACTIVE_PROVIDER_ID = 'greater-boston';

let cached: StreetCleaningProvider | null = null;

export function getProvider(id: string = ACTIVE_PROVIDER_ID): StreetCleaningProvider {
  if (cached && cached.id === id) return cached;
  const make = REGISTRY[id] ?? REGISTRY[ACTIVE_PROVIDER_ID];
  cached = make();
  return cached;
}

export function listProviders(): { id: string; name: string }[] {
  return Object.keys(REGISTRY).map((id) => {
    const p = REGISTRY[id]();
    return { id: p.id, name: p.name };
  });
}
