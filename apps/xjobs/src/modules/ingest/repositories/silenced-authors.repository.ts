import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DatabaseTransaction } from '@xjobs/database';
import { DatabaseService } from 'src/database';

type Raw = DatabaseTransaction['raw'];

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const JSONB = 'pg/jsonb@1';
const TIMESTAMP = 'pg/timestamptz-date@1';

export type SilenceOrigin = 'manual' | 'automatic';

/** One silenced post author. */
export interface SilencedAuthorRow {
  id: string;
  /** A post record's `post.author.key`: `profile:<id>` or `company:<id>`. */
  authorKey: string;
  /** The author's name as last seen. */
  name: string | null;
  reason: string;
  origin: SilenceOrigin;
  /** Why an automatic entry was added; null for manual ones. */
  evidence: unknown;
  /** The admin's Supabase user id; null for automatic entries. */
  createdBy: string | null;
  createdAt: Date;
}

export interface SilenceInput {
  authorKey: string;
  name: string | null;
  reason: string;
  origin: SilenceOrigin;
  evidence: unknown;
  createdBy: string | null;
}

/**
 * Silenced post authors, engine-wide. Silencing is derived, never stored on
 * jobs: a post job is silenced when every one of its sources' authors is
 * silenced (see `silencedPostJobSql`), so un-silencing needs no clean-up.
 */
export abstract class SilencedAuthorsRepository {
  /** Every silenced author, newest entry first. */
  abstract list(): Promise<SilencedAuthorRow[]>;
  /** Adds the author; `'already'` when it was silenced, leaving that entry as it was. */
  abstract silence(input: SilenceInput): Promise<'silenced' | 'already'>;
  /**
   * Removes the author; false when it was not silenced. Removing an
   * `automatic` entry also records the dismissal (`by` = the admin), in the
   * same statement, so automatic silencing needs new posts to silence the
   * author again. A manual entry leaves no dismissal.
   */
  abstract unsilence(authorKey: string, by: string | null): Promise<boolean>;
  /**
   * Ids of silenced post jobs, by job id descending (ids are UUIDv7, so newest
   * job first). `before` is the last id of the previous page, or null for the
   * first page; the next page holds the ids strictly below it.
   */
  abstract silencedPostJobIds(page: {
    before: string | null;
    limit: number;
  }): Promise<string[]>;
}

/** A column reference: `id`, `j.id`, `"jobId"` or `s."jobId"`. */
const COLUMN =
  /^(?:[a-z_][a-z0-9_]*\.)?(?:[a-z_][a-z0-9_]*|"[A-Za-z_][A-Za-z0-9_]*")$/;

/**
 * True when `jobIdColumn` names a post job (`kind = 'post'`) with at least one
 * source, every source's author key (`record->'post'->'author'->>'key'` of
 * the source's normalized version; for a share, the sharer) being silenced. A
 * source with no `post` or a null key is never silenced. A job with no source
 * (an archived post job) is never silenced: "every source" of none is not a
 * reason to hold it.
 *
 * `jobIdColumn` is spliced into the SQL as written, so it must be a column
 * reference in the calling statement (e.g. `j.id`); anything else throws. Slice
 * 03 embeds this in the processor's scope.
 */
export function silencedPostJobSql(raw: Raw, jobIdColumn: string) {
  if (!COLUMN.test(jobIdColumn))
    throw new Error(`Not a column reference: ${jobIdColumn}`);
  const c = jobIdColumn;
  const text = `(EXISTS (SELECT 1 FROM normalized_jobs sp_j
      WHERE sp_j.id = ${c} AND sp_j.kind = 'post')
    AND EXISTS (SELECT 1 FROM normalized_job_sources sp_s WHERE sp_s."jobId" = ${c})
    AND NOT EXISTS (
      SELECT 1 FROM normalized_job_sources sp_s
      JOIN normalized_versions sp_v ON sp_v.id = sp_s."normalizedVersionId"
      WHERE sp_s."jobId" = ${c}
        AND NOT EXISTS (
          SELECT 1 FROM silenced_authors sp_a
          WHERE sp_a."authorKey" = sp_v.record->'post'->'author'->>'key')))`;
  // The raw tag splices only values; the column name is fixed text here.
  const strings = Object.assign([text], { raw: [text] });
  return raw.sql(strings).returns('pg/bool@1');
}

@Injectable()
export class PrismaSilencedAuthorsRepository extends SilencedAuthorsRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get db() {
    return this.database.db;
  }

  async list(): Promise<SilencedAuthorRow[]> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT id, "authorKey", name, reason, origin, evidence, "createdBy", "createdAt"
        FROM silenced_authors ORDER BY "createdAt" DESC, id DESC`
        .returnsRow({
          id: UUID,
          authorKey: TEXT,
          name: TEXT,
          reason: TEXT,
          origin: TEXT,
          evidence: JSONB,
          createdBy: UUID,
          createdAt: TIMESTAMP,
        })
        .build(),
    );
    return rows.map((row) => ({
      id: row.id as string,
      authorKey: row.authorKey as string,
      name: (row.name as string | null) ?? null,
      reason: row.reason as string,
      origin: row.origin as SilenceOrigin,
      evidence: row.evidence ?? null,
      createdBy: (row.createdBy as string | null) ?? null,
      createdAt: row.createdAt as Date,
    }));
  }

  async silence(input: SilenceInput): Promise<'silenced' | 'already'> {
    const { raw } = this.db;
    // Nullable fields travel in one jsonb document, read back field by field.
    const doc = JSON.stringify({
      name: input.name,
      evidence: input.evidence ?? null,
      createdBy: input.createdBy,
    });
    const rows = await this.db.query(
      raw.sql`WITH d AS (SELECT ${doc}::jsonb AS d)
        INSERT INTO silenced_authors (id, "authorKey", name, reason, origin, evidence, "createdBy")
        SELECT ${randomUUID()}::uuid, ${input.authorKey}::text, d->>'name',
          ${input.reason}::text, ${input.origin}::text,
          NULLIF(d->'evidence', 'null'::jsonb), (d->>'createdBy')::uuid
        FROM d
        ON CONFLICT ("authorKey") DO NOTHING
        RETURNING id`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.length > 0 ? 'silenced' : 'already';
  }

  async unsilence(authorKey: string, by: string | null): Promise<boolean> {
    const { raw } = this.db;
    // The nullable admin id travels in a jsonb document, as in `silence`.
    const doc = JSON.stringify({ by });
    // One statement: the delete and the dismissal commit together.
    const rows = await this.db.query(
      raw.sql`WITH gone AS (
          DELETE FROM silenced_authors WHERE "authorKey" = ${authorKey}::text
          RETURNING id),
        dismissed AS (
          INSERT INTO auto_silence_dismissals ("authorKey", "dismissedAt", "dismissedBy")
          SELECT ${authorKey}::text, now(), (${doc}::jsonb->>'by')::uuid
          FROM gone
          ON CONFLICT ("authorKey") DO UPDATE
            SET "dismissedAt" = EXCLUDED."dismissedAt", "dismissedBy" = EXCLUDED."dismissedBy"
          RETURNING 1)
        SELECT id FROM gone`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.length > 0;
  }

  async silencedPostJobIds(page: {
    before: string | null;
    limit: number;
  }): Promise<string[]> {
    const { raw } = this.db;
    // The cursor travels as text so the first page needs no null uuid param.
    const before = page.before ?? '';
    const rows = await this.db.query(
      raw.sql`SELECT j.id FROM normalized_jobs j
        WHERE j.kind = 'post'
          AND (${before}::text = '' OR j.id < NULLIF(${before}::text, '')::uuid)
          AND ${silencedPostJobSql(raw, 'j.id')}
        ORDER BY j.id DESC
        LIMIT ${page.limit}::int`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.map((row) => row.id as string);
  }
}
