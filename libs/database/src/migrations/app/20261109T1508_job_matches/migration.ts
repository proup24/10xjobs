#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2b13e35e2e7380aacb17fa41ff6141e311ba0d3a2d3e211d878889ae00959bdc/contract';
import startContract from '../../snapshots/2b13e35e2e7380aacb17fa41ff6141e311ba0d3a2d3e211d878889ae00959bdc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract';
import endContract from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract.json' with { type: 'json' };
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
        table: 'job_matches',
        columns: [
          col('checks', 'jsonb', {
            notNull: true,
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('decidedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('extractionId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('jobId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('matcherVersion', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('outcome', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('profileId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('stackScore', 'numeric(4,3)', {
            codecRef: {
              codecId: 'pg/numeric@1',
              typeParams: { precision: 4, scale: 3 },
            },
          }),
          col('unverified', 'bool', {
            notNull: true,
            codecRef: { codecId: 'pg/bool@1' },
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
            'job_matches_outcome_99dbf9c9',
            sql`outcome IN ('qualified','rejected')`,
          ),
          checkExpression(
            'job_matches_rejected_verified_42d2b1cf',
            sql`NOT (outcome = 'rejected' AND unverified)`,
          ),
          checkExpression(
            'job_matches_stack_score_range_75a2340d',
            sql`"stackScore" IS NULL OR "stackScore" BETWEEN 0 AND 1`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'job_matches',
        constraint: 'job_matches_profileId_jobId_key',
        columns: ['profileId', 'jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_matches',
        index: 'job_matches_extractionId_idx_3dd68fa6',
        columns: ['extractionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_matches',
        index: 'job_matches_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_matches',
        index: 'job_matches_profileId_outcome_decidedAt_idx_d8694a97',
        columns: ['profileId', 'outcome', 'decidedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_matches',
        index: 'job_matches_profileId_userId_idx_2d3ae1fb',
        columns: ['profileId', 'userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_matches',
        index: 'job_matches_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_matches',
        foreignKey: {
          name: 'job_matches_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_matches',
        foreignKey: {
          name: 'job_matches_profileId_userId_fkey',
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
        table: 'job_matches',
        foreignKey: {
          name: 'job_matches_jobId_fkey',
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
        table: 'job_matches',
        foreignKey: {
          name: 'job_matches_extractionId_fkey',
          columns: ['extractionId'],
          references: {
            schema: 'public',
            table: 'job_extractions',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'job_matches' }),
      this.createRlsPolicy({
        schema: 'public',
        table: 'job_matches',
        policy: {
          naming: {
            kind: 'wire',
            prefix: 'job_matches_owner_read',
            hash: 'ab58a1a7',
          },
          tableName: 'job_matches',
          namespaceId: 'public',
          operation: 'select',
          roles: ['authenticated'],
          using: sql`"userId" = auth.uid()`,
          permissive: true,
        },
      }),
      // Owners read their matches and never write them. service_role and postgres are
      // untouched: the engine writes this table.
      rawSql({
        id: 'grants.job_matches_read_only',
        label: 'Limit authenticated to reading job_matches',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'job_matches',
          },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke every grant from anon and authenticated, grant SELECT to authenticated',
            sql: `REVOKE ALL ON public.job_matches FROM anon, authenticated;
GRANT SELECT ON public.job_matches TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
