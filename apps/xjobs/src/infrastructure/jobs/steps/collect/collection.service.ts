import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, isLinkedinJobBoard } from 'src/common/enums';
import type { WorkerProcessEnvironmentVariables } from 'src/config';
import {
  AshbyCollector,
  GreenhouseCollector,
  LinkedinJobBoardCheapCollector,
  LinkedinJobBoardCollector,
  type LinkedinJobBoardRunConfig,
  LinkedinPostsCollector,
  SearchNotStartedError,
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
  LinkedinSearchSplitsRepository,
  planSegments,
  segmentHash,
  segmentWindow,
} from 'src/modules/segments';
import { StorageService } from 'src/modules/storage';
import { channelJobsConfig } from './config';
import { IngestQueue } from '../ingest';
import { DailyBudget, moroccoDayStart } from './spend';
import { halve, nextParts } from './splits';
import { CollectionSummary, SegmentOutcome } from './types';
/** Scheduler id and job name of a channel's recurring collect job. */
export const COLLECT_JOB = 'collect';

/**
 * Each LinkedIn job board search asks only for the last hour, and segments run
 * one after another: a tick longer than this leaves postings uncollected.
 */
const LINKEDIN_JOB_BOARD_TICK_LIMIT_MS = 60 * 60_000;

/** How one LinkedIn job board group fared in a tick, for its remembered split. */
interface GroupTally {
  /** Segments the group ends the tick with. */
  chunks: number;
  split: boolean;
  /** Most rows returned by a run that ended a branch. */
  maxReturned: number;
  /** False once a segment of the group failed, was skipped or deferred: its size is unknown. */
  measured: boolean;
}

/** How a run treats a full result. */
interface RunOptions {
  /** Rows the search may return; the collector's default when absent. */
  maxItems?: number;
  /** A full result is split or rerun: store it without moving cursors. */
  holdIfFull: boolean;
  /** The day's budget, added to as the run ends; none for channels without a cap. */
  budget?: DailyBudget;
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
  /** Set on worker shutdown: the segment in flight finishes, no new one starts. */
  private stopping = false;

  constructor(
    private readonly ashby: AshbyCollector,
    private readonly greenhouse: GreenhouseCollector,
    private readonly linkedinJobs: LinkedinJobBoardCollector,
    private readonly linkedinJobsCheap: LinkedinJobBoardCheapCollector,
    private readonly linkedinPosts: LinkedinPostsCollector,
    private readonly queries: QuerySearchService,
    private readonly segments: SearchSegmentsRepository,
    private readonly splits: LinkedinSearchSplitsRepository,
    private readonly storage: StorageService,
    private readonly ingestQueue: IngestQueue,
    private readonly config: ConfigService<
      WorkerProcessEnvironmentVariables,
      true
    >,
  ) {}

  /**
   * Starts no further segment. The one in flight still finishes and stores
   * what Apify returned, so a restart never leaves a paid run uncollected;
   * the rest stay unclaimed and the next scheduled run searches them.
   */
  stop(): void {
    this.stopping = true;
  }

  async collect(channel: Channel): Promise<CollectionSummary> {
    const config = channelJobsConfig[channel];
    // One end of window and observation time for every segment of the run.
    const until = new Date();
    const builders = await this.queries.listActive(channel);
    const remembered = await this.rememberedSplits(channel);
    const plan = planSegments(
      builders,
      config.segmentSize,
      new Map([...remembered].map(([key, { parts }]) => [key, parts])),
    );
    const { segments } = plan;
    // Keyword length, not a full search, cut these groups: one line per group.
    for (const cut of plan.cuts) {
      const parts = remembered.get(cut.key)?.parts ?? 1;
      this.logger.log(
        `${cut.key} cut into ${cut.chunks} searches for keyword length (${cut.members} members, ${parts} ${parts === 1 ? 'part' : 'parts'})`,
      );
    }
    // A lone builder can't be cut further: it is sent anyway, once warned.
    for (const over of plan.oversized)
      this.logger.warn(
        `Segment ${over.key} (${over.hash.slice(0, 12)}) keyword is over the LinkedIn keyword limit: ${over.length} characters, ${over.terms} terms; it is sent alone, and LinkedIn may degrade it`,
      );
    const summary: CollectionSummary = {
      channel,
      builders: builders.length,
      segments: segments.length,
      segmentsFailed: 0,
      segmentsSkipped: 0,
      segmentsDeferred: 0,
      queriesSkipped: 0,
      collected: 0,
      batches: 0,
      costUsd: 0,
    };
    const budget = await this.dailyBudget(channel, until);
    const groups = new Map<string, GroupTally>();
    if (isLinkedinJobBoard(channel))
      for (const { key } of segments) {
        const group = groups.get(key);
        if (group) group.chunks += 1;
        else
          groups.set(key, {
            chunks: 1,
            split: false,
            maxReturned: 0,
            measured: true,
          });
      }

    for (const [index, segment] of segments.entries()) {
      if (this.stopping) {
        const left = segments.slice(index);
        summary.segmentsDeferred += left.length;
        for (const { key } of left) {
          const group = groups.get(key);
          if (group) group.measured = false;
        }
        this.logger.log(
          `${channel} collection stopping for shutdown; ${left.length} segments left for the next run`,
        );
        break;
      }
      await this.collectSegment(
        channel,
        segment,
        until,
        summary,
        groups.get(segment.key),
        budget,
      );
    }

    if (isLinkedinJobBoard(channel)) {
      await this.rememberSplits(channel, groups, remembered, until);
      // Only a tick that reached every group knows which splits are stale.
      if (summary.segmentsDeferred === 0)
        await this.pruneSplits(channel, [...groups.keys()]);
    }

    const durationMs = Date.now() - until.getTime();
    this.logger.log(
      [...Object.entries(summary), ['durationMs', durationMs]]
        .map(([key, value]) => `${key}=${value}`)
        .join(' '),
    );
    if (
      isLinkedinJobBoard(channel) &&
      durationMs > LINKEDIN_JOB_BOARD_TICK_LIMIT_MS
    )
      this.logger.warn(
        `${channel} collection took ${Math.round(durationMs / 60_000)} minutes, over 60: jobs may be missed, because each search asks only for the last hour`,
      );
    // Runs that happened: stored or failed. Skips and deferrals (shutdown, daily
    // budget) are not runs, so they never cancel one that did happen.
    if (summary.segmentsFailed > 0 && summary.batches === 0)
      throw new Error(
        `${channel} collection failed for all ${summary.segmentsFailed} segments`,
      );
    return summary;
  }

  /**
   * Runs one segment and adds its outcome to the summary. A LinkedIn job board
   * search that comes back full was stored without moving cursors: it is
   * halved and each half run at once over the same hour, down to one member,
   * which is rerun once at the ceiling row limit. Every run of a tick starts
   * here, so a check before each run (shutdown, spend) covers splits too.
   */
  private async collectSegment(
    channel: Channel,
    segment: SearchSegment,
    until: Date,
    summary: CollectionSummary,
    group: GroupTally | undefined,
    budget: DailyBudget | undefined,
    maxItems?: number,
  ): Promise<void> {
    if (this.stopping) {
      summary.segmentsDeferred += 1;
      if (group) group.measured = false;
      return;
    }
    if (budget?.reached) {
      // Not a failure: no run started and no cursor moved, so the next tick re-covers the window.
      this.logBudgetReached(channel, budget);
      summary.segmentsDeferred += 1;
      if (group) group.measured = false;
      return;
    }
    const splittable = isLinkedinJobBoard(channel);
    const atCeiling = maxItems !== undefined;
    const outcome = await this.runSegment(channel, segment, until, {
      maxItems,
      holdIfFull: splittable && !atCeiling,
      budget,
    });
    summary.queriesSkipped += outcome.queriesSkipped;
    if (outcome.skipped) {
      summary.segmentsSkipped += 1;
      if (group) group.measured = false;
      return;
    }
    summary.costUsd += outcome.costUsd;
    summary.collected += outcome.collected;
    if (!outcome.stored) {
      summary.segmentsFailed += 1;
      if (group) group.measured = false;
      return;
    }
    summary.batches += 1;

    const searched = outcome.searched;
    if (!splittable || !outcome.truncated || atCeiling || !searched) {
      if (group)
        group.maxReturned = Math.max(group.maxReturned, outcome.fetched);
      if (splittable && outcome.truncated && atCeiling)
        this.logger.warn(
          `${segment.key} is full at ${maxItems} rows; older postings in this hour are lost`,
        );
      return;
    }
    if (searched.members.length > 1) {
      summary.segments += 1;
      if (group) {
        group.chunks += 1;
        group.split = true;
      }
      for (const half of halve(searched))
        await this.collectSegment(channel, half, until, summary, group, budget);
      return;
    }
    await this.collectSegment(
      channel,
      searched,
      until,
      summary,
      group,
      budget,
      boardRun(channel).maxRowsCeiling,
    );
  }

  /** A LinkedIn job board channel's spend today, read once per tick; other channels have no cap. */
  private async dailyBudget(
    channel: Channel,
    now: Date,
  ): Promise<DailyBudget | undefined> {
    if (!isLinkedinJobBoard(channel)) return undefined;
    const dayStart = moroccoDayStart(now);
    const spent = await this.segments.spentMicroUsd(
      channel,
      dayStart,
      chargeCapMicroUsd(channel),
    );
    return new DailyBudget(
      this.config.get(budgetSetting(channel), { infer: true }),
      spent,
      dayStart,
    );
  }

  /** Says once per tick that the cap stopped collection. */
  private logBudgetReached(channel: Channel, budget: DailyBudget): void {
    if (budget.announced) return;
    budget.announced = true;
    this.logger.warn(
      `${channel} daily budget $${budget.limitUsd} reached ($${budget.spentUsd} since ${budget.dayStart.toISOString()}); collection resumes tomorrow`,
    );
  }

  /** Remembered LinkedIn job board splits; none for other channels, or when they can't be read. */
  private async rememberedSplits(
    channel: Channel,
  ): Promise<Map<string, { parts: number; splitAt: Date }>> {
    if (!isLinkedinJobBoard(channel)) return new Map();
    try {
      return await this.splits.parts();
    } catch (error) {
      this.logger.warn(
        `Remembered LinkedIn search splits could not be read: ${message(error)}; searching each group whole`,
      );
      return new Map();
    }
  }

  /** Stores each group's next parts; a write that fails is retried by the next tick. */
  private async rememberSplits(
    channel: Channel,
    groups: ReadonlyMap<string, GroupTally>,
    remembered: ReadonlyMap<string, { parts: number; splitAt: Date }>,
    now: Date,
  ): Promise<void> {
    const rowLimit = boardRun(channel).maxRowsPerSearch;
    for (const [groupKey, group] of groups) {
      if (groupKey.includes('|unresolved:')) continue;
      const parts = nextParts(
        remembered.get(groupKey),
        {
          groupKey,
          chunks: group.chunks,
          split: group.split,
          // A segment with no result says nothing of its size: never shrink on it.
          maxReturned: group.measured ? group.maxReturned : rowLimit,
          rowLimit,
        },
        now,
      );
      if (parts === null) continue;
      try {
        await this.splits.setParts(groupKey, parts, now);
      } catch (error) {
        this.logger.warn(
          `Split of ${groupKey} into ${parts} parts could not be saved: ${message(error)}`,
        );
      }
    }
  }

  /**
   * Forgets remembered splits of groups this tick did not build (a profile
   * deleted or moved to another recipe); a failure is retried by the next tick.
   */
  private async pruneSplits(channel: Channel, built: string[]): Promise<void> {
    try {
      const forgot = await this.splits.prune(channel, built);
      if (forgot > 0)
        this.logger.log(
          `Forgot ${forgot} remembered LinkedIn search splits of groups no longer searched`,
        );
    } catch (error) {
      this.logger.warn(
        `Remembered LinkedIn search splits could not be pruned: ${message(error)}`,
      );
    }
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
    options: RunOptions,
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
        truncated: false,
        fetched: 0,
        searched: null,
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
        truncated: false,
        fetched: 0,
        searched: null,
      };

    let run: (NewSegmentRun & { id: string }) | undefined;
    let batch: BatchFile;
    let collected: number;
    let costUsd = 0;
    let owned: SearchSegment;
    let result: SegmentResult;
    /** True once an Apify run may have started: only then does a failure cost anything. */
    let started = false;
    /** Started, and no cost reported yet. */
    let charged = false;

    try {
      owned = narrow(segment, claim.claimed);
      // Recomputed from the cursors the claim read, so a concurrent success is seen.
      const window = segmentWindow(owned.members, until, config.window);
      if (window.clipped)
        this.logger.warn(
          `Segment ${segment.key} was not collected for longer than ${config.window.maximumHours}h; older postings are not caught up`,
        );
      const search = buildSearch(channel, owned, window, options.maxItems);
      run = buildRun(runId, owned, search, startedAt);
      // From here a paid run may exist, whatever happens next.
      started = true;
      charged = true;
      result = await this.fetch(search);
      costUsd = result.costUsd ?? 0;
      options.budget?.add(
        result.costUsd == null
          ? chargeCapMicroUsd(channel, options.maxItems)
          : Math.round(result.costUsd * 1_000_000),
      );
      charged = false;
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
      const full = result.truncatedQueryIds.length > 0;
      // A capped run may have stopped early, and a full one is searched again
      // in pieces: keep their searches eligible.
      const advance =
        run.capped || (full && options.holdIfFull) ? [] : run.queryIds;
      collected = await this.saveBatch(batch, run, advance);
    } catch (error) {
      this.logger.warn(`Segment ${segment.key} failed: ${message(error)}`);
      // The collector refused the search before calling Apify: nothing ran.
      if (error instanceof SearchNotStartedError) {
        started = false;
        charged = false;
      }
      // A fetch that threw reported no cost: count what it could have charged.
      if (charged)
        options.budget?.add(chargeCapMicroUsd(channel, options.maxItems));
      const failed =
        run ??
        buildRun(
          runId,
          segment,
          buildSearch(channel, segment, claimed),
          startedAt,
        );
      // No Apify run could have started: record a cost of 0, which the spend
      // total counts as nothing (null would count at the charge cap).
      if (!started) failed.costMicroUsd = 0;
      await this.recordFailure(failed, error);
      return {
        skipped: false,
        queriesSkipped,
        stored: false,
        collected: 0,
        costUsd,
        truncated: false,
        fetched: 0,
        searched: null,
      };
    }

    await this.enqueueBatch(batch.batchId);
    return {
      skipped: false,
      queriesSkipped,
      stored: true,
      collected,
      costUsd,
      truncated: result.truncatedQueryIds.length > 0,
      fetched: result.fetched,
      searched: owned,
    };
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
    advance: string[],
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
      advance,
    );
    return itemCount;
  }

  private fetch(segment: SegmentSearch): Promise<SegmentResult> {
    switch (segment.channel) {
      case Channel.ASHBY:
        return this.ashby.collect(segment);
      case Channel.GREEN_HOUSE:
        return this.greenhouse.collect(segment);
      case Channel.LINKEDIN_JOB_BOARD:
        return this.linkedinJobs.collect(segment);
      case Channel.LINKEDIN_JOB_BOARD_CHEAP:
        return this.linkedinJobsCheap.collect(segment);
      case Channel.LINKEDIN_POSTS:
        return this.linkedinPosts.collect(segment);
    }
  }
}

/** The run config of a LinkedIn job board channel (harvestapi or a trial actor). */
function boardRun(channel: Channel): LinkedinJobBoardRunConfig {
  if (!isLinkedinJobBoard(channel))
    throw new Error(`${channel} is not a LinkedIn job board channel`);
  return channelJobsConfig[
    channel as Channel.LINKEDIN_JOB_BOARD | Channel.LINKEDIN_JOB_BOARD_CHEAP
  ].run;
}

/** The environment setting holding a channel's daily budget in dollars. */
function budgetSetting(
  channel: Channel,
):
  | 'COLLECTION_DAILY_BUDGET_USD'
  | 'COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP' {
  return channel === Channel.LINKEDIN_JOB_BOARD_CHEAP
    ? 'COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP'
    : 'COLLECTION_DAILY_BUDGET_USD';
}

/**
 * The most a run of a LinkedIn job board channel of `maxItems` rows (the
 * default limit when absent) may charge; with no `maxItems` it is also what a
 * run with no recorded cost counts as.
 */
function chargeCapMicroUsd(channel: Channel, maxItems?: number): number {
  const { maxRunChargeUsd, maxRowsPerSearch } = boardRun(channel);
  const rows = maxItems ?? maxRowsPerSearch;
  return Math.round((maxRunChargeUsd * rows * 1_000_000) / maxRowsPerSearch);
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
  maxItems?: number,
): SegmentSearch {
  return {
    channel,
    segmentKey: segment.key,
    since: window.since,
    until: window.until,
    queries: segment.members.map((member) => ({
      id: member.id,
      keyword: member.keyword,
      params: member.params as Record<string, unknown>,
    })),
    ...(maxItems === undefined ? {} : { maxItems }),
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
  const fresh = new Map(
    claimed.map(({ id, coveredUntil }) => [id, coveredUntil]),
  );
  const members = segment.members
    .filter(({ id }) => fresh.has(id))
    .map((member) => ({
      ...member,
      coveredUntil: fresh.get(member.id) ?? null,
    }));
  if (members.length !== fresh.size)
    throw new Error(
      `Segment ${segment.key} claimed a query that is not a member`,
    );
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
