/**
 * Point-in-polygon neighborhood lookup against Boston's BPDA neighborhood
 * boundaries (ArcGIS). Used to disambiguate streets that repeat across the city
 * (there's a Boylston St in Back Bay *and* Jamaica Plain) — the neighborhood
 * name matches the sweeping dataset's `dist_name`.
 *
 * Endpoint overridable via app.json -> expo.extra.bostonNeighborhoodsUrl.
 */
import Constants from 'expo-constants';

export const DEFAULT_NEIGHBORHOODS_URL =
  'https://gis.bostonplans.org/hosting/rest/services/Hosted/Boston_Neighborhood_Boundaries/FeatureServer/5/query';

function url(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  return extra.bostonNeighborhoodsUrl || DEFAULT_NEIGHBORHOODS_URL;
}

/** The BPDA neighborhood containing (lat,lng), e.g. "Back Bay". Throws on network error. */
export async function neighborhoodAt(lat: number, lng: number): Promise<string | null> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'name',
    returnGeometry: 'false',
  });
  const res = await fetch(`${url()}?${params.toString()}`);
  if (!res.ok) throw new Error(`Neighborhoods HTTP ${res.status}`);
  const json = (await res.json()) as {
    features?: { attributes?: { name?: string } }[];
    error?: unknown;
  };
  if (json.error) throw new Error(`Neighborhoods error ${JSON.stringify(json.error)}`);
  return json.features?.[0]?.attributes?.name ?? null;
}
