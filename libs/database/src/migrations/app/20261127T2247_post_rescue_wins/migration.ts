#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/a0917348c1267aba2f41c5b39988f9d003b36a3dadd7f37284afb66803615824/contract';
import endContract from '../../snapshots/a0917348c1267aba2f41c5b39988f9d003b36a3dadd7f37284afb66803615824/contract.json' with { type: 'json' };
import startContract from '../../snapshots/a0917348c1267aba2f41c5b39988f9d003b36a3dadd7f37284afb66803615824/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so its invariant
// (post-rescue-wins) in ../refs/db.json decides whether it runs on a fresh database. Advancing
// the `db` ref writes `invariants: []`; re-add every earlier invariant and this one.
//
// A Junk rescue wins over the roles a later re-extraction makes of its post (spec
// 2026-11-27-posts-page-design, "Rescue": no later re-extraction takes a rescued post out of
// the rescuer's Matches). Each function is its latest definition with only these changes:
// - post_rescue_list (20261127T1818_post_rescue_fixes) always lists a live Junk rescue (the
//   dedupe that hid it behind a matched role is gone) and returns "coveredJobIds": the role
//   jobs of a Junk-rescued post, which the posts page leaves out of every tab while the rescue
//   is live. A new column changes the return type, so the function is dropped and re-created.
// - post_rescue (20261127T1619_post_reads) refuses a role a live Junk rescue of its post covers.

// post_rescue_list (20261127T1818_post_rescue_fixes): no dedupe; "coveredJobIds".
const postRescueList = String.raw`DROP FUNCTION IF EXISTS public.post_rescue_list();
CREATE FUNCTION public.post_rescue_list()
 RETURNS TABLE("jobId" uuid, kind text, origin text, "profileIds" uuid[], title text, "companyName" text, "postingUrl" text, "postedAt" timestamp with time zone, "firstSeenAt" timestamp with time zone, "authorName" text, "decisionStatus" text, "coveredJobIds" uuid[])
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
       public.group_decision_status(me.uid, j.id),
       -- The roles a later re-extraction made of a Junk-rescued post: the rescue wins, so the
       -- posts page lists none of them while it is live.
       CASE WHEN r.origin = 'junk' THEN ARRAY(
         SELECT c.id FROM public.normalized_jobs c
          WHERE c."parentJobId" = j.id AND c.kind = 'post_role'
          ORDER BY c.id)
       ELSE '{}'::uuid[] END
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

// post_rescue (20261127T1619_post_reads): no second rescue of a covered role.
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
           WHERE m."userId" = v_user AND m."jobId" = p_job_id AND m.outcome = 'rejected')
        -- A live Junk rescue of the role's post already covers it.
        AND NOT EXISTS (
          SELECT 1 FROM public.post_rescues r
            JOIN public.normalized_jobs j ON j.id = p_job_id
           WHERE r."userId" = v_user AND r."jobId" = j."parentJobId" AND r."undoneAt" IS NULL) THEN
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
      rawSql({
        id: 'functions.post_rescue_wins',
        invariantId: 'post-rescue-wins',
        label:
          "post_rescue_list, post_rescue: a Junk rescue stays listed and covers its post's roles",
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
              'replace post_rescue_list: always list a Junk rescue; its covered role ids',
            sql: postRescueList,
          },
          {
            description: 'replace post_rescue: refuse a covered role',
            sql: postRescue,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
