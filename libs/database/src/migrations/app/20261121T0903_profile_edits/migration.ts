#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a8b0e3af5a6acba211a21487fd666dddcb3d809695f0f5b44ee66a25372c2621/contract';
import endContract from '../../snapshots/a8b0e3af5a6acba211a21487fd666dddcb3d809695f0f5b44ee66a25372c2621/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e7b08e363baaa0a3e156ae4de9f711a51863b987540910924cedef23bf467e55/contract';
import startContract from '../../snapshots/e7b08e363baaa0a3e156ae4de9f711a51863b987540910924cedef23bf467e55/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  lit,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

// NOTE: advancing the `db` ref in ../refs/db.json writes `invariants: []`; re-add every earlier
// invariant and the ones below (profile-match-version, replace-profile-skills-published,
// match-reviews-profile-version, match-details-review-version, profile-version-backfill).
// Profile edits: published profiles become editable. profiles.matchVersion counts the changes the
// matcher reads, bumped by trigger so every writer is covered: any profiles column except the
// excluded ones (resume, state and publication, the version columns, postSearch, timestamps) and
// any profile_skills change. job_matches.profileVersion records the version a decision read, and
// match_reviews.profileVersion (set by trigger from its match) the version a choice was made on.

const bumpProfileMatchVersion = `CREATE FUNCTION public.bump_profile_match_version() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    -- BEFORE UPDATE. Every column bumps unless listed here, so a new column bumps by default.
    IF (to_jsonb(NEW) - ARRAY['resumeKey','resumeFilename','resumeSizeBytes','resumeSha256','resumeUploadedAt','state','publishedAt','matchVersion','searchesVersion','postSearch','createdAt','updatedAt'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['resumeKey','resumeFilename','resumeSizeBytes','resumeSha256','resumeUploadedAt','state','publishedAt','matchVersion','searchesVersion','postSearch','createdAt','updatedAt']) THEN
      NEW."matchVersion" := OLD."matchVersion" + 1;
    END IF;
    RETURN NEW;
  END IF;
  -- profile_skills, AFTER each row: OLD is null on insert, NEW on delete.
  UPDATE public.profiles SET "matchVersion" = "matchVersion" + 1
    WHERE id IN (OLD."profileId", NEW."profileId");
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.bump_profile_match_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER bump_profile_match_version BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.bump_profile_match_version();
CREATE TRIGGER bump_profile_match_version AFTER INSERT OR UPDATE OR DELETE ON public.profile_skills
  FOR EACH ROW EXECUTE FUNCTION public.bump_profile_match_version();`;

const replaceProfileSkills = `CREATE OR REPLACE FUNCTION public.replace_profile_skills(p_profile_id uuid, p_skills jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  -- Lock the caller's draft or published profile so concurrent calls (double submit, two tabs)
  -- run one after the other: the second waits, then its delete sees the first one's rows.
  -- Not the caller's profile (missing, another user's): P0002, nothing written.
  PERFORM 1
     FROM public.profiles p
    WHERE p.id = p_profile_id AND p."userId" = (SELECT auth.uid()) AND p.state IN ('draft', 'published')
      FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'no profile of yours to replace the skills of';
  END IF;

  DELETE FROM public.profile_skills ps
   WHERE ps."profileId" = p_profile_id AND ps."userId" = (SELECT auth.uid());

  INSERT INTO public.profile_skills ("id", "userId", "profileId", "technology", "domain", "mastery", "importance")
  SELECT gen_random_uuid(), (SELECT auth.uid()), p_profile_id, s.technology, s.domain, s.mastery, s.importance
    FROM jsonb_to_recordset(p_skills) AS s(technology text, domain text, mastery integer, importance integer);
END $$;
REVOKE EXECUTE ON FUNCTION public.replace_profile_skills(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_profile_skills(uuid, jsonb) TO authenticated;`;

const matchReviewsProfileVersion = `CREATE FUNCTION public.match_reviews_profile_version() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT m."profileVersion" INTO NEW."profileVersion"
    FROM public.job_matches m WHERE m.id = NEW."matchId";
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.match_reviews_profile_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER match_reviews_profile_version BEFORE INSERT ON public.match_reviews
  FOR EACH ROW EXECUTE FUNCTION public.match_reviews_profile_version();`;

const backfill = `UPDATE public.job_matches SET "profileVersion" = 0;
UPDATE public.match_reviews r SET "profileVersion" = m."profileVersion"
  FROM public.job_matches m WHERE m.id = r."matchId";`;

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

const matchDetails = `CREATE OR REPLACE FUNCTION public.match_details(
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
  "reviewRule" text, "reviewField" text, "reviewChoice" text, "extractionId" uuid,
  "decisionStatus" text
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
WITH l AS MATERIALIZED (
  SELECT
    ${labelLists.map(labelMap).join(',\n    ')}
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
  m."reviewRule", m."reviewField", d.choice, f."extractionId", jd.status
FROM public.job_matches m
JOIN public.normalized_jobs j ON j.id = m."jobId"
LEFT JOIN public.job_facts f ON f."jobId" = m."jobId"
LEFT JOIN public.job_views v ON v."jobId" = m."jobId" AND v."userId" = (SELECT auth.uid())
LEFT JOIN public.job_decisions jd ON jd."jobId" = m."jobId" AND jd."userId" = (SELECT auth.uid())
CROSS JOIN LATERAL (
  SELECT ${fields.map((f) => `dd.d->'${f}' AS "${f}"`).join(', ')}
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
$$;
REVOKE EXECUTE ON FUNCTION public.match_details(uuid, text, timestamptz, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_details(uuid, text, timestamptz, uuid, boolean) TO authenticated;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: 'profile_skills_owner_delete_e80e5c12',
      }),
      this.dropRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: 'profile_skills_owner_insert_87e871a7',
      }),
      this.dropRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: 'profile_skills_owner_update_7fcd0c7f',
      }),
      this.dropRlsPolicy({
        schema: 'public',
        table: 'profiles',
        policy: 'profiles_owner_update_draft_b3dbbb7b',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'job_matches',
        column: 'profileUpdatedAt',
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_matches',
        column: col('profileVersion', 'int4', {
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'match_reviews',
        column: col('profileVersion', 'int4', {
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('matchVersion', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('searchesVersion', 'int4', {
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profile_skills_owner_delete',
            hash: '5640e969',
          },
          tableName: 'profile_skills',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_skills."profileId" AND p."userId" = auth.uid())`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profile_skills_owner_insert',
            hash: 'ca26fb79',
          },
          tableName: 'profile_skills',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['authenticated'],
          withCheck: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_skills."profileId" AND p."userId" = auth.uid())`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profile_skills',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profile_skills_owner_update',
            hash: '43e3a0db',
          },
          tableName: 'profile_skills',
          namespaceId: 'public',
          operation: 'update',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_skills."profileId" AND p."userId" = auth.uid())`,
          withCheck: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_skills."profileId" AND p."userId" = auth.uid())`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'profiles',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'profiles_owner_update',
            hash: '027386ad',
          },
          tableName: 'profiles',
          namespaceId: 'public',
          operation: 'update',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          withCheck: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      rawSql({
        id: 'functions.bump_profile_match_version',
        invariantId: 'profile-match-version',
        label:
          'Bump profiles.matchVersion when the matcher-relevant profile changes',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description:
              'create bump_profile_match_version() and its triggers on profiles and profile_skills',
            sql: bumpProfileMatchVersion,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.replace_profile_skills_published',
        invariantId: 'replace-profile-skills-published',
        label:
          "replace_profile_skills: accept the caller's draft or published profile",
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'profile_skills',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'replace replace_profile_skills(p_profile_id, p_skills)',
            sql: replaceProfileSkills,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.match_reviews_profile_version',
        invariantId: 'match-reviews-profile-version',
        label: 'Set match_reviews.profileVersion from its match on insert',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'match_reviews',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'create match_reviews_profile_version() and its trigger',
            sql: matchReviewsProfileVersion,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'data.profile_version_backfill',
        invariantId: 'profile-version-backfill',
        label: 'Backfill job_matches and match_reviews profileVersion to 0',
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
            description: 'set profileVersion on existing matches and reviews',
            sql: backfill,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.match_details_review_version',
        invariantId: 'match-details-review-version',
        label:
          "match_details: a review choice applies only on the match's profile version",
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
            description: 'replace match_details (same return columns)',
            sql: matchDetails,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
