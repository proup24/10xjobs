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
  linkedinGroupKey,
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
  };

  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  constructor(private readonly actor: ApifyActorProvider) {}

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = LinkedinJobBoardCollector.config;
    // Throws for a place with no geoId; that failure must reach the caller.
    const searches = new Set(
      segment.queries.map(({ params }) => linkedinGroupKey(params)),
    );
    if (searches.size !== 1)
      throw new Error(
        `A LinkedIn job board segment runs one search; this one has ${searches.size}`,
      );
    // Members may spell a geoId-pinned place differently; any one runs the search.
    const [first] = segment.queries;
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      {
        ...toHarvestJobSearchInput(
          first.keyword,
          first.params,
          config.maxRowsPerSearch,
        ),
      },
      { maxChargeUsd: config.maxRunChargeUsd },
    );

    // The actor reports no position; dataset order is newest first.
    const found = items.map((payload, i) => ({ rank: i + 1, payload }));
    const totals = searchTotals(items[0]);
    const total = (totals as { totalElements?: unknown } | null)?.totalElements;
    const truncated =
      items.length >= config.maxRowsPerSearch ||
      (typeof total === 'number' && total > items.length);
    return {
      itemsByQuery: new Map(segment.queries.map(({ id }) => [id, [...found]])),
      unattributed: [],
      truncatedQueryIds: truncated ? segment.queries.map(({ id }) => id) : [],
      fetched: items.length,
      searchTotals: totals,
      costUsd,
      capped: reachedChargeCap(costUsd, config.maxRunChargeUsd),
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
