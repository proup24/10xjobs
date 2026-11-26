import { Injectable } from '@nestjs/common';
import type { DatabaseTransaction } from '@xjobs/database';
import { DatabaseService } from 'src/database';
import { loadPlaceIndex } from 'src/modules/matcher/repositories/place-index';
import {
  hasLinkedInSourceSql,
  linkedInJobIds,
} from 'src/modules/processor/repositories/processor.repository';
import type { PlacesByArrangement } from 'src/modules/users/types/place.types';
import {
  onSiteDemand,
  type OnSiteDemand,
  type PrefilterJob,
  type SkipReason,
} from '../rules/check';

/** A listing the prefilter may check: never processed, not joined, in the processor's scope. */
export type UncheckedJob = PrefilterJob & { id: string };

/**
 * Every read and write the prefilter makes. It only ever looks at `pending`
 * listing jobs (`kind = 'job'`) in the processor's scope (an active job with a
 * LinkedIn job board source, see `processorScopeSql`) that have no current
 * extraction and were not queued as `joined`: a job that was processed once,
 * a post, a post role or a joined job is never skipped.
 */
export abstract class PrefilterRepository {
  /** Unchecked `pending` listings, in the order `listPendingInScope` claims them. */
  abstract listUncheckedPending(limit: number): Promise<UncheckedJob[]>;
  /** The same test for one job; null when it is not one the prefilter may check. */
  abstract findUncheckedPending(jobId: string): Promise<UncheckedJob | null>;
  /** Where published profiles want hybrid or onsite work. Throws when it cannot be read. */
  abstract loadDemand(): Promise<OnSiteDemand>;
  /**
   * `pending` → `skipped` with `reason`, only while the job still passes the
   * `listUncheckedPending` test and carries the tag and country the reason
   * names; false when it changed since (an extraction, a claim, a join).
   */
  abstract markSkipped(jobId: string, reason: SkipReason): Promise<boolean>;
  /**
   * `skipped` jobs first seen since `firstSeenSince`, not closed and not past
   * `expiresAt`, go back to `pending` as `reopened`, so the prefilter checks
   * them again; `processingSkip` stays for history. Returns how many.
   */
  abstract reopenSkipped(filter: { firstSeenSince: Date }): Promise<number>;
}

type Raw = DatabaseTransaction['raw'];

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';
const BOOL = 'pg/bool@1';

const JOB_COLUMNS = {
  id: UUID,
  workplaceType: TEXT,
  countryCode: TEXT,
  remoteAllowed: BOOL,
  title: TEXT,
  location: TEXT,
  descriptionText: TEXT,
} as const;

/** Never processed and not joined: the rows the prefilter may skip, on the job aliased `j`. */
function uncheckedSql(raw: Raw) {
  return raw.sql`j."processingStatus" = 'pending' AND j."currentExtractionId" IS NULL
    AND j."processingReason" IS DISTINCT FROM 'joined'`.returns('pg/bool@1');
}

function toJob(row: Record<string, unknown>): UncheckedJob {
  return {
    id: row.id as string,
    workplaceType: (row.workplaceType as string | null) ?? null,
    countryCode: (row.countryCode as string | null) ?? null,
    remoteAllowed: (row.remoteAllowed as boolean | null) ?? null,
    title: (row.title as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    descriptionText: (row.descriptionText as string | null) ?? null,
  };
}

@Injectable()
export class PrismaPrefilterRepository extends PrefilterRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get db() {
    return this.database.db;
  }

  async listUncheckedPending(limit: number): Promise<UncheckedJob[]> {
    const { raw } = this.db;
    // The scope and order of `listPendingInScope`, so every job it lists was checked.
    const rows = await this.db.query(
      raw.sql`SELECT j.id, j."workplaceType", j."countryCode", j."remoteAllowed",
          j.title, j.location, j."descriptionText"
        FROM normalized_jobs j
        WHERE ${uncheckedSql(raw)} AND j.status = 'active' AND j.kind = 'job'
          AND j.id IN (${linkedInJobIds(raw)})
        ORDER BY j."processingRequestedAt" ASC NULLS FIRST, j.id ASC
        LIMIT ${limit}::int`
        .returnsRow(JOB_COLUMNS)
        .build(),
    );
    return rows.map(toJob);
  }

  async findUncheckedPending(jobId: string): Promise<UncheckedJob | null> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`SELECT j.id, j."workplaceType", j."countryCode", j."remoteAllowed",
          j.title, j.location, j."descriptionText"
        FROM normalized_jobs j
        WHERE j.id = ${jobId}::uuid AND ${uncheckedSql(raw)}
          AND j.status = 'active' AND j.kind = 'job'
          AND ${hasLinkedInSourceSql(raw, 'j')}`
        .returnsRow(JOB_COLUMNS)
        .build(),
    );
    return row ? toJob(row) : null;
  }

  async loadDemand(): Promise<OnSiteDemand> {
    const profiles = await this.db.orm.public.Profile.where({
      state: 'published',
    }).all();
    const places = await loadPlaceIndex(this.db);
    return onSiteDemand(
      profiles.map((p) => ({
        locations: p.locations as unknown as PlacesByArrangement,
      })),
      places,
    );
  }

  /**
   * One UPDATE whose WHERE repeats the listing test, so a job claimed, joined
   * or given an extraction after it was listed is left alone (READ COMMITTED
   * re-checks the WHERE on the row version a concurrent write left).
   */
  async markSkipped(jobId: string, reason: SkipReason): Promise<boolean> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`UPDATE normalized_jobs j SET
          "processingStatus" = 'skipped',
          "processingSkip" = ${JSON.stringify(reason)}::jsonb,
          "processingRequestedAt" = NULL,
          "updatedAt" = now()
        WHERE j.id = ${jobId}::uuid AND ${uncheckedSql(raw)}
          AND j.status = 'active' AND j.kind = 'job'
          AND j."workplaceType" = ${reason.tag}::text
          AND upper(j."countryCode") = ${reason.country}::text
          AND ${hasLinkedInSourceSql(raw, 'j')}
        RETURNING j.id`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.length > 0;
  }

  async reopenSkipped(filter: { firstSeenSince: Date }): Promise<number> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`UPDATE normalized_jobs j SET
          "processingStatus" = 'pending',
          "processingReason" = 'reopened',
          "processingRequestedAt" = now(),
          "processingAttempts" = 0,
          "processingError" = NULL,
          "processingStartedAt" = NULL,
          "updatedAt" = now()
        WHERE j."processingStatus" = 'skipped' AND j.status = 'active'
          AND j."firstSeenAt" >= ${filter.firstSeenSince.toISOString()}::timestamptz
          AND NOT j.closed
          AND (j."expiresAt" IS NULL OR j."expiresAt" > now())
        RETURNING j.id`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.length;
  }
}
