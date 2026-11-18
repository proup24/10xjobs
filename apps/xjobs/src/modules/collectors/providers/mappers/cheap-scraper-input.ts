/** The trial actor these inputs are for. */
export const CHEAP_SCRAPER_ACTOR = 'cheap_scraper/linkedin-job-scraper';

/** LinkedIn has no `GLOBAL` location; its worldwide search is `Worldwide`. */
function linkedinLocation(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value === 'GLOBAL' ? 'Worldwide' : value;
}

/**
 * The job search URL of one builder: its keyword, place (its `geoId` when the
 * builder has one, else its text location), `f_E` (experience) and `f_WT` (work type) when it
 * has them, newest first (`sortBy=DD`, so a search that reaches its row limit
 * loses its oldest jobs), posted within the last `seconds` (`f_TPR`).
 */
export function linkedinJobSearchUrl(
  keyword: string,
  params: Record<string, unknown>,
  seconds: number,
): string {
  const query = new URLSearchParams({ keywords: keyword });
  if (typeof params.geoId === 'string') query.set('geoId', params.geoId);
  else {
    const location = linkedinLocation(params.location);
    if (location) query.set('location', location);
  }
  if (typeof params.experienceLevel === 'string')
    query.set('f_E', params.experienceLevel);
  if (typeof params.workType === 'string') query.set('f_WT', params.workType);
  query.set('sortBy', 'DD');
  query.set('f_TPR', `r${seconds}`);
  return `https://www.linkedin.com/jobs/search/?${query.toString()}`;
}

/**
 * The actor input for one search. `maxItems` caps the whole run, and a run
 * carries exactly one start URL, so it is that search's row limit.
 */
export function toLinkedinJobBoardInput(
  searchUrl: string,
  maxItems: number,
): Record<string, unknown> {
  return {
    startUrls: [{ url: searchUrl }],
    maxItems,
    saveOnlyUniqueItems: false,
    enrichCompanyData: false,
  };
}
