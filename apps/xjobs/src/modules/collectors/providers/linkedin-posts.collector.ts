import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type {
  LinkedinPostsRunConfig,
  RawCollectedItem,
  SegmentResult,
  SegmentSearch,
} from '../types/collector';
import {
  attribute,
  reachedChargeCap,
  record,
  text,
} from '../utils/collected-job';
import { ApifyActorProvider } from './apify/apify.provider';

/** The query a post was found by, as the actor echoes it. */
function querySearch(item: unknown): string | null {
  return text(record(record(item).query).search);
}

/** Apify trigger for LinkedIn posts: one actor run per search segment. */
@Injectable()
export class LinkedinPostsCollector {
  readonly channel = Channel.LINKEDIN_POSTS;
  constructor(private readonly actor: ApifyActorProvider) {}

  async collect(
    segment: SegmentSearch,
    config: LinkedinPostsRunConfig,
  ): Promise<SegmentResult> {
    const searches = segment.queries.map((query) => ({
      id: query.id,
      search: query.keyword,
    }));
    // The actor has no location filter, so `params.location` is not applied.
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      {
        searchQueries: [...new Set(searches.map(({ search }) => search))],
        maxPosts: config.maxPostsPerQuery,
        postedLimitDate: segment.since.toISOString(),
        sortBy: 'date',
        profileScraperMode: 'short',
      },
      { maxChargeUsd: config.maxRunChargeUsd },
    );

    const { byQuery, unattributed } = attribute(items, querySearch, searches);
    // The actor reports no positions, so posts carry no rank.
    const raw = (item: unknown): RawCollectedItem => ({
      rank: null,
      payload: item,
    });
    const itemsByQuery = new Map<string, RawCollectedItem[]>();
    const truncatedQueryIds: string[] = [];
    for (const { id } of searches) {
      const found = byQuery.get(id) ?? [];
      itemsByQuery.set(id, found.map(raw));
      // Scanned is what it returned.
      if (found.length >= config.maxPostsPerQuery) truncatedQueryIds.push(id);
    }
    return {
      itemsByQuery,
      unattributed: unattributed.map(raw),
      fetched: items.length,
      costUsd,
      capped: reachedChargeCap(costUsd, config.maxRunChargeUsd),
      truncatedQueryIds,
      source: { actor: config.actor, apifyRunId: runId },
    };
  }
}
