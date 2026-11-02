import { locationKey } from '../steps/normalize';

/**
 * Locations pinned by a verified LinkedIn geoId, keyed by the canonical
 * (lowercased) location text, for any kind of place. Free text is geocoded
 * and may drift; fill a value only after checking it on linkedin.com: pick
 * the location in the jobs search and read `geoId` from the URL.
 */
export const LINKEDIN_GEO_IDS: Record<string, string> = {
  // Gulf (GCC), verified 2026-11-02.
  'united arab emirates': '104305776',
  uae: '104305776',
  'saudi arabia': '100459316',
  qatar: '104170880',
  kuwait: '103239229',
  bahrain: '100425729',
  oman: '103619019',
  // Europe's main tech markets, verified 2026-11-02.
  'united kingdom': '101165590',
  uk: '101165590',
  germany: '101282230',
  france: '105015875',
  netherlands: '102890719',
  ireland: '104738515',
  spain: '105646813',
  portugal: '100364837',
  switzerland: '106693272',
  sweden: '105117694',
  denmark: '104514075',
  norway: '103819153',
  finland: '100456013',
  poland: '105072130',
  belgium: '100565514',
  austria: '103883259',
  italy: '103350119',
  luxembourg: '104042105',
  estonia: '102974008',
  czechia: '104508036',
  'czech republic': '104508036',
};

/** The location that means "no place restriction". */
export const WORLDWIDE = 'worldwide';

/** True for `worldwide`, whatever its spelling: it is never added to a keyword. */
export function isWorldwide(location: string): boolean {
  return locationKey(location) === WORLDWIDE;
}
