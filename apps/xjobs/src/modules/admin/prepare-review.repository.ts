import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import { NORMALIZER_VERSION } from 'src/modules/ingest/normalize/record';

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const JSONB = 'pg/jsonb@1';
const TIMESTAMP = 'pg/timestamptz-date@1';

export interface DropRow {
  rawItemId: string;
  reason: string;
  lastSeenAt: Date;
  payload: Record<string, unknown>;
}

export interface HeldPostRow {
  jobId: string;
  postingUrl: string;
  /** The first source's `record.post`, or null. */
  post: Record<string, unknown> | null;
}

export abstract class PrepareReviewRepository {
  /**
   * Post items whose latest raw version's normalized version at the current
   * `NORMALIZER_VERSION` is invalid, newest `lastSeenAt` first, then id
   * descending. `rule` keeps only `prepare: <rule>` reasons; `before` is the
   * last row of the previous page.
   */
  abstract drops(page: {
    rule: string | null;
    before: { lastSeenAt: string; id: string } | null;
    limit: number;
  }): Promise<DropRow[]>;
  /** The listed post jobs with a source's post record, in the order asked. */
  abstract heldPosts(jobIds: string[]): Promise<HeldPostRow[]>;
}

@Injectable()
export class PrismaPrepareReviewRepository extends PrepareReviewRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get db() {
    return this.database.db;
  }

  async drops(page: {
    rule: string | null;
    before: { lastSeenAt: string; id: string } | null;
    limit: number;
  }): Promise<DropRow[]> {
    const { raw } = this.db;
    // Optional params travel as text, '' meaning none, so no null params.
    const rule = page.rule ?? '';
    const at = page.before?.lastSeenAt ?? '';
    const id = page.before?.id ?? '';
    const rows = await this.db.query(
      raw.sql`SELECT i.id, v.reason, i."lastSeenAt", r.payload
        FROM raw_items i
        JOIN normalized_versions v
          ON v."rawVersionId" = i."latestVersionId"
          AND v."normalizerVersion" = ${NORMALIZER_VERSION}::int
        JOIN raw_item_versions r ON r.id = i."latestVersionId"
        WHERE i.channel = 'LINKEDIN_POSTS' AND i.kind = 'post'
          AND v.status = 'invalid'
          AND (${rule}::text = ''
            OR v.reason = 'prepare: ' || ${rule}::text
            OR starts_with(v.reason, 'prepare: ' || ${rule}::text || ': '))
          AND (${at}::text = ''
            OR (i."lastSeenAt", i.id) < (${at}::text::timestamptz, ${id}::text::uuid))
        ORDER BY i."lastSeenAt" DESC, i.id DESC
        LIMIT ${page.limit}::int`
        .returnsRow({
          id: UUID,
          reason: TEXT,
          lastSeenAt: TIMESTAMP,
          payload: JSONB,
        })
        .build(),
    );
    return rows.map((row) => ({
      rawItemId: row.id as string,
      reason: (row.reason as string | null) ?? '',
      lastSeenAt: row.lastSeenAt as Date,
      payload: (row.payload ?? {}) as Record<string, unknown>,
    }));
  }

  async heldPosts(jobIds: string[]): Promise<HeldPostRow[]> {
    if (jobIds.length === 0) return [];
    const { raw } = this.db;
    const ids = JSON.stringify(jobIds);
    const rows = await this.db.query(
      raw.sql`SELECT j.id, j."postingUrl",
          (SELECT v.record->'post'
            FROM normalized_job_sources s
            JOIN normalized_versions v ON v.id = s."normalizedVersionId"
            WHERE s."jobId" = j.id
            ORDER BY s."linkedAt", s.id LIMIT 1) AS post
        FROM normalized_jobs j
        WHERE j.id IN (SELECT e::uuid FROM jsonb_array_elements_text(${ids}::jsonb) e)
        ORDER BY j.id DESC`
        .returnsRow({ id: UUID, postingUrl: TEXT, post: JSONB })
        .build(),
    );
    return rows.map((row) => ({
      jobId: row.id as string,
      postingUrl: row.postingUrl as string,
      post: (row.post as Record<string, unknown> | null) ?? null,
    }));
  }
}
