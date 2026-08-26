/**
 * Geographic coverage for the active city dataset.
 *
 * The bundled/live data is Boston-only, so a coordinate outside greater Boston
 * has no real schedule. Rather than snapping to the nearest Boston block (which
 * would show wrong rules), providers return `null` for out-of-area coordinates
 * and the UI reports the area as unsupported.
 *
 * When you add another city provider, give it its own coverage box/polygon.
 */
export interface CoverageBox {
  name: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Generous bounding box around greater Boston (incl. Cambridge, Southie). */
export const BOSTON_COVERAGE: CoverageBox = {
  name: 'Boston',
  minLat: 42.15,
  maxLat: 42.45,
  minLng: -71.25,
  maxLng: -70.95,
};

export function isWithin(box: CoverageBox, lat: number, lng: number): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;
}

export function isWithinBoston(lat: number, lng: number): boolean {
  return isWithin(BOSTON_COVERAGE, lat, lng);
}
