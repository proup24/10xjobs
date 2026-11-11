/**
 * Input mapping for the LinkedIn job board actor,
 * `harvestapi/linkedin-job-search`. Everything that depends on the actor's
 * input format lives here; the collector only runs it. Builders keep storing
 * LinkedIn's `f_E` and `f_WT` codes; this maps them to the actor's names.
 */

export interface HarvestJobSearchInput {
  jobTitles: string[];
  geoIds?: string[];
  locations?: string[];
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

/** LinkedIn has no `GLOBAL` location; its worldwide search is `Worldwide`. */
function location(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value === 'GLOBAL' ? 'Worldwide' : value;
}

/** The actor's names for a comma-separated code list; unknown codes drop, order kept. */
function mapCodes(value: unknown, names: Record<string, string>): string[] {
  if (typeof value !== 'string') return [];
  const mapped = value
    .split(',')
    .map((code) => names[code.trim()])
    .filter((name): name is string => Boolean(name));
  return [...new Set(mapped)];
}

/** The actor input for one search; `maxItems` is its row limit. */
export function toHarvestJobSearchInput(
  keyword: string,
  params: Record<string, unknown>,
  maxItems: number,
): HarvestJobSearchInput {
  const place = location(params.location);
  const experienceLevel = mapCodes(params.experienceLevel, EXPERIENCE);
  const workplaceType = mapCodes(params.workType, WORKPLACE);
  return {
    jobTitles: [keyword],
    ...(typeof params.geoId === 'string'
      ? { geoIds: [params.geoId] }
      : place
        ? { locations: [place] }
        : {}),
    ...(experienceLevel.length ? { experienceLevel } : {}),
    ...(workplaceType.length ? { workplaceType } : {}),
    postedLimit: '1h',
    sortBy: 'date',
    maxItems,
  };
}

/**
 * What one builder searches, comparable across builders: canonical JSON of its
 * keyword, place (the `geoId` when it has one, else the location text) and
 * mapped filters. Builders with the same value run the same search; segments
 * group them by it.
 */
export function linkedinSearchKey(
  keyword: string,
  params: Record<string, unknown>,
): string {
  const place = location(params.location);
  const experienceLevel = mapCodes(params.experienceLevel, EXPERIENCE).sort();
  const workplaceType = mapCodes(params.workType, WORKPLACE).sort();
  return JSON.stringify({
    keyword,
    ...(typeof params.geoId === 'string'
      ? { place: { geoId: params.geoId } }
      : place
        ? { place: { location: place } }
        : {}),
    ...(experienceLevel.length ? { experienceLevel } : {}),
    ...(workplaceType.length ? { workplaceType } : {}),
  });
}
