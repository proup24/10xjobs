import { Injectable } from '@nestjs/common';
import { or } from '@prisma/orm-postgres/orm-client';
import type { Channel } from 'src/common/enums';
import { DatabaseService, type SearchSegmentRunRow } from 'src/database';

/** Whether the segment's results were collected and stored; ingest has its own status. */
/** `partial`: stored, but the actor said it did not finish; cursors stay. */
export type SegmentRunStatus = 'succeeded' | 'partial' | 'failed';

/** Per member builder: how many items its query returned. */
export interface SegmentQueryOutcome {
  returned: number;
}

/** The stored batch of a collected segment run; it starts `pending`. */
export interface NewCollectionBatch {
  id: string;
  storageKey: string;
  formatVersion: 1;
  observedAt: Date;
  itemCount: number;
  actor: string;
  apifyRunId: string | null;
}

/** One segment run as it is saved. */
export interface NewSegmentRun {
  channel: Channel;
  segmentKey: string;
  segmentHash: string;
  queryIds: string[];
  windowStart: Date;
  windowEnd: Date;
  startedAt: Date;
  finishedAt: Date;
  status: SegmentRunStatus;
  fetched: number;
  costMicroUsd: number | null;
  capped: boolean;
  truncatedQueryIds: string[];
  perQuery: Record<string, SegmentQueryOutcome>;
  /** What the source said matched each search, untouched; null when not reported. */
  searchTotals: unknown;
  error: string | null;
  /** The Apify run, once one started; null for a search that never started. */
  apifyRunId: string | null;
  /** When the cost was last read as final; null on write. */
  costFinalAt: Date | null;
}

/** A run whose cost Apify may still revise. */
export interface UnsettledCost {
  id: string;
  apifyRunId: string;
  finishedAt: Date;
}

/** Why a member was not claimed. */
export type ClaimSkipReason = 'in-flight' | 'already-covered';

/** The interval a run claims its members for. */
export interface ClaimWindow {
  since: Date;
  until: Date;
}

export interface ClaimResult {
  /** Members this run now owns, with their cursor as of the claim. */
  claimed: { id: string; coveredUntil: Date | null }[];
  skipped: { id: string; reason: ClaimSkipReason }[];
}

/** Saves segment runs, moves builder collection cursors and holds collection claims. */
export abstract class SearchSegmentsRepository {
  /**
   * Claims, for `runId`, every member that is active, not already covered up
   * to `until`, and not held by a live claim whose interval overlaps `window`.
   * Members it cannot claim are skipped; only the first run collects them.
   */
  abstract claim(
    runId: string,
    queryIds: string[],
    window: ClaimWindow,
    leaseMs: number,
  ): Promise<ClaimResult>;
  /** Clears the claims `runId` holds; never another run's. */
  abstract releaseClaims(runId: string): Promise<void>;
  /** A run with no batch, such as a failed one; releases the run's claims. */
  abstract recordRun(run: NewSegmentRun & { id: string }): Promise<void>;
  /**
   * In one transaction: the run, its pending batch, the cursors of `advance`
   * moved to the run's `windowEnd`, and the run's claims released. All of
   * them land, or none.
   */
  abstract recordCollectedRun(
    run: NewSegmentRun & { id: string },
    batch: NewCollectionBatch,
    advance: string[],
  ): Promise<void>;
  /** Sets each builder's `coveredUntil` to `until`; never moves a cursor back. */
  abstract advanceCursors(queryIds: string[], until: Date): Promise<void>;
  /**
   * The cost, in micro-USD, of the channel's runs started at or after `since`.
   * A run with no recorded cost counts as `nullCostMicroUsd`.
   */
  abstract spentMicroUsd(
    channel: Channel,
    since: Date,
    nullCostMicroUsd: number,
  ): Promise<number>;
  /**
   * The channel's runs with an Apify run id whose cost is not yet final and
   * that finished at or after `finishedSince`.
   */
  abstract unsettledCosts(
    channel: Channel,
    finishedSince: Date,
  ): Promise<UnsettledCost[]>;
  /** Stores a run's re-read cost; `finalAt` is null while Apify may still revise it. */
  abstract settleCost(
    id: string,
    costMicroUsd: number,
    finalAt: Date | null,
  ): Promise<void>;
}

@Injectable()
export class PrismaSearchSegmentsRepository extends SearchSegmentsRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  /**
   * One UPDATE, so the check and the write are atomic. Two runs claiming the
   * same builder both find it free, but the second blocks on the row lock the
   * first UPDATE takes; once the first commits, Postgres re-checks the WHERE
   * against the new row version (READ COMMITTED re-evaluation), sees the live
   * claim, and skips the row. The follow-up read only labels the skips.
   */
  async claim(
    runId: string,
    queryIds: string[],
    window: ClaimWindow,
    leaseMs: number,
  ): Promise<ClaimResult> {
    if (queryIds.length === 0) return { claimed: [], skipped: [] };
    const { db } = this.database;
    const { raw } = db;
    // Raw SQL takes scalars only: the ids travel as an array literal, times as ISO text.
    const ids = `{${queryIds.join(',')}}`;
    const since = window.since.toISOString();
    const until = window.until.toISOString();
    const rows = await db.query(
      raw.sql`UPDATE query_search_builder SET
          "claimRunId" = ${runId}::uuid,
          "claimWindowStart" = ${since}::timestamptz,
          "claimWindowEnd" = ${until}::timestamptz,
          "claimExpiresAt" = now() + make_interval(secs => ${leaseMs / 1000}::float8)
        WHERE id = ANY(${ids}::uuid[])
          AND "isActive" AND NOT "isDeleted"
          AND ("coveredUntil" IS NULL OR "coveredUntil" < ${until}::timestamptz)
          AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" <= now()
            OR "claimWindowEnd" <= ${since}::timestamptz
            OR "claimWindowStart" >= ${until}::timestamptz)
        RETURNING id, "coveredUntil"`
        .returnsRow({ id: UUID, coveredUntil: TIMESTAMP })
        .build(),
    );
    const claimed = rows.map((row) => ({
      id: row.id as string,
      coveredUntil: (row.coveredUntil as Date | null) ?? null,
    }));
    const owned = new Set(claimed.map(({ id }) => id));
    const rest = queryIds.filter((id) => !owned.has(id));
    if (rest.length === 0) return { claimed, skipped: [] };
    const others = await db.orm.public.QuerySearchBuilder.where((row) =>
      row.id.in(rest),
    ).all();
    const covered = new Set(
      others
        .filter((row) => row.coveredUntil && row.coveredUntil >= window.until)
        .map((row) => row.id),
    );
    return {
      claimed,
      skipped: rest.map((id) => ({
        id,
        reason: covered.has(id) ? 'already-covered' : 'in-flight',
      })),
    };
  }

  async releaseClaims(runId: string): Promise<void> {
    await clearClaims(this.database.db.orm, runId);
  }

  async recordRun(run: NewSegmentRun & { id: string }): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx.orm.public.SearchSegmentRun.create({
        ...run,
        perQuery: run.perQuery as unknown as SearchSegmentRunRow['perQuery'],
        searchTotals: (run.searchTotals ??
          null) as SearchSegmentRunRow['searchTotals'],
      });
      await clearClaims(tx.orm, run.id);
    });
  }

  async recordCollectedRun(
    run: NewSegmentRun & { id: string },
    batch: NewCollectionBatch,
    advance: string[],
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx.orm.public.SearchSegmentRun.create({
        ...run,
        perQuery: run.perQuery as unknown as SearchSegmentRunRow['perQuery'],
        searchTotals: (run.searchTotals ??
          null) as SearchSegmentRunRow['searchTotals'],
      });
      await tx.orm.public.CollectionBatch.create({
        ...batch,
        channel: run.channel,
        segmentRunId: run.id,
        status: 'pending',
      });
      await moveCursors(tx.orm, advance, run.windowEnd);
      await clearClaims(tx.orm, run.id);
    });
  }

  async advanceCursors(queryIds: string[], until: Date): Promise<void> {
    await moveCursors(this.database.db.orm, queryIds, until);
  }

  async spentMicroUsd(
    channel: Channel,
    since: Date,
    nullCostMicroUsd: number,
  ): Promise<number> {
    const runs = await this.database.db.orm.public.SearchSegmentRun.where(
      (row) => row.channel.eq(channel),
    )
      .where((row) => row.startedAt.gte(since))
      .all();
    return runs.reduce(
      (total, run) => total + (run.costMicroUsd ?? nullCostMicroUsd),
      0,
    );
  }

  async unsettledCosts(
    channel: Channel,
    finishedSince: Date,
  ): Promise<UnsettledCost[]> {
    const runs = await this.database.db.orm.public.SearchSegmentRun.where(
      (row) => row.channel.eq(channel),
    )
      .where((row) => row.apifyRunId.isNotNull())
      .where((row) => row.costFinalAt.isNull())
      .where((row) => row.finishedAt.gte(finishedSince))
      .all();
    return runs.map((run) => ({
      id: run.id,
      apifyRunId: run.apifyRunId as string,
      finishedAt: run.finishedAt,
    }));
  }

  async settleCost(
    id: string,
    costMicroUsd: number,
    finalAt: Date | null,
  ): Promise<void> {
    await this.database.db.orm.public.SearchSegmentRun.where((row) =>
      row.id.eq(id),
    ).updateAll({ costMicroUsd, costFinalAt: finalAt });
  }
}

type Orm = DatabaseService['db']['orm'];

const TIMESTAMP = 'pg/timestamptz-date@1';
const UUID = 'pg/uuid@1';

async function clearClaims(orm: Orm, runId: string): Promise<void> {
  await orm.public.QuerySearchBuilder.where((row) =>
    row.claimRunId.eq(runId),
  ).updateAll({
    claimRunId: null,
    claimWindowStart: null,
    claimWindowEnd: null,
    claimExpiresAt: null,
  });
}

async function moveCursors(
  orm: Orm,
  queryIds: string[],
  until: Date,
): Promise<void> {
  if (queryIds.length === 0) return;
  await orm.public.QuerySearchBuilder.where((row) => row.id.in(queryIds))
    .where((row) => or(row.coveredUntil.isNull(), row.coveredUntil.lt(until)))
    .updateAll({ coveredUntil: until });
}
