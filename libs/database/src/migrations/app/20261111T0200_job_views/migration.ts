#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/00a042d35d22a4fbebf6e55bab0e9ab945de091f26bbd6f41fef3e4023030455/contract';
import endContract from '../../snapshots/00a042d35d22a4fbebf6e55bab0e9ab945de091f26bbd6f41fef3e4023030455/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/8cb2265e8040192761e58010428f07e29b9732beeba0a262e6073575ab0125da/contract';
import startContract from '../../snapshots/8cb2265e8040192761e58010428f07e29b9732beeba0a262e6073575ab0125da/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'job_views',
        columns: [
          col('id', 'uuid', {
            notNull: true,
            default: fn(sql`gen_random_uuid()`),
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('jobId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('viewedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'job_views',
        constraint: 'job_views_userId_jobId_key',
        columns: ['userId', 'jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_views',
        index: 'job_views_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_views',
        index: 'job_views_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_views',
        foreignKey: {
          name: 'job_views_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_views',
        foreignKey: {
          name: 'job_views_jobId_fkey',
          columns: ['jobId'],
          references: { schema: 'public', table: 'normalized_jobs', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'job_views' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'job_views',
        policy: {
          naming: { kind: 'wire', prefix: 'job_views_owner_insert', hash: 'f9f540c9' },
          tableName: 'job_views',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['authenticated'],
          withCheck: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.job_matches m WHERE m."userId" = auth.uid() AND m."jobId" = job_views."jobId")`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'job_views',
        policy: {
          naming: { kind: 'wire', prefix: 'job_views_owner_read', hash: 'ab58a1a7' },
          tableName: 'job_views',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
