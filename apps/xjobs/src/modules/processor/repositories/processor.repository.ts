import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database';
import type { DatabaseTransaction, JobExtractionRow } from '@xjobs/database';
import { inRetriedTransaction } from 'src/modules/ingest/repositories/raw.repository';
import { silencedPostJobSql } from 'src/modules/ingest/repositories/silenced-authors.repository';
import type { PostDetail } from 'src/modules/ingest/normalize/record';
import type { JobForProcessing, ModelCallMeta } from '../models/types';
import { roleJobPostedAt } from './role-posted-at';
import { PROCESSOR_CHANNELS } from '../config/processor.config';
import { MATCHER_VERSION } from 'src/modules/matcher/config/matcher.config';
import type { TypedColumns } from '../rules/typed-columns';
import {
  type ExtractionDocument,
  type ExtractionDocumentV1,
  type ExtractionDocumentV2,
  parseStoredDocument,
} from '../schema';
import type { PostDocument } from '../schema/post-extraction';

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
  /** Which document the run generates; a listing key never finds a post row. */
  docType: DocType;
  inputHash: string;
  schemaVersion: number;
  promptHash: string;
  extractionModel: string;
};

export interface NewExtraction extends ReuseKey, TypedColumns {
  jobId: string;
  /** A listing document, or a post document on a `post` row. */
  data: ExtractionDocument | PostDocument;
  needsReview: boolean;
  costUsd: number;
  /** A post's verdict, its reason code and confidence; null on a listing. */
  verdict: string | null;
  verdictReason: string | null;
  verdictConfidence: string | null;
}

/** A stored extraction's key and raw `data`, as `findExtraction` reads it. */
export type StoredExtraction = ReuseKey & {
  id: string;
  jobId: string;
  data: unknown;
};

/** A role of a hiring post, written as its `post_role` job. */
export interface RoleJobInput {
  postJobId: string;
  /** Names the role within the post; unique per post. */
  roleKey: string;
  title: string;
  companyName: string | null;
  /** The role's listing-shaped extraction, made current. */
  extractionId: string;
  /** The job keys the role's apply links resolve to (`linkKeysOf`). */
  linkKeys: string[];
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
  /** The document the call was generating. */
  docType: DocType;
}

/** The two documents the processor generates: a listing's, or a post's. */
export type DocType = 'listing' | 'post';

export type FinishOutcome =
  | { status: 'processed'; extractionId: string | null }
  /** `refundAttempt`: the run was not the job's fault; the claim's attempt is given back. */
  | { status: 'pending'; error: string; refundAttempt?: boolean }
  | { status: 'failed'; error: string };

/**
 * What `markPending` did: jobs sent back, archived jobs a selector matched but
 * left alone, and `skipped` jobs `allInScope` matched but left alone.
 */
export interface MarkPendingResult {
  marked: number;
  skippedArchived: number;
  /** Never processed: the prefilter's recheck reopens them. `jobIds` sends one to `pending`, and the next sweep skips it again if it still fails the check. */
  leftSkipped: number;
}

/** Which in-scope jobs `markPending` sends back to the processor; selectors add up. */
export type ReprocessFilter = {
  allInScope?: boolean;
  nullStatus?: boolean;
  failed?: boolean;
  /** Jobs with a `qualified` or `review` decision on their current extraction, by this matcher version or later. */
  matched?: boolean;
  jobIds?: string[];
};

/** One job's processing state and current extraction, for inspection. */
export interface JobState {
  id: string;
  /** In the processor's scope (see `processorScopeSql`). */
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

/**
 * In-scope jobs per processing status; `unset` is a null status (never sent
 * to the processor), `skipped` a listing the prefilter kept from it.
 */
export type Counts = Record<
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'archived'
  | 'skipped'
  | 'unset',
  number
>;

/**
 * Listings and posts counted apart. `outOfWindow`: active posts still
 * `pending` that were first seen more than 7 days ago, so never extracted.
 * `silenced`: in-window `pending` posts held because every author is silenced.
 * Neither is in the post status counts; role jobs are never counted.
 */
export interface ProcessingCounts {
  listings: Counts;
  posts: Counts & { outOfWindow: number; silenced: number };
}

/**
 * Every read and write the processor makes. A job is in scope when it is
 * active and either a `job` with at least one LinkedIn job board or Indeed source, or a
 * `post` first seen within 7 days whose authors are not all silenced (see
 * `processorScopeSql`); nothing here claims or reprocesses any other job, and
 * never a `post_role` job.
 */
export abstract class ProcessorRepository {
  /** In-scope `pending` listing jobs, oldest `processingRequestedAt` first. */
  abstract listPendingInScope(limit: number): Promise<string[]>;
  /** In-scope `pending` post jobs, newest `firstSeenAt` first. */
  abstract listPendingPosts(limit: number): Promise<string[]>;
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
  /** One extraction row by id, its `data` unparsed; null when there is none. */
  abstract findExtraction(id: string): Promise<StoredExtraction | null>;
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
  /** Logged spend since `since`; of one document type, or of every attempt. */
  abstract spendSince(since: Date, docType?: DocType): Promise<number>;
  /** Sets the matching in-scope jobs to `pending`; returns how many. */
  abstract markPending(filter: ReprocessFilter): Promise<MarkPendingResult>;
  abstract jobState(jobId: string): Promise<JobState | null>;
  abstract processingCounts(): Promise<ProcessingCounts>;
  /**
   * Creates or updates the `post_role` job of `roleKey` under the post job,
   * `processed` with `extractionId` as its current extraction (an archived
   * one comes back); returns its id.
   */
  abstract upsertRoleJob(input: RoleJobInput): Promise<string>;
  /** Archives the post's role jobs whose `roleKey` is not in `keep`; returns how many. */
  abstract archiveRoleJobs(postJobId: string, keep: string[]): Promise<number>;
  /** Ids of the post's processed, active role jobs (what matching takes). */
  abstract listRoleJobIds(postJobId: string): Promise<string[]>;
  /** Non-eval post model calls (attempt rows) since `since`. */
  abstract postCallsSince(since: Date): Promise<number>;
}

type Raw = DatabaseTransaction['raw'];
type Json = JobExtractionRow['data'];

const TIMESTAMP = 'pg/timestamptz-date@1';
const UUID = 'pg/uuid@1';

type LinkedInJobIds = ReturnType<ReturnType<Raw['sql']>['returnsRow']>;

/**
 * Ids of jobs with a LinkedIn job board or Indeed source (the `PROCESSOR_CHANNELS`). Spliced into the statements
 * below as `id IN (…)`; the job's own columns are checked on the updated row
 * itself, so a concurrent change to them is seen (see `claim`).
 */
export function linkedInJobIds(raw: Raw): LinkedInJobIds {
  return raw.sql`SELECT s."jobId" FROM normalized_job_sources s JOIN raw_items r ON r.id = s."rawItemId" WHERE r.channel = ANY(${`{${PROCESSOR_CHANNELS.join(',')}}`}::text[])`.returnsRow(
    { jobId: UUID },
  );
}

/** A table alias: `j` or `normalized_jobs`. */
const ALIAS = /^[a-z_][a-z0-9_]*$/;

/** Splices fixed text (checked aliases) around `values`, which travel as fragments. */
function fragment(raw: Raw, parts: string[], ...values: unknown[]) {
  const strings = Object.assign([...parts], { raw: [...parts] });
  return (
    raw.sql as (
      s: TemplateStringsArray,
      ...v: unknown[]
    ) => ReturnType<Raw['sql']>
  )(strings, ...values).returns('pg/bool@1');
}

/**
 * The post half of the scope, on the job aliased `alias`: a `post` first seen
 * within 7 days, not silenced (checked after the window, so it runs only on
 * recent posts). The caller checks `status = 'active'`.
 */
export function postScopeSql(raw: Raw, alias: string) {
  if (!ALIAS.test(alias)) throw new Error(`Not a table alias: ${alias}`);
  const a = alias;
  return fragment(
    raw,
    [
      `(${a}.kind = 'post' AND ${a}."firstSeenAt" >= now() - interval '7 days' AND NOT `,
      `)`,
    ],
    silencedPostJobSql(raw, `${a}.id`),
  );
}

/**
 * True when the job aliased `alias` has a LinkedIn job board or Indeed source: the same
 * test as `id IN (linkedInJobIds)`, but correlated, so inside an OR it probes
 * that job's sources by index instead of hashing every LinkedIn source. The
 * processor's scope and the matcher's matchable test both use it.
 */
export function hasLinkedInSourceSql(raw: Raw, alias: string) {
  if (!ALIAS.test(alias)) throw new Error(`Not a table alias: ${alias}`);
  return fragment(
    raw,
    [
      `EXISTS (SELECT 1 FROM normalized_job_sources s JOIN raw_items r ON r.id = s."rawItemId" WHERE s."jobId" = ${alias}.id AND r.channel = ANY(`,
      `::text[]))`,
    ],
    `{${PROCESSOR_CHANNELS.join(',')}}`,
  );
}

/**
 * The processor's scope on the job aliased `alias`: a listing `job` with a
 * LinkedIn job board or Indeed source, or an in-window, unsilenced `post`. Never a
 * `post_role` job. The caller checks `status = 'active'`.
 */
export function processorScopeSql(raw: Raw, alias: string) {
  if (!ALIAS.test(alias)) throw new Error(`Not a table alias: ${alias}`);
  const a = alias;
  return fragment(
    raw,
    [`((${a}.kind = 'job' AND `, `) OR `, `)`],
    hasLinkedInSourceSql(raw, a),
    postScopeSql(raw, a),
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

  async listPendingPosts(limit: number): Promise<string[]> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`SELECT j.id FROM normalized_jobs j
        WHERE j."processingStatus" = 'pending' AND j.status = 'active'
          AND ${postScopeSql(raw, 'j')}
        ORDER BY j."firstSeenAt" DESC, j.id DESC
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
   * sees `processing`, and updates nothing. A job merged after listing, a
   * post that left the window, or one whose authors were silenced since,
   * fails the same row-level checks.
   */
  async claim(jobId: string): Promise<Claim | null> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`UPDATE normalized_jobs j SET
          "processingStatus" = 'processing',
          "processingAttempts" = "processingAttempts" + 1,
          "processingStartedAt" = now(),
          "processingRequestedAt" = COALESCE("processingRequestedAt", now()),
          "updatedAt" = now()
        WHERE j.id = ${jobId}::uuid
          AND j."processingStatus" = 'pending' AND j.status = 'active'
          AND ${processorScopeSql(raw, 'j')}
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
      // Role jobs are never claimed, so only `job` and `post` reach here.
      kind: row.kind === 'post' ? 'post' : 'job',
      postSources:
        (row.postSources as { sources: PostDetail[] } | null)?.sources ?? null,
    };
  }

  async findReusable(
    key: ReuseKey,
  ): Promise<{ id: string; jobId: string } | null> {
    const row = await this.db.orm.public.JobExtraction.where({
      docType: key.docType,
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
        WHERE e."docType" = ${key.docType}
          AND e."schemaVersion" = ${key.schemaVersion}
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

  async findExtraction(id: string): Promise<StoredExtraction | null> {
    const row = await this.db.orm.public.JobExtraction.where({ id }).first();
    if (!row) return null;
    return {
      id: row.id,
      jobId: row.jobId,
      docType: row.docType === 'post' ? 'post' : 'listing',
      inputHash: row.inputHash,
      schemaVersion: row.schemaVersion,
      promptHash: row.promptHash,
      extractionModel: row.extractionModel,
      data: row.data,
    };
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
    // finished the job; until then qualify reads this one. A job the
    // prefilter skipped meanwhile (released as stale, then checked) goes back
    // to `pending`: a job with an extraction is never `skipped`. One UPDATE,
    // so it cannot interleave with `markSkipped`: whichever commits first, the
    // other re-checks the row (READ COMMITTED) and either flips the skip back
    // or refuses a row that now holds an extraction.
    if (outcome.status === 'processed' && outcome.extractionId !== null) {
      const { raw } = this.db;
      await this.db.query(
        raw.sql`UPDATE normalized_jobs SET
            "currentExtractionId" = ${outcome.extractionId}::uuid,
            "processingRequestedAt" = CASE WHEN "processingStatus" = 'skipped'
              THEN now() ELSE "processingRequestedAt" END,
            "processingStatus" = CASE WHEN "processingStatus" = 'skipped'
              THEN 'pending' ELSE "processingStatus" END,
            "updatedAt" = now()
          WHERE id = ${claim.jobId}::uuid
            AND "processingStatus" IS DISTINCT FROM 'processed'
          RETURNING id`
          .returnsRow({ id: UUID })
          .build(),
      );
    }
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

  async spendSince(since: Date, docType?: DocType): Promise<number> {
    const result = await this.db.orm.public.ProcessingAttempt.where({
      eval: false,
      ...(docType ? { docType } : {}),
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
      raw.sql`SELECT EXISTS (SELECT 1 FROM normalized_jobs j
          WHERE j.id = ${jobId}::uuid AND j.status = 'active'
            AND ${processorScopeSql(raw, 'j')}) AS "inScope"`
        .returnsRow({ inScope: 'pg/bool@1' })
        .build(),
    );
    const extraction = job.currentExtractionId
      ? await orm.public.JobExtraction.where({
          id: job.currentExtractionId,
        }).first()
      : null;
    return {
      id: job.id,
      inScope: Boolean(scope?.inScope),
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
    // One row per (group, status); a post is in exactly one group.
    const rows = await this.db.query(
      raw.sql`SELECT g.grp, coalesce(g.status, 'unset') AS status, count(*)::int AS n
        FROM (
          SELECT 'listing' AS grp, j."processingStatus" AS status
            FROM normalized_jobs j
            WHERE j.status = 'active' AND j.kind = 'job'
              AND j.id IN (${linkedInJobIds(raw)})
          UNION ALL
          SELECT CASE
              WHEN j."firstSeenAt" < now() - interval '7 days' THEN 'outOfWindow'
              WHEN ${silencedPostJobSql(raw, 'j.id')} THEN 'silenced'
              ELSE 'post' END,
            j."processingStatus"
            FROM normalized_jobs j
            WHERE j.status = 'active' AND j.kind = 'post'
        ) g
        GROUP BY 1, 2`
        .returnsRow({ grp: 'pg/text@1', status: 'pg/text@1', n: 'pg/int4@1' })
        .build(),
    );
    const zero = (): Counts => ({
      pending: 0,
      processing: 0,
      processed: 0,
      failed: 0,
      archived: 0,
      skipped: 0,
      unset: 0,
    });
    const counts: ProcessingCounts = {
      listings: zero(),
      posts: { ...zero(), outOfWindow: 0, silenced: 0 },
    };
    for (const row of rows) {
      const n = row.n as number;
      const status = row.status as keyof Counts;
      if (row.grp === 'listing') counts.listings[status] = n;
      else if (row.grp === 'post') counts.posts[status] = n;
      // Held posts count only while they wait: `pending`.
      else if (status === 'pending')
        counts.posts[row.grp as 'outOfWindow' | 'silenced'] += n;
    }
    return counts;
  }

  async upsertRoleJob(input: RoleJobInput): Promise<string> {
    return inRetriedTransaction(this.database, async (tx) => {
      const jobs = tx.orm.public.NormalizedJob;
      const parent = await jobs
        .where({ id: input.postJobId })
        .forNoKeyUpdate()
        .first();
      if (!parent) throw new Error(`post job ${input.postJobId} not found`);
      const fields = {
        title: input.title,
        companyName: input.companyName,
        postingUrl: parent.postingUrl,
        postedAt: roleJobPostedAt(parent.postSources, parent.postedAt),
        firstSeenAt: parent.firstSeenAt,
        lastSeenAt: parent.lastSeenAt,
        descriptionText: parent.descriptionText,
        closed: parent.closed,
        status: 'active',
        processingStatus: 'processed',
        processingReason: null,
        processingError: null,
        processingStartedAt: null,
        processedAt: new Date(),
        currentExtractionId: input.extractionId,
        linkKeys: input.linkKeys,
      };
      const existing = await jobs
        .where({ parentJobId: input.postJobId, roleKey: input.roleKey })
        .first();
      if (existing) {
        await jobs.where({ id: existing.id }).updateAll(fields);
        return existing.id;
      }
      const created = await jobs.create({
        ...fields,
        jobKey: `${parent.jobKey}#role:${input.roleKey}`,
        kind: 'post_role',
        parentJobId: input.postJobId,
        roleKey: input.roleKey,
        mergedIntoId: null,
        fieldSources: {} as Json,
        normalizerVersion: parent.normalizerVersion,
      });
      return created.id;
    });
  }

  async archiveRoleJobs(postJobId: string, keep: string[]): Promise<number> {
    const { raw } = this.db;
    const rows = await this.db.query(
      raw.sql`UPDATE normalized_jobs SET "processingStatus" = 'archived', "updatedAt" = now()
        WHERE "parentJobId" = ${postJobId}::uuid AND kind = 'post_role'
          AND NOT coalesce("roleKey" = ANY(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(keep)}::jsonb))), false)
          AND "processingStatus" IS DISTINCT FROM 'archived'
        RETURNING id`
        .returnsRow({ id: UUID })
        .build(),
    );
    return rows.length;
  }

  async listRoleJobIds(postJobId: string): Promise<string[]> {
    const rows = await this.db.orm.public.NormalizedJob.where({
      parentJobId: postJobId,
      kind: 'post_role',
      processingStatus: 'processed',
      status: 'active',
    }).all();
    return rows.map((r) => r.id);
  }

  async postCallsSince(since: Date): Promise<number> {
    const { raw } = this.db;
    const [row] = await this.db.query(
      raw.sql`SELECT count(*)::int AS n FROM processing_attempts
        WHERE eval = false AND "docType" = 'post' AND "createdAt" >= ${since.toISOString()}::timestamptz`
        .returnsRow({ n: 'pg/int4@1' })
        .build(),
    );
    return (row?.n as number | undefined) ?? 0;
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
      const scope = () => processorScopeSql(raw, 'j');
      // Archived jobs are never touched, nor skipped ones by `allInScope`;
      // count the ones a selector would have matched. A skipped job was never
      // processed: the prefilter's recheck sends it back, or `jobIds` (the
      // operator's run of one job) on purpose.
      const left = { archived: 0, skipped: 0 };
      const countLeft = async (plan: Parameters<typeof tx.query>[0]) => {
        for (const row of await tx.query(plan))
          left[(row as { status: 'archived' | 'skipped' }).status]++;
      };
      if (filter.allInScope)
        await countLeft(
          raw.sql`SELECT j.id, j."processingStatus" AS status FROM normalized_jobs j
            WHERE j.status = 'active' AND ${scope()}
              AND "processingStatus" IN ('archived', 'skipped')`
            .returnsRow({ id: UUID, status: 'pg/text@1' })
            .build(),
        );
      else
        for (const jobId of new Set(filter.jobIds ?? []))
          await countLeft(
            raw.sql`SELECT j.id, j."processingStatus" AS status FROM normalized_jobs j
              WHERE j.status = 'active' AND ${scope()}
                AND "processingStatus" = 'archived' AND id = ${jobId}::uuid`
              .returnsRow({ id: UUID, status: 'pg/text@1' })
              .build(),
          );
      // Every statement: in scope (see `processorScopeSql`), then the selector.
      if (filter.allInScope)
        await run(
          raw.sql`UPDATE normalized_jobs j SET ${pendingColumns(raw)}
            WHERE j.status = 'active' AND ${scope()}
              AND "processingStatus" IS DISTINCT FROM 'archived'
              AND "processingStatus" IS DISTINCT FROM 'skipped'
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
      if (filter.nullStatus)
        await run(
          raw.sql`UPDATE normalized_jobs j SET ${pendingColumns(raw)}
            WHERE j.status = 'active' AND ${scope()}
              AND "processingStatus" IS NULL
              AND "processingStatus" IS DISTINCT FROM 'archived'
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
      if (filter.failed)
        await run(
          raw.sql`UPDATE normalized_jobs j SET ${pendingColumns(raw)}
            WHERE j.status = 'active' AND ${scope()}
              AND "processingStatus" = 'failed'
              AND "processingStatus" IS DISTINCT FROM 'archived'
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
      if (filter.matched)
        await run(
          raw.sql`UPDATE normalized_jobs j SET ${pendingColumns(raw)}
            WHERE j.status = 'active' AND ${scope()}
              AND "processingStatus" IS DISTINCT FROM 'archived'
              AND "processingStatus" IS DISTINCT FROM 'skipped'
              AND EXISTS (
                SELECT 1 FROM job_matches m
                WHERE m."jobId" = j.id
                  AND m."extractionId" = j."currentExtractionId"
                  AND m."matcherVersion" >= ${MATCHER_VERSION}::int
                  AND m.outcome IN ('qualified', 'review'))
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
      for (const jobId of new Set(filter.jobIds ?? []))
        await run(
          raw.sql`UPDATE normalized_jobs j SET ${pendingColumns(raw)}
            WHERE j.status = 'active' AND ${scope()}
              AND id = ${jobId}::uuid
              AND "processingStatus" IS DISTINCT FROM 'archived'
            RETURNING id`
            .returnsRow({ id: UUID })
            .build(),
        );
      return {
        marked: touched.size,
        skippedArchived: left.archived,
        leftSkipped: left.skipped,
      };
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
