import { Injectable } from '@nestjs/common';
import { or } from '@prisma/orm-postgres/orm-client';
import type { Channel } from 'src/common/enums';
import { DatabaseService, type SearchSegmentRunRow } from 'src/database';

/** Whether the segment's results were collected and stored; ingest has its own status. */
export type SegmentRunStatus = 'succeeded' | 'failed';

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
  error: string | null;
}

/** Saves segment runs and moves builder collection cursors. */
export abstract class SearchSegmentsRepository {
  /** A run with no batch, such as a failed one. */
  abstract recordRun(run: NewSegmentRun): Promise<void>;
  /**
   * In one transaction: the run, its pending batch, and the cursors of
   * `advance` moved to the run's `windowEnd`. All of them land, or none.
   */
  abstract recordCollectedRun(
    run: NewSegmentRun & { id: string },
    batch: NewCollectionBatch,
    advance: string[],
  ): Promise<void>;
  /** Sets each builder's `coveredUntil` to `until`; never moves a cursor back. */
  abstract advanceCursors(queryIds: string[], until: Date): Promise<void>;
}

@Injectable()
export class PrismaSearchSegmentsRepository extends SearchSegmentsRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async recordRun(run: NewSegmentRun): Promise<void> {
    await this.database.db.orm.public.SearchSegmentRun.create({
      ...run,
      perQuery: run.perQuery as unknown as SearchSegmentRunRow['perQuery'],
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
      });
      await tx.orm.public.CollectionBatch.create({
        ...batch,
        channel: run.channel,
        segmentRunId: run.id,
        status: 'pending',
      });
      await moveCursors(tx.orm, advance, run.windowEnd);
    });
  }

  async advanceCursors(queryIds: string[], until: Date): Promise<void> {
    await moveCursors(this.database.db.orm, queryIds, until);
  }
}

type Orm = DatabaseService['db']['orm'];

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
