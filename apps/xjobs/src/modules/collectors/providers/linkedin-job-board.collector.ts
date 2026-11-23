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
  harvestGroupKey,
  type HarvestJobSearchInput,
  mergedExperienceLevel,
  mergedLinkedinKeyword,
  toHarvestJobSearchInput,
} from './mappers/linkedin-job-board.mapper';

/**
 * Apify trigger for the LinkedIn job board: one actor run per search. Segments
 * group builders by their search (`harvestGroupKey`: place and work type, every
 * experience level merged into one search), so a segment runs one search and every item the run returns belongs to
 * every member. The input
 * never depends on the segment's window: the actor is asked for the last hour.
 * Nothing is matched by text, and the run's `maxItems` and charge cap bound
 * that one search alone.
 */
@Injectable()
export class LinkedinJobBoardCollector {
  /** The actor and its limits; fixed for every run of this collector. */
  static readonly config: Readonly<LinkedinJobBoardRunConfig> = {
    actor: 'harvestapi/linkedin-job-search',
    // 1,000 rows at $0.001 plus the $0.001 start, with margin; the cap only
    // stops a runaway run.
    maxRunChargeUsd: 1.1,
    maxRowsPerSearch: 1000,
  };

  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  constructor(private readonly actor: ApifyActorProvider) {}

  /** The actor input, built before any Apify call (see {@link oneSearchInput}). */
  private input(segment: SegmentSearch, rows: number): HarvestJobSearchInput {
    return oneSearchInput(
      segment,
      (first) =>
        toHarvestJobSearchInput(
          mergedLinkedinKeyword(segment.queries),
          {
            ...first.params,
            experienceLevel: mergedExperienceLevel(segment.queries),
          },
          rows,
        ),
      harvestGroupKey,
    );
  }

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = LinkedinJobBoardCollector.config;
    const rows = config.maxRowsPerSearch;
    const maxChargeUsd = config.maxRunChargeUsd;
    // Throws for a place with no geoId; that failure must reach the caller.
    const input = this.input(segment, rows);
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      { ...input },
      { maxChargeUsd },
    );

    // The actor reports no position; dataset order is newest first.
    const found = items.map((payload, i) => ({ rank: i + 1, payload }));
    // Full only at the row limit; LinkedIn's total is stored, never judged.
    const truncated = items.length >= rows;
    return {
      itemsByQuery: new Map(segment.queries.map(({ id }) => [id, [...found]])),
      unattributed: [],
      truncatedQueryIds: truncated ? segment.queries.map(({ id }) => id) : [],
      fetched: items.length,
      searchTotals: searchTotals(items[0]),
      costUsd,
      capped: reachedChargeCap(costUsd, maxChargeUsd),
      source: { actor: config.actor, apifyRunId: runId },
    };
  }
}

/** What LinkedIn said matched the search: the first item's `_meta.pagination`, else null. */
function searchTotals(first: unknown): unknown {
  const meta = (first as { _meta?: { pagination?: unknown } } | undefined)
    ?._meta;
  return meta?.pagination ?? null;
}
