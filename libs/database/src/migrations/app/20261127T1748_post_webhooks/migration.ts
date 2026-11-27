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

// NOTE: this migration changes no contract (same start and end hash), so its invariant
// (post-webhooks) in ../refs/db.json decides whether it runs on a fresh database. Advancing the
// `db` ref writes `invariants: []`; re-add every earlier invariant and this one.
//
// Qualified post roles reach the user's webhook (spec 2026-11-27-posts-page-design, "Webhooks"),
// held while Email pending, never for a rescue or a role the user already decided, and only for
// matches first decided after this migration ran: the post-deploy rematch must not send every
// past qualified role at once. The matcher re-decides rows in place (ON CONFLICT DO UPDATE), so
// job_matches."createdAt" is when a (profile, job) pair was first decided.

// The cutoff: the moment this migration ran, baked into the function body as a literal so it
// never moves. Created only when missing, so a re-run keeps the first moment. A helper: granted
// to nobody.
const postWebhooksSince = String.raw`DO $do$
BEGIN
  IF to_regprocedure('public.post_webhooks_since()') IS NULL THEN
    EXECUTE format($f$CREATE FUNCTION public.post_webhooks_since()
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $body$SELECT %L::timestamptz$body$$f$, now());
  END IF;
END
$do$;
REVOKE EXECUTE ON FUNCTION public.post_webhooks_since() FROM PUBLIC, anon, authenticated;`;

// webhook_enqueue_match (20261125T1248_post_matching), with post roles let through under the hold.
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
    -- A post role goes only when it was first decided after the cutoff (no backfill), is not
    -- Email pending (slice 05 creates its delivery when the send settles), was not rescued, and
    -- has no decision on its linked group (the user already acted on it).
    AND (j.kind = 'job'
         OR (j.kind = 'post_role'
             AND m."createdAt" >= public.post_webhooks_since()
             AND NOT public.post_email_pending(m."userId", j.id)
             AND NOT EXISTS (SELECT 1 FROM public.post_rescues r
                              WHERE r."userId" = m."userId" AND r."jobId" = j.id
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
        id: 'functions.post_webhooks',
        invariantId: 'post-webhooks',
        label:
          'post_webhooks_since; webhook_enqueue_match sends post roles, held while Email pending',
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
          { description: 'create post_webhooks_since', sql: postWebhooksSince },
          {
            description: 'replace webhook_enqueue_match: post roles',
            sql: enqueueMatch,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
