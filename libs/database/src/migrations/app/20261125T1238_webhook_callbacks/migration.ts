#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/b5852fb88a982712de75cf95bee57f920a90aeb4f4c941188c17824f2f6ca558/contract';
import startContract from '../../snapshots/b5852fb88a982712de75cf95bee57f920a90aeb4f4c941188c17824f2f6ca558/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c5aab1733fcac2a22b3f82422bdd80d9e2630474043df543fdba5a28d4abe44e/contract';
import endContract from '../../snapshots/c5aab1733fcac2a22b3f82422bdd80d9e2630474043df543fdba5a28d4abe44e/contract.json' with { type: 'json' };
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

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: 'public',
        table: 'webhook_deliveries',
        index: 'webhook_deliveries_user_delivered_6332df6c',
      }),
      this.createTable({
        schema: 'public',
        table: 'webhook_callbacks',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`gen_random_uuid()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('jobId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('receivedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('result', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('signature', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('webhookId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'webhook_callbacks_result_7ed13f67',
            sql`result IN ('ok', 'saved', 'already_decided', 'not_matched', 'invalid')`,
          ),
          checkExpression(
            'webhook_callbacks_type_a904aa7d',
            sql`type IN ('ping', 'feedback', 'invalid')`,
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_decisions',
        column: col('source', 'text', {
          notNull: true,
          default: lit('app'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'job_decisions',
        constraint: 'job_decisions_source_fb6fe6b2',
        expression: sql`source IN ('app','webhook')`,
      }),
      this.addUnique({
        schema: 'public',
        table: 'webhook_callbacks',
        constraint: 'webhook_callbacks_webhookId_signature_key',
        columns: ['webhookId', 'signature'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_callbacks',
        index: 'webhook_callbacks_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_callbacks',
        index: 'webhook_callbacks_userId_receivedAt_idx_5746e510',
        columns: ['userId', 'receivedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'webhook_callbacks',
        index: 'webhook_callbacks_webhookId_userId_idx_f48d66cb',
        columns: ['webhookId', 'userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'webhook_callbacks',
        foreignKey: {
          name: 'webhook_callbacks_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'webhook_callbacks',
        foreignKey: {
          name: 'webhook_callbacks_webhookId_userId_fkey',
          columns: ['webhookId', 'userId'],
          references: { schema: 'public', table: 'webhooks', columns: ['id', 'userId'] },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'webhook_callbacks' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'webhook_callbacks',
        policy: {
          naming: { kind: 'wire', prefix: 'webhook_callbacks_owner_read', hash: 'ab58a1a7' },
          tableName: 'webhook_callbacks',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      // Users update only what the web app writes; the web app's update now sets `source`.
      // Advancing the `db` ref writes `invariants: []`; re-add `job-decisions-update-source`.
      rawSql({
        id: 'grants.job_decisions_update_source',
        invariantId: 'job-decisions-update-source',
        label: 'Let authenticated update job_decisions.source',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'job_decisions',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'grant the source column to the user-editable set',
            sql: `GRANT UPDATE ("source") ON public.job_decisions TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
