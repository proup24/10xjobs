import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { DatabaseService } from 'src/database';

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const INT = 'pg/int4@1';
const BOOL = 'pg/bool@1';
const TIMESTAMP = 'pg/timestamptz-date@1';

/** One LinkedIn posts run, as the budget report reads it. */
export interface PostsBudgetRun {
  segmentKey: string;
  startedAt: Date;
  finishedAt: Date;
  costMicroUsd: number | null;
  /** The run came back full for at least one query (`truncatedQueryIds` not empty). */
  full: boolean;
}

export abstract class PostsBudgetRepository {
  /** The LinkedIn posts runs started at or after `since`, oldest first. */
  abstract runsSince(since: Date): Promise<PostsBudgetRun[]>;
  /** Each given builder's linked profile ids; builders with no profile are left out. */
  abstract profilesFor(builderIds: string[]): Promise<Map<string, string[]>>;
}

@Injectable()
export class PrismaPostsBudgetRepository extends PostsBudgetRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async runsSince(since: Date): Promise<PostsBudgetRun[]> {
    const { raw } = this.database.db;
    const rows = await this.database.db.query(
      raw.sql`SELECT "segmentKey", "startedAt", "finishedAt", "costMicroUsd",
          cardinality("truncatedQueryIds") > 0 AS full
        FROM search_segment_runs
        WHERE channel = ${Channel.LINKEDIN_POSTS}::text
          AND "startedAt" >= ${since.toISOString()}::timestamptz
        ORDER BY "startedAt", id`
        .returnsRow({
          segmentKey: TEXT,
          startedAt: TIMESTAMP,
          finishedAt: TIMESTAMP,
          costMicroUsd: INT,
          full: BOOL,
        })
        .build(),
    );
    return rows.map((row) => ({
      segmentKey: row.segmentKey as string,
      startedAt: row.startedAt as Date,
      finishedAt: row.finishedAt as Date,
      costMicroUsd: (row.costMicroUsd as number | null) ?? null,
      full: row.full as boolean,
    }));
  }

  async profilesFor(builderIds: string[]): Promise<Map<string, string[]>> {
    const profiles = new Map<string, string[]>();
    if (builderIds.length === 0) return profiles;
    const ids = `{${builderIds.join(',')}}`;
    const { raw } = this.database.db;
    const rows = await this.database.db.query(
      raw.sql`SELECT "queryId", "profileId"
        FROM profile_query_search_builders
        WHERE "queryId" = ANY(${ids}::uuid[])`
        .returnsRow({ queryId: UUID, profileId: UUID })
        .build(),
    );
    for (const row of rows) {
      const queryId = row.queryId as string;
      profiles.set(queryId, [
        ...(profiles.get(queryId) ?? []),
        row.profileId as string,
      ]);
    }
    return profiles;
  }
}
