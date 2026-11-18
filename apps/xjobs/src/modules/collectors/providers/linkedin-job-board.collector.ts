import { Injectable, Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type {
  LinkedinJobBoardRunConfig,
  SegmentResult,
  SegmentSearch,
} from '../types/collector';
import { reachedChargeCap } from '../utils/collected-job';
import { oneSearchInput, runChargeCapUsd } from '../utils/linkedin-board-run';
import { ApifyActorProvider } from './apify/apify.provider';
import {
  type HarvestJobSearchInput,
  mergedLinkedinKeyword,
  toHarvestJobSearchInput,
} from './mappers/linkedin-job-board.mapper';

/**
 * Apify trigger for the LinkedIn job board: one actor run per search. Segments
 * group builders by their search (`linkedinGroupKey`), so a segment runs one
 * search and every item the run returns belongs to every member. The input
 * never depends on the segment's window: the actor is asked for the last hour.
 * Nothing is matched by text, and the run's `maxItems` and charge cap bound
 * that one search alone.
 */
@Injectable()
export class LinkedinJobBoardCollector {
  /** The actor and its limits; fixed for every run of this collector. */
  static readonly config: Readonly<LinkedinJobBoardRunConfig> = {
    actor: 'harvestapi/linkedin-job-search',
    // The cap only stops a runaway run.
    maxRunChargeUsd: 0.25,
    maxRowsPerSearch: 100,
    maxRowsCeiling: 1000,
  };

  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  private readonly logger = new Logger(LinkedinJobBoardCollector.name);
  constructor(private readonly actor: ApifyActorProvider) {}

  /** The actor input, built before any Apify call (see {@link oneSearchInput}). */
  private input(segment: SegmentSearch, rows: number): HarvestJobSearchInput {
    return oneSearchInput(segment, (first) =>
      toHarvestJobSearchInput(
        mergedLinkedinKeyword(segment.queries),
        first.params,
        rows,
      ),
    );
  }

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = LinkedinJobBoardCollector.config;
    // The charge cap grows with the rows asked for.
    const rows = segment.maxItems ?? config.maxRowsPerSearch;
    const maxChargeUsd = runChargeCapUsd(config, rows);
    // Throws for a place with no geoId; that failure must reach the caller.
    const input = this.input(segment, rows);
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      { ...input },
      { maxChargeUsd },
    );

    // The actor reports no position; dataset order is newest first.
    const found = items.map((payload, i) => ({ rank: i + 1, payload }));
    const totals = searchTotals(items[0]);
    const total = (totals as { totalElements?: unknown } | null)?.totalElements;
    const moreThanReturned = typeof total === 'number' && total > items.length;
    const truncated = items.length >= rows || moreThanReturned;
    // Full by the spec's rule, though the row limit wasn't reached: logged so
    // the week-one report can measure how often LinkedIn's total runs ahead.
    if (moreThanReturned && items.length < rows)
      this.logger.warn(
        `LinkedIn search ${segment.segmentKey ?? '(no segment key)'} returned ${items.length} of ${rows} rows but reports ${total} in total`,
      );
    return {
      itemsByQuery: new Map(segment.queries.map(({ id }) => [id, [...found]])),
      unattributed: [],
      truncatedQueryIds: truncated ? segment.queries.map(({ id }) => id) : [],
      fetched: items.length,
      searchTotals: totals,
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
