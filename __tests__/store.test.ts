/**
 * Integration tests for the real Zustand store (state/store.ts) under node.
 * Device/network edges are mocked: AsyncStorage (in-memory, with switchable
 * read failure), the notification service and the provider registry (a fake
 * provider whose lookups each test controls). The store module is re-required
 * per "launch" via jest.isolateModules so hydration runs from scratch.
 */
import { CleaningSchedule, Car } from '../src/types';
import { SNAPSHOT_BLOCKS, toSchedule } from '../src/data/snapshot';
import { getNextCleaning, MAX_CARS, perCarCap } from '../src/services/scheduling';

// ---- mocks (names must start with `mock` to be usable in jest.mock factories) ----

const mockMem = new Map<string, string>();
const mockStorageCtl = { failGet: false };
const mockSetItem = jest.fn(async (k: string, v: string) => {
  mockMem.set(k, v);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => {
      if (mockStorageCtl.failGet) throw new Error('disk read failed');
      return mockMem.get(k) ?? null;
    }),
    setItem: (k: string, v: string) => mockSetItem(k, v),
    removeItem: jest.fn(async (k: string) => {
      mockMem.delete(k);
    }),
  },
}));

// Outside the factory so tests can inspect calls across isolated registries.
const mockSync = jest.fn(async (_car: Car, _cap: number) => ({}));

jest.mock('../src/services/notifications', () => ({
  syncCarNotifications: (car: Car, cap: number) => mockSync(car, cap),
  cancelCarNotifications: jest.fn(async () => undefined),
}));

const mockLookup = jest.fn<Promise<CleaningSchedule | null>, [number, number]>();

jest.mock('../src/data/providers', () => {
  const { getNextCleaning: next } = jest.requireActual('../src/services/scheduling');
  return {
    getProvider: () => ({
      id: 'fake',
      name: 'Fake',
      getScheduleForLocation: (lat: number, lng: number) => mockLookup(lat, lng),
      getNextCleaning: next,
    }),
  };
});

// ---- helpers ----

const KEY = 'sweepalert-v1';
type StoreModule = typeof import('../src/state/store');

/** Simulate an app launch: fresh module registry, so persist hydrates again. */
function launch(): StoreModule {
  let mod!: StoreModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../src/state/store');
  });
  return mod;
}

async function until(cond: () => boolean, label = 'condition'): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Launch and wait until init has finished (hydrated is set in init's finally). */
async function launchReady(): Promise<StoreModule> {
  const m = launch();
  await until(() => m.useStore.getState().hydrated, 'init');
  return m;
}

function persisted(): {
  state: { cars: Car[]; seeded: boolean; defaultReminders?: { label: string }[] };
  version: number;
} | null {
  const raw = mockMem.get(KEY);
  return raw ? JSON.parse(raw) : null;
}

type Saved = Partial<{ cars: Car[]; seeded: boolean; showEmpty: boolean; theme: string; defaultReminders: unknown[] }>;

function savePersisted(state: Saved, version = 4) {
  mockMem.set(
    KEY,
    JSON.stringify({ state: { theme: 'light', showEmpty: false, seeded: true, cars: [], ...state }, version }),
  );
}

const BLOCK = SNAPSHOT_BLOCKS[0];
/** A schedule with a concrete far-future date, so nextCleaning is deterministic. */
function sched(address: string, date = '2099-05-01'): CleaningSchedule {
  return { ...toSchedule(BLOCK), address, explicitDates: [date] };
}

function car(id: string, opts: { lat?: number; lng?: number; schedule?: CleaningSchedule } = {}): Car {
  const lat = opts.lat ?? BLOCK.lat;
  const lng = opts.lng ?? BLOCK.lng;
  return {
    id,
    name: id,
    color: '#000',
    plate: 'X',
    location: { carId: id, lat, lng, address: 'Somewhere', blockId: toSchedule(BLOCK).blockId, savedAt: 1 },
    schedule: opts.schedule,
    nextCleaning: opts.schedule ? getNextCleaning(opts.schedule, new Date())!.getTime() : undefined,
    reminders: [],
    createdAt: 1,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  mockMem.clear();
  mockStorageCtl.failGet = false;
  mockSetItem.mockClear();
  mockSync.mockClear();
  mockLookup.mockReset();
  mockLookup.mockResolvedValue(null);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---- tests ----

describe('seeding', () => {
  it('seeds demo cars once on a fresh install, and not again on the next launch', async () => {
    const first = await launchReady();
    const seeded = first.useStore.getState().cars;
    expect(seeded.length).toBeGreaterThan(0);
    expect(first.useStore.getState().seeded).toBe(true);
    expect(persisted()?.state.seeded).toBe(true);

    const second = await launchReady();
    expect(second.useStore.getState().cars.map((c) => c.id)).toEqual(seeded.map((c) => c.id));
  });

  it('does not re-seed after the user deletes every car', async () => {
    const first = await launchReady();
    for (const c of first.useStore.getState().cars) {
      await first.useStore.getState().removeCar(c.id);
    }
    expect(persisted()?.state.cars).toEqual([]);

    const second = await launchReady();
    expect(second.useStore.getState().cars).toEqual([]);
  });
});

describe('lookup result handling (provider contract)', () => {
  it('a null lookup (authoritative "no schedule") clears a cached schedule', async () => {
    savePersisted({ cars: [car('a', { schedule: sched('Old St') })] });
    mockLookup.mockResolvedValue(null);
    const m = await launchReady();
    const a = m.useStore.getState().cars[0];
    expect(a.schedule).toBeUndefined();
    expect(a.nextCleaning).toBeNull();
  });

  it('a thrown lookup (unknown, e.g. offline) keeps the cached schedule', async () => {
    const cached = sched('Old St');
    savePersisted({ cars: [car('a', { schedule: cached })] });
    mockLookup.mockRejectedValue(new Error('network down'));
    const m = await launchReady();
    const a = m.useStore.getState().cars[0];
    expect(a.schedule).toEqual(cached);
    expect(a.nextCleaning).toBe(getNextCleaning(cached, new Date())!.getTime());
  });
});

describe('hydration failure', () => {
  it('blocks writes (never persists defaults), flags loadError, and recovers on foreground retry', async () => {
    savePersisted({ cars: [car('real')] });
    mockStorageCtl.failGet = true;
    const m = launch();
    await until(() => m.useStore.getState().loadError, 'loadError');

    // Store still holds defaults; any mutation must not reach storage.
    m.useStore.getState().toggleTheme();
    // addCar is refused too: a session-only car would vanish on a successful
    // retry while its scheduled alerts stayed behind as orphans.
    await expect(m.useStore.getState().addCar({ name: 'x', color: '#fff' })).resolves.toBeNull();
    expect(m.useStore.getState().cars).toEqual([]);
    expect(mockSync).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(persisted()?.state.cars.map((c) => c.id)).toEqual(['real']);
    expect(mockLookup).not.toHaveBeenCalled(); // init didn't run

    // Storage readable again: foregrounding retries hydration and runs init.
    mockStorageCtl.failGet = false;
    await m.onAppActive();
    await until(() => m.useStore.getState().hydrated, 'init after retry');
    expect(m.useStore.getState().loadError).toBe(false);
    expect(m.useStore.getState().cars.map((c) => c.id)).toEqual(['real']);
    expect(mockSetItem).toHaveBeenCalled();
    expect(persisted()?.state.cars.map((c) => c.id)).toEqual(['real']);
  });
});

describe('car limit', () => {
  it('addCar refuses past MAX_CARS', async () => {
    const cars = Array.from({ length: MAX_CARS }, (_, i) => ({ ...car(`c${i}`), location: undefined }));
    savePersisted({ cars });
    const ready = await launchReady();
    expect(ready.useStore.getState().cars).toHaveLength(MAX_CARS);
    await expect(ready.useStore.getState().addCar({ name: 'one more', color: '#fff' })).resolves.toBeNull();
    expect(ready.useStore.getState().cars).toHaveLength(MAX_CARS);
  });

  it('addCar returns the new id below the limit', async () => {
    savePersisted({ cars: [] });
    const m = await launchReady();
    const id = await m.useStore.getState().addCar({ name: 'new', color: '#fff' });
    expect(typeof id).toBe('string');
    expect(m.useStore.getState().cars.map((c) => c.id)).toEqual([id]);
  });
});

describe('refresh coalescing', () => {
  it('addCar during an in-flight refresh re-plans every car with the smaller budget', async () => {
    const ids = ['c0', 'c1', 'c2', 'c3'];
    savePersisted({ cars: ids.map((id, i) => car(id, { lat: BLOCK.lat + i * 0.001 })) });
    const last = deferred<CleaningSchedule | null>();
    mockLookup
      .mockResolvedValueOnce(sched('S0'))
      .mockResolvedValueOnce(sched('S1'))
      .mockResolvedValueOnce(sched('S2'))
      .mockReturnValueOnce(last.promise);

    const m = launch();
    // Launch refresh (forced) has synced c0..c2 and is waiting on c3's lookup.
    await until(() => mockLookup.mock.calls.length === 4, 'c3 lookup');
    expect(perCarCap(5)).toBeLessThan(perCarCap(4));

    const added = m.useStore.getState().addCar({ name: 'fifth', color: '#fff' });
    last.resolve(sched('S3'));
    await added;

    // Every original car's final sync uses the 5-car budget.
    for (const id of ids) {
      const caps = mockSync.mock.calls.filter(([c]) => c.id === id).map(([, cap]) => cap);
      expect(caps[caps.length - 1]).toBe(perCarCap(5));
    }
  });
});

describe('stale refresh results', () => {
  it('a re-park during an in-flight refresh drops the stale result', async () => {
    savePersisted({ cars: [car('a')] });
    const launchLookup = deferred<CleaningSchedule | null>();
    const parkLookup = deferred<CleaningSchedule | null>();
    mockLookup.mockReturnValueOnce(launchLookup.promise).mockReturnValueOnce(parkLookup.promise);

    const m = launch();
    await until(() => mockLookup.mock.calls.length === 1, 'launch lookup');

    // User re-parks while the launch refresh is still waiting on the network.
    const spot = { carId: 'a', lat: BLOCK.lat + 0.01, lng: BLOCK.lng, address: 'New spot', blockId: 'x', savedAt: 2 };
    const parked = m.useStore.getState().parkCar('a', spot);
    await until(() => mockLookup.mock.calls.length === 2, 'park lookup');

    parkLookup.resolve(sched('New St'));
    await parked;
    launchLookup.resolve(sched('Old St')); // late result for the old spot
    await until(() => m.useStore.getState().hydrated, 'init');

    const a = m.useStore.getState().cars[0];
    expect(a.location).toEqual(spot);
    expect(a.schedule?.address).toBe('New St');
  });
});

describe('default reminders', () => {
  const night = { label: 'Night before at 8pm', offsetMinutes: 1440, timeOfDayOverride: '20:00' };

  it('an old (v4) install migrates to the initial default, and addCar uses it', async () => {
    savePersisted({ cars: [] }, 4);
    const m = await launchReady();
    expect(m.useStore.getState().defaultReminders).toEqual([expect.objectContaining({ ...night, channel: 'push' })]);
    const id = (await m.useStore.getState().addCar({ name: 'new', color: '#fff' }))!;
    const added = m.useStore.getState().cars.find((c) => c.id === id)!;
    expect(added.reminders).toEqual([expect.objectContaining({ ...night, carId: id, enabled: true })]);
    expect(persisted()?.version).toBe(5);
    expect(persisted()?.state.defaultReminders?.map((d) => d.label)).toEqual(['Night before at 8pm']);
  });

  it('addCar copies the current defaults with fresh ids', async () => {
    savePersisted({ cars: [] }, 5);
    const m = await launchReady();
    const s = m.useStore.getState();
    expect(s.addDefaultReminder({ label: '1 hour before', offsetMinutes: 60, channel: 'alarm' })).toBe(true);
    const a = (await s.addCar({ name: 'a', color: '#fff' }))!;
    const b = (await s.addCar({ name: 'b', color: '#fff' }))!;
    const ra = m.useStore.getState().cars.find((c) => c.id === a)!.reminders;
    const rb = m.useStore.getState().cars.find((c) => c.id === b)!.reminders;
    expect(ra.map((r) => r.label)).toEqual(['Night before at 8pm', '1 hour before']);
    expect(ra[1].channel).toBe('alarm');
    const ids = [...ra, ...rb].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(m.useStore.getState().defaultReminders[0].id);
  });

  it('edits, recolors and removes defaults without touching existing cars', async () => {
    savePersisted({ cars: [car('a')] }, 5);
    const m = await launchReady();
    const s = m.useStore.getState();
    const d = s.defaultReminders[0];
    expect(s.updateDefaultReminder(d.id, { label: '2 days before at 7pm', offsetMinutes: 2880, timeOfDayOverride: '19:00' })).toBe(true);
    s.setDefaultReminderChannel(d.id, 'alarm');
    expect(m.useStore.getState().defaultReminders[0]).toMatchObject({ label: '2 days before at 7pm', channel: 'alarm' });
    expect(s.addDefaultReminder({ label: 'dup', offsetMinutes: 2880, timeOfDayOverride: '19:00', channel: 'push' })).toBe(false);
    s.removeDefaultReminder(d.id);
    expect(m.useStore.getState().defaultReminders).toEqual([]);
    expect(m.useStore.getState().cars[0].reminders).toEqual([]);
  });

  it('applyDefaultsToAllCars replaces every car\'s reminders and resyncs each car', async () => {
    const withReminder = (id: string): Car => ({
      ...car(id, { schedule: sched('S') }),
      reminders: [{ id: `${id}-old`, carId: id, label: '15 min before', offsetMinutes: 15, channel: 'push', enabled: false }],
    });
    savePersisted({ cars: [withReminder('a'), withReminder('b')] }, 5);
    mockLookup.mockRejectedValue(new Error('offline')); // keep cached schedules
    const m = await launchReady();
    mockSync.mockClear();
    await expect(m.useStore.getState().applyDefaultsToAllCars()).resolves.toBe(true);
    const cars = m.useStore.getState().cars;
    for (const c of cars) {
      expect(c.reminders).toEqual([expect.objectContaining({ ...night, carId: c.id, enabled: true })]);
    }
    expect(cars[0].reminders[0].id).not.toBe(cars[1].reminders[0].id);
    const synced = mockSync.mock.calls.map(([c]) => [c.id, c.reminders.map((r) => r.label)]);
    expect(synced).toEqual([
      ['a', ['Night before at 8pm']],
      ['b', ['Night before at 8pm']],
    ]);
  });

  it('defaults and apply are refused while saved state failed to load', async () => {
    savePersisted({ cars: [car('real')] }, 5);
    mockStorageCtl.failGet = true;
    const m = launch();
    await until(() => m.useStore.getState().loadError, 'loadError');
    const s = m.useStore.getState();
    expect(s.addDefaultReminder({ label: '1 hour before', offsetMinutes: 60, channel: 'push' })).toBe(false);
    await expect(s.applyDefaultsToAllCars()).resolves.toBe(false);
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});

describe('reminder editing', () => {
  it('updateReminder changes the fire timing and resyncs', async () => {
    const schedule = sched('S', '2099-05-07'); // a Thursday
    savePersisted({
      cars: [
        {
          ...car('a', { schedule }),
          reminders: [{ id: 'r1', carId: 'a', label: '1 hour before', offsetMinutes: 60, channel: 'push', enabled: true }],
        },
      ],
    }, 5);
    mockLookup.mockRejectedValue(new Error('offline'));
    const m = await launchReady();
    mockSync.mockClear();
    const ok = await m.useStore
      .getState()
      .updateReminder('a', 'r1', { label: '2 days before at 7pm', offsetMinutes: 2880, timeOfDayOverride: '19:00', channel: 'alarm' });
    expect(ok).toBe(true);
    const r = m.useStore.getState().cars[0].reminders[0];
    expect(r).toMatchObject({ id: 'r1', label: '2 days before at 7pm', offsetMinutes: 2880, timeOfDayOverride: '19:00', channel: 'alarm' });

    const { planCarNotifications } = jest.requireActual('../src/services/scheduling');
    const synced: Car = mockSync.mock.calls[mockSync.mock.calls.length - 1][0];
    const plan = planCarNotifications(synced, new Date());
    const { DateTime } = jest.requireActual('luxon');
    expect(DateTime.fromJSDate(plan[0].fireAt, { zone: schedule.timezone }).toFormat('yyyy-LL-dd HH:mm')).toBe(
      '2099-05-05 19:00',
    );

    // Back to a plain offset clears the override.
    await m.useStore.getState().updateReminder('a', 'r1', { label: '30 min before', offsetMinutes: 30 });
    expect(m.useStore.getState().cars[0].reminders[0].timeOfDayOverride).toBeUndefined();
    expect(m.useStore.getState().cars[0].reminders[0].channel).toBe('alarm'); // kept when omitted
  });

  it('prevents exact duplicates on one car (add and update)', async () => {
    savePersisted({
      cars: [
        {
          ...car('a'),
          reminders: [
            { id: 'r1', carId: 'a', label: 'Night before at 8pm', offsetMinutes: 1440, timeOfDayOverride: '20:00', channel: 'push', enabled: true },
            { id: 'r2', carId: 'a', label: '1 hour before', offsetMinutes: 60, channel: 'push', enabled: true },
          ],
        },
      ],
    }, 5);
    const m = await launchReady();
    const s = m.useStore.getState();
    await expect(s.addReminder('a', { label: 'again', offsetMinutes: 1440, timeOfDayOverride: '20:00', channel: 'alarm' })).resolves.toBe(false);
    await expect(s.addReminder('a', { label: '1 hour before', offsetMinutes: 60, channel: 'push' })).resolves.toBe(false);
    // Same offset, different override (1 day before vs night before) is not a duplicate.
    await expect(s.addReminder('a', { label: '1 day before', offsetMinutes: 1440, channel: 'push' })).resolves.toBe(true);
    await expect(s.updateReminder('a', 'r2', { label: 'x', offsetMinutes: 1440, timeOfDayOverride: '20:00' })).resolves.toBe(false);
    // Saving a reminder with its own unchanged timing is fine.
    await expect(s.updateReminder('a', 'r2', { label: '1 hour before', offsetMinutes: 60, channel: 'alarm' })).resolves.toBe(true);
    expect(m.useStore.getState().cars[0].reminders.map((r) => r.label)).toEqual(['Night before at 8pm', '1 hour before', '1 day before']);
  });
});
