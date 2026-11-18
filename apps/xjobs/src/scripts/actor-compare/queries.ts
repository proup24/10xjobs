/**
 * The read-only queries behind `db:actor-compare`. Credit is by
 * `collection_batches.actor` (a run with no batch by its channel's actor); the
 * aggregation is in ./report.
 */
import type { DatabaseTransaction } from '@xjobs/database';
import { channelJobsConfig } from 'src/infrastructure/jobs/steps/collect/config';
import {
  linkedinGroupKey,
  mergedLinkedinKeyword,
} from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';
import { MATCHER_VERSION } from 'src/modules/matcher/config/matcher.config';
import {
  HARVEST_ACTOR,
  runActor,
  type BuilderRow,
  type JobOutcome,
  type RunRow,
  type Sighting,
} from './report';

const JSONB = 'pg/jsonb@1';

type Tx = Pick<DatabaseTransaction, 'query' | 'raw'>;

/** The location suffix LinkedIn appends: `<keyword> - <location>`. */
function stripLocation(searchString: string): string {
  const i = searchString.lastIndexOf(' - ');
  return i === -1 ? searchString : searchString.slice(0, i);
}

/** The report's start; null when no `--since`/`--days` and no trial batch yet. */
export async function resolveSince(
  tx: Tx,
  args: { since?: Date; days?: number },
): Promise<Date | null> {
  if (args.since) return args.since;
  if (args.days) return new Date(Date.now() - args.days * 86_400_000);
  const [row] = await tx.query(
    tx.raw.sql`SELECT min(b."observedAt") AS first
      FROM collection_batches b
      WHERE b.actor <> ${HARVEST_ACTOR}::text
        AND b.channel::text IN ('LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY')`
      .returnsRow({ first: 'pg/timestamptz-date@1' })
      .build(),
  );
  return (row?.first as Date | null) ?? null;
}

export async function loadSightings(
  tx: Tx,
  since: string,
): Promise<Sighting[]> {
  const [row] = await tx.query(
    tx.raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
      SELECT coalesce(j."mergedIntoId", j.id)::text AS "jobId", b.actor,
        b."segmentRunId"::text AS "runId",
        s."observedAt" AS "seenAt",
        q.params->>'workType' AS "filterWorkType",
        nv.record->>'workplaceType' AS "itemWorkplaceType"
      FROM raw_item_sightings s
      JOIN collection_batches b ON b.id = s."batchId"
      JOIN normalized_job_sources njs ON njs."rawItemId" = s."rawItemId"
      JOIN normalized_jobs j ON j.id = njs."jobId"
      LEFT JOIN query_search_builder q ON q.id = s."queryId"
      LEFT JOIN LATERAL (
        SELECT v.record FROM normalized_versions v
        WHERE v."rawVersionId" = s."versionId" AND v.status = 'valid'
        ORDER BY v."normalizerVersion" DESC LIMIT 1) nv ON true
      WHERE s."observedAt" >= ${since}::timestamptz
        AND b.channel::text IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY')) t`
      .returnsRow({ rows: JSONB })
      .build(),
  );
  return (
    (row?.rows ?? []) as (Omit<Sighting, 'seenAt'> & { seenAt: string })[]
  ).map((r) => ({ ...r, seenAt: new Date(r.seenAt) }));
}

export async function loadOutcomes(
  tx: Tx,
  since: string,
): Promise<JobOutcome[]> {
  const [row] = await tx.query(
    tx.raw.sql`WITH seen AS (
        SELECT DISTINCT coalesce(j."mergedIntoId", j.id) AS id
        FROM raw_item_sightings s
        JOIN collection_batches b ON b.id = s."batchId"
        JOIN normalized_job_sources njs ON njs."rawItemId" = s."rawItemId"
        JOIN normalized_jobs j ON j.id = njs."jobId"
        WHERE s."observedAt" >= ${since}::timestamptz
          AND b.channel::text IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY'))
      SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT j.id::text AS "jobId",
          (SELECT m.outcome FROM job_matches m
            WHERE m."jobId" = j.id AND m."matcherVersion" >= ${MATCHER_VERSION}::int
            ORDER BY CASE m.outcome WHEN 'qualified' THEN 0 WHEN 'review' THEN 1 ELSE 2 END
            LIMIT 1) AS outcome,
          (SELECT c->>'rule' FROM job_matches m,
              jsonb_array_elements(m.checks) WITH ORDINALITY AS e(c, n)
            WHERE m."jobId" = j.id AND m."matcherVersion" >= ${MATCHER_VERSION}::int
              AND m.outcome = 'rejected' AND c->>'outcome' = 'fail'
            ORDER BY m."decidedAt" DESC, e.n LIMIT 1) AS "firstFailRule",
          (SELECT count(*)::int FROM job_decisions d
            WHERE d."jobId" = j.id AND d.status = 'applied') AS applied,
          (SELECT count(*)::int FROM job_decisions d
            WHERE d."jobId" = j.id AND d.status = 'dismissed') AS dismissed,
          j."workplaceType" IS NOT NULL AS "workplaceType",
          (j."countryCode" IS NOT NULL OR j.city IS NOT NULL OR j."geoId" IS NOT NULL) AS place,
          (j."salaryMin" IS NOT NULL OR j."salaryMax" IS NOT NULL OR j."salaryText" IS NOT NULL) AS salary,
          j."applyUrl" IS NOT NULL AS "applyLink",
          j."processingReason" = 'joined' AS joined,
          CASE WHEN j."processingReason" = 'joined' AND j."currentExtractionId" IS NOT NULL
            THEN NOT EXISTS (
              SELECT 1 FROM processing_attempts a
              WHERE a."jobId" = j.id AND NOT a.eval
                AND a.step IN ('extraction', 'extraction_retry')
                -- A same-key join keeps the trial's job, with the trial's own
                -- earlier attempt on it: only attempts since the join count.
                AND a."createdAt" >= j."processingRequestedAt")
            END AS "joinedReused"
        FROM normalized_jobs j JOIN seen ON seen.id = j.id) t`
      .returnsRow({ rows: JSONB })
      .build(),
  );
  return (row?.rows ?? []) as unknown as JobOutcome[];
}

/** The merged keyword the run sent; null for members from before role words were recorded. */
function sentKeyword(members: { [key: string]: unknown }[]): string | null {
  if (members.length === 0) return null;
  try {
    return mergedLinkedinKeyword(
      members.map((params) => ({ params: params as Record<string, unknown> })),
    );
  } catch {
    return null;
  }
}

/**
 * Every run of the compared channels since `since`, with or without a batch
 * (a run that failed or never started has none). Costs are as stored: the
 * collection service has already re-read Apify's final cost.
 */
export async function loadSegmentRuns(
  tx: Tx,
  since: string,
): Promise<RunRow[]> {
  const [row] = await tx.query(
    tx.raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
      SELECT r.id::text AS "runId", b.actor AS "batchActor",
        r.channel::text AS channel, r."startedAt", r.status, r.capped,
        r.fetched AS rows, r."costMicroUsd",
        r."queryIds"::text[] AS "queryIds",
        r."truncatedQueryIds"::text[] AS "truncatedQueryIds",
        (SELECT coalesce(jsonb_agg(q.params), '[]'::jsonb)
          FROM query_search_builder q WHERE q.id = ANY(r."queryIds")) AS members,
        (SELECT coalesce(jsonb_agg(DISTINCT v.payload->>'searchString'), '[]'::jsonb)
          FROM raw_item_sightings s
          JOIN raw_item_versions v ON v.id = s."versionId"
          WHERE s."batchId" = b.id AND v.payload->>'searchString' IS NOT NULL) AS echoed
      FROM search_segment_runs r
      LEFT JOIN collection_batches b ON b."segmentRunId" = r.id
      WHERE r."startedAt" >= ${since}::timestamptz
        AND r.channel::text IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY')) t`
      .returnsRow({ rows: JSONB })
      .build(),
  );
  type Raw = {
    runId: string;
    batchActor: string | null;
    channel: string;
    startedAt: string;
    status: string;
    capped: boolean;
    rows: number;
    costMicroUsd: number | null;
    queryIds: string[];
    truncatedQueryIds: string[];
    members: { [key: string]: unknown }[];
    echoed: string[];
  };
  return ((row?.rows ?? []) as Raw[]).map((r) => {
    const actor = runActor(r.batchActor, r.channel);
    return {
      runId: r.runId,
      actor,
      channel: r.channel,
      startedAt: new Date(r.startedAt),
      status: r.status,
      capped: r.capped,
      costMicroUsd: r.costMicroUsd,
      queryIds: r.queryIds,
      truncatedQueryIds: r.truncatedQueryIds,
      atCeiling: r.rows >= ceilingRows(r.channel),
      rows: r.rows,
      sentKeyword: actor === HARVEST_ACTOR ? null : sentKeyword(r.members),
      echoedKeywords: [...new Set(r.echoed.map(stripLocation))],
    };
  });
}

/**
 * The channel's `maxRowsCeiling`. A run row stores what it fetched, not the
 * rows it asked for; a run held for splitting asks `maxRowsPerSearch`, far
 * below the ceiling, so only a ceiling run can fetch this many.
 */
function ceilingRows(channel: string): number {
  const config = (
    channelJobsConfig as Record<
      string,
      { run?: { maxRowsCeiling?: number } } | undefined
    >
  )[channel];
  return config?.run?.maxRowsCeiling ?? Number.POSITIVE_INFINITY;
}

/**
 * The collected builders (active, not deleted) of the compared channels, with
 * their group: the segment key without its channel (`<type>|group:<place and
 * filters>`), so twins on every channel share it.
 */
export async function loadBuilders(tx: Tx): Promise<BuilderRow[]> {
  const [row] = await tx.query(
    tx.raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
      SELECT q.id::text AS id, q.channel::text AS channel, q.type::text AS type,
        q.params
      FROM query_search_builder q
      WHERE q."isActive" AND NOT q."isDeleted"
        AND q.channel::text IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY')) t`
      .returnsRow({ rows: JSONB })
      .build(),
  );
  type Raw = {
    id: string;
    channel: string;
    type: string;
    params: Record<string, unknown> | null;
  };
  return ((row?.rows ?? []) as Raw[]).map((b) => ({
    id: b.id,
    channel: b.channel,
    group: builderGroup(b.type, b.id, b.params ?? {}),
  }));
}

/** As `segmentKey` without `<channel>|`: an unresolved place is a group of its own. */
function builderGroup(
  type: string,
  id: string,
  params: Record<string, unknown>,
): string {
  try {
    return `${type}|group:${linkedinGroupKey(params)}`;
  } catch {
    return `${type}|unresolved:${id}`;
  }
}
