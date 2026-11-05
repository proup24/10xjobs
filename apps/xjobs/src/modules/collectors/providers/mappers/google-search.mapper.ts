/**
 * Input and output mapping for Google discovery of Ashby and Greenhouse
 * postings, `apify/google-search-scraper`. Each dataset item is one results
 * page; its query is echoed in `searchQuery.term`.
 */
import type { BoardSearchRunConfig } from '../../types/collector';
import { rankOf, record, text } from '../../utils/collected-job';

/** One organic Google result. */
export interface DiscoveryHit {
  url: string;
  /** Google query that returned this result. */
  search: string;
  /** Google's position for the result, when it reports one. */
  rank: number | null;
  raw: Record<string, unknown>;
}

/** Per query: pages returned, and whether the last one had more. */
export interface QueryPaging {
  pages: number;
  hasMore: boolean;
}

/**
 * The Google query of one board builder: the site, the builder's query as it
 * is (titles, technologies, seniority and place already in place), and the
 * channel's suffix.
 */
export function boardQuery(
  keyword: string,
  config: Pick<BoardSearchRunConfig, 'site' | 'suffix'>,
): string {
  return [`site:${config.site}`, keyword, config.suffix]
    .filter((part) => !!part)
    .join(' ');
}

/** Google's `quickDateRange` for a window: whole hours below a day, whole days from a day. */
function quickDateRange(since: Date, until: Date): string {
  const hours = (until.getTime() - since.getTime()) / 3_600_000;
  return hours < 24
    ? `h${Math.max(1, Math.ceil(hours))}`
    : `d${Math.ceil(hours / 24)}`;
}

/** The actor input for one run over these queries in the window. */
export function toGoogleSearchInput(
  queries: readonly string[],
  window: { since: Date; until: Date },
  maxPagesPerQuery: number,
): Record<string, unknown> {
  return {
    queries: [...new Set(queries)].join('\n'),
    maxPagesPerQuery,
    quickDateRange: quickDateRange(window.since, window.until),
  };
}

/** The organic results of every page, with the query each page echoes. */
export function toGoogleHits(items: readonly unknown[]): DiscoveryHit[] {
  return items.flatMap((value) => {
    const page = record(value);
    const search = text(record(page.searchQuery).term);
    const results = Array.isArray(page.organicResults)
      ? page.organicResults.map(record)
      : [];
    return results.flatMap((result) => {
      const url = text(result.url) ?? text(result.link);
      return url && search
        ? [{ url, search, rank: rankOf(result.position), raw: result }]
        : [];
    });
  });
}

/** Pages returned per query, and whether its last page had more (career-hub). */
export function toGooglePaging(
  items: readonly unknown[],
): Map<string, QueryPaging> {
  const paging = new Map<string, QueryPaging>();
  for (const value of items) {
    const page = record(value);
    const search = text(record(page.searchQuery).term);
    if (!search) continue;
    paging.set(search, {
      pages: (paging.get(search)?.pages ?? 0) + 1,
      hasMore: page.hasNextPage === true,
    });
  }
  return paging;
}
