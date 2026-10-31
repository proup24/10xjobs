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
