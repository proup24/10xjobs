import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import type {
  ActorRunConfig,
  Collector,
  SegmentResult,
} from 'src/modules/collectors';
import {
  type BatchFile,
  batchStorageKey,
  ingestConfig,
  serializeBatchFile,
} from 'src/modules/ingest';
import type { QuerySearchService } from 'src/modules/queries';
import {
  type NewSegmentRun,
  type SearchSegment,
  type SearchSegmentsRepository,
  type SegmentQueryOutcome,
  buildSegments,
  segmentWindow,
} from 'src/modules/segments';
import type { StorageService } from 'src/modules/storage';
import type { ChannelJobConfig } from '../../config';
import type { IngestQueue } from '../ingest';

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
export abstract class CollectionJob<R extends ActorRunConfig = ActorRunConfig> {
  abstract readonly channel: Channel;
  abstract readonly queueName: string;
  abstract readonly config: ChannelJobConfig<R>;
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly collector: Collector<R>,
    protected readonly queries: QuerySearchService,
    protected readonly segments: SearchSegmentsRepository,
    protected readonly storage: StorageService,
    protected readonly ingestQueue: IngestQueue,
  ) {}

  async run(): Promise<CollectionSummary> {
    // One end of window and observation time for every segment of the run.
    const until = new Date();
    const builders = await this.queries.listActive(this.channel);
    const segments = buildSegments(builders, this.config.segmentSize);
    const summary: CollectionSummary = {
      channel: this.channel,
      builders: builders.length,
      segments: segments.length,
      segmentsFailed: 0,
      collected: 0,
      batches: 0,
      costUsd: 0,
    };

    for (const segment of segments)
      if (!(await this.runSegment(segment, until, summary)))
        summary.segmentsFailed += 1;

    this.logger.log(
      Object.entries(summary)
        .map(([key, value]) => `${key}=${value}`)
        .join(' '),
    );
    if (summary.segments > 0 && summary.segmentsFailed === summary.segments)
      throw new Error(
        `${this.channel} collection failed for all ${summary.segments} segments`,
      );
    return summary;
  }

  /** True when the segment's results were stored as a pending batch. */
  private async runSegment(
    segment: SearchSegment,
    until: Date,
    summary: CollectionSummary,
  ): Promise<boolean> {
    const startedAt = new Date();
    const window = segmentWindow(segment.members, until, this.config.window);
    if (window.clipped)
      this.logger.warn(
        `Segment ${segment.key} was not collected for longer than ${this.config.window.maximumHours}h; older postings are not caught up`,
      );
    const runId = randomUUID();
    const batchId = randomUUID();
    const run = (
      result: SegmentResult | null,
      error: string | null,
    ): NewSegmentRun => ({
      channel: this.channel,
      segmentKey: segment.key,
      segmentHash: segment.hash,
      queryIds: segment.members.map((member) => member.id),
      windowStart: window.since,
      windowEnd: window.until,
      startedAt,
      finishedAt: new Date(),
      status: error ? 'failed' : 'succeeded',
      fetched: result?.fetched ?? 0,
      costMicroUsd:
        result?.costUsd == null ? null : Math.round(result.costUsd * 1_000_000),
      capped: result?.capped ?? false,
      truncatedQueryIds: result?.truncatedQueryIds ?? [],
      perQuery: result ? perQuery(result) : {},
      error,
    });
    const recordFailed = (result: SegmentResult | null, error: unknown) => {
      this.logger.warn(`Segment ${segment.key} failed: ${message(error)}`);
      return this.segments
        .recordRun(run(result, message(error)))
        .catch((recordError: unknown) =>
          this.logger.error(
            `Could not record segment ${segment.hash}: ${message(recordError)}`,
          ),
        );
    };

    let result: SegmentResult;
    try {
      result = await this.collector.collect(
        {
          channel: this.channel,
          since: window.since,
          until: window.until,
          queries: segment.members.map((member) => ({
            id: member.id,
            keyword: member.keyword,
            params: member.params as Record<string, unknown>,
          })),
        },
        this.config.run,
      );
    } catch (error) {
      await recordFailed(null, error);
      return false;
    }
    summary.costUsd += result.costUsd ?? 0;

    const file: BatchFile = {
      formatVersion: 1,
      batchId,
      channel: this.channel,
      segmentRunId: runId,
      observedAt: window.until.toISOString(),
      source: result.source,
      queries: segment.members.map((member) => ({
        id: member.id,
        keyword: member.keyword,
        params: member.params as Record<string, unknown>,
      })),
      itemsByQuery: Object.fromEntries(result.itemsByQuery),
      unattributed: result.unattributed,
    };
    const itemCount =
      [...result.itemsByQuery.values()].reduce((n, items) => n + items.length, 0) +
      result.unattributed.length;
    const storageKey = batchStorageKey(this.channel, window.until, runId);
    try {
      await this.storage.put(
        ingestConfig.bucket,
        storageKey,
        serializeBatchFile(file),
        'application/json',
      );
      await this.segments.recordCollectedRun(
        { ...run(result, null), id: runId },
        {
          id: batchId,
          storageKey,
          formatVersion: 1,
          observedAt: window.until,
          itemCount,
          actor: result.source.actor,
          apifyRunId: result.source.apifyRunId,
        },
        // A capped run may have stopped before some postings: search them again.
        result.capped ? [] : segment.members.map((member) => member.id),
      );
    } catch (error) {
      await recordFailed(result, error);
      return false;
    }
    summary.collected += itemCount;
    summary.batches += 1;

    try {
      await this.ingestQueue.enqueue(batchId);
    } catch (error) {
      // The batch is stored and pending: the ingest sweeper picks it up.
      this.logger.warn(
        `Batch ${batchId} stored but not enqueued: ${message(error)}`,
      );
    }
    return true;
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
