/**
 * Input mapping for the LinkedIn job board actor,
 * `harvestapi/linkedin-job-search`. Everything that depends on the actor's
 * input format lives here; the collector only runs it. Builders keep storing
 * LinkedIn's `f_E` and `f_WT` codes; this maps them to the actor's names.
 */
import { locationKey } from 'src/modules/queries/steps/normalize';
import {
  LINKEDIN_GEO_IDS,
  WORLDWIDE,
} from 'src/modules/queries/channels/linkedin_geo';

export interface HarvestJobSearchInput {
  jobTitles: string[];
  geoIds: string[];
  experienceLevel?: string[];
  workplaceType?: string[];
  postedLimit: '1h';
  sortBy: 'date';
  maxItems: number;
}

const EXPERIENCE: Record<string, string> = {
  '1': 'internship',
  '2': 'entry',
  '3': 'associate',
  '4': 'mid-senior',
  '5': 'director',
};

const WORKPLACE: Record<string, string> = {
  '1': 'office',
  '2': 'remote',
  '3': 'hybrid',
};

/**
 * The geoId a search runs on: the builder's own when it has one, else the
 * verified one for its location (`GLOBAL` reads as `worldwide`; no location is
 * worldwide). The actor rejects place names as text, so a place without a
 * verified geoId throws instead of searching blind.
 */
export function linkedinGeoId(params: Record<string, unknown>): string {
  if (typeof params.geoId === 'string') return params.geoId;
  const location =
    typeof params.location === 'string' && params.location
      ? params.location
      : WORLDWIDE;
  const key = location === 'GLOBAL' ? WORLDWIDE : locationKey(location);
  const geoId = Object.hasOwn(LINKEDIN_GEO_IDS, key)
    ? LINKEDIN_GEO_IDS[key]
    : undefined;
  if (!geoId)
    throw new Error(
      `No LinkedIn geoId for location "${location}"; add it to LINKEDIN_GEO_IDS`,
    );
  return geoId;
}

/** The actor's names for a comma-separated code list; unknown codes drop, order kept. */
function mapCodes(value: unknown, names: Record<string, string>): string[] {
  if (typeof value !== 'string') return [];
  const mapped = value
    .split(',')
    .map((code) => code.trim())
    .filter((code) => Object.hasOwn(names, code))
    .map((code) => names[code]);
  return [...new Set(mapped)];
}

/** The actor input for one search; `maxItems` is its row limit. */
export function toHarvestJobSearchInput(
  keyword: string,
  params: Record<string, unknown>,
  maxItems: number,
): HarvestJobSearchInput {
  const experienceLevel = mapCodes(params.experienceLevel, EXPERIENCE);
  const workplaceType = mapCodes(params.workType, WORKPLACE);
  return {
    jobTitles: [keyword],
    geoIds: [linkedinGeoId(params)],
    ...(experienceLevel.length ? { experienceLevel } : {}),
    ...(workplaceType.length ? { workplaceType } : {}),
    postedLimit: '1h',
    sortBy: 'date',
    maxItems,
  };
}

/**
 * What one builder searches, comparable across builders: canonical JSON of its
 * keyword, place (its geoId) and
 * mapped filters. Builders with the same value run the same search; segments
 * group them by it.
 */
export function linkedinSearchKey(
  keyword: string,
  params: Record<string, unknown>,
): string {
  const experienceLevel = mapCodes(params.experienceLevel, EXPERIENCE).sort();
  const workplaceType = mapCodes(params.workType, WORKPLACE).sort();
  return JSON.stringify({
    keyword,
    place: { geoId: linkedinGeoId(params) },
    ...(experienceLevel.length ? { experienceLevel } : {}),
    ...(workplaceType.length ? { workplaceType } : {}),
  });
}
