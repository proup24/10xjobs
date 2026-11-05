import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type {
  LinkedinPostsRunConfig,
  SegmentResult,
  SegmentSearch,
} from '../types/collector';
import { reachedChargeCap } from '../utils/collected-job';
import { ApifyActorProvider } from './apify/apify.provider';
import {
  toLinkedinPostOrigins,
  toLinkedinPostsInput,
} from './mappers/linkedin-posts.mapper';
import { attributeItems } from './segment-result';

/** Apify trigger for LinkedIn posts: one actor run per search segment. */
@Injectable()
export class LinkedinPostsCollector {
  /** The actor and its limits; fixed for every run of this collector. */
  static readonly config: Readonly<LinkedinPostsRunConfig> = {
    actor: 'harvestapi/linkedin-post-search',
    maxRunChargeUsd: 0.75,
    maxPostsPerQuery: 100,
  };

  readonly channel = Channel.LINKEDIN_POSTS;
  constructor(private readonly actor: ApifyActorProvider) {}

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = LinkedinPostsCollector.config;
    const searches = segment.queries.map(({ id, keyword }) => ({
      id,
      search: keyword,
    }));
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      toLinkedinPostsInput(
        searches.map(({ search }) => search),
        segment.since,
        config.maxPostsPerQuery,
      ),
      { maxChargeUsd: config.maxRunChargeUsd },
    );

    return {
      ...attributeItems(
        items,
        toLinkedinPostOrigins(items),
        searches,
        config.maxPostsPerQuery,
      ),
      costUsd,
      capped: reachedChargeCap(costUsd, config.maxRunChargeUsd),
      source: { actor: config.actor, apifyRunId: runId },
    };
  }
}
