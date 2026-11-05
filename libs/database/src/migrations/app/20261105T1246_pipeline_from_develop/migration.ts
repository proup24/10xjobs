#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2ef1383476902d44bfefe23fa388f4d5030f76523f77f7306ccd598d6fe8330a/contract';
import startContract from '../../snapshots/2ef1383476902d44bfefe23fa388f4d5030f76523f77f7306ccd598d6fe8330a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/8f1715e4755f3ef514f24cf2090ce086ef24f4c0a113dc0bdbbe76cc5e6accd3/contract';
import endContract from '../../snapshots/8f1715e4755f3ef514f24cf2090ce086ef24f4c0a113dc0bdbbe76cc5e6accd3/contract.json' with { type: 'json' };
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
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_arrangements_check_7606728b',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_arrangements_elem_not_null_d7d34c79',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_arrangements_nonempty_52fb6f2a',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_regions_check_76fa66e0',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_regions_elem_not_null_0c7680bd',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_seniority_check_2e7615f6',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'profiles',
        column: 'arrangements',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'profiles',
        column: 'regions',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'profiles',
        column: 'seniority',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_locationRegion_check_eb30a260',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: 'city',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: 'country',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: 'locationRegion',
      }),
      this.dropTable({ schema: 'public', table: 'raw_job_identities' }),
      this.dropTable({ schema: 'public', table: 'raw_job_query_hits' }),
      this.dropTable({ schema: 'public', table: 'raw_jobs' }),
      this.dropTable({ schema: 'public', table: 'ats_posting_identities' }),
      this.createTable({
        schema: 'public',
        table: 'arrangements',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('code', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('label', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'arrangements_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'arrangements_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'cities',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('countryCode', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('geonamesId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('name', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('nameKey', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'cities_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'cities_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'collection_batches',
        columns: [
          col('actor', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('apifyRunId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('attempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('channel', 'text', {
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
          col('formatVersion', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('ingestedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('itemCount', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('observedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('report', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('segmentRunId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('storageKey', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'collection_batches_attempts_b3d879c1',
            sql`attempts >= 0`,
          ),
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
        table: 'contract_types',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('code', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('label', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'contract_types_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'contract_types_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'countries',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('code', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('label', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'countries_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'countries_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'engagements',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('code', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('label', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'engagements_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'engagements_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'job_extractions',
        columns: [
          col('arrangement', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('cityIds', 'uuid[]', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1', many: true },
          }),
          col('contractType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('costUsd', 'numeric', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1' },
          }),
          col('countryCodes', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('data', 'jsonb', {
            notNull: true,
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('decisionModel', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('engagement', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('extractionModel', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('inputHash', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('isSoftwareEngineeringRole', 'bool', {
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('jobId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('mainStackTags', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('needsReview', 'bool', {
            notNull: true,
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('promptHash', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('regionCodes', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('roleKind', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryCurrency', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryMax', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('salaryMin', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('salaryPeriod', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('schemaVersion', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('seniority', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('techTags', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('worldwide', 'bool', {
            notNull: true,
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'job_extractions_cityIds_elem_not_null_6db9e1dc',
            sql`array_position("cityIds", NULL) IS NULL`,
          ),
          checkExpression(
            'job_extractions_countryCodes_elem_not_null_59dca6fd',
            sql`array_position("countryCodes", NULL) IS NULL`,
          ),
          checkExpression(
            'job_extractions_mainStackTags_elem_not_null_e0558217',
            sql`array_position("mainStackTags", NULL) IS NULL`,
          ),
          checkExpression(
            'job_extractions_regionCodes_elem_not_null_65a1cb26',
            sql`array_position("regionCodes", NULL) IS NULL`,
          ),
          checkExpression(
            'job_extractions_techTags_elem_not_null_93a73d6b',
            sql`array_position("techTags", NULL) IS NULL`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'junk_flags',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('code', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('label', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'junk_flags_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'junk_flags_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'normalized_job_sources',
        columns: [
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('jobId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('linkedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('normalizedVersionId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('rawItemId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'normalized_jobs',
        columns: [
          col('applyUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('closed', 'bool', {
            notNull: true,
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('companyName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('companyUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('contractType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('currentExtractionId', 'uuid', {
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('descriptionHtml', 'text', {
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('descriptionText', 'text', {
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('experienceLevel', 'text', {
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('fieldSources', 'jsonb', {
            notNull: true,
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('jobKey', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('kind', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('location', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('mergedIntoId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('normalizerVersion', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('posterName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('posterProfileUrl', 'text', {
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('posterType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('postingUrl', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('processedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('processingAttempts', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('processingError', 'text', {
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('processingReason', 'text', {
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('processingRequestedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('processingStartedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('processingStatus', 'text', {
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('publishedAt', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryCurrency', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryMax', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('salaryMin', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('salaryPeriod', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryText', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sector', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('title', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'normalized_jobs_kind_e26544db',
            sql`kind IN ('job', 'post')`,
          ),
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
          checkExpression(
            'normalized_jobs_status_e7531d73',
            sql`status IN ('active', 'merged')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'normalized_versions',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('jobKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('normalizerVersion', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('rawVersionId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('record', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
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
      this.createTable({
        schema: 'public',
        table: 'processing_attempts',
        columns: [
          col('cachedInputTokens', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('costUsd', 'numeric', {
            notNull: true,
            codecRef: { codecId: 'pg/numeric@1' },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('eval', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('extractionId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('inputTokens', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('jobId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('latencyMs', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('model', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('outcome', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('outputTokens', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('providerRequestId', 'text', {
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('quoteFailures', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('step', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'processing_attempts_outcome_f70ba339',
            sql`outcome IN ('ok', 'error', 'invalid')`,
          ),
          checkExpression(
            'processing_attempts_step_0068b0ea',
            sql`step IN ('decision', 'extraction', 'extraction_retry')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'raw_item_sightings',
        columns: [
          col('attribution', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('batchId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('observedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('queryId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('rank', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('rawItemId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('versionId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'raw_item_sightings_attribution_a531f58e',
            sql`attribution = COALESCE("queryId"::text, 'none')`,
          ),
          checkExpression(
            'raw_item_sightings_rank_d48e58d1',
            sql`rank IS NULL OR rank > 0`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'raw_item_versions',
        columns: [
          col('contentHash', 'text', {
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
          col('firstBatchId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('payload', 'jsonb', {
            notNull: true,
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('rawItemId', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
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
          col('channel', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('kind', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('latestVersionId', 'uuid', {
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('sourceKey', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'raw_items_channel_check_687325cb',
            sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
          ),
          checkExpression(
            'raw_items_kind_e26544db',
            sql`kind IN ('job', 'post')`,
          ),
          checkExpression(
            'raw_items_seen_order_9de70718',
            sql`"firstSeenAt" <= "lastSeenAt"`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'region_countries',
        columns: [
          col('countryCode', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('regionCode', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [primaryKey(['regionCode', 'countryCode'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'regions',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('code', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('label', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'regions_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'regions_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'role_kinds',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('code', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('label', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'role_kinds_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'role_kinds_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'search_segment_runs',
        columns: [
          col('capped', 'bool', {
            notNull: true,
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('channel', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('costMicroUsd', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fetched', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('finishedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('id', 'uuid', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1' },
          }),
          col('perQuery', 'jsonb', {
            notNull: true,
            codecRef: { codecId: 'pg/jsonb@1' },
          }),
          col('queryIds', 'uuid[]', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1', many: true },
          }),
          col('searchTotals', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('segmentHash', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('segmentKey', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('startedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('truncatedQueryIds', 'uuid[]', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1', many: true },
          }),
          col('windowEnd', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('windowStart', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'search_segment_runs_channel_check_687325cb',
            sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
          ),
          checkExpression(
            'search_segment_runs_queryIds_elem_not_null_4915023e',
            sql`array_position("queryIds", NULL) IS NULL`,
          ),
          checkExpression(
            'search_segment_runs_status_c2d610e5',
            sql`status IN ('succeeded', 'partial', 'failed')`,
          ),
          checkExpression(
            'search_segment_runs_truncatedQueryIds_elem_not_null_f687001d',
            sql`array_position("truncatedQueryIds", NULL) IS NULL`,
          ),
          checkExpression(
            'search_segment_runs_window_83d3058e',
            sql`"windowStart" < "windowEnd"`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'seniorities',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('code', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('label', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'seniorities_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'seniorities_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'tech_tags',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('code', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('family', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('implies', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('label', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'tech_tags_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression(
            'tech_tags_implies_elem_not_null_0dbb5db7',
            sql`array_position("implies", NULL) IS NULL`,
          ),
          checkExpression(
            'tech_tags_status_e626d06d',
            sql`status IN ('approved', 'proposed')`,
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('claimExpiresAt', 'timestamptz(3)', {
          codecRef: {
            codecId: 'pg/timestamptz-date@1',
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('claimRunId', 'uuid', {
          codecRef: { codecId: 'pg/uuid@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('claimWindowEnd', 'timestamptz(3)', {
          codecRef: {
            codecId: 'pg/timestamptz-date@1',
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('claimWindowStart', 'timestamptz(3)', {
          codecRef: {
            codecId: 'pg/timestamptz-date@1',
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('coveredUntil', 'timestamptz(3)', {
          codecRef: {
            codecId: 'pg/timestamptz-date@1',
            typeParams: { precision: 3 },
          },
        }),
      }),
      this.addColumnWithTemporaryDefault({
        schema: 'public',
        table: 'profiles',
        column: 'locations',
        type: 'jsonb',
        temporaryDefault: sql`'{}'::jsonb`,
      }),
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'profiles',
        column: 'seniorities',
        type: 'text[]',
      }),
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'query_search_builder',
        column: 'domain',
        type: 'text',
      }),
      this.addColumnWithTemporaryDefault({
        schema: 'public',
        table: 'query_search_builder',
        column: 'location',
        type: 'text',
        temporaryDefault: sql`''`,
      }),
      this.addUnique({
        schema: 'public',
        table: 'cities',
        constraint: 'cities_nameKey_countryCode_key',
        columns: ['nameKey', 'countryCode'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'collection_batches',
        constraint: 'collection_batches_segmentRunId_key',
        columns: ['segmentRunId'],
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
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_locations_nonempty_dfbcb81c',
        expression: sql`jsonb_path_exists("locations", '$.*[*]')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_locations_shape_8e195cce',
        expression: sql`jsonb_typeof("locations") = 'object' AND "locations" ?& ARRAY['remote', 'hybrid', 'onsite'] AND ("locations" - ARRAY['remote', 'hybrid', 'onsite']) = '{}'::jsonb AND CASE WHEN jsonb_typeof("locations" -> 'remote') = 'array' AND jsonb_typeof("locations" -> 'hybrid') = 'array' AND jsonb_typeof("locations" -> 'onsite') = 'array' THEN jsonb_array_length("locations" -> 'remote') <= 20 AND jsonb_array_length("locations" -> 'hybrid') <= 20 AND jsonb_array_length("locations" -> 'onsite') <= 20 AND NOT jsonb_path_exists("locations", '$.*[*] ? (@.type() != "string")') ELSE false END`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_seniorities_check_c892abac',
        expression: sql`array_remove("seniorities", NULL) <@ '{"junior","mid","senior","staff","lead","principal","unstated"}'`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_seniorities_elem_not_null_f6b227c2',
        expression: sql`array_position("seniorities", NULL) IS NULL`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_seniorities_nonempty_798996d1',
        expression: sql`cardinality("seniorities") > 0`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_claim_complete_98a85abe',
        expression: sql`("claimRunId" IS NULL) = ("claimWindowStart" IS NULL) AND ("claimRunId" IS NULL) = ("claimWindowEnd" IS NULL) AND ("claimRunId" IS NULL) = ("claimExpiresAt" IS NULL)`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_domain_check_5fdc18af',
        expression: sql`"domain" IN ('backend', 'frontend', 'fullstack', 'mobile', 'devops', 'data', 'ml', 'security', 'qa')`,
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
        table: 'cities',
        index: 'cities_countryCode_idx_479cc5a2',
        columns: ['countryCode'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'collection_batches',
        index: 'collection_batches_status_createdAt_idx_58610442',
        columns: ['status', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_arrangement_idx_5f2eb234',
        columns: ['arrangement'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_cityIds_gin_36569053',
        columns: ['cityIds'],
        extras: { type: 'gin' },
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_contractType_idx_7af72bd3',
        columns: ['contractType'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_countryCodes_gin_d29e2bf0',
        columns: ['countryCodes'],
        extras: { type: 'gin' },
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_engagement_idx_01398bc8',
        columns: ['engagement'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_jobId_idx_623c8f77',
        columns: ['jobId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_job_created',
        columns: ['jobId', 'createdAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_mainStackTags_gin_a32a2b95',
        columns: ['mainStackTags'],
        extras: { type: 'gin' },
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_regionCodes_gin_2489d722',
        columns: ['regionCodes'],
        extras: { type: 'gin' },
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_reuse',
        columns: [
          'inputHash',
          'schemaVersion',
          'promptHash',
          'decisionModel',
          'extractionModel',
        ],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_roleKind_idx_0a94017d',
        columns: ['roleKind'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_seniority_idx_79fd7107',
        columns: ['seniority'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_techTags_gin_e48af3d5',
        columns: ['techTags'],
        extras: { type: 'gin' },
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
        index: 'normalized_jobs_currentExtractionId_idx_6f0ea778',
        columns: ['currentExtractionId'],
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
      this.createIndex({
        schema: 'public',
        table: 'processing_attempts',
        index: 'processing_attempts_created_noneval_95f31976',
        columns: ['createdAt'],
        extras: { where: sql`NOT eval` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'processing_attempts',
        index: 'processing_attempts_extractionId_idx_3dd68fa6',
        columns: ['extractionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'processing_attempts',
        index: 'processing_attempts_jobId_idx_623c8f77',
        columns: ['jobId'],
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
      this.createIndex({
        schema: 'public',
        table: 'region_countries',
        index: 'region_countries_countryCode_idx_479cc5a2',
        columns: ['countryCode'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'region_countries',
        index: 'region_countries_regionCode_idx_65b6bdbe',
        columns: ['regionCode'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'search_segment_runs',
        index: 'search_segment_runs_channel_startedAt_idx_346540ce',
        columns: ['channel', 'startedAt'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cities',
        foreignKey: {
          name: 'cities_countryCode_fkey',
          columns: ['countryCode'],
          references: {
            schema: 'public',
            table: 'countries',
            columns: ['code'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'collection_batches',
        foreignKey: {
          name: 'collection_batches_segmentRunId_fkey',
          columns: ['segmentRunId'],
          references: {
            schema: 'public',
            table: 'search_segment_runs',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_jobId_fkey',
          columns: ['jobId'],
          references: {
            schema: 'public',
            table: 'normalized_jobs',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_arrangement_fkey',
          columns: ['arrangement'],
          references: {
            schema: 'public',
            table: 'arrangements',
            columns: ['code'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_seniority_fkey',
          columns: ['seniority'],
          references: {
            schema: 'public',
            table: 'seniorities',
            columns: ['code'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_roleKind_fkey',
          columns: ['roleKind'],
          references: {
            schema: 'public',
            table: 'role_kinds',
            columns: ['code'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_contractType_fkey',
          columns: ['contractType'],
          references: {
            schema: 'public',
            table: 'contract_types',
            columns: ['code'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_engagement_fkey',
          columns: ['engagement'],
          references: {
            schema: 'public',
            table: 'engagements',
            columns: ['code'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_job_sources',
        foreignKey: {
          name: 'normalized_job_sources_jobId_fkey',
          columns: ['jobId'],
          references: {
            schema: 'public',
            table: 'normalized_jobs',
            columns: ['id'],
          },
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
          references: {
            schema: 'public',
            table: 'normalized_versions',
            columns: ['id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_jobs',
        foreignKey: {
          name: 'normalized_jobs_mergedIntoId_fkey',
          columns: ['mergedIntoId'],
          references: {
            schema: 'public',
            table: 'normalized_jobs',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_jobs',
        foreignKey: {
          name: 'normalized_jobs_currentExtractionId_fkey',
          columns: ['currentExtractionId'],
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
        table: 'normalized_versions',
        foreignKey: {
          name: 'normalized_versions_rawVersionId_fkey',
          columns: ['rawVersionId'],
          references: {
            schema: 'public',
            table: 'raw_item_versions',
            columns: ['id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'processing_attempts',
        foreignKey: {
          name: 'processing_attempts_jobId_fkey',
          columns: ['jobId'],
          references: {
            schema: 'public',
            table: 'normalized_jobs',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'processing_attempts',
        foreignKey: {
          name: 'processing_attempts_extractionId_fkey',
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
        table: 'raw_item_sightings',
        foreignKey: {
          name: 'raw_item_sightings_batchId_fkey',
          columns: ['batchId'],
          references: {
            schema: 'public',
            table: 'collection_batches',
            columns: ['id'],
          },
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
          references: {
            schema: 'public',
            table: 'raw_item_versions',
            columns: ['id'],
          },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raw_item_sightings',
        foreignKey: {
          name: 'raw_item_sightings_queryId_fkey',
          columns: ['queryId'],
          references: {
            schema: 'public',
            table: 'query_search_builder',
            columns: ['id'],
          },
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
          references: {
            schema: 'public',
            table: 'collection_batches',
            columns: ['id'],
          },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'region_countries',
        foreignKey: {
          name: 'region_countries_regionCode_fkey',
          columns: ['regionCode'],
          references: { schema: 'public', table: 'regions', columns: ['code'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'region_countries',
        foreignKey: {
          name: 'region_countries_countryCode_fkey',
          columns: ['countryCode'],
          references: {
            schema: 'public',
            table: 'countries',
            columns: ['code'],
          },
          onDelete: 'cascade',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'arrangements' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'cities' }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'collection_batches',
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'contract_types',
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'countries' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'engagements' }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'job_extractions',
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'junk_flags' }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'normalized_job_sources',
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'normalized_jobs',
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'normalized_versions',
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'processing_attempts',
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'raw_item_sightings',
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'raw_item_versions',
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'raw_items' }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'region_countries',
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'regions' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'role_kinds' }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'search_segment_runs',
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'seniorities' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'tech_tags' }),
      // Dropping regions, arrangements and seniority dropped their column grants, and
      // the new locations and seniorities columns have none. Re-issue the
      // questionnaire grants from 20261103T1416_profile_policies for the new shape:
      // state, publishedAt, the resume* columns and the timestamps stay engine-only.
      rawSql({
        id: 'grants.profiles_user_columns_locations',
        label:
          'Limit authenticated writes on profiles to the questionnaire columns, locations and seniorities included',
        operationClass: 'destructive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke table-level writes, grant the user-editable columns',
            sql: `REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;
GRANT INSERT ("id", "userId", "position", "languages", "country", "city", "locations", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax", "engagements", "seniorities", "noticePeriodDays") ON public.profiles TO authenticated;
GRANT UPDATE ("position", "languages", "country", "city", "locations", "yearsOfExperience", "timezoneCurrent", "timezoneMin", "timezoneMax", "engagements", "seniorities", "noticePeriodDays") ON public.profiles TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
