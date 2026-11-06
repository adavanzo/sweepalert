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

function persisted(): { state: { cars: Car[]; seeded: boolean }; version: number } | null {
  const raw = mockMem.get(KEY);
  return raw ? JSON.parse(raw) : null;
}

function savePersisted(state: Partial<{ cars: Car[]; seeded: boolean; showEmpty: boolean; theme: string }>) {
  mockMem.set(
    KEY,
    JSON.stringify({ state: { theme: 'light', showEmpty: false, seeded: true, cars: [], ...state }, version: 4 }),
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
