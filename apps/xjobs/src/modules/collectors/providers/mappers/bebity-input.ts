import { linkedinGeoId } from './linkedin-job-board.mapper';

/** The trial actor these inputs are for. */
export const BEBITY_ACTOR = 'bebity/linkedin-jobs-scraper';

/** The place name bebity searches, by LinkedIn geoId. MENA has none. */
export const BEBITY_PLACES: Readonly<Record<string, string>> = {
  '102787409': 'Morocco',
  '103644278': 'United States',
  '100506914': 'Europe',
  '91000001': 'Middle East',
  '91000011': 'Latin America',
  '103537801': 'Africa',
  '101174742': 'Canada',
};

function codes(value: unknown): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean)
    : [];
}

/**
 * bebity's input for one search: the keyword as its title, the place named by
 * geoId, the builder's work type and experience codes (LinkedIn's own), posted
 * in the last hour. Throws when the place has no bebity name.
 */
export function toBebityInput(
  keyword: string,
  params: Record<string, unknown>,
  rows: number,
): Record<string, unknown> {
  const geoId = linkedinGeoId(params);
  const place = Object.hasOwn(BEBITY_PLACES, geoId)
    ? BEBITY_PLACES[geoId]
    : undefined;
  if (!place) throw new Error(`bebity has no place for geoId ${geoId}`);
  const workTypes = codes(params.workType);
  const experienceLevels = codes(params.experienceLevel);
  return {
    titles: [keyword],
    locations: [place],
    ...(workTypes.length ? { workTypes } : {}),
    ...(experienceLevels.length ? { experienceLevels } : {}),
    publishedAt: 'r3600',
    rows,
    companyProfile: false,
    enrichCompany: false,
  };
}
