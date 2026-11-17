#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/6445f1a93dc43f67978d3e8df96ba5087d849227003d05e95a754d8d62b6d06f/contract';
import endContract from '../../snapshots/6445f1a93dc43f67978d3e8df96ba5087d849227003d05e95a754d8d62b6d06f/contract.json' with { type: 'json' };
import startContract from '../../snapshots/6445f1a93dc43f67978d3e8df96ba5087d849227003d05e95a754d8d62b6d06f/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the `job-postings`
// invariant in ../refs/db.json decides whether it runs on a fresh database. Advancing the `db`
// ref writes `invariants: []`; re-add it, and keep the earlier ones.
// job_postings(p_job_id) lists a job's postings (one row per normalized_job_sources link) for
// the job page: each posting's own title, place, posted time and URL from its normalized
// record, its channel, whether it is the posting the job shows (the source of the job's
// title), and whether its title, place (location, countryCode or city) or description differs
// from the job's. Descriptions compare with whitespace runs folded to one space and trimmed;
// two missing descriptions are the same.
// - Rows only when the caller has a job_matches or a job_decisions row on the job (read once
//   per call as `(SELECT auth.uid())`); otherwise none, not an error. A null uid matches none.
// - Ordered: the shown posting first, then by posted time (unknown last), then raw item id.

// A description with whitespace runs folded to one space, trimmed.
const folded = (expr: string) =>
  `pg_catalog.btrim(pg_catalog.regexp_replace(${expr}, '\\s+', ' ', 'g'))`;

const jobPostings = `CREATE FUNCTION public.job_postings(p_job_id uuid)
RETURNS TABLE(
  "rawItemId" uuid, channel text, title text, location text,
  "postedAt" timestamptz, "postingUrl" text, shown boolean,
  "titleDiffers" boolean, "placeDiffers" boolean, "descriptionDiffers" boolean
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT
  p."rawItemId", p.channel, p.title, p.location, p."postedAt", p."postingUrl", p.shown,
  p."titleDiffers", p."placeDiffers", p."descriptionDiffers"
FROM (
  SELECT
    s."rawItemId",
    r.channel::text AS channel,
    v.record->>'title' AS title,
    v.record->>'location' AS location,
    (v.record->>'postedAt')::timestamptz AS "postedAt",
    v.record->>'postingUrl' AS "postingUrl",
    -- The posting the job's title came from is the one the job shows.
    COALESCE(s."rawItemId"::text = j."fieldSources"->>'title', false) AS shown,
    (v.record->>'title') IS DISTINCT FROM j.title AS "titleDiffers",
    (v.record->>'location') IS DISTINCT FROM j.location
      OR (v.record->>'countryCode') IS DISTINCT FROM j."countryCode"
      OR (v.record->>'city') IS DISTINCT FROM j.city AS "placeDiffers",
    ${folded(`v.record->>'descriptionText'`)}
      IS DISTINCT FROM ${folded('j."descriptionText"')} AS "descriptionDiffers"
  FROM public.normalized_jobs j
  JOIN public.normalized_job_sources s ON s."jobId" = j.id
  JOIN public.raw_items r ON r.id = s."rawItemId"
  JOIN public.normalized_versions v ON v.id = s."normalizedVersionId"
  WHERE j.id = p_job_id
    -- Only a job the caller has a match or a decision on; a null uid matches none.
    AND (EXISTS (
          SELECT 1 FROM public.job_matches m
           WHERE m."jobId" = p_job_id AND m."userId" = (SELECT auth.uid()))
      OR EXISTS (
          SELECT 1 FROM public.job_decisions d
           WHERE d."jobId" = p_job_id AND d."userId" = (SELECT auth.uid())))
) p
ORDER BY p.shown DESC, p."postedAt" ASC NULLS LAST, p."rawItemId"
$$;
REVOKE EXECUTE ON FUNCTION public.job_postings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_postings(uuid) TO authenticated;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'functions.job_postings',
        invariantId: 'job-postings',
        label: "job_postings: a job's postings and what differs from the job",
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'normalized_job_sources',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'create job_postings(p_job_id) for authenticated',
            sql: jobPostings,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
