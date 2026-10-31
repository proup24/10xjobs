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
}

/**
 * The Google query of one board builder. Remote builders also require the word
 * "remote"; on-site and hybrid builders are searched by keyword alone.
 */
export function boardQuery(
  keyword: string,
  params: Record<string, unknown>,
  config: Pick<BoardSearchRunConfig, 'site' | 'suffix'>,
): string {
  return [
    `site:${config.site}`,
    `"${keyword}"`,
    config.suffix,
    params.remote === true ? '"remote"' : null,
  ]
    .filter((part): part is string => !!part)
    .join(' ');
}

/** Google's `quickDateRange` for a window: whole hours, rounded up, at least one. */
function quickDateRange(since: Date, until: Date): string {
  const hours = (until.getTime() - since.getTime()) / 3_600_000;
  return `h${Math.max(1, Math.ceil(hours))}`;
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
      search: boardQuery(query.keyword, query.params, config),
    }));
    const { items, costUsd } = await this.actor.run(
      config.actor,
      {
        queries: [...new Set(searches.map(({ search }) => search))].join('\n'),
        maxPagesPerQuery: config.maxPagesPerQuery,
        quickDateRange: quickDateRange(segment.since, segment.until),
      },
      { maxChargeUsd: config.maxRunChargeUsd },
    );
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
    };
  }
}
