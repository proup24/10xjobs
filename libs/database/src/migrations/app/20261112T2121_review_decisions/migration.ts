#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/c7e224b8457ff39be47ce7029466d362a15f7c5c9d93c0db4aa43ab160462815/contract';
import startContract from '../../snapshots/c7e224b8457ff39be47ce7029466d362a15f7c5c9d93c0db4aa43ab160462815/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c9460b85087b8c76224e2851ec975a1ae628faff433325609a6901426cf36d67/contract';
import endContract from '../../snapshots/c9460b85087b8c76224e2851ec975a1ae628faff433325609a6901426cf36d67/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'fact_reports',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('extractionId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('field', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
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
          col('listingValue', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('processorValue', 'jsonb', {
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('proposedValue', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('quote', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'match_reviews',
        columns: [
          col('choice', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('field', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
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
          col('matchId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('profileId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('rule', 'text', {
            notNull: true,
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
          col('userId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'match_reviews_choice_6c4b833f',
            sql`choice IN ('qualified','rejected')`,
          ),
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'fact_reports',
        index: 'fact_reports_extractionId_idx_3dd68fa6',
        columns: ['extractionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'fact_reports',
        index: 'fact_reports_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'fact_reports',
        index: 'fact_reports_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'match_reviews',
        index: 'match_reviews_matchId_createdAt_idx_c6ba7c28',
        columns: ['matchId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'match_reviews',
        index: 'match_reviews_matchId_idx_4caf5ecc',
        columns: ['matchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'match_reviews',
        index: 'match_reviews_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'fact_reports',
        foreignKey: {
          name: 'fact_reports_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'fact_reports',
        foreignKey: {
          name: 'fact_reports_jobId_fkey',
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
        table: 'fact_reports',
        foreignKey: {
          name: 'fact_reports_extractionId_fkey',
          columns: ['extractionId'],
          references: {
            schema: 'public',
            table: 'job_extractions',
            columns: ['id'],
          },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'match_reviews',
        foreignKey: {
          name: 'match_reviews_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'match_reviews',
        foreignKey: {
          name: 'match_reviews_matchId_fkey',
          columns: ['matchId'],
          references: {
            schema: 'public',
            table: 'job_matches',
            columns: ['id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'fact_reports' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'match_reviews' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'fact_reports',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'fact_reports_owner_insert',
            hash: '143ac371',
          },
          tableName: 'fact_reports',
          namespaceId: 'public',
          operation: 'insert',
          roles: ['authenticated'],
          withCheck: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.job_matches m WHERE m."userId" = auth.uid() AND m."jobId" = fact_reports."jobId")`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'fact_reports',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'fact_reports_owner_read',
            hash: 'ab58a1a7',
          },
          tableName: 'fact_reports',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'match_reviews',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'match_reviews_owner',
            hash: '23b38ff6',
          },
          tableName: 'match_reviews',
          namespaceId: 'public',
          operation: 'all',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          withCheck: sql`"userId" = auth.uid() AND EXISTS (SELECT 1 FROM public.job_matches m WHERE m.id = match_reviews."matchId" AND m."userId" = auth.uid() AND m."profileId" = match_reviews."profileId" AND m."jobId" = match_reviews."jobId" AND m.outcome = 'review' AND m."reviewRule" = match_reviews.rule AND m."reviewField" = match_reviews.field)`,
          permissive: true,
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
