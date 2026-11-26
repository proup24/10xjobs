import { Injectable, Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type {
  IndeedRunConfig,
  SegmentResult,
  SegmentSearch,
} from '../types/collector';
import { reachedChargeCap } from '../utils/collected-job';
import { SearchNotStartedError } from '../utils/search-not-started';
import { ApifyActorProvider } from './apify/apify.provider';
import { toIndeedInput } from './mappers/indeed-input';

/**
 * Indeed: one `valig/indeed-jobs-scraper` run per segment, a segment being one
 * merged search on one country site and location. Every item belongs to every
 * member, as the segment is a single search.
 */
@Injectable()
export class IndeedCollector {
  static readonly config: Readonly<IndeedRunConfig> = {
    actor: 'valig/indeed-jobs-scraper',
    // Only the ceiling for a run's charge limit, which comes from the day's budget.
    maxRunChargeUsd: 0.11,
    maxRowsPerSearch: 1000,
    waitSecs: 900,
  };

  readonly channel = Channel.INDEED;
  private readonly logger = new Logger(IndeedCollector.name);
  constructor(private readonly actor: ApifyActorProvider) {}

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const config = IndeedCollector.config;
    if (segment.maxChargeUsd === undefined)
      throw new SearchNotStartedError(
        'The Indeed collector needs a charge limit and got none',
      );
    const maxChargeUsd = Math.min(segment.maxChargeUsd, config.maxRunChargeUsd);
    const { items, costUsd, runId } = await this.actor.run(
      config.actor,
      toIndeedInput(segment, config.maxRowsPerSearch),
      { maxChargeUsd, waitSecs: config.waitSecs },
    );
    const found = items.map((payload, i) => ({ rank: i + 1, payload }));
    const full = items.length >= config.maxRowsPerSearch;
    if (full)
      this.logger.warn(
        `INDEED segment ${segment.segmentKey ?? '?'} returned ${items.length} rows, its row cap; jobs past it are lost`,
      );
    return {
      itemsByQuery: new Map(segment.queries.map(({ id }) => [id, [...found]])),
      unattributed: [],
      truncatedQueryIds: full ? segment.queries.map(({ id }) => id) : [],
      fetched: items.length,
      searchTotals: null,
      costUsd,
      capped: reachedChargeCap(costUsd, maxChargeUsd),
      source: { actor: config.actor, apifyRunId: runId },
    };
  }
}
