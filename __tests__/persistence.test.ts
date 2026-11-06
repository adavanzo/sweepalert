import { migratePersisted, PERSIST_VERSION, shouldSeed } from '../src/state/persistence';
import { SNAPSHOT_BLOCKS } from '../src/data/snapshot';
import { Car } from '../src/types';

const car = (id: string): Car =>
  ({
    id,
    name: id,
    color: '#000',
    plate: 'MA',
    reminders: [],
    createdAt: 0,
    schedule: { blockId: 'x' } as Car['schedule'],
    nextCleaning: 123,
  }) as Car;

describe('shouldSeed', () => {
  it('seeds on a genuine first launch', () => {
    expect(shouldSeed({ cars: [], showEmpty: false, seeded: false })).toBe(true);
  });

  it('does not re-seed after the user removed every car', () => {
    expect(shouldSeed({ cars: [], showEmpty: false, seeded: true })).toBe(false);
  });

  it('does not seed in the forced empty state', () => {
    expect(shouldSeed({ cars: [], showEmpty: true, seeded: false })).toBe(false);
  });

  it('never overwrites existing cars', () => {
    expect(shouldSeed({ cars: [car('a')], showEmpty: false, seeded: false })).toBe(false);
  });
});

describe('migratePersisted', () => {
  it('is at version 5', () => {
    expect(PERSIST_VERSION).toBe(5);
  });

  it('gives pre-v5 installs the initial default reminder, and keeps existing ones', () => {
    const out = migratePersisted({ cars: [car('a')], seeded: true }, 4) as { defaultReminders: unknown[]; cars: Car[] };
    expect(out.defaultReminders).toEqual([
      expect.objectContaining({ label: 'Night before at 8pm', offsetMinutes: 1440, timeOfDayOverride: '20:00', channel: 'push' }),
    ]);
    expect(out.cars[0].reminders).toEqual([]); // cars are untouched
    const custom = [{ id: 'd1', label: '1 hour before', offsetMinutes: 60, channel: 'alarm' }];
    expect(migratePersisted({ cars: [], defaultReminders: custom }, 4)).toMatchObject({ defaultReminders: custom });
  });

  it('marks existing installs (with a cars array) as seeded, even when empty', () => {
    expect(migratePersisted({ cars: [], showEmpty: false }, 3)).toMatchObject({ seeded: true });
    expect(migratePersisted({ cars: [car('a')] }, 3)).toMatchObject({ seeded: true });
  });

  it('keeps cached schedules from v3, drops them from older versions', () => {
    const v3 = migratePersisted({ cars: [car('a')] }, 3) as { cars: Car[] };
    expect(v3.cars[0].schedule).toBeDefined();
    const v2 = migratePersisted({ cars: [car('a')] }, 2) as { cars: Car[]; seeded: boolean };
    expect(v2.cars[0].schedule).toBeUndefined();
    expect(v2.cars[0].nextCleaning).toBeUndefined();
    expect(v2.seeded).toBe(true);
  });

  it('drops v3 snapshot schedules cached for a car far from that block', () => {
    const b = SNAPSHOT_BLOCKS[0];
    const parked = (id: string, lat: number, lng: number, blockId: string): Car =>
      ({
        ...car(id),
        location: { carId: id, lat, lng, address: '', blockId, savedAt: 0 },
        schedule: { blockId } as Car['schedule'],
      }) as Car;
    const out = migratePersisted(
      {
        cars: [
          parked('onBlock', b.lat, b.lng, b.blockId), // seeded demo car: kept
          parked('far', b.lat + 0.02, b.lng, b.blockId), // ~2 km away: fabricated
          parked('live', b.lat + 0.02, b.lng, 'bos-12345'), // live data: kept
        ],
      },
      3,
    ) as { cars: Car[] };
    expect(out.cars.map((c) => c.schedule?.blockId)).toEqual([b.blockId, undefined, 'bos-12345']);
    expect(out.cars[1].nextCleaning).toBeUndefined();
  });

  it('leaves state without cars alone and tolerates undefined', () => {
    expect(migratePersisted({ theme: 'dark' }, 3)).toEqual({ theme: 'dark', defaultReminders: expect.any(Array) });
    expect(migratePersisted({ theme: 'dark' }, 5)).toEqual({ theme: 'dark' });
    expect(migratePersisted(undefined, 3)).toBeUndefined();
  });
});
