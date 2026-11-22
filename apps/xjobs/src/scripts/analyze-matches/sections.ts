import type { createDatabaseClient } from 'src/database';
import { postExtractionSql, shapePostExtraction } from './post-extraction';

type Db = ReturnType<typeof createDatabaseClient>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Raw = Tx['raw'];

/**
 * Each query returns its rows as one jsonb array in `rows`. Sections 5 to 8
 * judge listing extractions: they read only listing rows (`docType`) of
 * job-board jobs (`kind = 'job'`), never post rows or post role jobs.
 */
export const SECTIONS: {
  title: string;
  sql: (raw: Raw) => ReturnType<Raw['sql']>;
  /** Turns the query's rows into the printed rows (default: print as they are). */
  shape?: (
    rows: Record<string, unknown>[],
    now: Date,
  ) => Record<string, unknown>[];
}[] = [
  {
    title: '0. Database contents',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT current_database() AS db,
          (SELECT count(*) FROM normalized_jobs) AS jobs,
          (SELECT count(*) FROM job_extractions) AS extractions,
          (SELECT count(*) FROM job_matches) AS matches,
          (SELECT count(*) FROM profiles) AS profiles) t`,
  },
  {
    title: '1. Jobs by processing status',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT kind, status, "processingStatus", count(*) FROM normalized_jobs
        GROUP BY 1, 2, 3 ORDER BY 4 DESC) t`,
  },
  {
    title: '2. Match outcomes',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT outcome, unverified, count(*) FROM job_matches
        GROUP BY 1, 2 ORDER BY 1, 2) t`,
  },
  {
    title:
      '3. Qualified matches by check pattern (position / seniority / location / stack)',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT (SELECT string_agg(c->>'outcome', ' / ' ORDER BY o)
                  FROM jsonb_array_elements(checks) WITH ORDINALITY x(c, o)) AS pattern,
          count(*)
        FROM job_matches WHERE outcome = 'qualified'
        GROUP BY 1 ORDER BY 2 DESC) t`,
  },
  {
    title: '4. Check reasons by rule and outcome',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT c->>'rule' AS rule, c->>'outcome' AS outcome,
          left(regexp_replace(c->>'reason', '[:;].*$', ''), 70) AS reason, count(*)
        FROM job_matches, jsonb_array_elements(checks) c
        GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC) t`,
  },
  {
    title: '5. Current extractions: roleKind and isSoftwareEngineeringRole',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT coalesce(e."roleKind", '<null>') AS role_kind,
          e."isSoftwareEngineeringRole" AS is_swe, count(*)
        FROM job_extractions e JOIN normalized_jobs j ON j."currentExtractionId" = e.id
        WHERE e.data <> '{}'::jsonb AND e."docType" = 'listing' AND j.kind = 'job'
        GROUP BY 1, 2 ORDER BY 3 DESC) t`,
  },
  {
    title: '6. Position fact: value, decidedBy, confidence, empty quote',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT coalesce(e.data->'position'->'value'->>'roleKind', '<null>') AS role_kind,
          e.data->'position'->>'decidedBy' AS decided_by,
          e.data->'position'->>'confidence' AS confidence,
          (e.data->'position'->>'quote' = '') AS empty_quote,
          count(*)
        FROM job_extractions e JOIN normalized_jobs j ON j."currentExtractionId" = e.id
        WHERE e.data <> '{}'::jsonb AND e."docType" = 'listing' AND j.kind = 'job'
        GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC) t`,
  },
  {
    title:
      '7. Tech requirement shape (no main/must means the stack check is always unknown)',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        WITH r AS (
          SELECT e.id,
            count(*) FILTER (WHERE q->>'kind' = 'main') AS main,
            count(*) FILTER (WHERE q->>'kind' = 'must') AS must,
            count(*) FILTER (WHERE q IS NOT NULL AND q->'technology'->>'code' IS NULL) AS uncoded,
            count(q) AS total
          FROM job_extractions e
          JOIN normalized_jobs j ON j."currentExtractionId" = e.id
          LEFT JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(e.data->'techStack'->'value'->'requirements') = 'array'
                 THEN e.data->'techStack'->'value'->'requirements' ELSE '[]'::jsonb END) q ON true
          WHERE e.data <> '{}'::jsonb AND e."docType" = 'listing' AND j.kind = 'job'
          GROUP BY e.id)
        SELECT CASE WHEN total = 0 THEN 'no requirements'
                    WHEN main + must = 0 THEN 'only nice'
                    WHEN main = 0 THEN 'must but no main'
                    ELSE 'has main' END AS shape,
          count(*), round(avg(total), 1) AS avg_reqs, round(avg(uncoded), 1) AS avg_uncoded
        FROM r GROUP BY 1 ORDER BY 2 DESC) t`,
  },
  {
    title: '8. Uncoded technologies seen most often (vocabulary gaps)',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT q->'technology'->>'text' AS text, q->>'kind' AS kind, count(*)
        FROM job_extractions e
        JOIN normalized_jobs j ON j."currentExtractionId" = e.id,
          jsonb_array_elements(
            CASE WHEN jsonb_typeof(e.data->'techStack'->'value'->'requirements') = 'array'
                 THEN e.data->'techStack'->'value'->'requirements' ELSE '[]'::jsonb END) q
        WHERE q->'technology'->>'code' IS NULL
          AND e."docType" = 'listing' AND j.kind = 'job'
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30) t`,
  },
  {
    title: '9. Qualified matches with BOTH position and stack unknown',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT j.id, left(j.title, 50) AS title, left(j."companyName", 25) AS company,
          length(j."descriptionText") AS desc_len,
          e.data->'isSoftwareEngineeringRole'->>'value' AS is_swe,
          e."needsReview" AS needs_review
        FROM job_matches m
        JOIN normalized_jobs j ON j.id = m."jobId"
        JOIN job_extractions e ON e.id = m."extractionId"
        WHERE m.outcome = 'qualified'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.checks) c
                      WHERE c->>'rule' = 'position' AND c->>'outcome' = 'unknown')
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.checks) c
                      WHERE c->>'rule' = 'stack' AND c->>'outcome' = 'unknown')
        ORDER BY m."decidedAt" DESC LIMIT 40) t`,
  },
  {
    title: '10. Processing attempts by step and outcome',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT step, outcome, count(*),
          round(avg("quoteFailures"), 2) AS avg_quote_failures,
          round(sum("costUsd"), 4) AS cost_usd
        FROM processing_attempts WHERE NOT eval
        GROUP BY 1, 2 ORDER BY 1, 2) t`,
  },
  {
    title: '11. Most common processing errors',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT step, left(error, 110) AS error, count(*)
        FROM processing_attempts WHERE NOT eval AND error IS NOT NULL
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15) t`,
  },
  {
    title: '12. "Not for me" reasons (last 30 days)',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t ORDER BY t.jobs DESC, t.reason), '[]'::jsonb) AS rows FROM (
        WITH rule_map(reason, rules) AS (VALUES
          ('role', ARRAY['position']),
          ('seniority', ARRAY['seniority']),
          ('location', ARRAY['location']),
          ('stack', ARRAY['stack']),
          ('salary', ARRAY['salary', 'currency']),
          ('contract', ARRAY['contractType']),
          ('languages', ARRAY['languages', 'postingLanguage']),
          ('work_authorization', ARRAY['workAuthorization'])),
        decisions AS (
          SELECT d.id, coalesce(d.reason, 'none') AS reason, m.rules,
            coalesce(jsonb_typeof(d."matchSnapshot") = 'array'
              AND jsonb_array_length(d."matchSnapshot") > 0, false) AS has_snapshot
          FROM job_decisions d LEFT JOIN rule_map m ON m.reason = d.reason
          WHERE d.status = 'dismissed' AND d."decidedAt" > now() - interval '30 days'),
        seen AS (
          SELECT d.id,
            bool_or(c->>'outcome' = 'unknown') AS is_unknown,
            bool_or(c->>'outcome' = 'pass') AS is_pass
          FROM decisions d
          JOIN job_decisions j ON j.id = d.id
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN d.has_snapshot THEN j."matchSnapshot" ELSE '[]'::jsonb END) e
          CROSS JOIN LATERAL jsonb_array_elements(coalesce(e->'checks', '[]'::jsonb)) c
          -- Entries that reached the user's Matches: qualified, or review moved there.
          WHERE d.rules IS NOT NULL AND e->>'outcome' IN ('qualified', 'review')
            AND c->>'rule' = ANY (d.rules)
          GROUP BY d.id)
        SELECT d.reason, count(*) AS jobs,
          CASE WHEN d.rules IS NULL THEN NULL
            ELSE count(*) FILTER (WHERE s.is_unknown) END AS "unknownOnRule",
          CASE WHEN d.rules IS NULL THEN NULL
            ELSE count(*) FILTER (WHERE s.is_pass) END AS "passOnRule",
          count(*) FILTER (WHERE NOT d.has_snapshot) AS "noSnapshot"
        FROM decisions d LEFT JOIN seen s ON s.id = d.id
        GROUP BY d.reason, d.rules) t`,
  },
  {
    title:
      '13. Post extraction per UTC day (last 7 days; left_window_pending is the current state)',
    sql: postExtractionSql,
    shape: (rows, now) =>
      shapePostExtraction(rows as never, now).map((r) => ({ ...r })),
  },
];
