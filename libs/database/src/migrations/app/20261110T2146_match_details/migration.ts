#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract';
import endContract from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract.json' with { type: 'json' };
import startContract from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the
// `match-details` invariant in ../refs/db.json decides whether it runs on a fresh
// database. Advancing the `db` ref writes `invariants: []`; re-add it.
// It adds match_details, the one way a signed-in user reads their matches with each job's
// details and curated extraction facts. normalized_jobs, job_extractions and the raw tables
// stay engine-only: match_details is SECURITY DEFINER and reaches a job only through the
// caller's own job_matches rows. match_facts builds the facts from the match's extraction,
// field by field, so nothing of `data` passes through unlisted.

// match_facts(doc) builds one document's facts; match_details calls it per row. Its cost per
// row is kept to the JSON building itself:
// - `doc || '{}'` decompresses the stored document once, and each top-level field is read
//   from it once into `x`; OFFSET 0 keeps the planner from folding those expressions back
//   into every reference, which would decompress (and copy) the document again each time.
// - Each label is one primary-key lookup. The value lists are a few pages, so the planner
//   would rather scan a whole list for every code it looks up, which costs far more per row
//   than the index; `enable_seqscan = off`, set on match_facts only, keeps the index lookups.

// A fact whose value is present (not missing, not JSON null).
const has = (field: string) => `jsonb_typeof(x."${field}"->'value') <> 'null'`;
const quote = (expr: string) => `NULLIF(${expr}->>'quote', '')`;
// The label of `code` in the value list `list`; null when the code is null or unknown.
const label = (list: string, code: string) =>
  `(SELECT t.label FROM public.${list} t WHERE t.code = ${code})`;
// A coded fact: { code, label, quote }, the label read from `list` by code.
const coded = (field: string, list: string) =>
  `'${field}', CASE WHEN ${has(field)} THEN jsonb_build_object(
      'code', x."${field}"->'value',
      'label', ${label(list, `x."${field}"->>'value'`)},
      'quote', ${quote(`x."${field}"`)}) END`;

const facts = `jsonb_build_object(
  'position', CASE WHEN ${has('position')} THEN jsonb_build_object(
      'roleKind', jsonb_build_object(
        'code', x."position"->'value'->'roleKind',
        'label', ${label('role_kinds', `x."position"->'value'->>'roleKind'`)}),
      'title', x."position"->'value'->'title',
      'quote', ${quote(`x."position"`)}) END,
  ${coded('seniority', 'seniorities')},
  'yearsRequired', CASE WHEN ${has('yearsRequired')} THEN jsonb_build_object(
      'min', x."yearsRequired"->'value'->'min',
      'max', x."yearsRequired"->'value'->'max',
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
      'quote', ${quote('o.opening')}
    ) ORDER BY o.ord), '[]'::jsonb)
    FROM jsonb_array_elements(x."openings") WITH ORDINALITY o(opening, ord)),
  ${coded('contractType', 'contract_types')},
  ${coded('engagement', 'engagements')},
  'contractMonths', CASE WHEN ${has('contractMonths')} THEN jsonb_build_object(
      'months', x."contractMonths"->'value',
      'quote', ${quote(`x."contractMonths"`)}) END,
  'salary', CASE WHEN ${has('salary')} THEN jsonb_build_object(
      'min', x."salary"->'value'->'min',
      'max', x."salary"->'value'->'max',
      'currency', x."salary"->'value'->'currency',
      'period', x."salary"->'value'->'period',
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
      'quote', ${quote(`x."techStack"`)}) END,
  'requiredLanguages', CASE WHEN ${has('requiredLanguages')} THEN jsonb_build_object(
      'languages', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'lang', l.lang->'lang',
          'level', l.lang->'level',
          'quote', ${quote('l.lang')}
        ) ORDER BY l.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."requiredLanguages"->'value') WITH ORDINALITY l(lang, ord)),
      'quote', ${quote(`x."requiredLanguages"`)}) END,
  'workAuthorization', CASE WHEN ${has('workAuthorization')} THEN jsonb_build_object(
      'requirements', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'kind', w.req->'kind',
          'place', w.req->'place'
        ) ORDER BY w.ord), '[]'::jsonb)
        FROM jsonb_array_elements(x."workAuthorization"->'value'->'requirements') WITH ORDINALITY w(req, ord)),
      'sponsorship', x."workAuthorization"->'value'->'sponsorship',
      'quote', ${quote(`x."workAuthorization"`)}) END
)`;

// The document's top-level fields the facts are built from, each read once.
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

const matchFacts = `CREATE OR REPLACE FUNCTION public.match_facts(doc jsonb) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' SET enable_seqscan = off AS $$
SELECT ${facts}
FROM (
  SELECT ${fields.map((f) => `dd.d->'${f}' AS "${f}"`).join(', ')}
  FROM (SELECT doc || '{}'::jsonb AS d OFFSET 0) dd
  OFFSET 0) x
$$;
REVOKE EXECUTE ON FUNCTION public.match_facts(jsonb) FROM PUBLIC, anon, authenticated;`;

const matchDetails = `CREATE OR REPLACE FUNCTION public.match_details(
  p_profile_id uuid,
  p_outcome text DEFAULT 'qualified',
  p_since timestamptz DEFAULT NULL,
  p_job_id uuid DEFAULT NULL
) RETURNS TABLE(
  "matchId" uuid, "profileId" uuid, "jobId" uuid, outcome text, unverified boolean,
  "stackScore" numeric, checks jsonb, "decidedAt" timestamptz,
  kind text, title text, "companyName" text, "companyUrl" text, location text,
  "salaryText" text, "salaryMin" int, "salaryMax" int, "salaryCurrency" text, "salaryPeriod" text,
  "publishedAt" text, "firstSeenAt" timestamptz, "lastSeenAt" timestamptz, closed boolean,
  "postingUrl" text, "applyUrl" text, "posterName" text, "posterProfileUrl" text, "posterType" text,
  "descriptionText" text, channels text[], facts jsonb
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT
  m.id, m."profileId", m."jobId", m.outcome, m.unverified, m."stackScore", m.checks, m."decidedAt",
  j.kind, j.title, j."companyName", j."companyUrl", j.location,
  j."salaryText", j."salaryMin", j."salaryMax", j."salaryCurrency", j."salaryPeriod",
  j."publishedAt", j."firstSeenAt", j."lastSeenAt", j.closed,
  j."postingUrl", j."applyUrl", j."posterName", j."posterProfileUrl", j."posterType",
  j."descriptionText",
  ARRAY(
    SELECT DISTINCT r.channel::text
      FROM public.normalized_job_sources s
      JOIN public.raw_items r ON r.id = s."rawItemId"
     WHERE s."jobId" = j.id
     ORDER BY 1),
  -- The facts the match was decided on, not the job's current extraction.
  public.match_facts(e.data)
FROM public.job_matches m
JOIN public.normalized_jobs j ON j.id = m."jobId"
JOIN public.job_extractions e ON e.id = m."extractionId"
-- Every job row is reached only through the caller's own matches; a null uid matches none.
WHERE m."userId" = auth.uid()
  AND m."profileId" = p_profile_id
  AND m.outcome = p_outcome
  AND j.status = 'active'
  AND (p_since IS NULL OR j."lastSeenAt" >= p_since)
  AND (p_job_id IS NULL OR m."jobId" = p_job_id)
$$;
REVOKE EXECUTE ON FUNCTION public.match_details(uuid, text, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_details(uuid, text, timestamptz, uuid) TO authenticated;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'functions.match_details',
        invariantId: 'match-details',
        label:
          "match_details: a signed-in user's matches with job details and curated extraction facts",
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
            description: 'create match_facts(doc), owner-only',
            sql: matchFacts,
          },
          {
            description:
              'create match_details(p_profile_id, p_outcome, p_since, p_job_id) for authenticated',
            sql: matchDetails,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
