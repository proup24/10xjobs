#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/64733e95e0c7fb5bff5ac7480083265995823beeb7bc089770bc3bd088a60b13/contract';
import endContract from '../../snapshots/64733e95e0c7fb5bff5ac7480083265995823beeb7bc089770bc3bd088a60b13/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e77655c24b187fa1c73badde5327bccea57ba3fabd4e6283986afd4ef4cc422e/contract';
import startContract from '../../snapshots/e77655c24b187fa1c73badde5327bccea57ba3fabd4e6283986afd4ef4cc422e/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
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
        table: 'ats_posting_identities',
        columns: [
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('postingId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('provider', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tenantKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'ats_posting_identity_provider_bbd425e4',
            sql`provider IN ('ashby', 'greenhouse')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'raw_job_identities',
        columns: [
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('identityType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('identityValue', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('rawJobId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'raw_job_identities_channel_check_687325cb',
            sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
          ),
          checkExpression(
            'raw_job_identity_type_16e51197',
            sql`"identityType" IN ('source_id', 'url')`,
          ),
          checkExpression(
            'raw_job_identity_value_845effc9',
            sql`length(trim("identityValue")) > 0`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'raw_job_query_hits',
        columns: [
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('observedUrl', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('queryId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('rank', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('rawJobId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('raw_job_query_hits_rank_d48e58d1', sql`rank IS NULL OR rank > 0`),
          checkExpression(
            'raw_job_query_hits_seen_order_9de70718',
            sql`"firstSeenAt" <= "lastSeenAt"`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'raw_jobs',
        columns: [
          col('applyUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('atsPostingId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('authorName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('authorUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('company', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('contactName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('contactUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('description', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('externalId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
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
          col('location', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('normalizationVersion', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('postedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('postedAtPrecision', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('raw', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('url', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'raw_jobs_channel_check_687325cb',
            sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
          ),
          checkExpression(
            'raw_jobs_content_b4848497',
            sql`length(trim(description)) > 0 AND length(trim(url)) > 0`,
          ),
          checkExpression('raw_jobs_kind_e26544db', sql`kind IN ('job', 'post')`),
          checkExpression(
            'raw_jobs_precision_ffc5649c',
            sql`"postedAtPrecision" IN ('hour', 'day')`,
          ),
          checkExpression('raw_jobs_seen_order_9de70718', sql`"firstSeenAt" <= "lastSeenAt"`),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ats_posting_identities',
        constraint: 'ats_posting_identities_provider_tenantKey_postingId_key',
        columns: ['provider', 'tenantKey', 'postingId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'raw_job_identities',
        constraint: 'raw_job_identities_channel_identityType_identityValue_key',
        columns: ['channel', 'identityType', 'identityValue'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'raw_job_query_hits',
        constraint: 'raw_job_query_hits_queryId_rawJobId_key',
        columns: ['queryId', 'rawJobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_job_identities',
        index: 'raw_job_identities_rawJobId_idx_8a0054ee',
        columns: ['rawJobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_job_query_hits',
        index: 'raw_job_query_hits_queryId_idx_edc2d44a',
        columns: ['queryId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_job_query_hits',
        index: 'raw_job_query_hits_rawJobId_idx_8a0054ee',
        columns: ['rawJobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_jobs',
        index: 'raw_jobs_atsPostingId_idx_00c81f46',
        columns: ['atsPostingId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'raw_jobs',
        index: 'raw_jobs_channel_lastSeenAt_idx_c418af1e',
        columns: ['channel', 'lastSeenAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_job_identities',
        foreignKey: {
          name: 'raw_job_identities_rawJobId_fkey',
          columns: ['rawJobId'],
          references: { schema: 'public', table: 'raw_jobs', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_job_query_hits',
        foreignKey: {
          name: 'raw_job_query_hits_queryId_fkey',
          columns: ['queryId'],
          references: { schema: 'public', table: 'query_search_builder', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_job_query_hits',
        foreignKey: {
          name: 'raw_job_query_hits_rawJobId_fkey',
          columns: ['rawJobId'],
          references: { schema: 'public', table: 'raw_jobs', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_jobs',
        foreignKey: {
          name: 'raw_jobs_atsPostingId_fkey',
          columns: ['atsPostingId'],
          references: { schema: 'public', table: 'ats_posting_identities', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
