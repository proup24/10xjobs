import { Logger } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import type {
  ActorRunConfig,
  CollectedJob,
  Collector,
  SegmentResult,
} from 'src/modules/collectors';
import { type IngestService, ingestConfig } from 'src/modules/ingest';
import type { QuerySearchService } from 'src/modules/queries';
import {
  type SearchSegment,
  type SearchSegmentsRepository,
  type SegmentQueryOutcome,
  type SegmentRunStatus,
  buildSegments,
  segmentWindow,
} from 'src/modules/segments';
import type { ChannelJobConfig } from '../config';

/** Scheduler id and job name of a channel's recurring collect job. */
export const COLLECT_JOB = 'collect';

/** What one collect job did across the channel's segments. */
export interface CollectionSummary {
  channel: Channel;
  builders: number;
  segments: number;
  segmentsFailed: number;
  collected: number;
  inserted: number;
  updated: number;
  duplicate: number;
  invalid: number;
  costUsd: number;
}

const emptyOutcome = (): SegmentQueryOutcome => ({
  returned: 0,
  inserted: 0,
  updated: 0,
  duplicate: 0,
  invalid: 0,
});

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * A channel's collection job. Each run groups the channel's active query search
 * builders into search segments, searches each segment with one Apify run over
 * the window its members have not covered, ingests every member's results
 * against that member, moves the cursors of members that were fully ingested,
 * and records the segment run. A worker process schedules and consumes it.
 */
export abstract class CollectionJob<R extends ActorRunConfig = ActorRunConfig> {
  abstract readonly channel: Channel;
  abstract readonly queueName: string;
  abstract readonly config: ChannelJobConfig<R>;
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly collector: Collector<R>,
    protected readonly queries: QuerySearchService,
    protected readonly ingest: IngestService,
    protected readonly segments: SearchSegmentsRepository,
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
      inserted: 0,
      updated: 0,
      duplicate: 0,
      invalid: 0,
      costUsd: 0,
    };

    for (const segment of segments) {
      const status = await this.runSegment(segment, until, summary);
      if (status === 'failed') summary.segmentsFailed += 1;
    }

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

  private async runSegment(
    segment: SearchSegment,
    until: Date,
    summary: CollectionSummary,
  ): Promise<SegmentRunStatus> {
    const startedAt = new Date();
    const window = segmentWindow(segment.members, until, this.config.window);
    if (window.clipped)
      this.logger.warn(
        `Segment ${segment.key} was not collected for longer than ${this.config.window.maximumHours}h; older postings are not caught up`,
      );
    const queryIds = segment.members.map((member) => member.id);
    const record = (
      status: SegmentRunStatus,
      result: SegmentResult | null,
      perQuery: Record<string, SegmentQueryOutcome>,
      error: string | null,
    ) =>
      this.segments
        .recordRun({
          channel: this.channel,
          segmentKey: segment.key,
          segmentHash: segment.hash,
          queryIds,
          windowStart: window.since,
          windowEnd: window.until,
          startedAt,
          finishedAt: new Date(),
          status,
          fetched: result?.fetched ?? 0,
          costMicroUsd:
            result?.costUsd == null
              ? null
              : Math.round(result.costUsd * 1_000_000),
          capped: result?.capped ?? false,
          truncatedQueryIds: result?.truncatedQueryIds ?? [],
          perQuery,
          error,
        })
        .catch((recordError: unknown) =>
          this.logger.error(
            `Could not record segment ${segment.hash}: ${message(recordError)}`,
          ),
        );

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
      this.logger.warn(`Segment ${segment.key} failed: ${message(error)}`);
      await record('failed', null, {}, message(error));
      return 'failed';
    }
    summary.costUsd += result.costUsd ?? 0;

    const perQuery: Record<string, SegmentQueryOutcome> = {};
    const ingested: string[] = [];
    for (const member of segment.members) {
      const outcome = await this.ingestMember(
        member,
        result.jobsByQuery.get(member.id) ?? [],
        until,
      );
      perQuery[member.id] = outcome;
      summary.collected += outcome.returned;
      summary.inserted += outcome.inserted;
      summary.updated += outcome.updated;
      summary.duplicate += outcome.duplicate;
      summary.invalid += outcome.invalid;
      if (outcome.error)
        this.logger.warn(`Builder ${member.id} failed: ${outcome.error}`);
      else ingested.push(member.id);
    }

    // A capped run may have stopped before some postings: search them again.
    if (!result.capped) await this.segments.advanceCursors(ingested, until);
    const status: SegmentRunStatus =
      ingested.length === segment.members.length
        ? 'succeeded'
        : ingested.length === 0
          ? 'failed'
          : 'partial';
    await record(status, result, perQuery, null);
    return status;
  }

  private async ingestMember(
    member: QuerySearchBuilderRow,
    jobs: CollectedJob[],
    observedAt: Date,
  ): Promise<SegmentQueryOutcome> {
    const outcome = emptyOutcome();
    outcome.returned = jobs.length;
    try {
      for (
        let start = 0;
        start < jobs.length;
        start += ingestConfig.maxBatchItems
      ) {
        const report = await this.ingest.ingest({
          queryId: member.id,
          observedAt,
          channel: this.channel,
          items: jobs.slice(start, start + ingestConfig.maxBatchItems),
        });
        outcome.inserted += report.inserted;
        outcome.updated += report.updated;
        outcome.duplicate += report.duplicate;
        outcome.invalid += report.invalid;
      }
    } catch (error) {
      outcome.error = message(error);
    }
    return outcome;
  }
}
