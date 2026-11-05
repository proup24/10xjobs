import { Injectable } from '@nestjs/common';
import type {
  BoardSearchRunConfig,
  SegmentSearch,
} from '../../types/collector';
import { attribute, reachedChargeCap } from '../../utils/collected-job';
import {
  boardQuery,
  type DiscoveryHit,
  toGoogleHits,
  toGooglePaging,
  toGoogleSearchInput,
} from '../mappers/google-search.mapper';
import { ApifyActorProvider } from './apify.provider';

/** What one Google run discovered for a segment, per member builder. */
export interface SegmentDiscovery {
  hitsByQuery: Map<string, DiscoveryHit[]>;
  /** Hits whose query matches no member; kept for the batch. */
  unattributed: DiscoveryHit[];
  source: { actor: string; apifyRunId: string | null };
  /** Results Google returned, attributed or not. */
  fetched: number;
  costUsd: number | null;
  capped: boolean;
  /** Members whose last allowed page still had more results. */
  truncatedQueryIds: string[];
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
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      toGoogleSearchInput(
        searches.map(({ search }) => search),
        segment,
        config.maxPagesPerQuery,
      ),
      { maxChargeUsd: config.maxRunChargeUsd },
    );

    const hits = toGoogleHits(items);
    const paging = toGooglePaging(items);
    const { byQuery, unattributed } = attribute(
      hits,
      (hit) => hit.search,
      searches,
    );
    const truncated = ({ search }: { search: string }) => {
      const { pages = 0, hasMore = false } = paging.get(search) ?? {};
      return hasMore && pages >= config.maxPagesPerQuery;
    };
    return {
      hitsByQuery: byQuery,
      unattributed,
      source: { actor: config.actor, apifyRunId: runId },
      fetched: hits.length,
      costUsd,
      capped: reachedChargeCap(costUsd, config.maxRunChargeUsd),
      truncatedQueryIds: searches.filter(truncated).map(({ id }) => id),
    };
  }
}
