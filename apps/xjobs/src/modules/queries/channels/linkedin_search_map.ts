import { locationKey } from '../steps/normalize';
import { LINKEDIN_GEO_IDS } from './linkedin_geo';

/**
 * Checked on linkedin.com by hand, see docs/actors/linkedin-region-test.md.
 * Asia Pacific and Asia (excluding the GCC) are left out on purpose: their
 * geoIds are not pinned yet, so those places fail loudly in collection.
 */
export const SEARCH_MAP_CHECKED = '2026-11-14';

/**
 * Preference place (by `locationKey`) -> the LinkedIn places that cover it.
 * Values are keys of `LINKEDIN_GEO_IDS`.
 */
export const LINKEDIN_SEARCH_MAP: Readonly<Record<string, readonly string[]>> =
  {
    europe: ['europe'],
    'european union': ['europe'],
    'european economic area': ['europe'],
    uk: ['europe'],
    'united kingdom': ['europe'],
    dach: ['europe'],
    emea: ['africa', 'europe', 'middle east'],
    mena: ['africa', 'middle east'],
    'north africa': ['africa'],
    'sub-saharan africa': ['africa'],
    'north america': ['canada', 'united states'],
    americas: ['canada', 'latin america', 'united states'],
    gcc: [
      'bahrain',
      'kuwait',
      'oman',
      'qatar',
      'saudi arabia',
      'united arab emirates',
    ],
  };

/** The pinned LinkedIn places (`LINKEDIN_GEO_IDS` keys) that cover a preference place. */
export function searchPlaces(location: string): string[] {
  const key = locationKey(location);
  const mapped = LINKEDIN_SEARCH_MAP[key];
  if (mapped) return [...mapped].sort();
  if (key in LINKEDIN_GEO_IDS) return [key];
  const comma = key.lastIndexOf(',');
  if (comma >= 0) {
    const country = key.slice(comma + 1).trim();
    if (country in LINKEDIN_GEO_IDS) return [country];
  }
  return [key];
}
