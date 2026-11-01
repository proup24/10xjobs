#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/71f86469bdf4706dad90b99722716a5ad1b9e428c15e1aa3a09ec99a443fbe95/contract';
import startContract from '../../snapshots/71f86469bdf4706dad90b99722716a5ad1b9e428c15e1aa3a09ec99a443fbe95/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d63d407c65b181083ae45e022582f6caa9704846c24a2c204a4612ba8adfc38d/contract';
import endContract from '../../snapshots/d63d407c65b181083ae45e022582f6caa9704846c24a2c204a4612ba8adfc38d/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
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
        table: 'normalized_job_sources',
        columns: [
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('jobId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('linkedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('normalizedVersionId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('rawItemId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'normalized_jobs',
        columns: [
          col('applyUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('closed', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('companyName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('companyUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('contractType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('descriptionHtml', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('descriptionText', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('experienceLevel', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fieldSources', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('jobKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('location', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('mergedIntoId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('normalizerVersion', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('posterName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('posterProfileUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('posterType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('postingUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('processedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('processingAttempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('processingError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('processingReason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('processingRequestedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('processingStatus', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('publishedAt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryCurrency', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryMax', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('salaryMin', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('salaryPeriod', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryText', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sector', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('normalized_jobs_kind_e26544db', sql`kind IN ('job', 'post')`),
          checkExpression(
            'normalized_jobs_merged_into_49ee8511',
            sql`(status = 'merged') = ("mergedIntoId" IS NOT NULL)`,
          ),
          checkExpression(
            'normalized_jobs_processing_attempts_bc077913',
            sql`"processingAttempts" >= 0`,
          ),
          checkExpression(
            'normalized_jobs_processing_reason_0a1726bc',
            sql`"processingReason" IS NULL OR "processingReason" IN ('new', 'reopened')`,
          ),
          checkExpression(
            'normalized_jobs_processing_status_eba7bd28',
            sql`"processingStatus" IS NULL OR "processingStatus" IN ('pending', 'processing', 'processed', 'failed')`,
          ),
          checkExpression(
            'normalized_jobs_seen_order_9de70718',
            sql`"firstSeenAt" <= "lastSeenAt"`,
          ),
          checkExpression('normalized_jobs_status_e7531d73', sql`status IN ('active', 'merged')`),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'normalized_versions',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('jobKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('normalizerVersion', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('rawVersionId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('record', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'normalized_versions_status_6e0d386f',
            sql`status IN ('valid', 'invalid')`,
          ),
          checkExpression(
            'normalized_versions_valid_record_0400e26d',
            sql`(status = 'valid') = (record IS NOT NULL AND "jobKey" IS NOT NULL)`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'normalized_job_sources',
        constraint: 'normalized_job_sources_rawItemId_key',
        columns: ['rawItemId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_jobKey_key',
        columns: ['jobKey'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'normalized_versions',
        constraint: 'normalized_versions_rawVersionId_normalizerVersion_key',
        columns: ['rawVersionId', 'normalizerVersion'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'normalized_job_sources',
        index: 'normalized_job_sources_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'normalized_job_sources',
        index: 'normalized_job_sources_normalizedVersionId_idx_e69af444',
        columns: ['normalizedVersionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'normalized_jobs',
        index: 'normalized_jobs_mergedIntoId_idx_470bd53d',
        columns: ['mergedIntoId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'normalized_jobs',
        index: 'normalized_jobs_processing_queue',
        columns: ['processingStatus', 'processingRequestedAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'normalized_versions',
        index: 'normalized_versions_rawVersionId_idx_db7572f8',
        columns: ['rawVersionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_job_sources',
        foreignKey: {
          name: 'normalized_job_sources_jobId_fkey',
          columns: ['jobId'],
          references: { schema: 'public', table: 'normalized_jobs', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_job_sources',
        foreignKey: {
          name: 'normalized_job_sources_rawItemId_fkey',
          columns: ['rawItemId'],
          references: { schema: 'public', table: 'raw_items', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_job_sources',
        foreignKey: {
          name: 'normalized_job_sources_normalizedVersionId_fkey',
          columns: ['normalizedVersionId'],
          references: { schema: 'public', table: 'normalized_versions', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_jobs',
        foreignKey: {
          name: 'normalized_jobs_mergedIntoId_fkey',
          columns: ['mergedIntoId'],
          references: { schema: 'public', table: 'normalized_jobs', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_versions',
        foreignKey: {
          name: 'normalized_versions_rawVersionId_fkey',
          columns: ['rawVersionId'],
          references: { schema: 'public', table: 'raw_item_versions', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
