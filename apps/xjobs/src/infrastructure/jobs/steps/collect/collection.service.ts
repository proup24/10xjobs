import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  AshbyCollector,
  GreenhouseCollector,
  LinkedinJobBoardCollector,
  LinkedinPostsCollector,
  type SegmentSearch,
  type SegmentResult,
} from 'src/modules/collectors';
import {
  type BatchFile,
  batchStorageKey,
  ingestConfig,
  serializeBatchFile,
} from 'src/modules/ingest';
import { QuerySearchService } from 'src/modules/queries';
import {
  type NewSegmentRun,
  type SearchSegment,
  type SegmentWindow,
  SearchSegmentsRepository,
  type SegmentQueryOutcome,
  buildSegments,
  segmentWindow,
} from 'src/modules/segments';
import { StorageService } from 'src/modules/storage';
import { channelJobsConfig } from './config';
import { IngestQueue } from '../ingest';

/** Scheduler id and job name of a channel's recurring collect job. */
export const COLLECT_JOB = 'collect';

/** What one collect job did across the channel's segments. */
export interface CollectionSummary {
  channel: Channel;
  builders: number;
  segments: number;
  segmentsFailed: number;
  /** Items returned, attributed or not. */
  collected: number;
  /** Batches stored for ingest. */
  batches: number;
  costUsd: number;
}

/** Cost is retained even when the fetched results could not be stored. */
interface SegmentOutcome {
  stored: boolean;
  collected: number;
  costUsd: number;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * A channel's collection job. Each run groups the channel's active query search
 * builders into search segments and searches each segment with one Apify run
 * over the window its members have not covered. It stores each run's untouched
 * results as a batch file, records the run, its pending batch and the moved
 * cursors together, then hands the batch to ingest. It interprets nothing.
 * A worker process schedules and consumes it.
 */
@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    private readonly ashby: AshbyCollector,
    private readonly greenhouse: GreenhouseCollector,
    private readonly linkedinJobs: LinkedinJobBoardCollector,
    private readonly linkedinPosts: LinkedinPostsCollector,
    private readonly queries: QuerySearchService,
    private readonly segments: SearchSegmentsRepository,
    private readonly storage: StorageService,
    private readonly ingestQueue: IngestQueue,
  ) {}

  async collect(channel: Channel): Promise<CollectionSummary> {
    const config = channelJobsConfig[channel];
    // One end of window and observation time for every segment of the run.
    const until = new Date();
    const builders = await this.queries.listActive(channel);
    const segments = buildSegments(builders, config.segmentSize);
    const summary: CollectionSummary = {
      channel,
      builders: builders.length,
      segments: segments.length,
      segmentsFailed: 0,
      collected: 0,
      batches: 0,
      costUsd: 0,
    };

    for (const segment of segments) {
      const outcome = await this.runSegment(channel, segment, until);
      summary.costUsd += outcome.costUsd;
      summary.collected += outcome.collected;
      if (outcome.stored) summary.batches += 1;
      else summary.segmentsFailed += 1;
    }

    this.logger.log(
      Object.entries(summary)
        .map(([key, value]) => `${key}=${value}`)
        .join(' '),
    );
    if (summary.segments > 0 && summary.segmentsFailed === summary.segments)
      throw new Error(
        `${channel} collection failed for all ${summary.segments} segments`,
      );
    return summary;
  }

  /** Fetch and store one segment, returning its contribution to the totals. */
  private async runSegment(
    channel: Channel,
    segment: SearchSegment,
    until: Date,
  ): Promise<SegmentOutcome> {
    const config = channelJobsConfig[channel];
    const startedAt = new Date();
    const window = segmentWindow(segment.members, until, config.window);
    if (window.clipped)
      this.logger.warn(
        `Segment ${segment.key} was not collected for longer than ${config.window.maximumHours}h; older postings are not caught up`,
      );
    const search = buildSearch(channel, segment, window);
    const run = buildRun(segment, search, startedAt);
    let batch: BatchFile;
    let collected: number;
    let costUsd = 0;

    try {
      const result = await this.fetch(search);
      costUsd = result.costUsd ?? 0;
      Object.assign(run, {
        fetched: result.fetched,
        costMicroUsd:
          result.costUsd == null
            ? null
            : Math.round(result.costUsd * 1_000_000),
        capped: result.capped,
        truncatedQueryIds: result.truncatedQueryIds,
        perQuery: perQuery(result),
        searchTotals: result.searchTotals ?? null,
      });
      batch = buildBatch(search, result, run.id);
      collected = await this.saveBatch(batch, run);
    } catch (error) {
      this.logger.warn(`Segment ${segment.key} failed: ${message(error)}`);
      await this.segments
        .recordRun({
          ...run,
          finishedAt: new Date(),
          status: 'failed',
          error: message(error),
        })
        .catch((recordError: unknown) =>
          this.logger.error(
            `Could not record segment ${segment.hash}: ${message(recordError)}`,
          ),
        );
      return { stored: false, collected: 0, costUsd };
    }

    await this.enqueueBatch(batch.batchId);
    return { stored: true, collected, costUsd };
  }

  private async enqueueBatch(batchId: string): Promise<void> {
    try {
      await this.ingestQueue.enqueue(batchId);
    } catch (error) {
      // The batch is stored and pending: the ingest sweeper picks it up.
      this.logger.warn(
        `Batch ${batchId} stored but not enqueued: ${message(error)}`,
      );
    }
  }

  /** Store the file before committing its run, pending batch, and cursors. */
  private async saveBatch(
    file: BatchFile,
    run: NewSegmentRun & { id: string },
  ): Promise<number> {
    const itemCount = Object.values(file.itemsByQuery).reduce(
      (count, items) => count + items.length,
      file.unattributed.length,
    );
    const storageKey = batchStorageKey(file.channel, run.windowEnd, run.id);
    await this.storage.put(
      ingestConfig.bucket,
      storageKey,
      serializeBatchFile(file),
      'application/json',
    );
    await this.segments.recordCollectedRun(
      { ...run, finishedAt: new Date() },
      {
        id: file.batchId,
        storageKey,
        formatVersion: 1,
        observedAt: run.windowEnd,
        itemCount,
        actor: file.source.actor,
        apifyRunId: file.source.apifyRunId,
      },
      // A capped run may have stopped early: keep its searches eligible for retry.
      run.capped ? [] : run.queryIds,
    );
    return itemCount;
  }

  private fetch(segment: SegmentSearch): Promise<SegmentResult> {
     return this.linkedinJobs.collect(
          segment,
          channelJobsConfig[Channel.LINKEDIN_JOB_BOARD].run,
    );
    // switch (segment.channel) {
    //   case Channel.ASHBY:
    //     return this.ashby.collect(
    //       segment,
    //       channelJobsConfig[Channel.ASHBY].run,
    //     );
    //   case Channel.GREEN_HOUSE:
    //     return this.greenhouse.collect(
    //       segment,
    //       channelJobsConfig[Channel.GREEN_HOUSE].run,
    //     );
    //   case Channel.LINKEDIN_JOB_BOARD:
    //     return this.linkedinJobs.collect(
    //       segment,
    //       channelJobsConfig[Channel.LINKEDIN_JOB_BOARD].run,
    //     );
    //   case Channel.LINKEDIN_POSTS:
    //     return this.linkedinPosts.collect(
    //       segment,
    //       channelJobsConfig[Channel.LINKEDIN_POSTS].run,
    //     );
    // }
  }
}

function perQuery(result: SegmentResult): Record<string, SegmentQueryOutcome> {
  return Object.fromEntries(
    [...result.itemsByQuery].map(([id, items]) => [
      id,
      { returned: items.length },
    ]),
  );
}

function buildSearch(
  channel: Channel,
  segment: SearchSegment,
  window: SegmentWindow,
): SegmentSearch {
  return {
    channel,
    since: window.since,
    until: window.until,
    queries: segment.members.map((member) => ({
      id: member.id,
      keyword: member.keyword,
      params: member.params as Record<string, unknown>,
    })),
  };
}

function buildRun(
  segment: SearchSegment,
  search: SegmentSearch,
  startedAt: Date,
): NewSegmentRun & { id: string } {
  return {
    id: randomUUID(),
    channel: search.channel,
    segmentKey: segment.key,
    segmentHash: segment.hash,
    queryIds: search.queries.map(({ id }) => id),
    windowStart: search.since,
    windowEnd: search.until,
    startedAt,
    finishedAt: startedAt,
    status: 'succeeded',
    fetched: 0,
    costMicroUsd: null,
    capped: false,
    truncatedQueryIds: [],
    perQuery: {},
    searchTotals: null,
    error: null,
  };
}

function buildBatch(
  search: SegmentSearch,
  result: SegmentResult,
  runId: string,
): BatchFile {
  return {
    formatVersion: 1,
    batchId: randomUUID(),
    channel: search.channel,
    segmentRunId: runId,
    observedAt: search.until.toISOString(),
    source: result.source,
    queries: search.queries,
    itemsByQuery: Object.fromEntries(result.itemsByQuery),
    unattributed: result.unattributed,
  };
}
