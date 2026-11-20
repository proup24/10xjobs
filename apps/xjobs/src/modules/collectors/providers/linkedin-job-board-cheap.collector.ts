import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type {
  LinkedinJobBoardRunConfig,
  SegmentResult,
  SegmentSearch,
} from '../types/collector';
import { reachedChargeCap } from '../utils/collected-job';
import { oneSearchInput } from '../utils/linkedin-board-run';
import { ApifyActorProvider } from './apify/apify.provider';
import {
  CHEAP_SCRAPER_ACTOR,
  linkedinJobSearchUrl,
  toLinkedinJobBoardInput,
} from './mappers/cheap-scraper-input';
import {
  linkedinGeoId,
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
    // 1,000 rows plus the start fee, with margin; the cap only stops a
    // runaway run.
    maxRunChargeUsd: 1.5,
    // Its start fee is $0.005 per GB, and its 4 GB default made every run cost $0.02 before any row.
    memoryMbytes: 1024,
    maxRowsPerSearch: 1000,
  };

  readonly channel = Channel.LINKEDIN_JOB_BOARD_CHEAP;
  constructor(private readonly actor: ApifyActorProvider) {}

  /** The actor input, built before any Apify call (see {@link oneSearchInput}). */
  private input(segment: SegmentSearch, rows: number): Record<string, unknown> {
    return oneSearchInput(segment, (first) =>
      toLinkedinJobBoardInput(
        linkedinJobSearchUrl(
          mergedLinkedinKeyword(segment.queries),
          { ...first.params, geoId: linkedinGeoId(first.params) },
          3600,
        ),
        rows,
      ),
    );
  }

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = LinkedinJobBoardCheapCollector.config;
    const rows = config.maxRowsPerSearch;
    const maxChargeUsd = config.maxRunChargeUsd;
    const input = this.input(segment, rows);
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      input,
      {
        maxChargeUsd,
        memoryMbytes: config.memoryMbytes,
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
