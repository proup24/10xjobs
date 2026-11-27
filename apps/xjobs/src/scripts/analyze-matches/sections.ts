import type { createDatabaseClient } from 'src/database';
import { skippableListingSql } from '../skip-share';
import { postExtractionSql, shapePostExtraction } from './post-extraction';

type Db = ReturnType<typeof createDatabaseClient>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Raw = Tx['raw'];

/**
 * Each query returns its rows as one jsonb array in `rows`. Section 0 counts
 * every row and section 1 splits jobs by kind. Sections 2 to 4 and 9 judge
 * matches of job-board jobs and post roles (`kind IN ('job', 'post_role')`),
 * and sections 5 to 8 judge their listing extractions (`docType`); each splits
 * its rows by `kind`, so listings and post roles are never mixed in a count.
 * Post rows (`kind = 'post'`) belong to section 13.
 * Section 15 reads the turn record of listing and post calls alike.
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
    title: '2. Match outcomes (listings and post roles)',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT j.kind, m.outcome, m.unverified, count(*)
        FROM job_matches m JOIN normalized_jobs j ON j.id = m."jobId"
        WHERE j.kind IN ('job', 'post_role')
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3) t`,
  },
  {
    title:
      '3. Qualified matches by check pattern (position / seniority / location / stack)',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT j.kind, (SELECT string_agg(c->>'outcome', ' / ' ORDER BY o)
                  FROM jsonb_array_elements(m.checks) WITH ORDINALITY x(c, o)) AS pattern,
          count(*)
        FROM job_matches m JOIN normalized_jobs j ON j.id = m."jobId"
        WHERE m.outcome = 'qualified' AND j.kind IN ('job', 'post_role')
        GROUP BY 1, 2 ORDER BY 1, 3 DESC) t`,
  },
  {
    title: '4. Check reasons by rule and outcome',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT j.kind, c->>'rule' AS rule, c->>'outcome' AS outcome,
          left(regexp_replace(c->>'reason', '[:;].*$', ''), 70) AS reason, count(*)
        FROM job_matches m JOIN normalized_jobs j ON j.id = m."jobId",
          jsonb_array_elements(m.checks) c
        WHERE j.kind IN ('job', 'post_role')
        GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 5 DESC) t`,
  },
  {
    title: '5. Current extractions: roleKind and isSoftwareEngineeringRole',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT j.kind, coalesce(e."roleKind", '<null>') AS role_kind,
          e."isSoftwareEngineeringRole" AS is_swe, count(*)
        FROM job_extractions e JOIN normalized_jobs j ON j."currentExtractionId" = e.id
        WHERE e.data <> '{}'::jsonb AND e."docType" = 'listing' AND j.kind IN ('job', 'post_role')
        GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC) t`,
  },
  {
    title: '6. Position fact: value, decidedBy, confidence, empty quote',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT j.kind, coalesce(e.data->'position'->'value'->>'roleKind', '<null>') AS role_kind,
          e.data->'position'->>'decidedBy' AS decided_by,
          e.data->'position'->>'confidence' AS confidence,
          (e.data->'position'->>'quote' = '') AS empty_quote,
          count(*)
        FROM job_extractions e JOIN normalized_jobs j ON j."currentExtractionId" = e.id
        WHERE e.data <> '{}'::jsonb AND e."docType" = 'listing' AND j.kind IN ('job', 'post_role')
        GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 6 DESC) t`,
  },
  {
    title:
      '7. Tech requirement shape (no main/must means the stack check is always unknown)',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        WITH r AS (
          SELECT e.id, j.kind AS job_kind,
            count(*) FILTER (WHERE q->>'kind' = 'main') AS main,
            count(*) FILTER (WHERE q->>'kind' = 'must') AS must,
            count(*) FILTER (WHERE q IS NOT NULL AND q->'technology'->>'code' IS NULL) AS uncoded,
            count(q) AS total
          FROM job_extractions e
          JOIN normalized_jobs j ON j."currentExtractionId" = e.id
          LEFT JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(e.data->'techStack'->'value'->'requirements') = 'array'
                 THEN e.data->'techStack'->'value'->'requirements' ELSE '[]'::jsonb END) q ON true
          WHERE e.data <> '{}'::jsonb AND e."docType" = 'listing' AND j.kind IN ('job', 'post_role')
          GROUP BY e.id, j.kind)
        SELECT job_kind AS kind,
          CASE WHEN total = 0 THEN 'no requirements'
                    WHEN main + must = 0 THEN 'only nice'
                    WHEN main = 0 THEN 'must but no main'
                    ELSE 'has main' END AS shape,
          count(*), round(avg(total), 1) AS avg_reqs, round(avg(uncoded), 1) AS avg_uncoded
        FROM r GROUP BY 1, 2 ORDER BY 1, 3 DESC) t`,
  },
  {
    title: '8. Uncoded technologies seen most often (vocabulary gaps)',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT j.kind AS job_kind, q->'technology'->>'text' AS text, q->>'kind' AS kind, count(*)
        FROM job_extractions e
        JOIN normalized_jobs j ON j."currentExtractionId" = e.id,
          jsonb_array_elements(
            CASE WHEN jsonb_typeof(e.data->'techStack'->'value'->'requirements') = 'array'
                 THEN e.data->'techStack'->'value'->'requirements' ELSE '[]'::jsonb END) q
        WHERE q->'technology'->>'code' IS NULL
          AND e."docType" = 'listing' AND j.kind IN ('job', 'post_role')
        GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 30) t`,
  },
  {
    title: '9. Qualified matches with BOTH position and stack unknown',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        SELECT j.kind, j.id, left(j.title, 50) AS title, left(j."companyName", 25) AS company,
          length(j."descriptionText") AS desc_len,
          e.data->'isSoftwareEngineeringRole'->>'value' AS is_swe,
          e."needsReview" AS needs_review
        FROM job_matches m
        JOIN normalized_jobs j ON j.id = m."jobId"
        JOIN job_extractions e ON e.id = m."extractionId"
        WHERE m.outcome = 'qualified' AND j.kind IN ('job', 'post_role')
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
  {
    // New listings = active LinkedIn job board listings (the processor's
    // scope; ATS and merged rows are never skipped) first seen in the last 7
    // days; skipped =
    // those whose current status is 'skipped' (the pre-LLM check). The sample
    // is random, so it differs on every run.
    title:
      '14. Skipped before processing (last 7 days; new LinkedIn listings first seen in the window)',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(t), '[]'::jsonb) AS rows FROM (
        WITH new_listings AS (
          SELECT id, title, "processingStatus", "processingSkip"
          FROM normalized_jobs
          WHERE ${skippableListingSql(raw)}
            AND "firstSeenAt" >= now() - interval '7 days'),
        skipped AS (
          SELECT * FROM new_listings WHERE "processingStatus" = 'skipped')
        SELECT 'by_tag_country' AS part, "processingSkip"->>'tag' AS tag,
          "processingSkip"->>'country' AS country, NULL::text AS title,
          count(*)::int AS count, NULL::numeric AS share
        FROM skipped GROUP BY 2, 3
        UNION ALL
        SELECT 'share', NULL, NULL, NULL,
          (SELECT count(*)::int FROM skipped),
          round((SELECT count(*) FROM skipped)::numeric
            / nullif((SELECT count(*) FROM new_listings), 0), 3)
        UNION ALL
        SELECT 'sample', "processingSkip"->>'tag', "processingSkip"->>'country',
          title, NULL, NULL
        FROM (SELECT * FROM skipped ORDER BY random() LIMIT 20) s) t`,
  },
  {
    // Calls that carry a turn record (`processing_attempts.turns`, from
    // slice 03 task 12): how many model requests each needed, and what the
    // calls with a repeat did. A text reply plus a nudge points at the prompt
    // (the model wrote the JSON as text); a rejection names the field the
    // CLI's schema check refused. Rejection texts are counted with their
    // prefix dropped and array indices folded to N.
    title:
      '15. Claude call requests (last 7 days; calls with a turn record): requests per call, what repeats did, max turns, top rejections',
    sql: (
      raw,
    ) => raw.sql`SELECT coalesce(jsonb_agg(to_jsonb(t) - 'p' - 'o'
          ORDER BY t.p, t.kind, t.o, t.count DESC, t.key), '[]'::jsonb) AS rows FROM (
        WITH a AS (
          SELECT "docType" AS kind, turns,
            least(coalesce((turns->>'requests')::int, 0), 3) AS requests
          FROM processing_attempts
          WHERE NOT eval AND turns IS NOT NULL
            AND "createdAt" >= now() - interval '7 days'),
        totals AS (SELECT kind, count(*) AS n FROM a GROUP BY kind),
        multi AS (
          SELECT kind, count(*) AS n,
            count(*) FILTER (WHERE (turns->>'textReplies')::int > 0) AS text,
            count(*) FILTER (WHERE (turns->>'enforceNudges')::int > 0) AS nudged,
            count(*) FILTER (WHERE jsonb_array_length(coalesce(turns->'rejections', '[]'::jsonb)) > 0) AS rejected
          FROM a WHERE requests >= 2 GROUP BY kind),
        rejection AS (
          SELECT left(regexp_replace(
              regexp_replace(r, '^Output does not match required schema: ', ''),
              '/[0-9]+(?=/|:|[[:space:]]|$)', '/N', 'g'), 160) AS key
          FROM a, jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(turns->'rejections') = 'array'
                 THEN turns->'rejections' ELSE '[]'::jsonb END) r)
        SELECT 1 AS p, 'requests' AS part, a.kind, a.requests AS o,
          a.requests::text AS key, count(*)::int AS count,
          round(count(*)::numeric / t.n, 3) AS share
        FROM a JOIN totals t USING (kind) GROUP BY a.kind, a.requests, t.n
        UNION ALL
        SELECT 2, 'multi', m.kind, v.o, v.key, v.count::int, v.share
        FROM multi m CROSS JOIN LATERAL (VALUES
          (1, 'calls', m.n, NULL::numeric),
          (2, 'with_text_replies', m.text, round(m.text::numeric / m.n, 3)),
          (3, 'with_enforce_nudges', m.nudged, round(m.nudged::numeric / m.n, 3)),
          (4, 'with_rejections', m.rejected, round(m.rejected::numeric / m.n, 3))
        ) v(o, key, count, share)
        UNION ALL
        SELECT 3, 'max_turns', a.kind, 0, 'error_max_turns',
          count(*) FILTER (WHERE a.turns->>'subtype' = 'error_max_turns')::int,
          round(count(*) FILTER (WHERE a.turns->>'subtype' = 'error_max_turns')::numeric
            / count(*), 3)
        FROM a GROUP BY a.kind
        UNION ALL
        SELECT 4, 'rejection', NULL, 0, key, count, NULL
        FROM (SELECT key, count(*)::int AS count FROM rejection
              GROUP BY key ORDER BY 2 DESC, 1 LIMIT 10) r) t`,
  },
];
