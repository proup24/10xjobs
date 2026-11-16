#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/9a48a4e77a746f4139019f4d84e5ccddfee3174d4b606a6626b8181d84715a60/contract';
import endContract from '../../snapshots/9a48a4e77a746f4139019f4d84e5ccddfee3174d4b606a6626b8181d84715a60/contract.json' with { type: 'json' };
import startContract from '../../snapshots/9a48a4e77a746f4139019f4d84e5ccddfee3174d4b606a6626b8181d84715a60/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the `webhook-rpcs`
// invariant in ../refs/db.json decides whether it runs on a fresh database. Advancing the `db`
// ref writes `invariants: []`; re-add it, and keep the earlier ones.
//
// 1. webhook_enqueue_match compares the root of each job's merge chain (follow mergedIntoId to a
//    job with none, at most 10 steps) for the job being enqueued and every job the profile was
//    already sent, and takes its advisory lock on that root. One level was not enough: after
//    A -> B and then B -> D, D's coalesce(mergedIntoId, id) is D while A's is B, so D was sent
//    again. Everything else is as 20261116T0641_match_webhooks.
// 2. The user RPCs, the only way a signed-in user writes `webhooks` or asks for a test delivery
//    (RLS gives owners SELECT only). Each acts on auth.uid() alone and raises 42501 without it;
//    EXECUTE is for authenticated only. The web app maps on the errors:
//    webhook_save raises 22023 'invalid webhook url'; webhook_send_test raises P0001
//    'webhook off' (no webhook, or off) and 'too soon' (a test row in the last 10 s).

const enqueueMatch = String.raw`CREATE OR REPLACE FUNCTION public.webhook_enqueue_match(p_match_id uuid, p_trigger text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;
REVOKE EXECUTE ON FUNCTION public.webhook_enqueue_match(uuid, text) FROM PUBLIC, anon, authenticated;`;

// Raised by every RPC when there is no signed-in user.
const signedIn = `IF v_user IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;`;

/** SECURITY DEFINER with a pinned search_path; EXECUTE for authenticated only. */
const grant = (signature: string) =>
  `REVOKE EXECUTE ON FUNCTION public.${signature} FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`;

const userRpcs = String.raw`-- Whether a webhook URL may be saved: https, no userinfo, at most 2048 characters, and a host
-- that is a DNS name (ASCII; IDNs in punycode) other than localhost, *.localhost, *.local and
-- *.internal. Any IP literal is refused: IPv6 in brackets, and any host whose last label is a
-- number (decimal, or hex with 0x), which URL parsers read as IPv4 (10.0.0.1, 2130706433,
-- 0x7f.0.0.1). The engine checks what the name resolves to before each send.
CREATE FUNCTION public.webhook_url_ok(p_url text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_authority text;
  v_host text;
BEGIN
  IF p_url IS NULL OR length(p_url) > 2048 OR p_url !~* '^https://'
     OR p_url ~ '[[:space:][:cntrl:]\\]' THEN
    RETURN false;
  END IF;
  -- Everything between "https://" and the path, query or fragment.
  v_authority := substring(substring(p_url from 9) from '^[^/?#]*');
  IF v_authority LIKE '%@%' OR v_authority LIKE '[%' THEN
    RETURN false;
  END IF;
  -- The host, without an optional port and trailing dots; null when the port is malformed.
  v_host := rtrim(lower(substring(v_authority from '^([^:]*)(:[0-9]{1,5})?$')), '.');
  IF v_host IS NULL OR v_host = '' OR v_host !~ '^[a-z0-9._-]+$' OR v_host ~ '(^\.|\.\.)' THEN
    RETURN false;
  END IF;
  IF v_host = 'localhost' OR v_host ~ '\.(localhost|local|internal)$' THEN
    RETURN false;
  END IF;
  IF v_host ~ '(^|\.)(0x[0-9a-f]*|[0-9]+)$' THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;
${grant('webhook_url_ok(text)')}

-- Creates the user's webhook (on, enabledSince now, a new secret) or changes its URL. A new URL
-- resets consecutiveFailures; saving the same URL changes nothing.
CREATE FUNCTION public.webhook_save(p_url text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  ${signedIn}
  IF NOT coalesce(webhook_url_ok(p_url), false) THEN
    RAISE EXCEPTION 'invalid webhook url' USING ERRCODE = '22023';
  END IF;
  INSERT INTO webhooks ("userId", url, enabled, "enabledSince")
  VALUES (v_user, p_url, true, now())
  ON CONFLICT ("userId") DO UPDATE
    SET url = EXCLUDED.url, "consecutiveFailures" = 0, "updatedAt" = now()
    WHERE webhooks.url IS DISTINCT FROM EXCLUDED.url;
END $$;
${grant('webhook_save(text)')}

-- Off -> on moves enabledSince to now (jobs first seen while off are never sent) and clears the
-- failure count and the reason; on -> off records 'user'. The state it already has is a no-op,
-- so an engine 'failing' stays until the user turns it on.
CREATE FUNCTION public.webhook_set_enabled(p_enabled boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  ${signedIn}
  IF p_enabled THEN
    UPDATE webhooks
       SET enabled = true, "enabledSince" = now(), "consecutiveFailures" = 0,
           "disabledReason" = NULL, "updatedAt" = now()
     WHERE "userId" = v_user AND NOT enabled;
  ELSIF NOT p_enabled THEN
    UPDATE webhooks
       SET enabled = false, "disabledReason" = 'user', "updatedAt" = now()
     WHERE "userId" = v_user AND enabled;
  END IF;
END $$;
${grant('webhook_set_enabled(boolean)')}

-- A new secret from the column default (32 random bytes, base64url).
CREATE FUNCTION public.webhook_rotate_secret() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  ${signedIn}
  UPDATE webhooks SET secret = DEFAULT, "updatedAt" = now() WHERE "userId" = v_user;
END $$;
${grant('webhook_rotate_secret()')}

-- Deletes the user's webhook; its deliveries cascade. A later save starts a new webhook whose
-- enabledSince is then, so jobs from before are not sent.
CREATE FUNCTION public.webhook_delete() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  ${signedIn}
  DELETE FROM webhooks WHERE "userId" = v_user;
END $$;
${grant('webhook_delete()')}

-- Queues a test delivery and returns its id. The webhook row is locked, so two calls at once
-- cannot both pass the 10 s check.
CREATE FUNCTION public.webhook_send_test() RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_webhook uuid;
  v_id uuid;
BEGIN
  ${signedIn}
  SELECT id INTO v_webhook FROM webhooks WHERE "userId" = v_user AND enabled FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'webhook off' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM webhook_deliveries
     WHERE "webhookId" = v_webhook AND kind = 'test' AND "createdAt" > now() - interval '10 seconds'
  ) THEN
    RAISE EXCEPTION 'too soon' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO webhook_deliveries ("userId", "webhookId", kind, status, attempts, "nextAttemptAt")
  VALUES (v_user, v_webhook, 'test', 'pending', 0, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
${grant('webhook_send_test()')}`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'functions.webhook_enqueue_match_root',
        invariantId: 'webhook-rpcs',
        label:
          'webhook_enqueue_match: compare and lock on the root of each merge chain',
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
            description: 'replace webhook_enqueue_match(p_match_id, p_trigger)',
            sql: enqueueMatch,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        // The invariant is edge-level: the first op's invariantId routes this one too.
        id: 'functions.webhook_rpcs',
        label:
          'webhook_url_ok, webhook_save, webhook_set_enabled, webhook_rotate_secret, webhook_delete and webhook_send_test for authenticated',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'webhooks' },
        },
        precheck: [],
        execute: [
          {
            description: 'create the webhook RPCs',
            sql: userRpcs,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
