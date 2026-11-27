#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/830fc4a03331a38a1c682ee66f7b0250b50d72327d8c8a93f96461451902e63f/contract';
import endContract from '../../snapshots/830fc4a03331a38a1c682ee66f7b0250b50d72327d8c8a93f96461451902e63f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/668c4a1752b51f2e7aa44792a829918d5251da7b7d8c2ccad6fdeb544f3d9a9f/contract';
import startContract from '../../snapshots/668c4a1752b51f2e7aa44792a829918d5251da7b7d8c2ccad6fdeb544f3d9a9f/contract.json' with { type: 'json' };
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

// NOTE: invariants (blocked-authors-lower-key, post-rescue-rpcs) in ../refs/db.json decide whether
// the raw ops run on a fresh database. Advancing the `db` ref writes `invariants: []`; re-add
// every earlier invariant and these.

// A blocked author's key is matched case-insensitively: the key is always stored lower-cased.
const blockedAuthorsLowerKey = String.raw`CREATE OR REPLACE FUNCTION public.blocked_authors_lower_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  NEW."authorKey" := lower(NEW."authorKey");
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.blocked_authors_lower_key() FROM PUBLIC, anon, authenticated;`;

const blockedAuthorsLowerKeyTrigger = String.raw`CREATE TRIGGER blocked_authors_lower_key
  BEFORE INSERT ON public.blocked_authors
  FOR EACH ROW EXECUTE FUNCTION public.blocked_authors_lower_key();`;

// Rescue: the caller pulls a job out of their Disqualified tab (a post role with a rejected match
// of theirs). The Junk branch (a kind = 'post' job post_junk_list returns) arrives with
// post_junk_list in a later migration, which redefines this function. A live rescue is returned
// as it is. Rescuing changes nothing for any other user and writes no match.
const postRescue = String.raw`CREATE OR REPLACE FUNCTION public.post_rescue(p_job_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
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
  IF NOT EXISTS (SELECT 1 FROM public.normalized_jobs j
                  WHERE j.id = p_job_id AND j.kind = 'post_role')
     OR NOT EXISTS (SELECT 1 FROM public.job_matches m
                     WHERE m."userId" = v_user AND m."jobId" = p_job_id AND m.outcome = 'rejected') THEN
    RAISE EXCEPTION 'not rescuable';
  END IF;
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
  INSERT INTO public.post_rescues ("userId", "jobId", origin, snapshot, note)
  VALUES (v_user, p_job_id, 'disqualified', v_snapshot, p_note)
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

// Undo: only while the user has no decision on the job's group; after one, the decision owns it.
const postRescueUndo = String.raw`CREATE OR REPLACE FUNCTION public.post_rescue_undo(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not rescuable';
  END IF;
  IF public.group_decision_status(v_user, p_job_id) IS NOT NULL THEN
    RAISE EXCEPTION 'decided';
  END IF;
  UPDATE public.post_rescues
     SET "undoneAt" = now(), "updatedAt" = now()
   WHERE "userId" = v_user AND "jobId" = p_job_id AND "undoneAt" IS NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.post_rescue_undo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_rescue_undo(uuid) TO authenticated;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'post_rescues',
        columns: [
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
            default: fn(sql`gen_random_uuid()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('jobId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('origin', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('snapshot', 'jsonb', {
            notNull: true,
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('undoneAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
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
            'post_rescues_note_length_73ec5843',
            sql`note IS NULL OR char_length(note) <= 500`,
          ),
          checkExpression(
            'post_rescues_origin_0c531019',
            sql`origin IN ('junk','disqualified')`,
          ),
        ],
      }),
      this.setDefault({
        schema: 'public',
        table: 'blocked_authors',
        column: col('id', 'uuid', {
          default: fn(sql`gen_random_uuid()`),
          codecRef: { codecId: 'pg/uuid@1' },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'post_rescues',
        index: 'post_rescues_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'post_rescues',
        index: 'post_rescues_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'post_rescues',
        index: 'post_rescues_live_user_job_800e0fe1',
        columns: ['userId', 'jobId'],
        extras: { where: sql`"undoneAt" IS NULL`, unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'post_rescues',
        index: 'post_rescues_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'post_rescues',
        foreignKey: {
          name: 'post_rescues_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'post_rescues',
        foreignKey: {
          name: 'post_rescues_jobId_fkey',
          columns: ['jobId'],
          references: {
            schema: 'public',
            table: 'normalized_jobs',
            columns: ['id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'post_rescues' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'job_decisions',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'job_decisions_owner_insert',
            hash: '3e2aa6d5',
          },
          tableName: 'job_decisions',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['authenticated'],
          withCheck: sql`"userId" = auth.uid() AND (EXISTS (SELECT 1 FROM public.job_matches m WHERE m."userId" = auth.uid() AND m."jobId" = job_decisions."jobId") OR EXISTS (SELECT 1 FROM public.post_rescues r WHERE r."userId" = auth.uid() AND r."jobId" = job_decisions."jobId" AND r."undoneAt" IS NULL))`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'post_rescues',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'post_rescues_owner_read',
            hash: 'ab58a1a7',
          },
          tableName: 'post_rescues',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.dropRlsPolicy({
        schema: 'public',
        table: 'job_decisions',
        policy: 'job_decisions_owner_insert_13839fbe',
      }),
      rawSql({
        id: 'triggers.blocked_authors_lower_key',
        invariantId: 'blocked-authors-lower-key',
        label: 'blocked_authors stores authorKey lower-cased',
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
            description: 'create blocked_authors_lower_key',
            sql: blockedAuthorsLowerKey,
          },
          {
            description: 'create the trigger',
            sql: blockedAuthorsLowerKeyTrigger,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        id: 'functions.post_rescue',
        invariantId: 'post-rescue-rpcs',
        label: 'post_rescue and post_rescue_undo',
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
          { description: 'create post_rescue', sql: postRescue },
          { description: 'create post_rescue_undo', sql: postRescueUndo },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
