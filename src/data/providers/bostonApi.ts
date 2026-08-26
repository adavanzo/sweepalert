/**
 * Live client for Boston's public street-sweeping schedule on Analyze Boston
 * (data.boston.gov), served via CKAN's datastore API. No API key required.
 *
 *   Dataset: "Street Sweeping Schedules"
 *   Resource: 9fdbdcad-67c8-4b23-b6ec-861e77d56227
 *   API doc:  https://docs.ckan.org/en/latest/maintaining/datastore.html
 *
 * The dataset is TABULAR (keyed by street name + cross-street segment), not
 * geometric — there are no lat/lng columns. So the lookup path is:
 *   pin (lat,lng) -> reverse-geocode to a street name -> query this dataset.
 *
 * Base URL and resource id are overridable via app.json -> expo.extra
 * ({ bostonCkanBase, bostonSweepingResourceId }) so you can point at a mirror or
 * an updated resource without code changes.
 *
 * Pure row->schedule translation lives in bostonMapping.ts (unit-tested).
 */
import Constants from 'expo-constants';

import { CleaningSchedule } from '../../types';
import { toSchedule, SNAPSHOT_BLOCKS } from '../snapshot';
import { normalizeStreet, rowToSchedule, SweepRow } from './bostonMapping';

export * from './bostonMapping';

export const DEFAULT_CKAN_BASE = 'https://data.boston.gov/api/3/action';
export const DEFAULT_RESOURCE_ID = '9fdbdcad-67c8-4b23-b6ec-861e77d56227';

function extra(): Record<string, string> {
  return (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
}

function ckanBase(): string {
  return extra().bostonCkanBase || DEFAULT_CKAN_BASE;
}
function resourceId(): string {
  return extra().bostonSweepingResourceId || DEFAULT_RESOURCE_ID;
}

/**
 * Fetch schedule rows for a street from the live dataset. Uses CKAN full-text
 * search (`q`) then filters client-side by normalized street name — no SQL, so
 * no injection surface. Throws on network/HTTP error (caller falls back).
 */
export async function fetchRowsForStreet(street: string): Promise<SweepRow[]> {
  const url = `${ckanBase()}/datastore_search?resource_id=${resourceId()}&limit=50&q=${encodeURIComponent(street)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CKAN HTTP ${res.status}`);
  const json = (await res.json()) as { success: boolean; result?: { records?: SweepRow[] } };
  if (!json.success || !json.result?.records) throw new Error('CKAN response not successful');
  const target = normalizeStreet(street);
  const exact = json.result.records.filter((r) => normalizeStreet(r.st_name || '') === target);
  return exact.length ? exact : json.result.records;
}

const SEARCH_FIELDS =
  '_id,main_id,st_name,dist_name,side,"from","to",start_time,end_time,' +
  'week_1,week_2,week_3,week_4,week_5,sunday,monday,tuesday,wednesday,thursday,friday,saturday,every_day,year_round';

/**
 * Free-text street search across the whole dataset (for the in-app lookup),
 * mirroring the city's street-name search. Uses a substring (ILIKE) match so
 * partial names autocomplete-style work ("marl" -> Marlborough St). Returns one
 * CleaningSchedule per matching street-side segment, ordered by street then side.
 *
 * Falls back to the bundled snapshot when the network/dataset is unavailable, so
 * the lookup still returns the demo blocks offline.
 */
export async function searchSchedules(term: string, limit = 150): Promise<CleaningSchedule[]> {
  const cleaned = term.trim();
  if (cleaned.length < 2) return [];
  // Strip anything but letters/digits/space/./- so the value can't break the SQL.
  const safe = cleaned.replace(/[^a-zA-Z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safe) return [];

  try {
    const sql =
      `SELECT ${SEARCH_FIELDS} FROM "${resourceId()}" ` +
      `WHERE st_name ILIKE '%${safe}%' ORDER BY st_name, side LIMIT ${limit}`;
    const res = await fetch(`${ckanBase()}/datastore_search_sql?sql=${encodeURIComponent(sql)}`);
    if (!res.ok) throw new Error(`CKAN SQL HTTP ${res.status}`);
    const json = (await res.json()) as { success: boolean; result?: { records?: SweepRow[] } };
    if (!json.success || !json.result?.records) throw new Error('CKAN SQL not successful');
    return json.result.records.map(rowToSchedule);
  } catch (err) {
    console.warn('[searchSchedules] live search failed, using snapshot:', err);
    const t = safe.toLowerCase();
    return SNAPSHOT_BLOCKS.filter((b) => b.address.toLowerCase().includes(t)).map(toSchedule);
  }
}
