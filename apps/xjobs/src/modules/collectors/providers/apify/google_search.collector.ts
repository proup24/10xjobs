import { Injectable } from '@nestjs/common';
import type {
  BoardSearchRunConfig,
  SegmentSearch,
} from '../../types/collector';
import {
  attribute,
  reachedChargeCap,
  record,
  text,
} from '../../utils/collected-job';
import { ApifyActorProvider } from './apify.provider';

export interface DiscoveryHit {
  url: string;
  /** Google query that returned this result. */
  search: string;
  raw: Record<string, unknown>;
}

/** What one Google run discovered for a segment, per member builder. */
export interface SegmentDiscovery {
  hitsByQuery: Map<string, DiscoveryHit[]>;
  /** Results Google returned, attributed or not. */
  fetched: number;
  costUsd: number | null;
  capped: boolean;
  /** Members whose last allowed page still had more results. */
  truncatedQueryIds: string[];
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

/** The country every member searches in, or null when they differ or have none. */
function sharedCountry(segment: SegmentSearch): string | null {
  const codes = new Set(
    segment.queries.map((query) =>
      typeof query.params.countryCode === 'string'
        ? query.params.countryCode
        : null,
    ),
  );
  const [code] = codes;
  return codes.size === 1 && code ? code : null;
}

/** Apify trigger for Greenhouse and Ashby discovery: one Google run per segment. */
@Injectable()
export class GoogleJobsSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}

  async search(
    segment: SegmentSearch,
    config: BoardSearchRunConfig,
  ): Promise<SegmentDiscovery> {
    const searches = segment.queries.map((query) => ({
      id: query.id,
      search: boardQuery(query.keyword, config),
    }));
    const countryCode = sharedCountry(segment);
    const { items, costUsd } = await this.actor.run(
      config.actor,
      {
        queries: [...new Set(searches.map(({ search }) => search))].join('\n'),
        maxPagesPerQuery: config.maxPagesPerQuery,
        quickDateRange: quickDateRange(segment.since, segment.until),
        // Onsite segments share a city, so Google searches from its country.
        ...(countryCode ? { countryCode } : {}),
      },
      { maxChargeUsd: config.maxRunChargeUsd },
    );
    // Per query: pages returned and whether the last one had more (career-hub).
    const pages = new Map<string, number>();
    const hasMore = new Map<string, boolean>();
    for (const value of items) {
      const page = record(value);
      const search = text(record(page.searchQuery).term);
      if (!search) continue;
      pages.set(search, (pages.get(search) ?? 0) + 1);
      hasMore.set(search, page.hasNextPage === true);
    }
    // Each dataset item is one results page; its query is echoed in searchQuery.term.
    const hits = items.flatMap((value) => {
      const page = record(value);
      const search = text(record(page.searchQuery).term);
      const results = Array.isArray(page.organicResults)
        ? page.organicResults.map(record)
        : [];
      return results.flatMap((result) => {
        const url = text(result.url) ?? text(result.link);
        return url && search ? [{ url, search, raw: result }] : [];
      });
    });
    return {
      hitsByQuery: attribute(hits, (hit) => hit.search, searches),
      fetched: hits.length,
      costUsd,
      capped: reachedChargeCap(costUsd, config.maxRunChargeUsd),
      truncatedQueryIds: searches
        .filter(
          ({ search }) =>
            hasMore.get(search) === true &&
            (pages.get(search) ?? 0) >= config.maxPagesPerQuery,
        )
        .map(({ id }) => id),
    };
  }
}
