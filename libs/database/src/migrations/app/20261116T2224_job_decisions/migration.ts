#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/23a126fe874387bd7fdd1898a4c88df9bf5fde05c8ca860d262c15d8865dfdda/contract';
import endContract from '../../snapshots/23a126fe874387bd7fdd1898a4c88df9bf5fde05c8ca860d262c15d8865dfdda/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/9a48a4e77a746f4139019f4d84e5ccddfee3174d4b606a6626b8181d84715a60/contract';
import startContract from '../../snapshots/9a48a4e77a746f4139019f4d84e5ccddfee3174d4b606a6626b8181d84715a60/contract.json' with { type: 'json' };
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

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'job_decisions',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('decidedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`gen_random_uuid()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('jobId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('matchSnapshot', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'job_decisions_applied_bare_3dd0d51a',
            sql`status = 'dismissed' OR (reason IS NULL AND note IS NULL AND "matchSnapshot" IS NULL)`,
          ),
          checkExpression(
            'job_decisions_note_length_73ec5843',
            sql`note IS NULL OR char_length(note) <= 500`,
          ),
          checkExpression(
            'job_decisions_reason_f322f92c',
            sql`reason IS NULL OR reason IN ('role','seniority','location','stack','salary','contract','languages','work_authorization','company','other')`,
          ),
          checkExpression('job_decisions_status_87345d2c', sql`status IN ('applied','dismissed')`),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'job_decisions',
        constraint: 'job_decisions_userId_jobId_key',
        columns: ['userId', 'jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_decisions',
        index: 'job_decisions_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_decisions',
        index: 'job_decisions_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_decisions',
        foreignKey: {
          name: 'job_decisions_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_decisions',
        foreignKey: {
          name: 'job_decisions_jobId_fkey',
          columns: ['jobId'],
          references: { schema: 'public', table: 'normalized_jobs', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'job_decisions' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'job_decisions',
        policy: {
          naming: { kind: 'wire', prefix: 'job_decisions_owner_delete', hash: '8d4763aa' },
          tableName: 'job_decisions',
          namespaceId: 'public',
          operation: 'delete',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'job_decisions',
        policy: {
          naming: { kind: 'wire', prefix: 'job_decisions_owner_insert', hash: '13839fbe' },
          tableName: 'job_decisions',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['authenticated'],
          withCheck: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.job_matches m WHERE m."userId" = auth.uid() AND m."jobId" = job_decisions."jobId")`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'job_decisions',
        policy: {
          naming: { kind: 'wire', prefix: 'job_decisions_owner_read', hash: 'ab58a1a7' },
          tableName: 'job_decisions',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'job_decisions',
        policy: {
          naming: { kind: 'wire', prefix: 'job_decisions_owner_update', hash: '027386ad' },
          tableName: 'job_decisions',
          namespaceId: 'public',
          operation: 'update',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          withCheck: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      // Users update only what the web app writes, so the job and user stay fixed (an
      // update policy checks rows, not columns). Advancing the `db` ref writes
      // `invariants: []`; re-add `job-decisions-update-columns`.
      rawSql({
        id: 'grants.job_decisions_update_columns',
        invariantId: 'job-decisions-update-columns',
        label:
          'Limit authenticated updates on job_decisions to status, reason, note, decidedAt, matchSnapshot and updatedAt',
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
            description:
              'revoke table-level updates, grant the user-editable columns',
            sql: `REVOKE UPDATE ON public.job_decisions FROM authenticated, anon;
GRANT UPDATE ("status", "reason", "note", "decidedAt", "matchSnapshot", "updatedAt") ON public.job_decisions TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
