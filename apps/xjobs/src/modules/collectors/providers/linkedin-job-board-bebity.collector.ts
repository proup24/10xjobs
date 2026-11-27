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
import { BEBITY_ACTOR, toBebityInput } from './mappers/bebity-input';
import {
  linkedinGeoId,
  linkedinBoardKeyword,
} from './mappers/linkedin-job-board.mapper';

/**
 * Trial trigger for the LinkedIn job board: one `bebity/linkedin-jobs-scraper`
 * run per search, beside harvestapi's. Segments group builders by their search,
 * so a segment runs one search and every item belongs to every member. The
 * actor takes search fields (title, place name, filters, last hour) and reports
 * no totals, so a run is full when it returns its row limit.
 */
@Injectable()
export class LinkedinJobBoardBebityCollector {
  /** The actor and its limits; fixed for every run of this collector. */
  static readonly config: Readonly<LinkedinJobBoardRunConfig> = {
    actor: BEBITY_ACTOR,
    // 1,000 rows plus the start fee, with margin (bebity charges $0.00125 a
    // job); the cap only stops a runaway run.
    maxRunChargeUsd: 1.5,
    // Fixed at 1 GB, like cheap_scraper, to keep its start fee low.
    memoryMbytes: 1024,
    maxRowsPerSearch: 1000,
  };

  readonly channel = Channel.LINKEDIN_JOB_BOARD_BEBITY;
  constructor(private readonly actor: ApifyActorProvider) {}

  /** The actor input, built before any Apify call (see {@link oneSearchInput}). */
  private input(segment: SegmentSearch, rows: number): Record<string, unknown> {
    return oneSearchInput(segment, (first) =>
      toBebityInput(
        linkedinBoardKeyword(segment.queries),
        { ...first.params, geoId: linkedinGeoId(first.params) },
        rows,
      ),
    );
  }

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = LinkedinJobBoardBebityCollector.config;
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

    // The actor reports no position; dataset order is the rank.
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
