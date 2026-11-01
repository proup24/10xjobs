import { Region } from 'src/common/enums';

/** How LinkedIn's job search names a region: its location text and, once verified, its geoId. */
export interface LinkedinRegion {
  location: string;
  /**
   * LinkedIn's geoId pins the region exactly; free text is geocoded and may
   * drift. Fill a value only after checking it on linkedin.com: pick the
   * location in the jobs search and read `geoId` from the URL.
   */
  geoId: string | null;
}

/**
 * Remote regions as LinkedIn searches them. `Worldwide`, `EMEA`,
 * `European Union` and `United Kingdom` are the texts career-hub collected
 * with; the others are LinkedIn's usual names and still unverified.
 */
export const LINKEDIN_REGIONS: Record<Region, LinkedinRegion> = {
  [Region.GLOBAL]: { location: 'Worldwide', geoId: null },
  [Region.EMEA]: { location: 'EMEA', geoId: null },
  [Region.EU]: { location: 'European Union', geoId: null },
  [Region.UK]: { location: 'United Kingdom', geoId: null },
  [Region.EUROPE]: { location: 'Europe', geoId: null },
  [Region.NORTH_AMERICA]: { location: 'North America', geoId: null },
  [Region.LATAM]: { location: 'Latin America', geoId: null },
  [Region.APAC]: { location: 'Asia Pacific', geoId: null },
  [Region.MIDDLE_EAST]: { location: 'Middle East', geoId: null },
  // LinkedIn has no MENA location; EMEA is the closest region that covers it.
  [Region.MENA]: { location: 'EMEA', geoId: null },
  [Region.NORTH_AFRICA]: { location: 'North Africa', geoId: null },
  [Region.SUB_SAHARAN_AFRICA]: { location: 'Africa', geoId: null },
};

/**
 * Cities pinned by a verified LinkedIn geoId, keyed `<ISO country>|<City>`.
 * Fill a value only after checking it on linkedin.com: pick the place in the
 * jobs search and read `geoId` from the URL.
 */
export const LINKEDIN_CITY_GEO_IDS: Record<string, string> = {};

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * The English name of an ISO country code, as LinkedIn's location box reads
 * it: a bare code is ambiguous (`MA` is Morocco and Massachusetts). An
 * unknown or malformed code is returned as given.
 */
export function countryName(iso: string): string {
  try {
    const name = regionNames.of(iso);
    return name && name !== iso && !/unknown/i.test(name) ? name : iso;
  } catch {
    return iso;
  }
}

/** The place a LinkedIn onsite or hybrid search names: `City, Country`, and its geoId once verified. */
export function linkedinPlace(
  country: string,
  city: string | null,
): { location: string; geoId: string | null } {
  const name = countryName(country);
  return {
    location: city ? `${city}, ${name}` : name,
    geoId: (city && LINKEDIN_CITY_GEO_IDS[`${country}|${city}`]) || null,
  };
}
