#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/be873e1827fcd83ca4eaf63b7e76adc2c945ae78c1b594cfacd84b05fde9e3c6/contract';
import endContract from '../../snapshots/be873e1827fcd83ca4eaf63b7e76adc2c945ae78c1b594cfacd84b05fde9e3c6/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f7a1c0acc4b8baef72167a011f0293c8e81285ca85739d0f73171cb5e648de76/contract';
import startContract from '../../snapshots/f7a1c0acc4b8baef72167a011f0293c8e81285ca85739d0f73171cb5e648de76/contract.json' with { type: 'json' };
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
        table: 'job_fact_conflicts',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('descriptionValue', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('extractionId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('field', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('jobId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('listingValue', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('quote', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('winner', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'job_fact_conflicts_winner_e30266de',
            sql`winner IN ('description','listing')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'job_facts',
        columns: [
          col('builtAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('closed', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('extractionId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('facts', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('factsHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('factsVersion', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('jobId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['jobId'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_fact_conflicts',
        index: 'job_fact_conflicts_extractionId_idx_3dd68fa6',
        columns: ['extractionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_fact_conflicts',
        index: 'job_fact_conflicts_field_idx_7672e3b5',
        columns: ['field'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_fact_conflicts',
        index: 'job_fact_conflicts_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_facts',
        index: 'job_facts_extractionId_idx_3dd68fa6',
        columns: ['extractionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_fact_conflicts',
        foreignKey: {
          name: 'job_fact_conflicts_jobId_fkey',
          columns: ['jobId'],
          references: { schema: 'public', table: 'normalized_jobs', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_fact_conflicts',
        foreignKey: {
          name: 'job_fact_conflicts_extractionId_fkey',
          columns: ['extractionId'],
          references: { schema: 'public', table: 'job_extractions', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_facts',
        foreignKey: {
          name: 'job_facts_jobId_fkey',
          columns: ['jobId'],
          references: { schema: 'public', table: 'normalized_jobs', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_facts',
        foreignKey: {
          name: 'job_facts_extractionId_fkey',
          columns: ['extractionId'],
          references: { schema: 'public', table: 'job_extractions', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'job_fact_conflicts' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'job_facts' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
