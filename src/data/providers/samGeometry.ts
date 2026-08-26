/**
 * Pure geometry + parsing for Boston SAM street segments. No device/native
 * imports, so it is fully unit-testable (see __tests__/samSegments.test.ts).
 * Network + config live in samSegments.ts.
 */
import { StreetSide } from '../../types';

// ---- equirectangular meters (accurate enough at city scale) ----------------

const M_PER_DEG_LAT = 110_540;
function mPerDegLng(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

export interface Pt {
  x: number;
  y: number;
}

export function toMeters(lat: number, lng: number, lat0: number): Pt {
  return { x: lng * mPerDegLng(lat0), y: lat * M_PER_DEG_LAT };
}

/** Distance (m) from P to segment AB, plus the signed side (>0 left, <0 right). */
export function pointToSegment(p: Pt, a: Pt, b: Pt): { dist: number; side: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const len2 = abx * abx + aby * aby || 1e-9;
  let t = (apx * abx + apy * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const projx = a.x + t * abx;
  const projy = a.y + t * aby;
  const dist = Math.hypot(p.x - projx, p.y - projy);
  const cross = abx * apy - aby * apx; // z of AB x AP
  return { dist, side: cross };
}

/** Min distance (m) from a point to a polyline path ([lng,lat] pairs), with side. */
export function pointToPath(
  lat: number,
  lng: number,
  path: [number, number][],
): { dist: number; side: number } {
  const p = toMeters(lat, lng, lat);
  let best = { dist: Infinity, side: 0 };
  for (let i = 0; i + 1 < path.length; i++) {
    const a = toMeters(path[i][1], path[i][0], lat);
    const b = toMeters(path[i + 1][1], path[i + 1][0], lat);
    const r = pointToSegment(p, a, b);
    if (r.dist < best.dist) best = r;
  }
  return best;
}

function parity(n: unknown): 'even' | 'odd' | null {
  const v = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10);
  if (!Number.isFinite(v) || v === 0) return null;
  return v % 2 === 0 ? 'even' : 'odd';
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

/** "Boylston" + "ST" -> "Boylston St" to match the sweeping dataset's st_name. */
export function buildStreetName(stName: string, stType?: string | null): string {
  return [titleCase(stName || ''), stType ? titleCase(stType) : ''].filter(Boolean).join(' ');
}

/** Service alleys / private ways where you don't park for street cleaning. */
export function isAlley(name: string): boolean {
  return /\balley\b|\bprivate\b/i.test(name);
}

export interface SamAttrs {
  ST_NAME: string;
  ST_TYPE?: string | null;
  L_F_ADD?: number | null;
  R_F_ADD?: number | null;
  NBHD_L?: string | null;
  NBHD_R?: string | null;
}
export interface SamFeature {
  attributes: SamAttrs;
  geometry?: { paths?: [number, number][][] };
}

export interface SegmentMatch {
  street: string;
  side: StreetSide;
  neighborhood?: string;
  distanceM: number;
  /** Distinct nearby street names, nearest first (for the correction picker). */
  candidates: string[];
}

/** Compute the best street match from raw SAM features (pure). */
export function resolveFromFeatures(
  lat: number,
  lng: number,
  features: SamFeature[],
): SegmentMatch | null {
  let best: { d: number; f: SamFeature; side: number } | null = null;
  let bestReal: { d: number; f: SamFeature; side: number } | null = null; // non-alley
  const ranked: { d: number; name: string }[] = [];

  for (const f of features) {
    const paths = f.geometry?.paths ?? [];
    let fbest = { dist: Infinity, side: 0 };
    for (const path of paths) {
      const r = pointToPath(lat, lng, path);
      if (r.dist < fbest.dist) fbest = r;
    }
    if (fbest.dist === Infinity) continue;
    const name = buildStreetName(f.attributes.ST_NAME, f.attributes.ST_TYPE);
    ranked.push({ d: fbest.dist, name });
    if (!best || fbest.dist < best.d) best = { d: fbest.dist, f, side: fbest.side };
    if (!isAlley(name) && (!bestReal || fbest.dist < bestReal.d)) {
      bestReal = { d: fbest.dist, f, side: fbest.side };
    }
  }
  if (!best) return null;

  // People park on named streets, not the service alleys behind them. If a real
  // street is essentially as close as the nearest alley, prefer the street —
  // the alley usually has no sweeping schedule and would read as "no schedule".
  if (bestReal && bestReal.d <= best.d + 40) best = bestReal;

  const a = best.f.attributes;
  const onLeft = best.side > 0;
  const sideParity = onLeft ? parity(a.L_F_ADD) : parity(a.R_F_ADD);
  const neighborhood = (onLeft ? a.NBHD_L : a.NBHD_R) ?? a.NBHD_L ?? a.NBHD_R ?? undefined;

  const seen = new Set<string>();
  const candidates: string[] = [];
  // Nearest first, but real streets ahead of service alleys.
  const order = ranked.sort((x, y) => Number(isAlley(x.name)) - Number(isAlley(y.name)) || x.d - y.d);
  for (const r of order) {
    const keyName = r.name.toLowerCase();
    if (r.name && !seen.has(keyName)) {
      seen.add(keyName);
      candidates.push(r.name);
    }
  }

  return {
    street: buildStreetName(a.ST_NAME, a.ST_TYPE),
    side: sideParity ?? 'both',
    neighborhood: neighborhood ? titleCase(neighborhood) : undefined,
    distanceM: best.d,
    candidates,
  };
}
