import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const JSONB = 'pg/jsonb@1';
const TIMESTAMP = 'pg/timestamptz-date@1';

export interface RescueRow {
  id: string;
  createdAt: Date;
  undoneAt: Date | null;
  origin: string;
  note: string | null;
  snapshot: unknown;
  job: {
    id: string;
    kind: string;
    title: string | null;
    postingUrl: string;
  };
  user: { id: string };
}

export abstract class RescuesRepository {
  /** Every user's rescues, undone ones included, newest first. */
  abstract list(limit: number): Promise<RescueRow[]>;
}

@Injectable()
export class PrismaRescuesRepository extends RescuesRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async list(limit: number): Promise<RescueRow[]> {
    const { raw } = this.database.db;
    const rows = await this.database.db.query(
      raw.sql`SELECT r.id, r."createdAt", r."undoneAt", r.origin, r.note,
          r.snapshot, r."userId", j.id AS "jobId", j.kind, j.title,
          j."postingUrl"
        FROM post_rescues r
        JOIN normalized_jobs j ON j.id = r."jobId"
        ORDER BY r."createdAt" DESC, r.id DESC
        LIMIT ${limit}::int`
        .returnsRow({
          id: UUID,
          createdAt: TIMESTAMP,
          undoneAt: TIMESTAMP,
          origin: TEXT,
          note: TEXT,
          snapshot: JSONB,
          userId: UUID,
          jobId: UUID,
          kind: TEXT,
          title: TEXT,
          postingUrl: TEXT,
        })
        .build(),
    );
    return rows.map((row) => ({
      id: row.id as string,
      createdAt: row.createdAt as Date,
      undoneAt: (row.undoneAt as Date | null) ?? null,
      origin: row.origin as string,
      note: (row.note as string | null) ?? null,
      snapshot: row.snapshot,
      job: {
        id: row.jobId as string,
        kind: row.kind as string,
        title: (row.title as string | null) ?? null,
        postingUrl: row.postingUrl as string,
      },
      user: { id: row.userId as string },
    }));
  }
}
