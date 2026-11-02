#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/944233e509d9126dc6f0d7e64cc2c8229c1661126b49d35a36427a3f75e7a262/contract';
import endContract from '../../snapshots/944233e509d9126dc6f0d7e64cc2c8229c1661126b49d35a36427a3f75e7a262/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/dd2bee4d84c2645ce32848a522a3f0f3afddd186f4df9d922c4a60326320b8e1/contract';
import startContract from '../../snapshots/dd2bee4d84c2645ce32848a522a3f0f3afddd186f4df9d922c4a60326320b8e1/contract.json' with { type: 'json' };
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
        table: 'arrangements',
        columns: [
          col('aliases', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('approvedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'arrangements_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression('arrangements_status_e626d06d', sql`status IN ('approved', 'proposed')`),
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
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('countryCode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('geonamesId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('nameKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'cities_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression('cities_status_e626d06d', sql`status IN ('approved', 'proposed')`),
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
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'countries_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression('countries_status_e626d06d', sql`status IN ('approved', 'proposed')`),
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
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'engagements_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression('engagements_status_e626d06d', sql`status IN ('approved', 'proposed')`),
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
          col('costUsd', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('countryCodes', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('data', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('decisionModel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('engagement', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('extractionModel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('inputHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isSoftwareEngineeringRole', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
          col('jobId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('mainStackTags', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('needsReview', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('promptHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('regionCodes', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('roleKind', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryCurrency', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('salaryMax', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('salaryMin', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('salaryPeriod', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('schemaVersion', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('seniority', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('techTags', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('worldwide', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
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
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'junk_flags_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression('junk_flags_status_e626d06d', sql`status IN ('approved', 'proposed')`),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'processing_attempts',
        columns: [
          col('cachedInputTokens', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('costUsd', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('eval', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('extractionId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('inputTokens', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('jobId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('latencyMs', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('model', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outcome', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('outputTokens', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('providerRequestId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('quoteFailures', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('step', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        table: 'region_countries',
        columns: [
          col('countryCode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('regionCode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'regions_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression('regions_status_e626d06d', sql`status IN ('approved', 'proposed')`),
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
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'role_kinds_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression('role_kinds_status_e626d06d', sql`status IN ('approved', 'proposed')`),
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
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['code']),
          checkExpression(
            'seniorities_aliases_elem_not_null_3676266c',
            sql`array_position("aliases", NULL) IS NULL`,
          ),
          checkExpression('seniorities_status_e626d06d', sql`status IN ('approved', 'proposed')`),
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
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('family', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('implies', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('occurrences', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
          checkExpression('tech_tags_status_e626d06d', sql`status IN ('approved', 'proposed')`),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('currentExtractionId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('processingStartedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'cities',
        constraint: 'cities_nameKey_countryCode_key',
        columns: ['nameKey', 'countryCode'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cities',
        index: 'cities_countryCode_idx_479cc5a2',
        columns: ['countryCode'],
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
        columns: ['inputHash', 'schemaVersion', 'promptHash', 'decisionModel', 'extractionModel'],
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
        table: 'normalized_jobs',
        index: 'normalized_jobs_currentExtractionId_idx_6f0ea778',
        columns: ['currentExtractionId'],
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
      this.addForeignKey({
        schema: 'public',
        table: 'cities',
        foreignKey: {
          name: 'cities_countryCode_fkey',
          columns: ['countryCode'],
          references: { schema: 'public', table: 'countries', columns: ['code'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_jobId_fkey',
          columns: ['jobId'],
          references: { schema: 'public', table: 'normalized_jobs', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_arrangement_fkey',
          columns: ['arrangement'],
          references: { schema: 'public', table: 'arrangements', columns: ['code'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_seniority_fkey',
          columns: ['seniority'],
          references: { schema: 'public', table: 'seniorities', columns: ['code'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_roleKind_fkey',
          columns: ['roleKind'],
          references: { schema: 'public', table: 'role_kinds', columns: ['code'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_contractType_fkey',
          columns: ['contractType'],
          references: { schema: 'public', table: 'contract_types', columns: ['code'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'job_extractions',
        foreignKey: {
          name: 'job_extractions_engagement_fkey',
          columns: ['engagement'],
          references: { schema: 'public', table: 'engagements', columns: ['code'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_jobs',
        foreignKey: {
          name: 'normalized_jobs_currentExtractionId_fkey',
          columns: ['currentExtractionId'],
          references: { schema: 'public', table: 'job_extractions', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'processing_attempts',
        foreignKey: {
          name: 'processing_attempts_jobId_fkey',
          columns: ['jobId'],
          references: { schema: 'public', table: 'normalized_jobs', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'processing_attempts',
        foreignKey: {
          name: 'processing_attempts_extractionId_fkey',
          columns: ['extractionId'],
          references: { schema: 'public', table: 'job_extractions', columns: ['id'] },
          onDelete: 'setNull',
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
          references: { schema: 'public', table: 'countries', columns: ['code'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
