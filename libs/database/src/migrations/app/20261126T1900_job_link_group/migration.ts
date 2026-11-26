#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/84883c684e9b8bc81b7fad1234576075a5a08a30f80a9c2b08f617b52f123c72/contract';
import endContract from '../../snapshots/84883c684e9b8bc81b7fad1234576075a5a08a30f80a9c2b08f617b52f123c72/contract.json' with { type: 'json' };
import startContract from '../../snapshots/84883c684e9b8bc81b7fad1234576075a5a08a30f80a9c2b08f617b52f123c72/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so its invariant
// (job-link-group) in ../refs/db.json decides whether it runs on a fresh database. Advancing the
// `db` ref writes `invariants: []`; re-add every earlier invariant and this one.
//
// A job's linked group is resolved on read (spec 2026-11-25-posts-qualify, "A role linked to a
// job we hold"): jobs that share a job key are one job, transitively. A role's keys are its
// linkKeys; a listing's are its jobKey plus linkedin-job:<id> for each LinkedIn job board source
// keyed id:<id>, because ingest keys a listing by its apply URL when it can, so a post linking
// /jobs/view/<id>/ would otherwise never find it. A decision on any job of the group counts for
// all of them; match_details' decisionStatus reads it. The helpers are granted to nobody.

// The three helpers are plpgsql, not sql: match_details calls group_decision_status once per row,
// and a non-inlined sql function plans its query (and its nested calls) on every call. plpgsql
// keeps the plans for the session, which cut the per-row cost about tenfold on seeded data.

// The LinkedIn job board channels (harvestapi and the trial actors), whose sources are keyed id:<id>.
const LINKEDIN_JOB_BOARD = `('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY')`;

const jobLinkKeys = String.raw`CREATE OR REPLACE FUNCTION public.job_link_keys(p_job uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN (SELECT CASE WHEN j.kind = 'post_role' THEN j."linkKeys"
  ELSE ARRAY(
    SELECT j."jobKey"
    UNION
    SELECT 'linkedin-job:' || substr(r."sourceKey", 4)
      FROM public.normalized_job_sources s
      JOIN public.raw_items r ON r.id = s."rawItemId"
     WHERE s."jobId" = j.id
       AND r.channel IN ${LINKEDIN_JOB_BOARD}
       AND r."sourceKey" LIKE 'id:%')
  END
  FROM public.normalized_jobs j
 WHERE j.id = p_job);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.job_link_keys(uuid) FROM PUBLIC, anon, authenticated;`;

// Breadth first from p_job: each step looks up only the keys the previous step added, adds only
// jobs not yet in the group, and the recursion ends when a step adds none or at depth 4. Only
// active jobs join; p_job itself is always in its group. OFFSET 0 keeps each step's lookup a
// single evaluation: inlined, its ARRAY() would run once per reference.
const jobLinkGroup = String.raw`CREATE OR REPLACE FUNCTION public.job_link_group(p_job uuid)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
RETURN QUERY
WITH RECURSIVE g(ids, keys, fresh, depth) AS (
  SELECT ARRAY[p_job], k.keys, k.keys, 0
    FROM (SELECT COALESCE(public.job_link_keys(p_job), '{}'::text[]) AS keys) k
  UNION
  SELECT g.ids || n.ids, g.keys || nk.keys, nk.keys, g.depth + 1
    FROM g
    CROSS JOIN LATERAL (SELECT ARRAY(
      -- A listing whose job key is one of the keys.
      SELECT j.id FROM public.normalized_jobs j
       WHERE j."jobKey" = ANY (g.fresh) AND j.kind = 'job' AND j.status = 'active'
      UNION
      -- A role whose links resolve to one of the keys.
      SELECT j.id FROM public.normalized_jobs j
       WHERE j."linkKeys" && g.fresh AND j.kind = 'post_role' AND j.status = 'active'
      UNION
      -- A listing with a LinkedIn job board source whose id is a linkedin-job:<id> key.
      SELECT j.id
        FROM public.raw_items r
        JOIN public.normalized_job_sources s ON s."rawItemId" = r.id
        JOIN public.normalized_jobs j ON j.id = s."jobId"
       WHERE r.channel IN ${LINKEDIN_JOB_BOARD}
         AND r."sourceKey" = ANY (ARRAY(
           SELECT 'id:' || substr(f.key, 14) FROM unnest(g.fresh) f(key)
            WHERE f.key LIKE 'linkedin-job:%'))
         AND j.kind = 'job' AND j.status = 'active'
      EXCEPT
      SELECT unnest(g.ids)) AS ids OFFSET 0) n
    CROSS JOIN LATERAL (SELECT ARRAY(
      SELECT k.key FROM unnest(n.ids) i(id), unnest(public.job_link_keys(i.id)) k(key)
      EXCEPT
      SELECT unnest(g.keys)) AS keys OFFSET 0) nk
   WHERE g.depth < 4 AND cardinality(n.ids) > 0
)
SELECT DISTINCT unnest(g.ids) FROM g;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.job_link_group(uuid) FROM PUBLIC, anon, authenticated;`;

// The user's latest decision (applied, dismissed, expired) on any job of p_job's group, else
// null. A user with no decision at all skips the group lookup.
const groupDecisionStatus = String.raw`CREATE OR REPLACE FUNCTION public.group_decision_status(p_user uuid, p_job uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.job_decisions d WHERE d."userId" = p_user) THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT d.status
            FROM public.job_decisions d
           WHERE d."userId" = p_user
             AND d."jobId" IN (SELECT public.job_link_group(p_job))
           ORDER BY d."decidedAt" DESC, d.id DESC
           LIMIT 1);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.group_decision_status(uuid, uuid) FROM PUBLIC, anon, authenticated;`;

// match_details is 20261125T1248_post_matching's definition with only decisionStatus changed:
// the user's decision on the job, else on any job linked to it.
const matchDetails = String.raw`CREATE OR REPLACE FUNCTION public.match_details(p_profile_id uuid DEFAULT NULL::uuid, p_outcome text DEFAULT 'qualified'::text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_job_id uuid DEFAULT NULL::uuid, p_details boolean DEFAULT true, p_kind text DEFAULT 'job'::text)
 RETURNS TABLE("matchId" uuid, "profileId" uuid, "jobId" uuid, outcome text, unverified boolean, "stackScore" numeric, checks jsonb, "decidedAt" timestamp with time zone, kind text, title text, "companyName" text, "companyUrl" text, location text, "salaryText" text, "salaryMin" integer, "salaryMax" integer, "salaryCurrency" text, "salaryPeriod" text, "publishedAt" text, "postedAt" timestamp with time zone, "firstSeenAt" timestamp with time zone, "lastSeenAt" timestamp with time zone, closed boolean, "postingUrl" text, "applyUrl" text, "posterName" text, "posterProfileUrl" text, "posterType" text, "descriptionText" text, channels text[], "viewedAt" timestamp with time zone, facts jsonb, conflicts jsonb, "reviewRule" text, "reviewField" text, "reviewChoice" text, "extractionId" uuid, "decisionStatus" text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH l AS MATERIALIZED (
  SELECT
    (SELECT COALESCE(jsonb_object_agg(t.code, t.label), '{}'::jsonb) FROM public.role_kinds t) AS role_kinds,
    (SELECT COALESCE(jsonb_object_agg(t.code, t.label), '{}'::jsonb) FROM public.seniorities t) AS seniorities,
    (SELECT COALESCE(jsonb_object_agg(t.code, t.label), '{}'::jsonb) FROM public.arrangements t) AS arrangements,
    (SELECT COALESCE(jsonb_object_agg(t.code, t.label), '{}'::jsonb) FROM public.contract_types t) AS contract_types,
    (SELECT COALESCE(jsonb_object_agg(t.code, t.label), '{}'::jsonb) FROM public.engagements t) AS engagements,
    (SELECT COALESCE(jsonb_object_agg(t.code, t.label), '{}'::jsonb) FROM public.tech_tags t) AS tech_tags,
    (SELECT COALESCE(jsonb_object_agg(t.code, t.label), '{}'::jsonb) FROM public.regions t) AS regions,
    (SELECT COALESCE(jsonb_object_agg(t.code, t.label), '{}'::jsonb) FROM public.countries t) AS countries
)
SELECT
  m.id, m."profileId", m."jobId", m.outcome,
  -- A review row the user moved to Matches rests on an unsure check.
  m.unverified OR COALESCE(d.choice = 'qualified', false), m."stackScore",
  CASE WHEN p_details THEN m.checks END, m."decidedAt",
  j.kind, j.title, j."companyName", j."companyUrl", j.location,
  j."salaryText", j."salaryMin", j."salaryMax", j."salaryCurrency", j."salaryPeriod",
  j."publishedAt", j."postedAt", j."firstSeenAt", j."lastSeenAt",
  -- Closed by its sources, by its combined facts, or by a LinkedIn listing past its expiry.
  j.closed OR COALESCE(f.closed, false) OR (j."expiresAt" IS NOT NULL AND j."expiresAt" <= now()),
  j."postingUrl", j."applyUrl", j."posterName", j."posterProfileUrl", j."posterType",
  CASE WHEN p_details THEN j."descriptionText" END,
  ARRAY(
    SELECT DISTINCT r.channel::text
      FROM public.normalized_job_sources s
      JOIN public.raw_items r ON r.id = s."rawItemId"
     WHERE s."jobId" = j.id
     ORDER BY 1),
  v."viewedAt",
  -- The job's combined facts; null when it has none yet.
  CASE WHEN f."jobId" IS NULL THEN NULL
       WHEN p_details THEN jsonb_build_object(
  'position', CASE WHEN jsonb_typeof(x."position"->'value') <> 'null' THEN jsonb_build_object(
      'roleKind', jsonb_build_object(
        'code', x."position"->'value'->'roleKind',
        'label', l.role_kinds ->> (x."position"->'value'->>'roleKind')),
      'title', x."position"->'value'->'title',
      'source', x."position"->>'source',
      'quote', NULLIF(x."position"->>'quote', '')) END,
  'seniority', CASE WHEN jsonb_typeof(x."seniority"->'value') <> 'null' THEN jsonb_build_object(
      'code', x."seniority"->'value',
      'label', l.seniorities ->> (x."seniority"->>'value'),
      'source', x."seniority"->>'source',
      'quote', NULLIF(x."seniority"->>'quote', '')) END,
  'yearsRequired', CASE WHEN jsonb_typeof(x."yearsRequired"->'value') <> 'null' THEN jsonb_build_object(
      'min', x."yearsRequired"->'value'->'min',
      'max', x."yearsRequired"->'value'->'max',
      'source', x."yearsRequired"->>'source',
      'quote', NULLIF(x."yearsRequired"->>'quote', '')) END,
  'arrangement', CASE WHEN jsonb_typeof(x."arrangement"->'value') <> 'null' THEN jsonb_build_object(
      'code', x."arrangement"->'value',
      'label', l.arrangements ->> (x."arrangement"->>'value'),
      'source', x."arrangement"->>'source',
      'quote', NULLIF(x."arrangement"->>'quote', '')) END,
  'openings', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'arrangements', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'code', a.code,
          'label', l.arrangements ->> (a.code)
        ) ORDER BY a.ord), '[]'::jsonb)
        FROM jsonb_array_elements_text(o.opening->'arrangements') WITH ORDINALITY a(code, ord)),
      'places', (
        SELECT COALESCE(jsonb_agg(CASE p.place->>'kind'
          WHEN 'worldwide' THEN jsonb_build_object('kind', 'worldwide')
          WHEN 'region' THEN jsonb_build_object(
            'kind', 'region',
            'code', p.place->'code',
            'label', l.regions ->> (p.place->>'code'))
          WHEN 'country' THEN jsonb_build_object(
            'kind', 'country',
            'code', p.place->'code',
            'label', l.countries ->> (p.place->>'code'))
          WHEN 'city' THEN jsonb_build_object(
            'kind', 'city',
            'name', p.place->'name',
            'countryCode', p.place->'countryCode',
            'cityId', p.place->'cityId')
        END ORDER BY p.ord), '[]'::jsonb)
        FROM jsonb_array_elements(o.opening->'places') WITH ORDINALITY p(place, ord)),
      'placeStrictness', o.opening->'placeStrictness',
      'timezones', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'fromUtc', z.tz->'fromUtc',
          'toUtc', z.tz->'toUtc',
          'label', z.tz->'label'
        ) ORDER BY z.ord), '[]'::jsonb)
        FROM jsonb_array_elements(o.opening->'timezones') WITH ORDINALITY z(tz, ord)),
      'arrangementSource', o.opening->'arrangementSource',
      'placesSource', o.opening->'placesSource',
      'quote', NULLIF(o.opening->>'quote', '')
    ) ORDER BY o.ord), '[]'::jsonb)
    FROM jsonb_array_elements(x."openings") WITH ORDINALITY o(opening, ord)),
  'contractType', CASE WHEN jsonb_typeof(x."contractType"->'value') <> 'null' THEN jsonb_build_object(
      'code', x."contractType"->'value',
      'label', l.contract_types ->> (x."contractType"->>'value'),
      'source', x."contractType"->>'source',
      'quote', NULLIF(x."contractType"->>'quote', '')) END,
  'engagement', CASE WHEN jsonb_typeof(x."engagement"->'value') <> 'null' THEN jsonb_build_object(
      'code', x."engagement"->'value',
      'label', l.engagements ->> (x."engagement"->>'value'),
      'source', x."engagement"->>'source',
      'quote', NULLIF(x."engagement"->>'quote', '')) END,
  'contractMonths', CASE WHEN jsonb_typeof(x."contractMonths"->'value') <> 'null' THEN jsonb_build_object(
      'months', x."contractMonths"->'value',
      'source', x."contractMonths"->>'source',
      'quote', NULLIF(x."contractMonths"->>'quote', '')) END,
  'salary', CASE WHEN jsonb_typeof(x."salary"->'value') <> 'null' THEN jsonb_build_object(
      'min', x."salary"->'value'->'min',
      'max', x."salary"->'value'->'max',
      'currency', x."salary"->'value'->'currency',
      'period', x."salary"->'value'->'period',
      'source', x."salary"->>'source',
      'quote', NULLIF(x."salary"->>'quote', '')) END,
  'techStack', CASE WHEN jsonb_typeof(x."techStack"->'value') <> 'null' THEN jsonb_build_object(
      'requirements', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'technology', jsonb_build_object(
            'code', r.req->'technology'->'code',
            -- An extracted technology with no (or no known) code shows its text.
            'label', COALESCE(
              l.tech_tags ->> (r.req->'technology'->>'code'),
              r.req->'technology'->>'text'),
            'text', r.req->'technology'->'text'),
          'kind', r.req->'kind',
          'importance', r.req->'importance',
          'domain', r.req->'domain',
          'years', CASE WHEN jsonb_typeof(r.req->'years') = 'object' THEN jsonb_build_object(
              'min', r.req->'years'->'min',
              'max', r.req->'years'->'max') END,
          'group', r.req->'group',
          'quote', NULLIF(r.req->>'quote', '')
        ) ORDER BY r.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."techStack"->'value'->'requirements') WITH ORDINALITY r(req, ord)),
      'groups', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', g.grp->'id',
          'min', g.grp->'min'
        ) ORDER BY g.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."techStack"->'value'->'groups') WITH ORDINALITY g(grp, ord)),
      'source', x."techStack"->>'source',
      'quote', NULLIF(x."techStack"->>'quote', '')) END,
  'requiredLanguages', CASE WHEN jsonb_typeof(x."requiredLanguages"->'value') <> 'null' THEN jsonb_build_object(
      'languages', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'lang', lg.lang->'lang',
          'level', lg.lang->'level',
          'quote', NULLIF(lg.lang->>'quote', '')
        ) ORDER BY lg.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."requiredLanguages"->'value') WITH ORDINALITY lg(lang, ord)),
      'source', x."requiredLanguages"->>'source',
      'quote', NULLIF(x."requiredLanguages"->>'quote', '')) END,
  'workAuthorization', CASE WHEN jsonb_typeof(x."workAuthorization"->'value') <> 'null' THEN jsonb_build_object(
      'requirements', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'kind', w.req->'kind',
          'place', w.req->'place'
        ) ORDER BY w.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."workAuthorization"->'value'->'requirements') WITH ORDINALITY w(req, ord)),
      'sponsorship', x."workAuthorization"->'value'->'sponsorship',
      'source', x."workAuthorization"->>'source',
      'quote', NULLIF(x."workAuthorization"->>'quote', '')) END
)
       ELSE jsonb_build_object(
  'arrangement', CASE WHEN jsonb_typeof(x."arrangement"->'value') <> 'null' THEN jsonb_build_object(
      'code', x."arrangement"->'value',
      'label', l.arrangements ->> (x."arrangement"->>'value'),
      'source', x."arrangement"->>'source',
      'quote', NULLIF(x."arrangement"->>'quote', '')) END,
  'openings', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'arrangements', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'code', a.code,
          'label', l.arrangements ->> (a.code)
        ) ORDER BY a.ord), '[]'::jsonb)
        FROM jsonb_array_elements_text(o.opening->'arrangements') WITH ORDINALITY a(code, ord))
    ) ORDER BY o.ord), '[]'::jsonb)
    FROM jsonb_array_elements(x."openings") WITH ORDINALITY o(opening, ord))
) END,
  CASE WHEN p_details THEN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'field', c.field,
      'listingValue', c."listingValue",
      'descriptionValue', c."descriptionValue",
      'winner', c.winner
    ) ORDER BY c.field, c.id), '[]'::jsonb)
    FROM public.job_fact_conflicts c
    WHERE c."jobId" = m."jobId") END,
  m."reviewRule", m."reviewField", d.choice, f."extractionId",
  -- The user's decision on this job, else their latest on any job linked to it.
  COALESCE(jd.status, public.group_decision_status((SELECT auth.uid()), m."jobId"))
FROM public.job_matches m
JOIN public.normalized_jobs j ON j.id = m."jobId"
LEFT JOIN public.job_facts f ON f."jobId" = m."jobId"
LEFT JOIN public.job_views v ON v."jobId" = m."jobId" AND v."userId" = (SELECT auth.uid())
LEFT JOIN public.job_decisions jd ON jd."jobId" = m."jobId" AND jd."userId" = (SELECT auth.uid())
CROSS JOIN LATERAL (
  SELECT dd.d->'position' AS "position", dd.d->'seniority' AS "seniority", dd.d->'yearsRequired' AS "yearsRequired", dd.d->'arrangement' AS "arrangement", dd.d->'openings' AS "openings", dd.d->'contractType' AS "contractType", dd.d->'engagement' AS "engagement", dd.d->'contractMonths' AS "contractMonths", dd.d->'salary' AS "salary", dd.d->'techStack' AS "techStack", dd.d->'requiredLanguages' AS "requiredLanguages", dd.d->'workAuthorization' AS "workAuthorization"
  FROM (SELECT f.facts || '{}'::jsonb AS d OFFSET 0) dd
  OFFSET 0) x
CROSS JOIN l
-- The user's decision that applies: the latest for the match, when the match is in review on
-- the rule and field it names, on the match's profile version, and the decision was made since the engine last changed the
-- outcome (decidedAt), so an old decision does not revive after another outcome.
LEFT JOIN LATERAL (
  SELECT r.choice
    FROM (SELECT r.choice, r.rule, r.field, r."createdAt", r."profileVersion"
            FROM public.match_reviews r
           WHERE r."matchId" = m.id AND r."userId" = m."userId"
           ORDER BY r."createdAt" DESC, r.id DESC
           LIMIT 1) r
   WHERE m.outcome = 'review' AND r.rule = m."reviewRule" AND r.field = m."reviewField"
     AND r."createdAt" >= m."decidedAt"
     -- A choice made on an older profile version does not apply to a match decided on a newer one.
     AND r."profileVersion" = m."profileVersion") d ON true
-- Every job row is reached only through the caller's own matches; a null uid matches none.
WHERE m."userId" = (SELECT auth.uid())
  AND (p_profile_id IS NULL OR m."profileId" = p_profile_id)
  -- The effective outcome: the applicable decision's choice, else the engine's. The first test
  -- only narrows the rows on the outcome index: a decision moves a review row elsewhere.
  AND (p_outcome IS NULL
       OR m.outcome = p_outcome OR (m.outcome = 'review' AND p_outcome IN ('qualified', 'rejected')))
  AND (p_outcome IS NULL OR COALESCE(d.choice, m.outcome) = p_outcome)
  AND j.status = 'active'
  AND (p_since IS NULL OR j."lastSeenAt" >= p_since)
  AND (p_job_id IS NULL OR m."jobId" = p_job_id)
  -- Listings by default; a post role needs p_kind => 'post_role', or null for both.
  AND (p_kind IS NULL OR j.kind = p_kind)
$function$;
REVOKE EXECUTE ON FUNCTION public.match_details(uuid, text, timestamptz, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_details(uuid, text, timestamptz, uuid, boolean, text) TO authenticated;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      rawSql({
        id: 'functions.job_link_group',
        invariantId: 'job-link-group',
        label:
          'job_link_keys, job_link_group, group_decision_status; match_details reads the group decision',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'job_decisions',
          },
        },
        precheck: [],
        execute: [
          { description: 'create job_link_keys', sql: jobLinkKeys },
          { description: 'create job_link_group', sql: jobLinkGroup },
          {
            description: 'create group_decision_status',
            sql: groupDecisionStatus,
          },
          {
            description:
              'replace match_details: decisionStatus reads the linked group',
            sql: matchDetails,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
