import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type {
  LinkedinJobBoardRunConfig,
  SegmentResult,
  SegmentSearch,
} from '../types/collector';
import { reachedChargeCap } from '../utils/collected-job';
import { ApifyActorProvider } from './apify/apify.provider';
import {
  linkedinJobSearchUrl,
  linkedinSearchKey,
  linkedinSearchString,
  toLinkedinJobBoardInput,
  toLinkedinJobOrigins,
} from './mappers/linkedin-job-board.mapper';
import { attributeItems } from './segment-result';

/** Apify trigger for the LinkedIn job board: one actor run per search segment. */
@Injectable()
export class LinkedinJobBoardCollector {
  /** The actor and its limits; fixed for every run of this collector. */
  static readonly config: Readonly<LinkedinJobBoardRunConfig> = {
    actor: 'cheap_scraper/linkedin-job-scraper',
    maxRunChargeUsd: 1,
    maxRowsPerUrl: 100,
  };

  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  constructor(private readonly actor: ApifyActorProvider) {}

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = LinkedinJobBoardCollector.config;
    const seconds = Math.max(
      1,
      Math.round((segment.until.getTime() - segment.since.getTime()) / 1000),
    );
    const searches = segment.queries.map(({ id, keyword, params }) => ({
      id,
      url: linkedinJobSearchUrl(keyword, params, seconds),
      search:
        linkedinSearchKey(linkedinSearchString(keyword, params)) ?? keyword,
    }));
    // Members with identical searches share one start URL; attribution gives
    // every one of them its items.
    const { items, costUsd, runId, keyValueStoreId } = await this.actor.run(
      config.actor,
      toLinkedinJobBoardInput(searches.map(({ url }) => url)),
      { maxChargeUsd: config.maxRunChargeUsd },
    );

    return {
      ...attributeItems(
        items,
        toLinkedinJobOrigins(items),
        searches,
        config.maxRowsPerUrl,
      ),
      searchTotals: await this.searchTotals(keyValueStoreId),
      costUsd,
      capped: reachedChargeCap(costUsd, config.maxRunChargeUsd),
      source: { actor: config.actor, apifyRunId: runId },
    };
  }

  /**
   * What LinkedIn said matched each start URL, if the actor stored it. A
   * missing or unreadable record is null: the paid results never depend on it.
   */
  private async searchTotals(storeId: string | null): Promise<unknown> {
    if (!storeId) return null;
    try {
      return (await this.actor.record(storeId, 'SEARCH_TOTALS')) ?? null;
    } catch {
      return null;
    }
  }
}
