/**
 * Input mapping for the LinkedIn job board actor,
 * `cheap_scraper/linkedin-job-scraper`. Everything that depends on the actor's
 * input format lives here; the collector only runs it. What an item means as a
 * job is ingest's mapper (`ingest/normalize/mappers/cheap-scraper-job.mapper.ts`).
 */

/** LinkedIn has no `GLOBAL` location; its worldwide search is `Worldwide`. */
function linkedinLocation(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value === 'GLOBAL' ? 'Worldwide' : value;
}

/**
 * What one builder searches, comparable across builders: its keyword, its
 * place (the `geoId` when it has one, which LinkedIn searches whatever the
 * location text, else that text) and its `f_E` and `f_WT` filters. Builders
 * with the same value run the same search; segments group them by it.
 */
export function linkedinSearch(
  keyword: string,
  params: Record<string, unknown>,
): string {
  const query = new URLSearchParams({ keywords: keyword });
  const location = linkedinLocation(params.location);
  if (typeof params.geoId === 'string') query.set('geoId', params.geoId);
  else if (location) query.set('location', location);
  if (typeof params.experienceLevel === 'string')
    query.set('f_E', params.experienceLevel);
  if (typeof params.workType === 'string') query.set('f_WT', params.workType);
  return query.toString();
}

/**
 * The job search URL of one builder: its keyword, location (pinned by `geoId`
 * when the builder has one), `f_E` (experience) and `f_WT` (work type) when it
 * has them, newest first (`sortBy=DD`, so a search that reaches its row limit
 * loses its oldest jobs), posted within the last `seconds` (`f_TPR`).
 */
export function linkedinJobSearchUrl(
  keyword: string,
  params: Record<string, unknown>,
  seconds: number,
): string {
  const query = new URLSearchParams({ keywords: keyword });
  const location = linkedinLocation(params.location);
  if (location) query.set('location', location);
  if (typeof params.geoId === 'string') query.set('geoId', params.geoId);
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
