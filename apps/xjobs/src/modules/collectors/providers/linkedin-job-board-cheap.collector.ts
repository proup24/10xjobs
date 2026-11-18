import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type {
  LinkedinJobBoardRunConfig,
  SegmentResult,
  SegmentSearch,
} from '../types/collector';
import { reachedChargeCap } from '../utils/collected-job';
import { SearchNotStartedError } from '../utils/search-not-started';
import { ApifyActorProvider } from './apify/apify.provider';
import {
  CHEAP_SCRAPER_ACTOR,
  linkedinJobSearchUrl,
  toLinkedinJobBoardInput,
} from './mappers/cheap-scraper-input';
import {
  linkedinGeoId,
  linkedinGroupKey,
  mergedLinkedinKeyword,
} from './mappers/linkedin-job-board.mapper';

/**
 * Trial trigger for the LinkedIn job board: one `cheap_scraper` run per search,
 * beside harvestapi's. Segments group builders by their search, so a segment
 * runs one search and every item belongs to every member. The actor takes a
 * search URL (last hour, newest first, place pinned by geoId) and reports no
 * totals, so a run is full when it returns its row limit.
 */
@Injectable()
export class LinkedinJobBoardCheapCollector {
  /** The actor and its limits; fixed for every run of this collector. */
  static readonly config: Readonly<LinkedinJobBoardRunConfig> = {
    actor: CHEAP_SCRAPER_ACTOR,
    // The cap only stops a runaway run.
    maxRunChargeUsd: 0.15,
    maxRowsPerSearch: 100,
    maxRowsCeiling: 1000,
  };

  readonly channel = Channel.LINKEDIN_JOB_BOARD_CHEAP;
  constructor(private readonly actor: ApifyActorProvider) {}

  /**
   * The actor input, built before any Apify call. Anything wrong here (a place
   * with no geoId, members that run different searches) throws a
   * {@link SearchNotStartedError}: no run started, nothing charged.
   */
  private input(segment: SegmentSearch, rows: number): Record<string, unknown> {
    try {
      const searches = new Set(
        segment.queries.map(({ params }) => linkedinGroupKey(params)),
      );
      if (searches.size !== 1)
        throw new Error(
          `A LinkedIn job board segment runs one search; this one has ${searches.size}`,
        );
      // Members may spell a geoId-pinned place differently; any one runs the search.
      const [first] = segment.queries;
      const url = linkedinJobSearchUrl(
        mergedLinkedinKeyword(segment.queries),
        { ...first.params, geoId: linkedinGeoId(first.params) },
        3600,
      );
      return toLinkedinJobBoardInput(url, rows);
    } catch (error) {
      throw new SearchNotStartedError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = LinkedinJobBoardCheapCollector.config;
    // The charge cap grows with the rows asked for.
    const rows = segment.maxItems ?? config.maxRowsPerSearch;
    const maxChargeUsd =
      (config.maxRunChargeUsd * rows) / config.maxRowsPerSearch;
    const input = this.input(segment, rows);
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      input,
      {
        maxChargeUsd,
      },
    );

    // The actor reports no position; dataset order is newest first.
    const found = items.map((payload, i) => ({ rank: i + 1, payload }));
    const truncated = items.length >= rows;
    return {
      itemsByQuery: new Map(segment.queries.map(({ id }) => [id, [...found]])),
      unattributed: [],
      truncatedQueryIds: truncated ? segment.queries.map(({ id }) => id) : [],
      fetched: items.length,
      searchTotals: null,
      costUsd,
      capped: reachedChargeCap(costUsd, maxChargeUsd),
      source: { actor: config.actor, apifyRunId: runId },
    };
  }
}
