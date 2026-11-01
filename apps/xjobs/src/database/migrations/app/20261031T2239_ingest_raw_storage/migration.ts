#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/50cbd7ca417f2c3da56f15b50646afb61b9dee953bb30211f3bf3a4e06817933/contract';
import endContract from '../../snapshots/50cbd7ca417f2c3da56f15b50646afb61b9dee953bb30211f3bf3a4e06817933/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/60c648669fe744bbcd8b2df78952fce8b68af22bf5ea5704e018486bdeef149e/contract';
import startContract from '../../snapshots/60c648669fe744bbcd8b2df78952fce8b68af22bf5ea5704e018486bdeef149e/contract.json' with { type: 'json' };
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
        table: 'collection_batches',
        columns: [
          col('actor', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('apifyRunId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('formatVersion', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('ingestedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('itemCount', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('observedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('report', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('segmentRunId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('storageKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('collection_batches_attempts_b3d879c1', sql`attempts >= 0`),
          checkExpression(
            'collection_batches_channel_check_687325cb',
            sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
          ),
          checkExpression(
            'collection_batches_status_14e6e00d',
            sql`status IN ('pending', 'ingested', 'failed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'raw_item_sightings',
        columns: [
          col('attribution', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('batchId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('observedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('queryId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('rank', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('rawItemId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('versionId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'raw_item_sightings_attribution_a531f58e',
            sql`attribution = COALESCE("queryId"::text, 'none')`,
          ),
          checkExpression('raw_item_sightings_rank_d48e58d1', sql`rank IS NULL OR rank > 0`),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'raw_item_versions',
        columns: [
          col('contentHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('firstBatchId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('payload', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('rawItemId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'raw_item_versions_seen_order_9de70718',
            sql`"firstSeenAt" <= "lastSeenAt"`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'raw_items',
        columns: [
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('latestVersionId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('sourceKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'raw_items_channel_check_687325cb',
            sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
          ),
          checkExpression('raw_items_kind_e26544db', sql`kind IN ('job', 'post')`),
          checkExpression('raw_items_seen_order_9de70718', sql`"firstSeenAt" <= "lastSeenAt"`),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'collection_batches',
        constraint: 'collection_batches_segmentRunId_key',
        columns: ['segmentRunId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'raw_item_sightings',
        constraint: 'raw_item_sightings_batchId_rawItemId_attribution_key',
        columns: ['batchId', 'rawItemId', 'attribution'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'raw_item_versions',
        constraint: 'raw_item_versions_rawItemId_contentHash_key',
        columns: ['rawItemId', 'contentHash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'raw_items',
        constraint: 'raw_items_channel_sourceKey_key',
        columns: ['channel', 'sourceKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'collection_batches',
        index: 'collection_batches_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_item_sightings',
        index: 'raw_item_sightings_batchId_idx_84d4b0b9',
        columns: ['batchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_item_sightings',
        index: 'raw_item_sightings_queryId_idx_edc2d44a',
        columns: ['queryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_item_sightings',
        index: 'raw_item_sightings_rawItemId_idx_e9f47b12',
        columns: ['rawItemId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_item_sightings',
        index: 'raw_item_sightings_versionId_idx_ef8aa804',
        columns: ['versionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_item_versions',
        index: 'raw_item_versions_createdAt_idx_9575dbd7',
        columns: ['createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_item_versions',
        index: 'raw_item_versions_firstBatchId_idx_5fbe686f',
        columns: ['firstBatchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_item_versions',
        index: 'raw_item_versions_rawItemId_idx_e9f47b12',
        columns: ['rawItemId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'collection_batches',
        foreignKey: {
          name: 'collection_batches_segmentRunId_fkey',
          columns: ['segmentRunId'],
          references: { schema: 'public', table: 'search_segment_runs', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_item_sightings',
        foreignKey: {
          name: 'raw_item_sightings_batchId_fkey',
          columns: ['batchId'],
          references: { schema: 'public', table: 'collection_batches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_item_sightings',
        foreignKey: {
          name: 'raw_item_sightings_rawItemId_fkey',
          columns: ['rawItemId'],
          references: { schema: 'public', table: 'raw_items', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_item_sightings',
        foreignKey: {
          name: 'raw_item_sightings_versionId_fkey',
          columns: ['versionId'],
          references: { schema: 'public', table: 'raw_item_versions', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_item_sightings',
        foreignKey: {
          name: 'raw_item_sightings_queryId_fkey',
          columns: ['queryId'],
          references: { schema: 'public', table: 'query_search_builder', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_item_versions',
        foreignKey: {
          name: 'raw_item_versions_rawItemId_fkey',
          columns: ['rawItemId'],
          references: { schema: 'public', table: 'raw_items', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_item_versions',
        foreignKey: {
          name: 'raw_item_versions_firstBatchId_fkey',
          columns: ['firstBatchId'],
          references: { schema: 'public', table: 'collection_batches', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
