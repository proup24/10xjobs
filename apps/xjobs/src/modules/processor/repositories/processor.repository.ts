import { Injectable } from '@nestjs/common';
import { or } from '@prisma/orm-postgres/orm-client';
import { DatabaseService } from 'src/database';
import type { DatabaseTransaction, JobExtractionRow } from '@xjobs/database';
import { inRetriedTransaction } from 'src/modules/ingest/repositories/raw.repository';
import type { JobForProcessing, ModelCallMeta } from '../models/types';
import { PROCESSOR_CHANNELS } from '../config/processor.config';
import type { TypedColumns } from '../rules/typed-columns';
import {
  type ExtractionDocument,
  type ExtractionDocumentV1,
  type ExtractionDocumentV2,
  parseStoredDocument,
} from '../schema';

/** A job this worker holds: what `finish` checks the row against. */
export interface Claim {
  jobId: string;
  requestedAt: Date;
  /** `processingAttempts` after the claim; also identifies the claim. */
  attempts: number;
  /** Why the job was queued; `joined` allows reusing a trial extraction. */
  reason: 'new' | 'reopened' | 'joined' | null;
}

/** Two runs with the same key would produce the same extraction. */
export type ReuseKey = {
  inputHash: string;
  schemaVersion: number;
  promptHash: string;
  extractionModel: string;
};

export interface NewExtraction extends ReuseKey, TypedColumns {
  jobId: string;
  data: ExtractionDocument;
  needsReview: boolean;
  costUsd: number;
}

export interface NewAttempt extends ModelCallMeta {
  /** Null for golden-set eval rows. */
  jobId: string | null;
  extractionId: string | null;
  eval: boolean;
  step:
    | 'decision'
    | 'extraction'
    | 'extraction_retry'
    | 'generation'
    | 'generation_retry'
    | 'verification';
  outcome: 'ok' | 'error' | 'invalid';
  error: string | null;
  quoteFailures: number;
}

export type FinishOutcome =
  | { status: 'processed'; extractionId: string | null }
  /** `refundAttempt`: the run was not the job's fault; the claim's attempt is given back. */
  | { status: 'pending'; error: string; refundAttempt?: boolean }
  | { status: 'failed'; error: string };

/** What `markPending` did: jobs sent back, and archived jobs a selector matched but left alone. */
export interface MarkPendingResult {
  marked: number;
  skippedArchived: number;
}

/** Which in-scope jobs `markPending` sends back to the processor; selectors add up. */
export type ReprocessFilter = {
  allInScope?: boolean;
  nullStatus?: boolean;
  failed?: boolean;
  jobIds?: string[];
};

/** One job's processing state and current extraction, for inspection. */
export interface JobState {
  id: string;
  /** Active, a `job`, and has a LinkedIn job board source. */
  inScope: boolean;
  status: string;
  kind: string;
  closed: boolean;
  title: string | null;
  companyName: string | null;
  processingStatus: string | null;
  processingReason: string | null;
  processingRequestedAt: Date | null;
  processingAttempts: number;
  processingError: string | null;
  processedAt: Date | null;
  extraction: {
    id: string;
    createdAt: Date;
    needsReview: boolean;
    costUsd: number;
    /** The schema version the stored data reads as; null when none reads it. */
    schemaVersion: 1 | 2 | 3 | 4 | null;
    data:
      | ExtractionDocument
      | ExtractionDocumentV2
      | ExtractionDocumentV1
      | null;
  } | null;
}

/** A stored extraction's `data`, read as v4, else v3, v2, else v1. */
export function readStoredData(
  data: unknown,
): Pick<NonNullable<JobState['extraction']>, 'schemaVersion' | 'data'> {
  const stored = parseStoredDocument(data);
  return {
    schemaVersion: stored?.version ?? null,
    data: stored?.document ?? null,
  };
}

/** In-scope jobs per processing status; `unset` is a null status (never sent to the processor). */
export type ProcessingCounts = Record<
  'pending' | 'processing' | 'processed' | 'failed' | 'archived' | 'unset',
  number
>;

/**
 * Every read and write the processor makes. A job is in scope when it is an
 * active `job` with at least one LinkedIn job board source; nothing here
 * claims or reprocesses any other job.
 */
export abstract class ProcessorRepository {
  /** In-scope `pending` jobs, oldest `processingRequestedAt` first. */
  abstract listPendingInScope(limit: number): Promise<string[]>;
  /** `pending` → `processing` for an in-scope job; null when it is not claimable. */
  abstract claim(jobId: string): Promise<Claim | null>;
  abstract loadJob(jobId: string): Promise<JobForProcessing | null>;
  abstract findReusable(
    key: ReuseKey,
  ): Promise<{ id: string; jobId: string } | null>;
  /**
   * The newest extraction with this schema, prompt and model made for `jobId`
   * or for a job merged into it (the trial's copy of the same posting).
   */
  abstract findJoinedReusable(
    jobId: string,
    key: Omit<ReuseKey, 'inputHash'>,
  ): Promise<{ id: string; jobId: string } | null>;
  /** A new row for `jobId` with the same document; returns its id. */
  abstract copyExtraction(extractionId: string, jobId: string): Promise<string>;
  abstract saveExtraction(row: NewExtraction): Promise<string>;
  abstract recordAttempts(rows: NewAttempt[]): Promise<void>;
  /**
   * Ends a claim. `superseded` when the job was reopened or reclaimed since:
   * the row is left alone, except that a processed outcome still points the
   * job at its extraction unless a newer run already finished it.
   */
  abstract finish(
    claim: Claim,
    outcome: FinishOutcome,
  ): Promise<'finished' | 'superseded'>;
  /** `processing` jobs claimed before `olderThan` go back to `pending`. */
  abstract releaseStale(olderThan: Date): Promise<number>;
  /** Spend of non-eval attempts since `since`, in USD. */
  abstract spendSince(since: Date): Promise<number>;
  /** Sets the matching in-scope jobs to `pending`; returns how many. */
  abstract markPending(filter: ReprocessFilter): Promise<MarkPendingResult>;
  abstract jobState(jobId: string): Promise<JobState | null>;
  abstract processingCounts(): Promise<ProcessingCounts>;
}

type Raw = DatabaseTransaction['raw'];
type Json = JobExtractionRow['data'];

const TIMESTAMP = 'pg/timestamptz-date@1';
const UUID = 'pg/uuid@1';

type LinkedInJobIds = ReturnType<ReturnType<Raw['sql']>['returnsRow']>;

/**
 * Ids of jobs with a LinkedIn job board source (harvestapi or trial channel). Spliced into the statements
 * below as `id IN (…)`; the job's own columns are checked on the updated row
 * itself, so a concurrent change to them is seen (see `claim`).
 */
export function linkedInJobIds(raw: Raw): LinkedInJobIds {
  return raw.sql`SELECT s."jobId" FROM normalized_job_sources s JOIN raw_items r ON r.id = s."rawItemId" WHERE r.channel = ANY(${`{${PROCESSOR_CHANNELS.join(',')}}`}::text[])`.returnsRow(
    { jobId: UUID },
  );
}

/** Numeric columns travel as decimal strings. */
const toDecimal = (n: number): string => String(n);

@Injectable()
export class PrismaProcessorRepository extends ProcessorRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get db() {
    return this.database.db;
  }

  async listPendingInScope(limit: number): Promise<string[]> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT j.id FROM normalized_jobs j
        WHERE j."processingStatus" = 'pending' AND j.status = 'active' AND j.kind = 'job'
          AND j.id IN (${linkedInJobIds(raw)})
        ORDER BY j."processingRequestedAt" ASC NULLS FIRST, j.id ASC
        LIMIT ${limit}::int`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.map((row) => row.id as string);
  }

  /**
   * One UPDATE, so the check and the write are atomic. Two concurrent claims
   * of the same job both find it `pending`, but the second blocks on the row
   * lock the first UPDATE takes; once the first commits, Postgres re-checks
   * the WHERE against the new row version (READ COMMITTED re-evaluation),
   * sees `processing`, and updates nothing. A job merged or demoted to a post
   * after listing fails the same row-level checks.
   */
  async claim(jobId: string): Promise<Claim | null> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`UPDATE normalized_jobs SET
          "processingStatus" = 'processing',
          "processingAttempts" = "processingAttempts" + 1,
          "processingStartedAt" = now(),
          "processingRequestedAt" = COALESCE("processingRequestedAt", now()),
          "updatedAt" = now()
        WHERE id = ${jobId}::uuid
          AND "processingStatus" = 'pending' AND status = 'active' AND kind = 'job'
          AND id IN (${linkedInJobIds(raw)})
        RETURNING "processingRequestedAt" AS "requestedAt", "processingAttempts" AS attempts, "processingReason" AS reason`
        .returnsRow({
          requestedAt: TIMESTAMP,
          attempts: 'pg/int4@1',
          reason: 'pg/text@1',
        })
        .build(),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      jobId,
      requestedAt: row.requestedAt as Date,
      attempts: row.attempts as number,
      reason: row.reason as Claim['reason'],
    };
  }

  async loadJob(jobId: string): Promise<JobForProcessing | null> {
    const row = await this.db.orm.public.NormalizedJob.where({
      id: jobId,
    }).first();
    if (!row) return null;
    return {
      id: row.id,
      closed: row.closed,
      title: row.title,
      descriptionText: row.descriptionText,
    };
  }

  async findReusable(
    key: ReuseKey,
  ): Promise<{ id: string; jobId: string } | null> {
    const row = await this.db.orm.public.JobExtraction.where({
      inputHash: key.inputHash,
      schemaVersion: key.schemaVersion,
      promptHash: key.promptHash,
      extractionModel: key.extractionModel,
    })
      .orderBy((e) => e.createdAt.desc())
      .first();
    return row ? { id: row.id, jobId: row.jobId } : null;
  }

  async findJoinedReusable(
    jobId: string,
    key: Omit<ReuseKey, 'inputHash'>,
  ): Promise<{ id: string; jobId: string } | null> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT e.id, e."jobId" FROM job_extractions e
        WHERE e."schemaVersion" = ${key.schemaVersion}
          AND e."promptHash" = ${key.promptHash}
          AND e."extractionModel" = ${key.extractionModel}
          AND (e."jobId" = ${jobId}::uuid
            OR e."jobId" IN (SELECT id FROM normalized_jobs WHERE "mergedIntoId" = ${jobId}::uuid))
        ORDER BY e."createdAt" DESC LIMIT 1`
        .returnsRow({ id: UUID, jobId: UUID })
        .build(),
    );
    return rows[0]
      ? { id: rows[0].id as string, jobId: rows[0].jobId as string }
      : null;
  }

  /** The copy cost nothing: no model was called for it. */
  async copyExtraction(extractionId: string, jobId: string): Promise<string> {
    const source = await this.db.orm.public.JobExtraction.where({
      id: extractionId,
    }).first();
    if (!source) throw new Error(`job extraction ${extractionId} not found`);
    const { id: _id, createdAt: _createdAt, ...fields } = source;
    const copy = await this.db.orm.public.JobExtraction.create({
      ...fields,
      jobId,
      costUsd: toDecimal(0),
    });
    return copy.id;
  }

  async saveExtraction(row: NewExtraction): Promise<string> {
    const created = await this.db.orm.public.JobExtraction.create({
      ...row,
      decisionModel: null,
      data: row.data as unknown as Json,
      costUsd: toDecimal(row.costUsd),
    });
    return created.id;
  }

  async recordAttempts(rows: NewAttempt[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const row of rows)
        await tx.orm.public.ProcessingAttempt.create({
          ...row,
          costUsd: toDecimal(row.costUsd),
        });
    });
  }

  /**
   * Writes only while the row still holds this claim: `processing`, the same
   * `processingRequestedAt` (a reopen changes it) and the same attempt count
   * (a stale-claim release followed by a new claim changes it).
   */
  async finish(
    claim: Claim,
    outcome: FinishOutcome,
  ): Promise<'finished' | 'superseded'> {
    const jobs = this.db.orm.public.NormalizedJob;
    const held = jobs.where({
      id: claim.jobId,
      processingStatus: 'processing',
      processingRequestedAt: claim.requestedAt,
      processingAttempts: claim.attempts,
    });
    const updated = await held.updateAll(
      outcome.status === 'processed'
        ? {
            processingStatus: 'processed',
            processingError: null,
            processedAt: new Date(),
            processingStartedAt: null,
            ...(outcome.extractionId === null
              ? {}
              : { currentExtractionId: outcome.extractionId }),
          }
        : {
            processingStatus: outcome.status,
            processingError: outcome.error,
            processingStartedAt: null,
            // The row still holds `claim.attempts`, so this is a decrement.
            ...(outcome.status === 'pending' && outcome.refundAttempt
              ? { processingAttempts: claim.attempts - 1 }
              : {}),
          },
    );
    if (updated.length > 0) return 'finished';

    // The extraction is still the freshest one unless a newer run already
    // finished the job; until then qualify reads this one.
    if (outcome.status === 'processed' && outcome.extractionId !== null)
      await jobs
        .where({ id: claim.jobId })
        .where((j) =>
          or(j.processingStatus.isNull(), j.processingStatus.neq('processed')),
        )
        .updateAll({ currentExtractionId: outcome.extractionId });
    return 'superseded';
  }

  async releaseStale(olderThan: Date): Promise<number> {
    const released = await this.db.orm.public.NormalizedJob.where({
      processingStatus: 'processing',
    })
      .where((j) => j.processingStartedAt.lt(olderThan))
      .updateAll({ processingStatus: 'pending', processingStartedAt: null });
    return released.length;
  }

  async spendSince(since: Date): Promise<number> {
    const result = await this.db.orm.public.ProcessingAttempt.where({
      eval: false,
    })
      .where((a) => a.createdAt.gte(since))
      .aggregate((a) => ({ total: a.sum('costUsd') }));
    return Number(result.total ?? 0);
  }

  async jobState(jobId: string): Promise<JobState | null> {
    const { orm, raw } = this.db;
    const job = await orm.public.NormalizedJob.where({ id: jobId }).first();
    if (!job) return null;
    const [scope] = await this.db.query(
      raw.sql`SELECT ${jobId}::uuid IN (${linkedInJobIds(raw)}) AS "linkedIn"`
        .returnsRow({ linkedIn: 'pg/bool@1' })
        .build(),
    );
    const extraction = job.currentExtractionId
      ? await orm.public.JobExtraction.where({
          id: job.currentExtractionId,
        }).first()
      : null;
    return {
      id: job.id,
      inScope:
        job.status === 'active' &&
        job.kind === 'job' &&
        Boolean(scope?.linkedIn),
      status: job.status,
      kind: job.kind,
      closed: job.closed,
      title: job.title,
      companyName: job.companyName,
      processingStatus: job.processingStatus,
      processingReason: job.processingReason,
      processingRequestedAt: job.processingRequestedAt,
      processingAttempts: job.processingAttempts,
      processingError: job.processingError,
      processedAt: job.processedAt,
      extraction: extraction
        ? {
            id: extraction.id,
            createdAt: extraction.createdAt,
            needsReview: extraction.needsReview,
            costUsd: Number(extraction.costUsd),
            ...readStoredData(extraction.data),
          }
        : null,
    };
  }

  async processingCounts(): Promise<ProcessingCounts> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT coalesce(j."processingStatus", 'unset') AS status, count(*)::int AS n
        FROM normalized_jobs j
        WHERE j.status = 'active' AND j.kind = 'job'
          AND j.id IN (${linkedInJobIds(raw)})
        GROUP BY 1`
        .returnsRow({ status: 'pg/text@1', n: 'pg/int4@1' })
        .build(),
    );
    const counts: ProcessingCounts = {
      pending: 0,
      processing: 0,
      processed: 0,
      failed: 0,
      archived: 0,
      unset: 0,
    };
    for (const row of rows)
      counts[row.status as keyof ProcessingCounts] = row.n as number;
    return counts;
  }

  /**
   * One transaction; each selector is its own UPDATE, and a job two selectors
   * match is counted once.
   */
  async markPending(filter: ReprocessFilter): Promise<MarkPendingResult> {
    return inRetriedTransaction(this.database, async (tx) => {
      const touched = new Set<string>();
      const run = async (plan: Parameters<typeof tx.query>[0]) => {
        for (const row of await tx.query(plan))
          touched.add((row as { id: string }).id);
      };
      const { raw } = tx;
      const ids = () => linkedInJobIds(raw);
      // Archived jobs are never touched; count the ones a selector would have matched.
      let skippedArchived = 0;
      const countArchived = async (plan: Parameters<typeof tx.query>[0]) => {
        skippedArchived += (await tx.query(plan)).length;
      };
      if (filter.allInScope)
        await countArchived(
          raw.sql`SELECT id FROM normalized_jobs
            WHERE status = 'active' AND kind = 'job' AND id IN (${ids()})
              AND "processingStatus" = 'archived'`
            .returnsRow({ id: UUID })
            .build(),
        );
      else
        for (const jobId of new Set(filter.jobIds ?? []))
          await countArchived(
            raw.sql`SELECT id FROM normalized_jobs
              WHERE status = 'active' AND kind = 'job' AND id IN (${ids()})
                AND "processingStatus" = 'archived' AND id = ${jobId}::uuid`
              .returnsRow({ id: UUID })
              .build(),
          );
      // Every statement: in scope (active `job` with a LinkedIn source), then the selector.
      if (filter.allInScope)
        await run(
          raw.sql`UPDATE normalized_jobs SET ${pendingColumns(raw)}
            WHERE status = 'active' AND kind = 'job' AND id IN (${ids()})
              AND "processingStatus" IS DISTINCT FROM 'archived'
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
      if (filter.nullStatus)
        await run(
          raw.sql`UPDATE normalized_jobs SET ${pendingColumns(raw)}
            WHERE status = 'active' AND kind = 'job' AND id IN (${ids()})
              AND "processingStatus" IS NULL
              AND "processingStatus" IS DISTINCT FROM 'archived'
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
      if (filter.failed)
        await run(
          raw.sql`UPDATE normalized_jobs SET ${pendingColumns(raw)}
            WHERE status = 'active' AND kind = 'job' AND id IN (${ids()})
              AND "processingStatus" = 'failed'
              AND "processingStatus" IS DISTINCT FROM 'archived'
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
      for (const jobId of new Set(filter.jobIds ?? []))
        await run(
          raw.sql`UPDATE normalized_jobs SET ${pendingColumns(raw)}
            WHERE status = 'active' AND kind = 'job' AND id IN (${ids()})
              AND id = ${jobId}::uuid
              AND "processingStatus" IS DISTINCT FROM 'archived'
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
      return { marked: touched.size, skippedArchived };
    });
  }
}

/** The SET list of `markPending`, as a raw fragment. */
function pendingColumns(raw: Raw) {
  return raw.sql`"processingStatus" = 'pending',
    "processingReason" = 'new',
    "processingRequestedAt" = now(),
    "processingAttempts" = 0,
    "processingError" = NULL,
    "processingStartedAt" = NULL,
    "updatedAt" = now()`.returns('pg/text@1');
}
