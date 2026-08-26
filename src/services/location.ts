/**
 * Location service. Wraps expo-location with clear permission handling and a
 * reverse-geocode to a street/block address. Every function degrades gracefully
 * so the UI can show a denied-state fallback instead of crashing.
 */
import * as Location from 'expo-location';

export interface Fix {
  lat: number;
  lng: number;
  address: string;
  accuracy?: number | null;
}

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function getPermissionState(): Promise<PermissionState> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status as PermissionState;
}

export async function requestPermission(): Promise<PermissionState> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status as PermissionState;
}

export interface GeocodeParts {
  /** "123 Beacon St" style label for display. */
  full: string;
  /** Just the street name, e.g. "Beacon St" — used to key the Boston dataset. */
  street?: string;
  /** Street number, e.g. 123 — parity gives the side of the street. */
  streetNumber?: number;
  /** Neighborhood/district if the geocoder provides one, e.g. "Beacon Hill". */
  neighborhood?: string;
  /** City/town, e.g. "Boston" / "Cambridge" — used to route to the right provider. */
  city?: string;
}

// A single parked point gets reverse-geocoded by the router, the city provider,
// and the Park screen in quick succession — memoize so it's one native call
// (iOS also rate-limits the geocoder). Bounded to the most recent points.
const geocodeCache = new Map<string, GeocodeParts>();

/** Reverse-geocode into structured parts (street + number + city + label). */
export async function reverseGeocodeParts(lat: number, lng: number): Promise<GeocodeParts> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const hit = geocodeCache.get(key);
  if (hit) return hit;
  const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    const r = results[0];
    if (!r) return { full: fallback };
    const full = [r.streetNumber, r.street].filter(Boolean).join(' ') || r.name || fallback;
    const num = r.streetNumber ? parseInt(String(r.streetNumber).replace(/\D.*$/, ''), 10) : undefined;
    const parts: GeocodeParts = {
      full,
      street: r.street ?? undefined,
      streetNumber: Number.isFinite(num) ? num : undefined,
      // iOS exposes neighborhood in `district`; Android often in `subregion`.
      neighborhood: (r.district || r.subregion) ?? undefined,
      city: r.city ?? r.subregion ?? undefined,
    };
    if (geocodeCache.size > 50) geocodeCache.clear();
    geocodeCache.set(key, parts);
    return parts;
  } catch {
    return { full: fallback };
  }
}

/** Reverse-geocode to a compact "123 Main St" style label. */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  return (await reverseGeocodeParts(lat, lng)).full;
}

/**
 * Capture the current GPS fix and reverse-geocode it. Returns null when
 * permission is denied so the caller can prompt/fallback.
 */
export async function captureCurrentSpot(): Promise<Fix | null> {
  let state = await getPermissionState();
  if (state !== 'granted') state = await requestPermission();
  if (state !== 'granted') return null;

  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const { latitude, longitude, accuracy } = pos.coords;
  const address = await reverseGeocode(latitude, longitude);
  return { lat: latitude, lng: longitude, address, accuracy };
}

export interface Coord {
  lat: number;
  lng: number;
  /** Horizontal accuracy radius in meters (smaller = more precise). */
  accuracy?: number | null;
}

/**
 * Get the current GPS coordinate only (no reverse-geocode), refined for
 * precision. A single fix — especially the first one after a cold start — is
 * often the least accurate, so instead of taking it we let GPS converge:
 *
 *   - request the highest tier (BestForNavigation),
 *   - sample continuously for up to `timeoutMs`, keeping the fix with the
 *     smallest accuracy radius,
 *   - resolve early once accuracy reaches `targetAccuracyM`.
 *
 * `onProgress` fires on each improved fix so the UI can tighten the pin live.
 * Returns null when permission is denied.
 */
export async function getCurrentCoord(opts?: {
  targetAccuracyM?: number;
  timeoutMs?: number;
  minSampleMs?: number;
  onProgress?: (c: Coord) => void;
}): Promise<Coord | null> {
  let state = await getPermissionState();
  if (state !== 'granted') state = await requestPermission();
  if (state !== 'granted') return null;

  const target = opts?.targetAccuracyM ?? 6;
  const timeout = opts?.timeoutMs ?? 9000;
  // Keep sampling at least this long even once a "good" fix appears — an early
  // sub-target reading is often a Wi-Fi/cell fix that GNSS later corrects.
  const minSampleMs = opts?.minSampleMs ?? 4000;
  const acc = (l: Location.LocationObject) => l.coords.accuracy ?? Number.POSITIVE_INFINITY;
  const started = Date.now();

  // Seed with a fast fix so we always have something, even if the watch stalls.
  let best: Location.LocationObject | null = null;
  try {
    best = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    opts?.onProgress?.({ lat: best.coords.latitude, lng: best.coords.longitude, accuracy: best.coords.accuracy });
  } catch {
    /* keep going — the watch may still deliver a fix */
  }

  return new Promise<Coord | null>((resolve) => {
    let sub: Location.LocationSubscription | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub?.remove();
      resolve(
        best
          ? { lat: best.coords.latitude, lng: best.coords.longitude, accuracy: best.coords.accuracy }
          : null,
      );
    };
    const timer = setTimeout(finish, timeout);

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 500, distanceInterval: 0 },
      (loc) => {
        if (!best || acc(loc) < acc(best)) {
          best = loc;
          opts?.onProgress?.({ lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy });
        }
        // Only settle once GNSS has had time to converge past any initial fix.
        if (Date.now() - started >= minSampleMs && acc(best) <= target) finish();
      },
    )
      .then((s) => {
        sub = s;
        if (done) s.remove();
      })
      .catch(() => finish());
  });
}
