/**
 * Shared helpers over the bundled offline Boston snapshot. Both the MockProvider
 * and the BostonProvider fallback path build CleaningSchedules from here.
 */
import { CleaningRule, CleaningSchedule, Season, StreetSide } from '../types';
import raw from './boston-snapshot.json';

interface RawBlock {
  blockId: string;
  lat: number;
  lng: number;
  address: string;
  blockLabel: string;
  scheduleLabel: string;
  seasonLabel: string;
  side: string;
  windowStart: string;
  windowEnd: string;
  rules: CleaningRule[];
}

const SNAPSHOT = raw as unknown as {
  timezone: string;
  season: Season;
  blocks: RawBlock[];
};

export interface SnapshotBlock extends RawBlock {
  distanceKm?: number;
}

export const SNAPSHOT_BLOCKS: RawBlock[] = SNAPSHOT.blocks;

/** Great-circle distance in km (haversine). */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Nearest snapshot block to a coordinate, with its distance attached. */
export function nearestBlock(lat: number, lng: number): SnapshotBlock {
  let best = SNAPSHOT.blocks[0];
  let bestD = Infinity;
  for (const b of SNAPSHOT.blocks) {
    const d = haversineKm(lat, lng, b.lat, b.lng);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return { ...best, distanceKm: bestD };
}

/**
 * How close (km) a point must be to a snapshot block for the offline fallback
 * to use it. The snapshot only holds a handful of blocks, so anything farther
 * would be a schedule for a different street — i.e. made-up data. ~100 m covers
 * GPS jitter around a block centroid (and the seeded demo cars, which are
 * parked exactly on snapshot coordinates).
 */
export const SNAPSHOT_MAX_KM = 0.1;

/**
 * Offline fallback: the snapshot schedule for this point if a snapshot block is
 * within SNAPSHOT_MAX_KM, otherwise null (no data beats wrong data).
 */
export function snapshotFallback(lat: number, lng: number): CleaningSchedule | null {
  const block = nearestBlock(lat, lng);
  return (block.distanceKm ?? Infinity) <= SNAPSHOT_MAX_KM ? toSchedule(block) : null;
}

export function blockById(blockId: string): RawBlock | undefined {
  return SNAPSHOT.blocks.find((b) => b.blockId === blockId);
}

/** Convert a raw snapshot block into a full CleaningSchedule. */
export function toSchedule(block: RawBlock): CleaningSchedule {
  return {
    blockId: block.blockId,
    rules: block.rules,
    windowStart: block.windowStart,
    windowEnd: block.windowEnd,
    side: block.side as StreetSide,
    season: SNAPSHOT.season,
    timezone: SNAPSHOT.timezone,
    address: block.address,
    blockLabel: block.blockLabel,
    scheduleLabel: block.scheduleLabel,
    seasonLabel: block.seasonLabel,
  };
}
