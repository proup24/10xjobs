/**
 * Input and output mapping for the LinkedIn posts actor,
 * `harvestapi/linkedin-post-search`.
 */
import type { ItemOrigin } from '../../types/collector';
import { record, text } from '../../utils/collected-job';

/**
 * The actor input for one run over these keyword queries, newest first, posted
 * since `since`. The actor has no location filter, so `params.location` is
 * not applied.
 */
export function toLinkedinPostsInput(
  queries: readonly string[],
  since: Date,
  maxPostsPerQuery: number,
): Record<string, unknown> {
  return {
    searchQueries: [...new Set(queries)],
    maxPosts: maxPostsPerQuery,
    postedLimitDate: since.toISOString(),
    sortBy: 'date',
    profileScraperMode: 'short',
  };
}

/** Each post's origin: the query it echoes in `query.search`; no position. */
export function toLinkedinPostOrigins(items: readonly unknown[]): ItemOrigin[] {
  return items.map((item) => ({
    search: text(record(record(item).query).search),
    rank: null,
  }));
}
