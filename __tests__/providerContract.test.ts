/**
 * Provider contract (providers/types.ts): null = authoritative "no schedule",
 * throw (LookupFailedError) = could not determine. Network edges are mocked.
 */
import { SNAPSHOT_BLOCKS } from '../src/data/snapshot';
// jest.mock calls below are hoisted above these imports.
import { BostonProvider } from '../src/data/providers/BostonProvider';
import { getProvider, LookupFailedError } from '../src/data/providers';

const mockGeocode = jest.fn();
const mockSegment = jest.fn();
const mockHood = jest.fn();
const mockRows = jest.fn();

jest.mock('../src/services/location', () => ({
  reverseGeocodeParts: (lat: number, lng: number) => mockGeocode(lat, lng),
}));
jest.mock('../src/data/providers/samSegments', () => ({
  nearestSegment: (lat: number, lng: number) => mockSegment(lat, lng),
}));
jest.mock('../src/data/providers/bostonNeighborhoods', () => ({
  neighborhoodAt: (lat: number, lng: number) => mockHood(lat, lng),
}));
jest.mock('../src/data/providers/bostonApi', () => ({
  fetchRowsForStreet: (s: string) => mockRows(s),
  pickRow: (rows: unknown[]) => rows[0] ?? null,
  rowToSchedule: () => ({ scheduleLabel: 'row' }),
}));

const OFFLINE = new Error('network down');
// Downtown Boston, but far (> SNAPSHOT_MAX_KM) from every snapshot block.
const FAR = { lat: 42.3, lng: -71.1 };

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Fully offline by default: geocoder degrades to a bare label.
  mockGeocode.mockImplementation(async (lat: number, lng: number) => ({ full: `${lat}, ${lng}` }));
  mockSegment.mockRejectedValue(OFFLINE);
  mockHood.mockRejectedValue(OFFLINE);
  mockRows.mockRejectedValue(OFFLINE);
});

afterEach(() => jest.restoreAllMocks());

describe('BostonProvider', () => {
  const p = new BostonProvider();

  it('returns null outside Boston coverage (authoritative)', async () => {
    await expect(p.getScheduleForLocation(40.7, -74.0)).resolves.toBeNull();
  });

  it('returns null when the point is confirmed outside every Boston neighborhood', async () => {
    mockHood.mockResolvedValue(null);
    await expect(p.getScheduleForLocation(FAR.lat, FAR.lng)).resolves.toBeNull();
  });

  it('returns null when the street resolved but has no sweeping row', async () => {
    mockHood.mockResolvedValue('Back Bay');
    mockSegment.mockResolvedValue({ street: 'Nowhere St', side: 'odd', candidates: [] });
    mockRows.mockResolvedValue([]);
    await expect(p.getScheduleForLocation(FAR.lat, FAR.lng)).resolves.toBeNull();
  });

  it('offline on a snapshot block: uses the snapshot', async () => {
    const b = SNAPSHOT_BLOCKS[0];
    const s = await p.getScheduleForLocation(b.lat, b.lng);
    expect(s?.address).toBe(b.address);
  });

  it('offline with no nearby snapshot block: throws LookupFailedError', async () => {
    await expect(p.getScheduleForLocation(FAR.lat, FAR.lng)).rejects.toBeInstanceOf(LookupFailedError);
  });

  it('SAM down, geocoder-guessed street has no row, no snapshot nearby: throws (not authoritative)', async () => {
    mockHood.mockResolvedValue('Back Bay');
    mockGeocode.mockResolvedValue({ full: '1 Main St', street: 'Main St', city: 'Boston' });
    mockRows.mockResolvedValue([]);
    await expect(p.getScheduleForLocation(FAR.lat, FAR.lng)).rejects.toBeInstanceOf(LookupFailedError);
  });

  it('SAM down, geocoder-guessed street has no row, on a snapshot block: uses the snapshot', async () => {
    const b = SNAPSHOT_BLOCKS[0];
    mockGeocode.mockResolvedValue({ full: '1 Main St', street: 'Main St', city: 'Boston' });
    mockRows.mockResolvedValue([]);
    const s = await p.getScheduleForLocation(b.lat, b.lng);
    expect(s?.address).toBe(b.address);
  });

  it('street resolved but the dataset query failed, no snapshot nearby: throws', async () => {
    mockGeocode.mockResolvedValue({ full: '1 Main St', street: 'Main St', city: 'Boston' });
    await expect(p.getScheduleForLocation(FAR.lat, FAR.lng)).rejects.toBeInstanceOf(LookupFailedError);
  });
});

describe('GreaterBostonProvider router', () => {
  it('geocoder down and Boston says "not mine": throws (might be Cambridge)', async () => {
    mockHood.mockResolvedValue(null); // Boston: outside its neighborhoods
    await expect(getProvider().getScheduleForLocation(FAR.lat, FAR.lng)).rejects.toBeInstanceOf(LookupFailedError);
  });

  it('geocoder down but Boston confirms an in-Boston street with no row: null', async () => {
    mockHood.mockResolvedValue('Back Bay');
    mockSegment.mockResolvedValue({ street: 'X St', side: 'odd', candidates: [] });
    mockRows.mockResolvedValue([]);
    await expect(getProvider().getScheduleForLocation(FAR.lat, FAR.lng)).resolves.toBeNull();
  });

  it('city known and Boston says "not mine": null', async () => {
    mockGeocode.mockResolvedValue({ full: '1 Elm St', street: 'Elm St', city: 'Somerville' });
    mockHood.mockResolvedValue(null);
    await expect(getProvider().getScheduleForLocation(FAR.lat, FAR.lng)).resolves.toBeNull();
  });

  it('Cambridge point with ReCollect unreachable: throws instead of null', async () => {
    mockGeocode.mockResolvedValue({ full: '5 JFK St', street: 'JFK St', city: 'Cambridge', streetNumber: 5 });
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(OFFLINE) as unknown as typeof fetch;
    try {
      await expect(getProvider().getScheduleForLocation(42.373, -71.119)).rejects.toBeInstanceOf(LookupFailedError);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('Cambridge address not in ReCollect: null (authoritative)', async () => {
    mockGeocode.mockResolvedValue({ full: '5 JFK St', street: 'JFK St', city: 'Cambridge', streetNumber: 5 });
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
    try {
      await expect(getProvider().getScheduleForLocation(42.373, -71.119)).resolves.toBeNull();
    } finally {
      global.fetch = realFetch;
    }
  });
});
