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
  type ClaimResult,
  type ClaimSkipReason,
  type NewSegmentRun,
  type SearchSegment,
  type SegmentWindow,
  SearchSegmentsRepository,
  type SegmentQueryOutcome,
  buildSegments,
  segmentHash,
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
  /** Segments not searched: another run holds, or already covered, every member. */
  segmentsSkipped: number;
  /** Members dropped from their segment for the same reasons. */
  queriesSkipped: number;
  /** Items returned, attributed or not. */
  collected: number;
  /** Batches stored for ingest. */
  batches: number;
  costUsd: number;
}

/** Cost is retained even when the fetched results could not be stored. */
interface SegmentOutcome {
  /** True when no member could be claimed; nothing was searched. */
  skipped: boolean;
  queriesSkipped: number;
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
      segmentsSkipped: 0,
      queriesSkipped: 0,
      collected: 0,
      batches: 0,
      costUsd: 0,
    };

    for (const segment of segments) {
      const outcome = await this.runSegment(channel, segment, until);
      summary.queriesSkipped += outcome.queriesSkipped;
      if (outcome.skipped) {
        summary.segmentsSkipped += 1;
        continue;
      }
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
    const attempted = summary.segments - summary.segmentsSkipped;
    if (attempted > 0 && summary.segmentsFailed === attempted)
      throw new Error(
        `${channel} collection failed for all ${attempted} segments`,
      );
    return summary;
  }

  /**
   * Claim the segment's members, then fetch and store the claimed ones. Only
   * the first run collects a query over an interval: members another run
   * holds, or already covered up to `until`, are dropped from the search.
   */
  private async runSegment(
    channel: Channel,
    segment: SearchSegment,
    until: Date,
  ): Promise<SegmentOutcome> {
    const config = channelJobsConfig[channel];
    const runId = randomUUID();
    const startedAt = new Date();
    // The interval claimed: the segment's window over the cursors as listed.
    const claimed = segmentWindow(segment.members, until, config.window);
    let claim: ClaimResult;
    try {
      claim = await this.segments.claim(
        runId,
        segment.members.map(({ id }) => id),
        claimed,
        config.claimLeaseMinutes * 60_000,
      );
    } catch (error) {
      // The claim may have committed before the error: release whatever it holds.
      this.logger.warn(
        `Segment ${segment.key} could not be claimed: ${message(error)}`,
      );
      await this.segments
        .releaseClaims(runId)
        .catch((releaseError: unknown) =>
          this.logger.error(
            `Could not release claims of run ${runId}: ${message(releaseError)}; they expire with their lease`,
          ),
        );
      return {
        skipped: false,
        queriesSkipped: 0,
        stored: false,
        collected: 0,
        costUsd: 0,
      };
    }
    const queriesSkipped = claim.skipped.length;
    if (queriesSkipped > 0) this.logSkips(segment, claim.skipped);
    if (claim.claimed.length === 0)
      return {
        skipped: true,
        queriesSkipped,
        stored: false,
        collected: 0,
        costUsd: 0,
      };

    let run: (NewSegmentRun & { id: string }) | undefined;
    let batch: BatchFile;
    let collected: number;
    let costUsd = 0;

    try {
      const owned = narrow(segment, claim.claimed);
      // Recomputed from the cursors the claim read, so a concurrent success is seen.
      const window = segmentWindow(owned.members, until, config.window);
      if (window.clipped)
        this.logger.warn(
          `Segment ${segment.key} was not collected for longer than ${config.window.maximumHours}h; older postings are not caught up`,
        );
      const search = buildSearch(channel, owned, window);
      run = buildRun(runId, owned, search, startedAt);
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
      await this.recordFailure(
        run ??
          buildRun(
            runId,
            segment,
            buildSearch(channel, segment, claimed),
            startedAt,
          ),
        error,
      );
      return { skipped: false, queriesSkipped, stored: false, collected: 0, costUsd };
    }

    await this.enqueueBatch(batch.batchId);
    return { skipped: false, queriesSkipped, stored: true, collected, costUsd };
  }

  /** Records the failed run, which releases its claims; releases them anyway if that fails. */
  private async recordFailure(
    run: NewSegmentRun & { id: string },
    error: unknown,
  ): Promise<void> {
    try {
      await this.segments.recordRun({
        ...run,
        finishedAt: new Date(),
        status: 'failed',
        error: message(error),
      });
    } catch (recordError) {
      this.logger.error(
        `Could not record segment ${run.segmentHash}: ${message(recordError)}`,
      );
      await this.segments
        .releaseClaims(run.id)
        .catch((releaseError: unknown) =>
          this.logger.error(
            `Could not release claims of run ${run.id}: ${message(releaseError)}; they expire with their lease`,
          ),
        );
    }
  }

  private logSkips(
    segment: SearchSegment,
    skipped: { reason: ClaimSkipReason }[],
  ): void {
    const count = (reason: ClaimSkipReason) =>
      skipped.filter((skip) => skip.reason === reason).length;
    this.logger.log(
      `Segment ${segment.key} skipped: ${count('in-flight')} in-flight, ${count('already-covered')} already-covered`,
    );
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
    switch (segment.channel) {
      case Channel.ASHBY:
        return this.ashby.collect(
          segment,
          channelJobsConfig[Channel.ASHBY].run,
        );
      case Channel.GREEN_HOUSE:
        return this.greenhouse.collect(
          segment,
          channelJobsConfig[Channel.GREEN_HOUSE].run,
        );
      case Channel.LINKEDIN_JOB_BOARD:
        return this.linkedinJobs.collect(
          segment,
          channelJobsConfig[Channel.LINKEDIN_JOB_BOARD].run,
        );
      case Channel.LINKEDIN_POSTS:
        return this.linkedinPosts.collect(
          segment,
          channelJobsConfig[Channel.LINKEDIN_POSTS].run,
        );
    }
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

/**
 * The segment cut down to the members this run claimed, with the cursors the
 * claim read, so its window and identity describe what is actually searched.
 */
function narrow(
  segment: SearchSegment,
  claimed: ClaimResult['claimed'],
): SearchSegment {
  const fresh = new Map(claimed.map(({ id, coveredUntil }) => [id, coveredUntil]));
  const members = segment.members
    .filter(({ id }) => fresh.has(id))
    .map((member) => ({ ...member, coveredUntil: fresh.get(member.id) ?? null }));
  if (members.length !== fresh.size)
    throw new Error(`Segment ${segment.key} claimed a query that is not a member`);
  const ids = members.map(({ id }) => id);
  return { ...segment, members, hash: segmentHash(segment.key, ids) };
}

function buildRun(
  id: string,
  segment: SearchSegment,
  search: SegmentSearch,
  startedAt: Date,
): NewSegmentRun & { id: string } {
  return {
    id,
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
