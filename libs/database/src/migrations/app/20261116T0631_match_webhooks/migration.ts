#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/126151f2ec71c506c55d9be96241e9ba422d9d0ebf3138deade182041a797796/contract';
import endContract from '../../snapshots/126151f2ec71c506c55d9be96241e9ba422d9d0ebf3138deade182041a797796/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bb8af43bca30e6471e52cd0c0d8d90c51a1f0c5ed462b52a7aad80dbed142948/contract';
import startContract from '../../snapshots/bb8af43bca30e6471e52cd0c0d8d90c51a1f0c5ed462b52a7aad80dbed142948/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

// Match webhooks (docs/superpowers/specs/2026-11-16-match-webhooks-design.md).
// - pgcrypto first: webhooks.secret defaults to its gen_random_bytes, found through the
//   search_path (which includes `extensions` on Supabase and processor_test). Supabase ships
//   pgcrypto in `extensions`; the bare processor_test database has neither, so both are created
//   if missing.
// - webhook_enqueue_match(match, trigger) applies the send rules ("What gets sent") and inserts
//   at most one pending match delivery per (profile, job), returning its id or null. The engine
//   calls it inside the matcher's upsert transaction; only the engine and the trigger below may.
// - match_reviews_webhook: an approved review (choice = 'qualified') runs the same rules with
//   trigger 'review'. The web app inserts match_reviews as the user, so it is SECURITY DEFINER.

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      rawSql({
        id: 'extension.pgcrypto',
        label: 'Create pgcrypto in extensions if missing, for webhooks.secret',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: {
            schema: 'extensions',
            objectType: 'schema',
            name: 'extensions',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'create the extensions schema and pgcrypto if missing',
            sql: `CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;`,
          },
        ],
        postcheck: [],
      }),
      this.createTable({
        schema: 'public',
        table: 'webhook_deliveries',
        columns: [
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('deliveredAt', 'timestamptz(3)', {
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
          col('jobId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('kind', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('lastStatusCode', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('matchId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('nextAttemptAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('payload', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('profileId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('pending'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('trigger', 'text', { codecRef: { codecId: 'pg/text@1' } }),
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
          col('webhookId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'webhook_deliveries_kind_0baf92e4',
            sql`kind IN ('match', 'test')`,
          ),
          checkExpression(
            'webhook_deliveries_match_complete_72089b3b',
            sql`kind <> 'match' OR ("profileId" IS NOT NULL AND "jobId" IS NOT NULL AND "matchId" IS NOT NULL AND trigger IS NOT NULL)`,
          ),
          checkExpression(
            'webhook_deliveries_status_2748a05e',
            sql`status IN ('pending', 'sending', 'delivered', 'failed', 'skipped')`,
          ),
          checkExpression(
            'webhook_deliveries_trigger_ae640364',
            sql`trigger IN ('decision', 'review')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'webhooks',
        columns: [
          col('consecutiveFailures', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('disabledReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('enabled', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('enabledSince', 'timestamptz(3)', {
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
          col('lastFailureAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('lastSuccessAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('secret', 'text', {
            notNull: true,
            default: fn(
              sql`translate(encode(gen_random_bytes(32), 'base64'::text), '+/='::text, '-_'::text)`,
            ),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('url', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('userId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'webhooks_disabled_reason_caba0ea2',
            sql`"disabledReason" IN ('user', 'failing')`,
          ),
          checkExpression(
            'webhooks_url_length_a78745bf',
            sql`length(url) <= 2048`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'webhooks',
        constraint: 'webhooks_userId_key',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_deliveries',
        index: 'webhook_deliveries_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_deliveries',
        index: 'webhook_deliveries_matchId_idx_4caf5ecc',
        columns: ['matchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_deliveries',
        index: 'webhook_deliveries_match_once_6bad34b8',
        columns: ['profileId', 'jobId'],
        extras: { where: sql`kind = 'match'`, unique: true },
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_deliveries',
        index: 'webhook_deliveries_profileId_userId_idx_2d3ae1fb',
        columns: ['profileId', 'userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_deliveries',
        index: 'webhook_deliveries_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_deliveries',
        index: 'webhook_deliveries_webhookId_idx_16330c4e',
        columns: ['webhookId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_deliveries',
        index: 'webhook_deliveries_webhookId_status_createdAt_idx_206ef646',
        columns: ['webhookId', 'status', 'createdAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'webhook_deliveries',
        foreignKey: {
          name: 'webhook_deliveries_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'webhook_deliveries',
        foreignKey: {
          name: 'webhook_deliveries_webhookId_fkey',
          columns: ['webhookId'],
          references: { schema: 'public', table: 'webhooks', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'webhook_deliveries',
        foreignKey: {
          name: 'webhook_deliveries_profileId_userId_fkey',
          columns: ['profileId', 'userId'],
          references: {
            schema: 'public',
            table: 'profiles',
            columns: ['id', 'userId'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'webhook_deliveries',
        foreignKey: {
          name: 'webhook_deliveries_jobId_fkey',
          columns: ['jobId'],
          references: {
            schema: 'public',
            table: 'normalized_jobs',
            columns: ['id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'webhook_deliveries',
        foreignKey: {
          name: 'webhook_deliveries_matchId_fkey',
          columns: ['matchId'],
          references: {
            schema: 'public',
            table: 'job_matches',
            columns: ['id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'webhooks',
        foreignKey: {
          name: 'webhooks_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'webhook_deliveries',
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'webhooks' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'webhook_deliveries',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'webhook_deliveries_owner_read',
            hash: 'ab58a1a7',
          },
          tableName: 'webhook_deliveries',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'webhooks',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'webhooks_owner_read',
            hash: 'ab58a1a7',
          },
          tableName: 'webhooks',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      rawSql({
        id: 'functions.webhook_enqueue_match',
        label:
          'Create webhook_enqueue_match and the match_reviews_webhook trigger',
        operationClass: 'additive',
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
              'create webhook_enqueue_match(), match_reviews_webhook() and its trigger on match_reviews',
            sql: `CREATE FUNCTION public.webhook_enqueue_match(p_match_id uuid, p_trigger text) RETURNS uuid
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
-- One pending delivery for the match's (profile, job) when the user's webhook is on, the job was
-- first seen since both the profile was published and the webhook was turned on, and no match
-- delivery exists for the profile on this job, the job it merged into, or a job merged into it.
INSERT INTO webhook_deliveries ("userId", "webhookId", kind, "profileId", "jobId", "matchId", trigger, status, attempts, "nextAttemptAt")
SELECT m."userId", w.id, 'match', m."profileId", m."jobId", m.id, p_trigger, 'pending', 0, now()
FROM job_matches m
JOIN webhooks w ON w."userId" = m."userId" AND w.enabled
JOIN profiles p ON p.id = m."profileId" AND p.state = 'published'
JOIN normalized_jobs j ON j.id = m."jobId"
WHERE m.id = p_match_id
  AND j."firstSeenAt" >= p."publishedAt" AND j."firstSeenAt" >= w."enabledSince"
  AND NOT EXISTS (
    SELECT 1 FROM webhook_deliveries d JOIN normalized_jobs dj ON dj.id = d."jobId"
    WHERE d.kind = 'match' AND d."profileId" = m."profileId"
      AND (d."jobId" = j.id OR dj."mergedIntoId" = j.id OR d."jobId" = j."mergedIntoId"))
ON CONFLICT DO NOTHING
RETURNING id;
$$;
REVOKE EXECUTE ON FUNCTION public.webhook_enqueue_match(uuid, text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.match_reviews_webhook() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.webhook_enqueue_match(NEW."matchId", 'review');
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.match_reviews_webhook() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER match_reviews_webhook AFTER INSERT ON public.match_reviews
  FOR EACH ROW WHEN (NEW.choice = 'qualified')
  EXECUTE FUNCTION public.match_reviews_webhook();`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
