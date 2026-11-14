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
  // Regions, verified 2026-11-11.
  worldwide: '92000000',
  europe: '100506914',
  'european union': '91000000',
  'european economic area': '91000002',
  emea: '91000007',
  'middle east': '91000001',
  mena: '91000008',
  'latin america': '91000011',
  // Africa, verified 2026-11-11. LinkedIn has no North Africa region and
  // falls back to Africa.
  africa: '103537801',
  'north africa': '103537801',
  // Single countries, verified 2026-11-11.
  morocco: '102787409',
  canada: '101174742',
  'united states': '103644278',
  // Single countries, verified 2026-11-14.
  israel: '101620260',
  türkiye: '102105699',
  turkey: '102105699',
};

/** The location that means "no place restriction". */
export const WORLDWIDE = 'worldwide';

/** True for `worldwide`, whatever its spelling: it is never added to a keyword. */
export function isWorldwide(location: string): boolean {
  return locationKey(location) === WORLDWIDE;
}
