#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/f0d8e37dbfdce68f789a15567b397f2b6f782992b56b931c1acdd311e0dea8a7/contract';
import endContract from '../../snapshots/f0d8e37dbfdce68f789a15567b397f2b6f782992b56b931c1acdd311e0dea8a7/contract.json' with { type: 'json' };
import startContract from '../../snapshots/f0d8e37dbfdce68f789a15567b397f2b6f782992b56b931c1acdd311e0dea8a7/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so its invariants
// (post-rescue-fixes, post-webhooks-first-seen) in ../refs/db.json decide whether it runs on a
// fresh database. Advancing the `db` ref writes `invariants: []`; re-add every earlier invariant
// and these.
//
// Fixes from the posts page's final review (spec 2026-11-27-posts-page-design, "Rescue",
// "Email pending", "Webhooks"). Each function is its latest definition (20261127T1619_post_reads,
// 20261127T1748_post_webhooks) with only these changes:
// - A Junk rescue of a post also covers the roles a later re-extraction makes of it:
//   post_email_pending and webhook_enqueue_match test a live rescue of the role or its post.
// - post_rescue_list keeps a rescue's profiles once the rows it was built from are gone (the
//   snapshot's profiles, the caller's own only), and hides a Junk rescue while a role of its
//   post is in the caller's lists (the role shows there instead).
// - post_details' rescue carries the verdict a Junk rescue was rescued from (the snapshot's).
// - webhook_enqueue_match sends a post role only when the role was first seen after the cutoff.

// post_email_pending (20261127T1619_post_reads): the rescue test covers the role's post.
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
  -- A live rescue of the role, or of its post (a Junk rescue covers the roles a later
  -- re-extraction makes of the post).
  IF EXISTS (SELECT 1 FROM public.post_rescues r
               JOIN public.normalized_jobs j ON j.id = p_job
              WHERE r."userId" = p_user AND r."jobId" IN (j.id, j."parentJobId")
                AND r."undoneAt" IS NULL) THEN
    RETURN false;
  END IF;
  RETURN public.group_decision_status(p_user, p_job) IS NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.post_email_pending(uuid, uuid) FROM PUBLIC, anon, authenticated;`;

// post_details (20261127T1619_post_reads): rescue adds the snapshot's verdict (null for a
// disqualified rescue, whose snapshot has none).
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
       (SELECT jsonb_build_object('origin', r.origin, 'createdAt', r."createdAt", 'note', r.note,
                                  'verdict', CASE WHEN jsonb_typeof(r.snapshot->'verdict') = 'object'
                                                  THEN r.snapshot->'verdict' END)
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

// post_rescue_list (20261127T1619_post_reads): a rescue lists the caller's profiles named in its
// snapshot plus, for a disqualified rescue, those with a rejected match on it and, for a junk
// rescue, the published post-search profiles that found the post. A Junk rescue hides while a
// role of its post is in the caller's lists.
const postRescueList = String.raw`CREATE OR REPLACE FUNCTION public.post_rescue_list()
 RETURNS TABLE("jobId" uuid, kind text, origin text, "profileIds" uuid[], title text, "companyName" text, "postingUrl" text, "postedAt" timestamp with time zone, "firstSeenAt" timestamp with time zone, "authorName" text, "decisionStatus" text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH me AS (SELECT auth.uid() AS uid)
SELECT j.id, j.kind, r.origin,
       ARRAY(
         SELECT DISTINCT pr.id
           FROM public.profiles pr
          WHERE pr."userId" = me.uid
            AND (pr.id::text IN (
                   SELECT x.value->>'profileId'
                     FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(r.snapshot->'profiles') = 'array'
                            THEN r.snapshot->'profiles' ELSE '[]'::jsonb END) x(value))
                 OR pr.id::text IN (
                   SELECT x.value
                     FROM jsonb_array_elements_text(
                       CASE WHEN jsonb_typeof(r.snapshot->'profileIds') = 'array'
                            THEN r.snapshot->'profileIds' ELSE '[]'::jsonb END) x(value))
                 OR (r.origin = 'disqualified' AND EXISTS (
                       SELECT 1 FROM public.job_matches m
                        WHERE m."userId" = me.uid AND m."jobId" = j.id
                          AND m."profileId" = pr.id AND m.outcome = 'rejected'))
                 OR (r.origin = 'junk' AND pr.state = 'published' AND pr."postSearch" AND EXISTS (
                       SELECT 1
                         FROM public.normalized_job_sources s
                         JOIN public.raw_item_sightings ris ON ris."rawItemId" = s."rawItemId"
                         JOIN public.profile_query_search_builders q ON q."queryId" = ris."queryId"
                        WHERE s."jobId" = j.id AND q."profileId" = pr.id)))
          ORDER BY 1),
       j.title, j."companyName", j."postingUrl", j."postedAt", j."firstSeenAt",
       public.post_author_of(p."postSources")->>'name',
       public.group_decision_status(me.uid, j.id)
  FROM me
  JOIN public.post_rescues r ON r."userId" = me.uid AND r."undoneAt" IS NULL
  JOIN public.normalized_jobs j ON j.id = r."jobId"
  JOIN public.normalized_jobs p ON p.id = COALESCE(j."parentJobId", j.id)
 WHERE NOT (r.origin = 'junk' AND EXISTS (
         -- A role a later re-extraction made of the rescued post, in the caller's lists: the
         -- role shows there instead (the rescue still covers it: no email, no webhook).
         SELECT 1
           FROM public.normalized_jobs c
           JOIN public.job_matches m ON m."jobId" = c.id AND m."userId" = me.uid
           JOIN public.profiles pr ON pr.id = m."profileId"
                                  AND pr.state = 'published' AND pr."postSearch"
          WHERE c."parentJobId" = j.id AND c.kind = 'post_role' AND c.status = 'active'
            AND c."processingStatus" IS DISTINCT FROM 'archived'))
   AND NOT EXISTS (SELECT 1 FROM public.blocked_authors b
                    WHERE b."userId" = me.uid
                      AND b."authorKey" = ANY (public.post_author_keys(p."postSources")))
 ORDER BY r."createdAt" DESC, r.id DESC
$function$;
REVOKE EXECUTE ON FUNCTION public.post_rescue_list() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_rescue_list() TO authenticated;`;

// webhook_enqueue_match (20261127T1748_post_webhooks): post roles first seen after the cutoff,
// and a Junk rescue of the role's post holds it like a rescue of the role.
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
    -- A post role goes only when it was first decided and first seen after the cutoff (no
    -- backfill: turning post search off deletes its matches, and on again re-creates them with
    -- a new createdAt; a role copies its post's firstSeenAt), is not Email pending (slice 05
    -- creates its delivery when the send settles), was not rescued (nor its post, from Junk),
    -- and has no decision on its linked group (the user already acted on it).
    AND (j.kind = 'job'
         OR (j.kind = 'post_role'
             AND m."createdAt" >= public.post_webhooks_since()
             AND j."firstSeenAt" >= public.post_webhooks_since()
             AND NOT public.post_email_pending(m."userId", j.id)
             AND NOT EXISTS (SELECT 1 FROM public.post_rescues r
                              WHERE r."userId" = m."userId" AND r."jobId" IN (j.id, j."parentJobId")
                                AND r."undoneAt" IS NULL)
             AND public.group_decision_status(m."userId", j.id) IS NULL))
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
      rawSql({
        id: 'functions.post_rescue_fixes',
        invariantId: 'post-rescue-fixes',
        label:
          "post_email_pending, post_details, post_rescue_list: a Junk rescue covers its post's roles; rescues keep their profiles and verdict",
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
            description:
              'replace post_email_pending: a rescue of the role or its post',
            sql: postEmailPending,
          },
          {
            description: "replace post_details: the rescue's snapshot verdict",
            sql: postDetails,
          },
          {
            description:
              'replace post_rescue_list: snapshot profiles; hide a Junk rescue behind its roles',
            sql: postRescueList,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.post_webhooks_first_seen',
        invariantId: 'post-webhooks-first-seen',
        label:
          "webhook_enqueue_match: post roles first seen after the cutoff; a rescue of the role's post holds it",
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
          {
            description:
              'replace webhook_enqueue_match: first seen after the cutoff',
            sql: enqueueMatch,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
