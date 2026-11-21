import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { mergedPostKeyword } from 'src/modules/queries/posts/merge';
import type {
  LinkedinPostsRunConfig,
  SegmentResult,
  SegmentSearch,
} from '../types/collector';
import { reachedChargeCap } from '../utils/collected-job';
import { SearchNotStartedError } from '../utils/search-not-started';
import { ApifyActorProvider } from './apify/apify.provider';
import { postRunFailure } from './mappers/linkedin-posts.log';

/**
 * LinkedIn posts: one `harvestapi/linkedin-post-search` run per segment, with
 * the members' words merged into one search. Every post belongs to every
 * member. The actor reports SUCCEEDED even when it failed, so the run log is
 * read afterwards and a known failure marks the result incomplete.
 */
@Injectable()
export class LinkedinPostsCollector {
  static readonly config: Readonly<LinkedinPostsRunConfig> = {
    actor: 'harvestapi/linkedin-post-search',
    // Only the ceiling for a run's charge limit, which comes from the day's budget.
    maxRunChargeUsd: 1.5,
    waitSecs: 900,
  };

  readonly channel = Channel.LINKEDIN_POSTS;
  constructor(private readonly actor: ApifyActorProvider) {}

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = LinkedinPostsCollector.config;
    if (segment.maxChargeUsd === undefined)
      throw new SearchNotStartedError(
        'The posts collector needs a charge limit and got none',
      );
    const maxChargeUsd = Math.min(segment.maxChargeUsd, config.maxRunChargeUsd);
    const input = {
      searchQueries: [mergedPostKeyword(segment.queries)],
      maxPosts: 0,
      postedLimitDate: segment.since.toISOString(),
      sortBy: 'date',
      profileScraperMode: 'short',
    };
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      input,
      { maxChargeUsd, waitSecs: config.waitSecs },
    );
    const found = items.map((payload, i) => ({ rank: i + 1, payload }));
    return {
      itemsByQuery: new Map(segment.queries.map(({ id }) => [id, [...found]])),
      unattributed: [],
      truncatedQueryIds: [],
      fetched: items.length,
      searchTotals: null,
      costUsd,
      capped: reachedChargeCap(costUsd, maxChargeUsd),
      incomplete: postRunFailure(await this.actor.runLog(runId)),
      source: { actor: config.actor, apifyRunId: runId },
    };
  }
}
