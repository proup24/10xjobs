/**
 * Input and output mapping for the LinkedIn job board actor,
 * `cheap_scraper/linkedin-job-scraper`. Everything that depends on the actor's
 * formats lives here; the collector only runs it. What an item means as a job
 * is ingest's mapper (`ingest/normalize/linkedin-job/cheap-scraper.ts`).
 */
import type { ItemOrigin } from '../../types/collector';
import { record, text } from '../../utils/collected-job';

/** LinkedIn has no `GLOBAL` location; its worldwide search is `Worldwide`. */
function linkedinLocation(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value === 'GLOBAL' ? 'Worldwide' : value;
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
 * The actor input for one run over these search URLs. The actor has no
 * per-URL row limit (`maxItems` caps the whole run, so one busy search could
 * starve the others); the run's charge cap bounds it.
 */
export function toLinkedinJobBoardInput(
  searchUrls: readonly string[],
): Record<string, unknown> {
  return {
    startUrls: [...new Set(searchUrls)].map((url) => ({ url })),
    // A job found by several searches is kept for each, so every member
    // (possibly another user's builder) is credited with it.
    saveOnlyUniqueItems: false,
    enrichCompanyData: false,
  };
}

/**
 * What the actor writes in an item's `searchString` for one builder's search:
 * `"<keyword> - <location>"`. Builders that differ only in other filters
 * (experience, work type, geoId) share it, so each gets all of its items.
 */
export function linkedinSearchString(
  keyword: string,
  params: Record<string, unknown>,
): string {
  const location = linkedinLocation(params.location);
  return location ? `${keyword} - ${location}` : keyword;
}

/**
 * A `searchString` in comparable form: spaces collapsed, case folded, no
 * trailing separator (a search with no location may echo `"<keyword> - "`).
 */
export function linkedinSearchKey(value: string | null): string | null {
  if (!value) return null;
  const key = value
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*$/, '')
    .trim()
    .toLowerCase();
  return key || null;
}

/**
 * Each item's origin, in item order: the search its `searchString` names, and
 * its 1-based order among that search's items (the actor reports no position).
 */
export function toLinkedinJobOrigins(items: readonly unknown[]): ItemOrigin[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const search = linkedinSearchKey(text(record(item).searchString));
    if (!search) return { search: null, rank: null };
    const rank = (seen.get(search) ?? 0) + 1;
    seen.set(search, rank);
    return { search, rank };
  });
}
