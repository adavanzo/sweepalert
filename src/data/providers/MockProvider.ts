import { CleaningSchedule } from '../../types';
import { getNextCleaning } from '../../services/scheduling';
import { nearestBlock, toSchedule } from '../snapshot';
import { StreetCleaningProvider } from './types';

/**
 * Fully offline provider backed by the bundled Boston snapshot. Used for tests
 * and the first-run demo so the app runs end-to-end with zero external setup.
 */
export class MockProvider implements StreetCleaningProvider {
  readonly id = 'boston-mock';
  readonly name = 'Boston (bundled demo data)';

  async getScheduleForLocation(lat: number, lng: number): Promise<CleaningSchedule | null> {
    return toSchedule(nearestBlock(lat, lng));
  }

  getNextCleaning(schedule: CleaningSchedule, from: Date): Date | null {
    return getNextCleaning(schedule, from);
  }
}
