import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';

const TEXT = 'pg/text@1';
const INT = 'pg/int4@1';
const TIMESTAMP = 'pg/timestamptz-date@1';

/** Remembered LinkedIn search splits: into how many parts a full search was cut. */
export abstract class LinkedinSearchSplitsRepository {
  /** Every remembered split by group key. */
  abstract parts(): Promise<Map<string, { parts: number; splitAt: Date }>>;
  /** Saves a split; a `parts` of 1 forgets it. */
  abstract setParts(
    groupKey: string,
    parts: number,
    splitAt: Date,
  ): Promise<void>;
  /** Forgets every split whose group key is not in `keep`; returns how many it forgot. */
  abstract prune(keep: readonly string[]): Promise<number>;
}

@Injectable()
export class PrismaLinkedinSearchSplitsRepository extends LinkedinSearchSplitsRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  async parts(): Promise<Map<string, { parts: number; splitAt: Date }>> {
    const { db } = this.database;
    const rows = await db.query(
      db.raw
        .sql`SELECT "groupKey", parts, "splitAt" FROM linkedin_search_splits`
        .returnsRow({ groupKey: TEXT, parts: INT, splitAt: TIMESTAMP })
        .build(),
    );
    return new Map(
      rows.map((row) => [
        row.groupKey as string,
        { parts: Number(row.parts), splitAt: row.splitAt as Date },
      ]),
    );
  }

  async setParts(
    groupKey: string,
    parts: number,
    splitAt: Date,
  ): Promise<void> {
    const { db } = this.database;
    const { raw } = db;
    if (parts <= 1) {
      await db.execute(
        raw.sql`DELETE FROM linkedin_search_splits WHERE "groupKey" = ${groupKey}::text`
          .affectedCount()
          .build(),
      );
      return;
    }
    await db.execute(
      raw.sql`INSERT INTO linkedin_search_splits ("groupKey", parts, "splitAt")
        VALUES (${groupKey}::text, ${parts}::int, ${splitAt.toISOString()}::timestamptz)
        ON CONFLICT ("groupKey") DO UPDATE SET
          parts = EXCLUDED.parts, "splitAt" = EXCLUDED."splitAt", "updatedAt" = now()`
        .affectedCount()
        .build(),
    );
  }

  async prune(keep: readonly string[]): Promise<number> {
    const { db } = this.database;
    // Group keys hold JSON (quotes, commas, braces): pass them as a jsonb array.
    const rows = await db.query(
      db.raw.sql`DELETE FROM linkedin_search_splits
        WHERE "groupKey" NOT IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(keep)}::jsonb)
        )
        RETURNING "groupKey"`
        .returnsRow({ groupKey: TEXT })
        .build(),
    );
    return rows.length;
  }
}
