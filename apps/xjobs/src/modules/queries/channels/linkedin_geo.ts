import { locationKey } from '../steps/normalize';

/**
 * Locations pinned by a verified LinkedIn geoId, keyed by the canonical
 * (lowercased) location text, for any kind of place. Free text is geocoded
 * and may drift; fill a value only after checking it on linkedin.com: pick
 * the location in the jobs search and read `geoId` from the URL.
 */
export const LINKEDIN_GEO_IDS: Record<string, string> = {};

/** The location that means "no place restriction". */
export const WORLDWIDE = 'worldwide';

/** True for `worldwide`, whatever its spelling: it is never added to a keyword. */
export function isWorldwide(location: string): boolean {
  return locationKey(location) === WORLDWIDE;
}
