#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/c9460b85087b8c76224e2851ec975a1ae628faff433325609a6901426cf36d67/contract';
import endContract from '../../snapshots/c9460b85087b8c76224e2851ec975a1ae628faff433325609a6901426cf36d67/contract.json' with { type: 'json' };
import startContract from '../../snapshots/c9460b85087b8c76224e2851ec975a1ae628faff433325609a6901426cf36d67/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the
// `match-details-review` invariant in ../refs/db.json decides whether it runs on a fresh
// database. Advancing the `db` ref writes `invariants: []`; re-add it, and keep the earlier ones.
// It replaces match_details (the return columns change, so CREATE OR REPLACE cannot) to apply
// the user's review decisions (match_reviews). A match's effective outcome is the choice of the
// latest decision for it (by createdAt, then id) when the match is in review and that decision
// names the match's current reviewRule and reviewField; otherwise the engine's outcome. A
// re-decision to another outcome, or to review on another rule or field, wins; the decision
// stays as history and applies again if the match returns to review on its rule and field.
// - `p_outcome` filters on the effective outcome: 'review' lists review rows with no applicable
//   decision, 'qualified' also lists those the user moved to Matches, 'rejected' those they
//   rejected.
// - `outcome` stays the engine's. New columns: `reviewRule` and `reviewField` (the match's) and
//   `reviewChoice` (the applicable decision's choice; null when none applies).
//   Also `extractionId` (the job_facts row's extraction; null without a facts row).
// Everything else is as match-details-job-facts:
// - Facts come from the job's `job_facts` row, each fact with its `source`, each opening with its
//   `arrangementSource` and `placesSource`; `conflicts` lists where the listing and the
//   description disagreed. `closed` is true when the job, its job_facts, or its expired listing
//   says so.
// - `p_details = false` returns light list rows (no checks, description, full facts or conflicts).
// - Isolation is unchanged: rows are reached only through the caller's own job_matches
//   (userId = auth.uid(), read once per call as `(SELECT auth.uid())`); decisions are read
//   only for those matches and only the match owner's.
// - job_facts is LEFT JOINed: a match whose job has no facts row (a job still on a v2 extraction)
//   is still returned, with `facts` null and `conflicts` empty.
// - Facts are built inline over the row set: `f.facts || '{}'` is read once per row into `x`,
//   OFFSET 0 keeps the planner from folding it back into every reference, and labels come from
//   one code -> label map per value list, built once per call.

// A fact whose value is present (not missing, not JSON null).
const has = (field: string) => `jsonb_typeof(x."${field}"->'value') <> 'null'`;
const quote = (expr: string) => `NULLIF(${expr}->>'quote', '')`;
// The label of `code` in the value list `list`; null when the code is null or unknown.
const label = (list: string, code: string) => `l.${list} ->> (${code})`;
// A coded fact: { code, label, quote }, the label read from `list` by code.
const source = (field: string) => `x."${field}"->>'source'`;
const coded = (field: string, list: string) =>
  `'${field}', CASE WHEN ${has(field)} THEN jsonb_build_object(
      'code', x."${field}"->'value',
      'label', ${label(list, `x."${field}"->>'value'`)},
      'source', ${source(field)},
      'quote', ${quote(`x."${field}"`)}) END`;

const facts = `jsonb_build_object(
  'position', CASE WHEN ${has('position')} THEN jsonb_build_object(
      'roleKind', jsonb_build_object(
        'code', x."position"->'value'->'roleKind',
        'label', ${label('role_kinds', `x."position"->'value'->>'roleKind'`)}),
      'title', x."position"->'value'->'title',
      'source', ${source('position')},
      'quote', ${quote(`x."position"`)}) END,
  ${coded('seniority', 'seniorities')},
  'yearsRequired', CASE WHEN ${has('yearsRequired')} THEN jsonb_build_object(
      'min', x."yearsRequired"->'value'->'min',
      'max', x."yearsRequired"->'value'->'max',
      'source', ${source('yearsRequired')},
      'quote', ${quote(`x."yearsRequired"`)}) END,
  ${coded('arrangement', 'arrangements')},
  'openings', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'arrangements', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'code', a.code,
          'label', ${label('arrangements', 'a.code')}
        ) ORDER BY a.ord), '[]'::jsonb)
        FROM jsonb_array_elements_text(o.opening->'arrangements') WITH ORDINALITY a(code, ord)),
      'places', (
        SELECT COALESCE(jsonb_agg(CASE p.place->>'kind'
          WHEN 'worldwide' THEN jsonb_build_object('kind', 'worldwide')
          WHEN 'region' THEN jsonb_build_object(
            'kind', 'region',
            'code', p.place->'code',
            'label', ${label('regions', `p.place->>'code'`)})
          WHEN 'country' THEN jsonb_build_object(
            'kind', 'country',
            'code', p.place->'code',
            'label', ${label('countries', `p.place->>'code'`)})
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
      'quote', ${quote('o.opening')}
    ) ORDER BY o.ord), '[]'::jsonb)
    FROM jsonb_array_elements(x."openings") WITH ORDINALITY o(opening, ord)),
  ${coded('contractType', 'contract_types')},
  ${coded('engagement', 'engagements')},
  'contractMonths', CASE WHEN ${has('contractMonths')} THEN jsonb_build_object(
      'months', x."contractMonths"->'value',
      'source', ${source('contractMonths')},
      'quote', ${quote(`x."contractMonths"`)}) END,
  'salary', CASE WHEN ${has('salary')} THEN jsonb_build_object(
      'min', x."salary"->'value'->'min',
      'max', x."salary"->'value'->'max',
      'currency', x."salary"->'value'->'currency',
      'period', x."salary"->'value'->'period',
      'source', ${source('salary')},
      'quote', ${quote(`x."salary"`)}) END,
  'techStack', CASE WHEN ${has('techStack')} THEN jsonb_build_object(
      'requirements', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'technology', jsonb_build_object(
            'code', r.req->'technology'->'code',
            -- An extracted technology with no (or no known) code shows its text.
            'label', COALESCE(
              ${label('tech_tags', `r.req->'technology'->>'code'`)},
              r.req->'technology'->>'text'),
            'text', r.req->'technology'->'text'),
          'kind', r.req->'kind',
          'importance', r.req->'importance',
          'domain', r.req->'domain',
          'years', CASE WHEN jsonb_typeof(r.req->'years') = 'object' THEN jsonb_build_object(
              'min', r.req->'years'->'min',
              'max', r.req->'years'->'max') END,
          'group', r.req->'group',
          'quote', ${quote('r.req')}
        ) ORDER BY r.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."techStack"->'value'->'requirements') WITH ORDINALITY r(req, ord)),
      'groups', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', g.grp->'id',
          'min', g.grp->'min'
        ) ORDER BY g.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."techStack"->'value'->'groups') WITH ORDINALITY g(grp, ord)),
      'source', ${source('techStack')},
      'quote', ${quote(`x."techStack"`)}) END,
  'requiredLanguages', CASE WHEN ${has('requiredLanguages')} THEN jsonb_build_object(
      'languages', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'lang', lg.lang->'lang',
          'level', lg.lang->'level',
          'quote', ${quote('lg.lang')}
        ) ORDER BY lg.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."requiredLanguages"->'value') WITH ORDINALITY lg(lang, ord)),
      'source', ${source('requiredLanguages')},
      'quote', ${quote(`x."requiredLanguages"`)}) END,
  'workAuthorization', CASE WHEN ${has('workAuthorization')} THEN jsonb_build_object(
      'requirements', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'kind', w.req->'kind',
          'place', w.req->'place'
        ) ORDER BY w.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."workAuthorization"->'value'->'requirements') WITH ORDINALITY w(req, ord)),
      'sponsorship', x."workAuthorization"->'value'->'sponsorship',
      'source', ${source('workAuthorization')},
      'quote', ${quote(`x."workAuthorization"`)}) END
)`;

// What a list row shows of the facts: the stated arrangement and each opening's arrangements,
// in the same shapes as the full facts.
const listFacts = `jsonb_build_object(
  ${coded('arrangement', 'arrangements')},
  'openings', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'arrangements', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'code', a.code,
          'label', ${label('arrangements', 'a.code')}
        ) ORDER BY a.ord), '[]'::jsonb)
        FROM jsonb_array_elements_text(o.opening->'arrangements') WITH ORDINALITY a(code, ord))
    ) ORDER BY o.ord), '[]'::jsonb)
    FROM jsonb_array_elements(x."openings") WITH ORDINALITY o(opening, ord))
)`;

// The value lists facts take labels from, each read into one code -> label map per call,
// labels regardless of status.
const labelLists = [
  'role_kinds',
  'seniorities',
  'arrangements',
  'contract_types',
  'engagements',
  'tech_tags',
  'regions',
  'countries',
];
const labelMap = (list: string) =>
  `(SELECT COALESCE(jsonb_object_agg(t.code, t.label), '{}'::jsonb) FROM public.${list} t) AS ${list}`;

// The document's top-level fields the facts are built from, each read once per row.
const fields = [
  'position',
  'seniority',
  'yearsRequired',
  'arrangement',
  'openings',
  'contractType',
  'engagement',
  'contractMonths',
  'salary',
  'techStack',
  'requiredLanguages',
  'workAuthorization',
];

const matchDetails = `CREATE FUNCTION public.match_details(
  p_profile_id uuid DEFAULT NULL,
  p_outcome text DEFAULT 'qualified',
  p_since timestamptz DEFAULT NULL,
  p_job_id uuid DEFAULT NULL,
  p_details boolean DEFAULT true
) RETURNS TABLE(
  "matchId" uuid, "profileId" uuid, "jobId" uuid, outcome text, unverified boolean,
  "stackScore" numeric, checks jsonb, "decidedAt" timestamptz,
  kind text, title text, "companyName" text, "companyUrl" text, location text,
  "salaryText" text, "salaryMin" int, "salaryMax" int, "salaryCurrency" text, "salaryPeriod" text,
  "publishedAt" text, "postedAt" timestamptz, "firstSeenAt" timestamptz, "lastSeenAt" timestamptz, closed boolean,
  "postingUrl" text, "applyUrl" text, "posterName" text, "posterProfileUrl" text, "posterType" text,
  "descriptionText" text, channels text[], "viewedAt" timestamptz, facts jsonb, conflicts jsonb,
  "reviewRule" text, "reviewField" text, "reviewChoice" text, "extractionId" uuid
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
WITH l AS MATERIALIZED (
  SELECT
    ${labelLists.map(labelMap).join(',\n    ')}
)
SELECT
  m.id, m."profileId", m."jobId", m.outcome, m.unverified, m."stackScore",
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
       WHEN p_details THEN ${facts}
       ELSE ${listFacts} END,
  CASE WHEN p_details THEN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'field', c.field,
      'listingValue', c."listingValue",
      'descriptionValue', c."descriptionValue",
      'winner', c.winner
    ) ORDER BY c.field, c.id), '[]'::jsonb)
    FROM public.job_fact_conflicts c
    WHERE c."jobId" = m."jobId") END,
  m."reviewRule", m."reviewField", d.choice, f."extractionId"
FROM public.job_matches m
JOIN public.normalized_jobs j ON j.id = m."jobId"
LEFT JOIN public.job_facts f ON f."jobId" = m."jobId"
LEFT JOIN public.job_views v ON v."jobId" = m."jobId" AND v."userId" = (SELECT auth.uid())
CROSS JOIN LATERAL (
  SELECT ${fields.map((f) => `dd.d->'${f}' AS "${f}"`).join(', ')}
  FROM (SELECT f.facts || '{}'::jsonb AS d OFFSET 0) dd
  OFFSET 0) x
CROSS JOIN l
-- The user's decision that applies: the latest for the match, when the match is in review on
-- the rule and field it names.
LEFT JOIN LATERAL (
  SELECT r.choice
    FROM (SELECT r.choice, r.rule, r.field
            FROM public.match_reviews r
           WHERE r."matchId" = m.id AND r."userId" = m."userId"
           ORDER BY r."createdAt" DESC, r.id DESC
           LIMIT 1) r
   WHERE m.outcome = 'review' AND r.rule = m."reviewRule" AND r.field = m."reviewField") d ON true
-- Every job row is reached only through the caller's own matches; a null uid matches none.
WHERE m."userId" = (SELECT auth.uid())
  AND (p_profile_id IS NULL OR m."profileId" = p_profile_id)
  -- The effective outcome: the applicable decision's choice, else the engine's. The first test
  -- only narrows the rows on the outcome index: a decision moves a review row elsewhere.
  AND (m.outcome = p_outcome OR (m.outcome = 'review' AND p_outcome IN ('qualified', 'rejected')))
  AND COALESCE(d.choice, m.outcome) = p_outcome
  AND j.status = 'active'
  AND (p_since IS NULL OR j."lastSeenAt" >= p_since)
  AND (p_job_id IS NULL OR m."jobId" = p_job_id)
$$;
REVOKE EXECUTE ON FUNCTION public.match_details(uuid, text, timestamptz, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_details(uuid, text, timestamptz, uuid, boolean) TO authenticated;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'functions.match_details_review',
        invariantId: 'match-details-review',
        label:
          "match_details: the user's review decisions set the effective outcome, plus reviewRule, reviewField and reviewChoice",
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'job_matches',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'drop the old match_details (its return columns change)',
            sql: 'DROP FUNCTION public.match_details(uuid, text, timestamptz, uuid, boolean)',
          },
          {
            description:
              'create match_details(p_profile_id, p_outcome, p_since, p_job_id, p_details) for authenticated',
            sql: matchDetails,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
