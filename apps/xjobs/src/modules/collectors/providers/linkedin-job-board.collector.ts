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
  linkedinSearch,
  toLinkedinJobBoardInput,
} from './mappers/linkedin-job-board.mapper';

/**
 * Apify trigger for the LinkedIn job board: one actor run per search. Segments
 * group builders by their search (`linkedinSearch`), so a segment runs one
 * start URL and every item the run returns belongs to every member.
 * Nothing is matched by text, and the run's `maxItems` and charge cap bound
 * that one search alone.
 */
@Injectable()
export class LinkedinJobBoardCollector {
  /** The actor and its limits; fixed for every run of this collector. */
  static readonly config: Readonly<LinkedinJobBoardRunConfig> = {
    actor: 'cheap_scraper/linkedin-job-scraper',
    // 100 rows cost about $0.07, plus the start fee; the cap only stops a
    // runaway run.
    maxRunChargeUsd: 0.25,
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
    const searches = new Set(
      segment.queries.map(({ keyword, params }) =>
        linkedinSearch(keyword, params),
      ),
    );
    if (searches.size !== 1)
      throw new Error(
        `A LinkedIn job board segment runs one search; this one has ${searches.size}`,
      );
    // Members may spell a geoId-pinned place differently; any one URL runs
    // the search.
    const [first] = segment.queries;
    const url = linkedinJobSearchUrl(first.keyword, first.params, seconds);
    const { items, costUsd, runId, keyValueStoreId } = await this.actor.run(
      config.actor,
      toLinkedinJobBoardInput(url, config.maxRowsPerUrl),
      { maxChargeUsd: config.maxRunChargeUsd },
    );

    // The actor reports no position; dataset order is newest first.
    const found = items.map((payload, i) => ({ rank: i + 1, payload }));
    return {
      itemsByQuery: new Map(segment.queries.map(({ id }) => [id, [...found]])),
      unattributed: [],
      truncatedQueryIds:
        items.length >= config.maxRowsPerUrl
          ? segment.queries.map(({ id }) => id)
          : [],
      fetched: items.length,
      searchTotals: await this.searchTotals(keyValueStoreId),
      costUsd,
      capped: reachedChargeCap(costUsd, config.maxRunChargeUsd),
      source: { actor: config.actor, apifyRunId: runId },
    };
  }

  /**
   * What LinkedIn said matched the start URL, if the actor stored it. A
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
