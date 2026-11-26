#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/b5852fb88a982712de75cf95bee57f920a90aeb4f4c941188c17824f2f6ca558/contract';
import startContract from '../../snapshots/b5852fb88a982712de75cf95bee57f920a90aeb4f4c941188c17824f2f6ca558/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/bfda5e93e4e7ecad4a8630730b553996ce2a804563293fb68414cf72428dbed1/contract';
import endContract from '../../snapshots/bfda5e93e4e7ecad4a8630730b553996ce2a804563293fb68414cf72428dbed1/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

// NOTE: advancing the `db` ref in ../refs/db.json writes `invariants: []`; re-add every earlier
// invariant and the three added here.

const bumpOnBlockedAuthors = `CREATE TRIGGER bump_eligibility_version AFTER INSERT OR DELETE ON public.blocked_authors
  FOR EACH ROW EXECUTE FUNCTION public.bump_eligibility_version();`;

// match_details gains p_kind (default 'job'), so listing views never see a post role. The body is
// 20261121T1131_profile_edits' definition plus the kind filter. The old 5-argument signature goes.
const matchDetails = String.raw`DROP FUNCTION public.match_details(uuid, text, timestamptz, uuid, boolean);
CREATE OR REPLACE FUNCTION public.match_details(p_profile_id uuid DEFAULT NULL::uuid, p_outcome text DEFAULT 'qualified'::text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_job_id uuid DEFAULT NULL::uuid, p_details boolean DEFAULT true, p_kind text DEFAULT 'job'::text)
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
  m."reviewRule", m."reviewField", d.choice, f."extractionId", jd.status
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

// webhook_enqueue_match (20261116T0654_webhook_rpcs) sends listings only: a post role never fires one.
const enqueueMatch = String.raw`CREATE OR REPLACE FUNCTION public.webhook_enqueue_match(p_match_id uuid, p_trigger text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile uuid;
  v_root uuid;
  v_next uuid;
  v_id uuid;
BEGIN
  SELECT m."profileId", m."jobId" INTO v_profile, v_root
    FROM job_matches m JOIN normalized_jobs j ON j.id = m."jobId"
   WHERE m.id = p_match_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- The root of the job's merge chain: follow mergedIntoId to a job with none, at most 10 steps.
  FOR i IN 1..10 LOOP
    SELECT "mergedIntoId" INTO v_next FROM normalized_jobs WHERE id = v_root;
    EXIT WHEN v_next IS NULL;
    v_root := v_next;
  END LOOP;
  -- Serialise calls for the same (profile, root job) until commit; the next statement takes
  -- a fresh snapshot, so a waiter sees the delivery the holder committed.
  PERFORM pg_advisory_xact_lock(hashtextextended('webhook:' || v_profile || ':' || v_root, 0));
  -- One pending delivery when the user's webhook is on, the job was first seen since both the
  -- profile was published and the webhook was turned on, and the profile has no match delivery
  -- on a job with the same merge root (this job, a job merged into it, its merge target, a
  -- merge sibling, or anything further along the same chain).
  INSERT INTO webhook_deliveries ("userId", "webhookId", kind, "profileId", "jobId", "matchId", trigger, status, attempts, "nextAttemptAt")
  SELECT m."userId", w.id, 'match', m."profileId", m."jobId", m.id, p_trigger, 'pending', 0, now()
  FROM job_matches m
  JOIN webhooks w ON w."userId" = m."userId" AND w.enabled
  JOIN profiles p ON p.id = m."profileId" AND p.state = 'published'
  JOIN normalized_jobs j ON j.id = m."jobId"
  WHERE m.id = p_match_id
    AND j.kind = 'job'
    AND j."firstSeenAt" >= p."publishedAt" AND j."firstSeenAt" >= w."enabledSince"
    AND NOT EXISTS (
      -- Each delivered job's chain, the same 10 steps; the last step (no next) is its root.
      WITH RECURSIVE chain (job, next, depth) AS (
        SELECT dj.id, dj."mergedIntoId", 0
          FROM webhook_deliveries d JOIN normalized_jobs dj ON dj.id = d."jobId"
         WHERE d.kind = 'match' AND d."profileId" = v_profile
        UNION ALL
        SELECT n.id, n."mergedIntoId", c.depth + 1
          FROM chain c JOIN normalized_jobs n ON n.id = c.next
         WHERE c.depth < 10)
      SELECT 1 FROM chain WHERE chain.next IS NULL AND chain.job = v_root)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
REVOKE EXECUTE ON FUNCTION public.webhook_enqueue_match(uuid, text) FROM PUBLIC, anon, authenticated;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'blocked_authors',
        columns: [
          col('authorKey', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('profileUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('userId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'blocked_authors_author_key_ac50d50b',
            sql`"authorKey" ~ '^(profile|company):.+$'`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'blocked_authors',
        constraint: 'blocked_authors_userId_authorKey_key',
        columns: ['userId', 'authorKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'blocked_authors',
        index: 'blocked_authors_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'blocked_authors',
        foreignKey: {
          name: 'blocked_authors_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'blocked_authors',
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'blocked_authors',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'blocked_authors_owner_delete',
            hash: '8d4763aa',
          },
          tableName: 'blocked_authors',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'blocked_authors',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'blocked_authors_owner_insert',
            hash: 'e7171a20',
          },
          tableName: 'blocked_authors',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['authenticated'],
          withCheck: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'blocked_authors',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'blocked_authors_owner_read',
            hash: 'ab58a1a7',
          },
          tableName: 'blocked_authors',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      rawSql({
        id: 'trigger.blocked_authors_eligibility',
        invariantId: 'blocked-authors-eligibility',
        label: 'blocked_authors: any insert or delete bumps eligibilityVersion',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'blocked_authors',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'create the bump_eligibility_version trigger on blocked_authors',
            sql: bumpOnBlockedAuthors,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.match_details_kind',
        invariantId: 'match-details-kind',
        label: 'match_details: p_kind filter, listings by default',
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
            description: 'replace match_details with a p_kind argument',
            sql: matchDetails,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.webhook_enqueue_match_listings',
        invariantId: 'webhook-listings-only',
        label: 'webhook_enqueue_match: listings only',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'webhook_deliveries',
          },
        },
        precheck: [],
        execute: [
          { description: 'replace webhook_enqueue_match', sql: enqueueMatch },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
