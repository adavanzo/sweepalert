import { SNAPSHOT_BLOCKS, SNAPSHOT_MAX_KM, snapshotFallback } from '../src/data/snapshot';

describe('snapshotFallback (offline distance gate)', () => {
  it('returns the block schedule for a point exactly on a snapshot block (seeded demo cars)', () => {
    for (const b of SNAPSHOT_BLOCKS) {
      expect(snapshotFallback(b.lat, b.lng)?.blockId).toBe(b.blockId);
    }
  });

  it('tolerates GPS jitter within the gate', () => {
    const b = SNAPSHOT_BLOCKS[0];
    // ~0.0005 deg latitude ≈ 55 m.
    expect(SNAPSHOT_MAX_KM).toBeGreaterThan(0.055);
    expect(snapshotFallback(b.lat + 0.0005, b.lng)?.blockId).toBe(b.blockId);
  });

  it('returns null when no snapshot block is nearby instead of fabricating one', () => {
    const b = SNAPSHOT_BLOCKS[0];
    expect(snapshotFallback(b.lat + 0.005, b.lng)).toBeNull(); // ~550 m away
    expect(snapshotFallback(42.3001, -71.1123)).toBeNull(); // Jamaica Plain
    expect(snapshotFallback(40.7128, -74.006)).toBeNull(); // New York City
  });
});
