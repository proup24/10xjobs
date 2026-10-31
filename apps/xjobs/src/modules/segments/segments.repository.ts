import { Injectable } from '@nestjs/common';
import { or } from '@prisma/orm-postgres/orm-client';
import type { Channel } from 'src/common/enums';
import { DatabaseService, type SearchSegmentRunRow } from 'src/database';

export type SegmentRunStatus = 'succeeded' | 'partial' | 'failed';

/** Per member builder: what its query returned and what ingest made of it. */
export interface SegmentQueryOutcome {
  returned: number;
  inserted: number;
  updated: number;
  duplicate: number;
  invalid: number;
  error?: string;
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
  abstract recordRun(run: NewSegmentRun): Promise<void>;
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

  async advanceCursors(queryIds: string[], until: Date): Promise<void> {
    if (queryIds.length === 0) return;
    await this.database.db.orm.public.QuerySearchBuilder.where((row) =>
      row.id.in(queryIds),
    )
      .where((row) => or(row.coveredUntil.isNull(), row.coveredUntil.lt(until)))
      .updateAll({ coveredUntil: until });
  }
}
