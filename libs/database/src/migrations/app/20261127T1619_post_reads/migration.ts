#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5299fb8fc35c27b60dfa6c603b48c8f630d6657c3b48e80e47a4d33132349dc5/contract';
import startContract from '../../snapshots/5299fb8fc35c27b60dfa6c603b48c8f630d6657c3b48e80e47a4d33132349dc5/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f0d8e37dbfdce68f789a15567b397f2b6f782992b56b931c1acdd311e0dea8a7/contract';
import endContract from '../../snapshots/f0d8e37dbfdce68f789a15567b397f2b6f782992b56b931c1acdd311e0dea8a7/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

// NOTE: invariants (post-reads, post-rescue-junk) in ../refs/db.json decide whether the raw ops
// run on a fresh database. Advancing the `db` ref writes `invariants: []`; re-add every earlier
// invariant and these.
//
// The reads of the social posts page (spec 2026-11-27-posts-page-design). A post's author is
// read by the rule of the engine's originalAuthorOf: a share's original author (null when the
// original names none, never the sharer), else the source's own author. A profile "found" a post
// when a sighting of any raw item of the post job carries one of the profile's queries; a
// sighting with no query attributes to nobody. Only published profiles with post search on
// count. Helpers are granted to nobody; the RPCs to authenticated only, and read auth.uid().

// The author of a post job's postSources: the first source, in order, whose author by the
// originalAuthorOf rule is known. Null when none is.
const postAuthorOf = String.raw`CREATE OR REPLACE FUNCTION public.post_author_of(p_post_sources jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF jsonb_typeof(p_post_sources->'sources') IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT x.a
            FROM (SELECT CASE WHEN jsonb_typeof(s.value->'original') = 'object'
                              THEN s.value->'original'->'author'
                              ELSE s.value->'author' END AS a, s.ord
                    FROM jsonb_array_elements(p_post_sources->'sources') WITH ORDINALITY s(value, ord)) x
           WHERE jsonb_typeof(x.a) = 'object'
           ORDER BY x.ord
           LIMIT 1);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.post_author_of(jsonb) FROM PUBLIC, anon, authenticated;`;

// Every author key of a post job's sources, lower-cased like blocked_authors keys: each source's
// own author (a sharer, for a share) and its original's author.
const postAuthorKeys = String.raw`CREATE OR REPLACE FUNCTION public.post_author_keys(p_post_sources jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF jsonb_typeof(p_post_sources->'sources') IS DISTINCT FROM 'array' THEN
    RETURN '{}'::text[];
  END IF;
  RETURN ARRAY(
    SELECT DISTINCT lower(k.key)
      FROM jsonb_array_elements(p_post_sources->'sources') s(value)
      CROSS JOIN LATERAL (VALUES (s.value->'author'->>'key'),
                                 (s.value->'original'->'author'->>'key')) k(key)
     WHERE k.key IS NOT NULL);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.post_author_keys(jsonb) FROM PUBLIC, anon, authenticated;`;

// The contact email a post role states: its entry (by roleKey) in its post's current post
// extraction, howToApply.email. Null when any of those is missing.
const postRoleContactEmail = String.raw`CREATE OR REPLACE FUNCTION public.post_role_contact_email(p_job uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  RETURN (SELECT NULLIF(r.value->'howToApply'->>'email', '')
            FROM public.normalized_jobs j
            JOIN public.normalized_jobs p ON p.id = j."parentJobId"
            JOIN public.job_extractions e ON e.id = p."currentExtractionId" AND e."docType" = 'post'
            CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(e.data->'roles') = 'array' THEN e.data->'roles' ELSE '[]'::jsonb END) r(value)
           WHERE j.id = p_job AND j.kind = 'post_role'
             AND r.value->>'roleKey' = j."roleKey"
           LIMIT 1);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.post_role_contact_email(uuid) FROM PUBLIC, anon, authenticated;`;

// Email pending: the post role would be emailed (spec "Email pending"). An active, unarchived
// post role; qualified for one of the user's published profiles after reviews (match_details'
// reviewChoice overlay); its post's verdict hiring and sure; a contact email; no live rescue by
// the user; no decision on its linked group. An unsure verdict is never pending, approved or not.
// Slice 05 extends this definition.
const postEmailPending = String.raw`CREATE OR REPLACE FUNCTION public.post_email_pending(p_user uuid, p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_user IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.normalized_jobs j
      JOIN public.normalized_jobs p ON p.id = j."parentJobId"
      JOIN public.job_extractions e ON e.id = p."currentExtractionId" AND e."docType" = 'post'
     WHERE j.id = p_job AND j.kind = 'post_role' AND j.status = 'active'
       AND j."processingStatus" IS DISTINCT FROM 'archived'
       AND e.verdict = 'hiring' AND e."verdictConfidence" = 'sure') THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.job_matches m
      JOIN public.profiles pr ON pr.id = m."profileId" AND pr.state = 'published'
      -- match_details' reviewChoice: the latest choice, when it still applies to the match.
      LEFT JOIN LATERAL (
        SELECT r.choice
          FROM (SELECT r.choice, r.rule, r.field, r."createdAt", r."profileVersion"
                  FROM public.match_reviews r
                 WHERE r."matchId" = m.id AND r."userId" = m."userId"
                 ORDER BY r."createdAt" DESC, r.id DESC
                 LIMIT 1) r
         WHERE m.outcome = 'review' AND r.rule = m."reviewRule" AND r.field = m."reviewField"
           AND r."createdAt" >= m."decidedAt"
           AND r."profileVersion" = m."profileVersion") d ON true
     WHERE m."userId" = p_user AND m."jobId" = p_job
       AND COALESCE(d.choice, m.outcome) = 'qualified') THEN
    RETURN false;
  END IF;
  IF public.post_role_contact_email(p_job) IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.post_rescues r
              WHERE r."userId" = p_user AND r."jobId" = p_job AND r."undoneAt" IS NULL) THEN
    RETURN false;
  END IF;
  RETURN public.group_decision_status(p_user, p_job) IS NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.post_email_pending(uuid, uuid) FROM PUBLIC, anon, authenticated;`;

// The user's Junk tab: active processed post jobs first seen since p_since whose current post
// extraction rules them not_hiring or junk (sure or unsure), found by one of the user's
// published post-search profiles, minus those the user rescued and those with an author (an
// original's or a sharer's) the user blocked. p_job narrows it to one job (post_rescue,
// post_details). Newest first by firstSeenAt.
const postJunkRows = String.raw`CREATE OR REPLACE FUNCTION public.post_junk_rows(p_user uuid, p_since timestamp with time zone, p_job uuid DEFAULT NULL::uuid)
 RETURNS TABLE("jobId" uuid, "profileIds" uuid[], verdict text, confidence text, reason text, "postingUrl" text, "postedAt" timestamp with time zone, "firstSeenAt" timestamp with time zone, "authorName" text, "authorUrl" text, "authorKey" text, text text, "extractionId" uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH mine AS MATERIALIZED (
  SELECT p.id FROM public.profiles p
   WHERE p."userId" = p_user AND p.state = 'published' AND p."postSearch"
),
junk AS (
  SELECT j.id, j."postingUrl", j."postedAt", j."firstSeenAt", j."descriptionText", j."postSources",
         e.id AS "extractionId", e.verdict, e."verdictConfidence", e."verdictReason"
    FROM public.normalized_jobs j
    JOIN public.job_extractions e ON e.id = j."currentExtractionId" AND e."docType" = 'post'
   WHERE j.kind = 'post' AND j."processingStatus" = 'processed' AND j.status = 'active'
     AND j."firstSeenAt" >= p_since
     AND (p_job IS NULL OR j.id = p_job)
     AND e.verdict IN ('not_hiring', 'junk')
),
found AS (
  SELECT s."jobId", array_agg(DISTINCT q."profileId" ORDER BY q."profileId") AS ids
    FROM junk
    JOIN public.normalized_job_sources s ON s."jobId" = junk.id
    JOIN public.raw_item_sightings r ON r."rawItemId" = s."rawItemId"
    JOIN public.profile_query_search_builders q ON q."queryId" = r."queryId"
    JOIN mine ON mine.id = q."profileId"
   GROUP BY s."jobId"
)
SELECT junk.id, found.ids, junk.verdict, junk."verdictConfidence", junk."verdictReason",
       junk."postingUrl", junk."postedAt", junk."firstSeenAt",
       au.a->>'name', au.a->>'profileUrl', au.a->>'key', junk."descriptionText", junk."extractionId"
  FROM junk
  JOIN found ON found."jobId" = junk.id
  CROSS JOIN LATERAL (SELECT public.post_author_of(junk."postSources") AS a) au
 WHERE NOT EXISTS (SELECT 1 FROM public.post_rescues pr
                    WHERE pr."userId" = p_user AND pr."jobId" = junk.id AND pr."undoneAt" IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.blocked_authors b
                    WHERE b."userId" = p_user
                      AND b."authorKey" = ANY (public.post_author_keys(junk."postSources")))
 ORDER BY junk."firstSeenAt" DESC, junk.id DESC
$function$;
REVOKE EXECUTE ON FUNCTION public.post_junk_rows(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;`;

const postJunkList = String.raw`CREATE OR REPLACE FUNCTION public.post_junk_list(p_since timestamp with time zone)
 RETURNS TABLE("jobId" uuid, "profileIds" uuid[], verdict text, confidence text, reason text, "postingUrl" text, "postedAt" timestamp with time zone, "firstSeenAt" timestamp with time zone, "authorName" text, "authorUrl" text, "authorKey" text, text text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT r."jobId", r."profileIds", r.verdict, r.confidence, r.reason, r."postingUrl", r."postedAt",
       r."firstSeenAt", r."authorName", r."authorUrl", r."authorKey", r.text
  FROM public.post_junk_rows((SELECT auth.uid()), p_since) r
 ORDER BY r."firstSeenAt" DESC, r."jobId" DESC
$function$;
REVOKE EXECUTE ON FUNCTION public.post_junk_list(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_junk_list(timestamptz) TO authenticated;`;

// What the posts page's lists add to match_details rows, for the jobs of p_job_ids the caller
// has a match or a live rescue on, in the array's order. A post job (a Junk rescue) has no
// apply kinds and is never Email pending; its author is its own sources'.
const postListExtras = String.raw`CREATE OR REPLACE FUNCTION public.post_list_extras(p_job_ids uuid[])
 RETURNS TABLE("jobId" uuid, "emailPending" boolean, "applyKinds" text[], "authorName" text, "authorUrl" text, "authorKey" text, rescued boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH me AS (SELECT auth.uid() AS uid),
ids AS (
  SELECT u.id, min(u.ord) AS ord FROM unnest(p_job_ids) WITH ORDINALITY u(id, ord) GROUP BY u.id
)
SELECT j.id,
       CASE WHEN j.kind = 'post_role' THEN public.post_email_pending(me.uid, j.id) ELSE false END,
       CASE WHEN j.kind = 'post_role' THEN ARRAY(
         SELECT k.kind FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(role.entry->'howToApply'->'kinds') = 'array'
                THEN role.entry->'howToApply'->'kinds' ELSE '[]'::jsonb END) WITH ORDINALITY k(kind, ord)
          ORDER BY k.ord) END,
       au.a->>'name', au.a->>'profileUrl', au.a->>'key',
       rs.live
  FROM me
  CROSS JOIN ids
  JOIN public.normalized_jobs j ON j.id = ids.id AND j.kind IN ('post', 'post_role')
  JOIN public.normalized_jobs p ON p.id = COALESCE(j."parentJobId", j.id)
  LEFT JOIN public.job_extractions e ON e.id = p."currentExtractionId" AND e."docType" = 'post'
  LEFT JOIN LATERAL (
    SELECT r.value AS entry
      FROM jsonb_array_elements(
        CASE WHEN j.kind = 'post_role' AND jsonb_typeof(e.data->'roles') = 'array'
             THEN e.data->'roles' ELSE '[]'::jsonb END) r(value)
     WHERE r.value->>'roleKey' = j."roleKey"
     LIMIT 1) role ON true
  CROSS JOIN LATERAL (SELECT public.post_author_of(p."postSources") AS a) au
  CROSS JOIN LATERAL (SELECT EXISTS (
    SELECT 1 FROM public.post_rescues r
     WHERE r."userId" = me.uid AND r."jobId" = j.id AND r."undoneAt" IS NULL) AS live) rs
 WHERE rs.live
    OR EXISTS (SELECT 1 FROM public.job_matches m WHERE m."userId" = me.uid AND m."jobId" = j.id)
 ORDER BY ids.ord
$function$;
REVOKE EXECUTE ON FUNCTION public.post_list_extras(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_list_extras(uuid[]) TO authenticated;`;

// One post role's or post job's detail, for a caller with a match or a live rescue on it, or
// with it in their Junk tab (over the 30 days post_rescue accepts). The verdict is the post's
// current post extraction's; howToApply and authorRelation are the role's entry in it (null for
// a post job). linked lists the other jobs of the linked group the caller has a match on.
const postDetails = String.raw`CREATE OR REPLACE FUNCTION public.post_details(p_job_id uuid)
 RETURNS TABLE("jobId" uuid, kind text, "postJobId" uuid, "postingUrl" text, "postedAt" timestamp with time zone, verdict jsonb, "howToApply" jsonb, "authorRelation" text, sources jsonb, "emailPending" boolean, rescue jsonb, linked jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH me AS (SELECT auth.uid() AS uid)
SELECT j.id, j.kind, p.id, j."postingUrl", j."postedAt",
       CASE WHEN e.id IS NOT NULL THEN jsonb_build_object(
         'value', e.verdict,
         'reason', e."verdictReason",
         'confidence', e."verdictConfidence",
         'quote', e.data->'verdict'->'quote') END,
       role.entry->'howToApply',
       role.entry->>'authorRelation',
       p."postSources"->'sources',
       CASE WHEN j.kind = 'post_role' THEN public.post_email_pending(me.uid, j.id) ELSE false END,
       (SELECT jsonb_build_object('origin', r.origin, 'createdAt', r."createdAt", 'note', r.note)
          FROM public.post_rescues r
         WHERE r."userId" = me.uid AND r."jobId" = j.id AND r."undoneAt" IS NULL),
       (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'jobId', g.id,
                 'kind', g.kind,
                 'title', g.title,
                 'authorName', CASE WHEN g.kind = 'post_role'
                                    THEN public.post_author_of(gp."postSources")->>'name' END)
               ORDER BY g."firstSeenAt", g.id), '[]'::jsonb)
          FROM public.job_link_group(j.id) lg(id)
          JOIN public.normalized_jobs g ON g.id = lg.id
          LEFT JOIN public.normalized_jobs gp ON gp.id = g."parentJobId"
         WHERE g.id <> j.id
           AND EXISTS (SELECT 1 FROM public.job_matches m
                        WHERE m."userId" = me.uid AND m."jobId" = g.id))
  FROM me
  JOIN public.normalized_jobs j ON j.id = p_job_id AND j.kind IN ('post', 'post_role')
  JOIN public.normalized_jobs p ON p.id = COALESCE(j."parentJobId", j.id)
  LEFT JOIN public.job_extractions e ON e.id = p."currentExtractionId" AND e."docType" = 'post'
  LEFT JOIN LATERAL (
    SELECT r.value AS entry
      FROM jsonb_array_elements(
        CASE WHEN j.kind = 'post_role' AND jsonb_typeof(e.data->'roles') = 'array'
             THEN e.data->'roles' ELSE '[]'::jsonb END) r(value)
     WHERE r.value->>'roleKey' = j."roleKey"
     LIMIT 1) role ON true
 WHERE EXISTS (SELECT 1 FROM public.job_matches m WHERE m."userId" = me.uid AND m."jobId" = j.id)
    OR EXISTS (SELECT 1 FROM public.post_rescues r
                WHERE r."userId" = me.uid AND r."jobId" = j.id AND r."undoneAt" IS NULL)
    OR (j.kind = 'post' AND EXISTS (
          SELECT 1 FROM public.post_junk_rows(me.uid, now() - interval '30 days', j.id)))
$function$;
REVOKE EXECUTE ON FUNCTION public.post_details(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_details(uuid) TO authenticated;`;

// The caller's live rescues, newest first, minus those whose post has an author the caller
// blocked (blocking wins; unblocking brings them back). A disqualified rescue lists the
// profiles with a rejected match on it; a junk rescue, the profiles that found the post.
const postRescueList = String.raw`CREATE OR REPLACE FUNCTION public.post_rescue_list()
 RETURNS TABLE("jobId" uuid, kind text, origin text, "profileIds" uuid[], title text, "companyName" text, "postingUrl" text, "postedAt" timestamp with time zone, "firstSeenAt" timestamp with time zone, "authorName" text, "decisionStatus" text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH me AS (SELECT auth.uid() AS uid)
SELECT j.id, j.kind, r.origin,
       CASE WHEN r.origin = 'disqualified' THEN ARRAY(
         SELECT DISTINCT m."profileId" FROM public.job_matches m
          WHERE m."userId" = me.uid AND m."jobId" = j.id AND m.outcome = 'rejected'
          ORDER BY 1)
       ELSE ARRAY(
         SELECT DISTINCT q."profileId"
           FROM public.normalized_job_sources s
           JOIN public.raw_item_sightings ris ON ris."rawItemId" = s."rawItemId"
           JOIN public.profile_query_search_builders q ON q."queryId" = ris."queryId"
           JOIN public.profiles pr ON pr.id = q."profileId"
          WHERE s."jobId" = j.id AND pr."userId" = me.uid
            AND pr.state = 'published' AND pr."postSearch"
          ORDER BY 1) END,
       j.title, j."companyName", j."postingUrl", j."postedAt", j."firstSeenAt",
       public.post_author_of(p."postSources")->>'name',
       public.group_decision_status(me.uid, j.id)
  FROM me
  JOIN public.post_rescues r ON r."userId" = me.uid AND r."undoneAt" IS NULL
  JOIN public.normalized_jobs j ON j.id = r."jobId"
  JOIN public.normalized_jobs p ON p.id = COALESCE(j."parentJobId", j.id)
 WHERE NOT EXISTS (SELECT 1 FROM public.blocked_authors b
                    WHERE b."userId" = me.uid
                      AND b."authorKey" = ANY (public.post_author_keys(p."postSources")))
 ORDER BY r."createdAt" DESC, r.id DESC
$function$;
REVOKE EXECUTE ON FUNCTION public.post_rescue_list() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_rescue_list() TO authenticated;`;

// The job of p_job_id's linked group that holds the caller's winning decision, by
// group_decision_status' precedence (applied, then expired, then dismissed; newest of a kind).
const groupDecisionJob = String.raw`CREATE OR REPLACE FUNCTION public.group_decision_job(p_job_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.job_decisions d WHERE d."userId" = v_user) THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT d."jobId"
            FROM public.job_decisions d
           WHERE d."userId" = v_user
             AND d."jobId" IN (SELECT public.job_link_group(p_job_id))
           ORDER BY CASE d.status WHEN 'applied' THEN 0 WHEN 'expired' THEN 1 ELSE 2 END,
                    d."decidedAt" DESC, d.id DESC
           LIMIT 1);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.group_decision_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.group_decision_job(uuid) TO authenticated;`;

// post_rescue is 20261127T1604_post_rescues' definition plus the Junk branch: a post job
// (kind = 'post') in the caller's Junk tab over the last 30 days, snapshotting its verdict, its
// extraction and the profiles that found it.
const postRescue = String.raw`CREATE OR REPLACE FUNCTION public.post_rescue(p_job_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
  v_kind text;
  v_origin text;
  v_snapshot jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not rescuable';
  END IF;
  SELECT r.id INTO v_id FROM public.post_rescues r
   WHERE r."userId" = v_user AND r."jobId" = p_job_id AND r."undoneAt" IS NULL;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT j.kind INTO v_kind FROM public.normalized_jobs j WHERE j.id = p_job_id;
  IF v_kind = 'post' THEN
    SELECT jsonb_build_object(
             'verdict', jsonb_build_object('value', r.verdict, 'reason', r.reason, 'confidence', r.confidence),
             'extractionId', r."extractionId",
             'profileIds', to_jsonb(r."profileIds"))
      INTO v_snapshot
      FROM public.post_junk_rows(v_user, now() - interval '30 days', p_job_id) r;
    IF v_snapshot IS NULL THEN
      RAISE EXCEPTION 'not rescuable';
    END IF;
    v_origin := 'junk';
  ELSIF v_kind = 'post_role' AND EXISTS (
          SELECT 1 FROM public.job_matches m
           WHERE m."userId" = v_user AND m."jobId" = p_job_id AND m.outcome = 'rejected') THEN
    SELECT jsonb_build_object(
             'profiles', jsonb_agg(jsonb_build_object(
               'profileId', m."profileId",
               'matchId', m.id,
               'matcherVersion', m."matcherVersion",
               'failed', COALESCE((
                 SELECT jsonb_agg(c.value)
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.checks) = 'array' THEN m.checks ELSE '[]'::jsonb END) c
                  WHERE c.value ->> 'outcome' = 'fail'), '[]'::jsonb)
             ) ORDER BY m."decidedAt", m.id),
             'extractionId', (SELECT j."currentExtractionId" FROM public.normalized_jobs j WHERE j.id = p_job_id))
      INTO v_snapshot
      FROM public.job_matches m
     WHERE m."userId" = v_user AND m."jobId" = p_job_id AND m.outcome = 'rejected';
    v_origin := 'disqualified';
  ELSE
    RAISE EXCEPTION 'not rescuable';
  END IF;
  INSERT INTO public.post_rescues ("userId", "jobId", origin, snapshot, note)
  VALUES (v_user, p_job_id, v_origin, v_snapshot, p_note)
  ON CONFLICT ("userId", "jobId") WHERE "undoneAt" IS NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.post_rescues r
     WHERE r."userId" = v_user AND r."jobId" = p_job_id AND r."undoneAt" IS NULL;
  END IF;
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.post_rescue(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_rescue(uuid, text) TO authenticated;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'normalized_jobs',
        index: 'normalized_jobs_processed_posts_a37ab94e',
        columns: ['firstSeenAt'],
        extras: {
          where: sql`kind = 'post' AND "processingStatus" = 'processed'`,
        },
      }),
      rawSql({
        id: 'functions.post_reads',
        invariantId: 'post-reads',
        label:
          'post reads: post_junk_list, post_list_extras, post_details, post_rescue_list, group_decision_job and their helpers',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'normalized_jobs',
          },
        },
        precheck: [],
        execute: [
          { description: 'create post_author_of', sql: postAuthorOf },
          { description: 'create post_author_keys', sql: postAuthorKeys },
          {
            description: 'create post_role_contact_email',
            sql: postRoleContactEmail,
          },
          { description: 'create post_email_pending', sql: postEmailPending },
          { description: 'create post_junk_rows', sql: postJunkRows },
          { description: 'create post_junk_list', sql: postJunkList },
          { description: 'create post_list_extras', sql: postListExtras },
          { description: 'create post_details', sql: postDetails },
          { description: 'create post_rescue_list', sql: postRescueList },
          { description: 'create group_decision_job', sql: groupDecisionJob },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.post_rescue_junk',
        invariantId: 'post-rescue-junk',
        label: "post_rescue accepts a post in the caller's Junk tab",
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'post_rescues',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'replace post_rescue: add the Junk branch',
            sql: postRescue,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
