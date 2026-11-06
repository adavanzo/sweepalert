/**
 * Live client for Boston's SAM street-segments layer (gisportal.boston.gov
 * ArcGIS FeatureServer). Used to snap a GPS point to the nearest real road
 * segment — giving the correct street *and side* — before looking the street up
 * in the name-keyed sweeping dataset. No API key required.
 *
 * Endpoint overridable via app.json -> expo.extra.bostonSamSegmentsUrl.
 *
 * Pure geometry/parsing lives in samGeometry.ts (unit-tested); only the network
 * calls below live here.
 */
import Constants from 'expo-constants';

import { fetchWithTimeout } from '../../services/http';

import { resolveFromFeatures, SamFeature, SegmentMatch } from './samGeometry';

export * from './samGeometry';

export const DEFAULT_SAM_SEGMENTS_URL =
  'https://gisportal.boston.gov/arcgis/rest/services/SAM/Live_SAM_Address/FeatureServer/3/query';

function samUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  return extra.bostonSamSegmentsUrl || DEFAULT_SAM_SEGMENTS_URL;
}

async function querySam(lat: number, lng: number): Promise<SamFeature[]> {
  const d = 0.0022; // ~220 m envelope — wide enough to catch bounding cross streets
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    geometry: JSON.stringify({
      xmin: lng - d,
      ymin: lat - d,
      xmax: lng + d,
      ymax: lat + d,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'ST_NAME,ST_TYPE,L_F_ADD,R_F_ADD,NBHD_L,NBHD_R',
    returnGeometry: 'true',
    resultRecordCount: '40',
  });
  const res = await fetchWithTimeout(`${samUrl()}?${params.toString()}`);
  if (!res.ok) throw new Error(`SAM HTTP ${res.status}`);
  const json = (await res.json()) as { features?: SamFeature[]; error?: unknown };
  if (json.error) throw new Error(`SAM error ${JSON.stringify(json.error)}`);
  return json.features ?? [];
}

/** Nearest street to a point, with side + nearby candidates. Throws on network error. */
export async function nearestSegment(lat: number, lng: number): Promise<SegmentMatch | null> {
  return resolveFromFeatures(lat, lng, await querySam(lat, lng));
}

/** Just the ordered list of nearby street names (for the correction picker). */
export async function nearbyStreets(lat: number, lng: number): Promise<string[]> {
  const m = await nearestSegment(lat, lng);
  return m?.candidates ?? [];
}
