#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/64733e95e0c7fb5bff5ac7480083265995823beeb7bc089770bc3bd088a60b13/contract';
import endContract from '../../snapshots/64733e95e0c7fb5bff5ac7480083265995823beeb7bc089770bc3bd088a60b13/contract.json' with { type: 'json' };
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

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
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
        table: 'contacts',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('isPrimary', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('value', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'contacts_kind_check_01673cfa',
            sql`"kind" IN ('phone', 'email', 'linkedin', 'github', 'gitlab', 'portfolio', 'website', 'other')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'profile_skills',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('domain', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('importance', 'int4', {
            notNull: true,
            default: lit(5),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('mastery', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('profileId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('technology', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'profile_skills_domain_check_5fdc18af',
            sql`"domain" IN ('backend', 'frontend', 'fullstack', 'mobile', 'devops', 'data', 'ml', 'security', 'qa')`,
          ),
          checkExpression(
            'profile_skills_importance_range_c5238a16',
            sql`importance BETWEEN 0 AND 10`,
          ),
          checkExpression('profile_skills_mastery_range_06062a09', sql`mastery BETWEEN 0 AND 10`),
          checkExpression(
            'profile_skills_technology_check_415c1e16',
            sql`"technology" IN ('javascript', 'typescript', 'python', 'java', 'kotlin', 'go', 'rust', 'csharp', 'cpp', 'php', 'ruby', 'scala', 'elixir', 'swift', 'dart', 'sql', 'bash', 'nodejs', 'nestjs', 'express', 'fastify', 'django', 'fastapi', 'flask', 'spring', 'dotnet', 'laravel', 'rails', 'graphql', 'grpc', 'react', 'nextjs', 'vue', 'nuxt', 'angular', 'svelte', 'tailwindcss', 'react_native', 'flutter', 'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'kafka', 'rabbitmq', 'spark', 'airflow', 'dbt', 'snowflake', 'aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'ansible', 'github_actions', 'gitlab_ci', 'linux', 'nginx', 'prometheus', 'grafana', 'pytorch', 'tensorflow', 'langchain')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'profiles',
        columns: [
          col('arrangements', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('city', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('country', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('engagements', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('languages', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('noticePeriodDays', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('positions', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('publishedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('regions', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('resumeFilename', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resumeKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resumeSha256', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('resumeSizeBytes', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('resumeUploadedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('seniority', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('state', 'text', {
            notNull: true,
            default: lit('draft'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('timezoneCurrent', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('timezoneMax', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('timezoneMin', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('yearsOfExperience', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'profiles_arrangements_check_7606728b',
            sql`array_remove("arrangements", NULL) <@ '{"remote","hybrid","onsite","unstated"}'`,
          ),
          checkExpression(
            'profiles_arrangements_elem_not_null_d7d34c79',
            sql`array_position("arrangements", NULL) IS NULL`,
          ),
          checkExpression(
            'profiles_arrangements_nonempty_52fb6f2a',
            sql`cardinality("arrangements") > 0`,
          ),
          checkExpression(
            'profiles_engagements_check_8a34079e',
            sql`array_remove("engagements", NULL) <@ '{"employee","contractor","eor","agency","per_task"}'`,
          ),
          checkExpression(
            'profiles_engagements_elem_not_null_49d9c5b3',
            sql`array_position("engagements", NULL) IS NULL`,
          ),
          checkExpression(
            'profiles_engagements_nonempty_2beb6a31',
            sql`cardinality("engagements") > 0`,
          ),
          checkExpression(
            'profiles_languages_check_dd30c302',
            sql`array_remove("languages", NULL) <@ '{"AR","FR","EN","ES"}'`,
          ),
          checkExpression(
            'profiles_languages_elem_not_null_d4aa0a00',
            sql`array_position("languages", NULL) IS NULL`,
          ),
          checkExpression(
            'profiles_languages_nonempty_ee0e6ea8',
            sql`cardinality("languages") > 0`,
          ),
          checkExpression(
            'profiles_notice_range_62c2438c',
            sql`"noticePeriodDays" BETWEEN 0 AND 365`,
          ),
          checkExpression(
            'profiles_positions_check_189b7313',
            sql`array_remove("positions", NULL) <@ '{"backend_engineer","frontend_engineer","fullstack_engineer","mobile_engineer","devops_engineer","site_reliability_engineer","platform_engineer","cloud_engineer","security_engineer","data_engineer","ml_engineer","ai_engineer","qa_engineer","embedded_engineer","software_architect","tech_lead","engineering_manager"}'`,
          ),
          checkExpression(
            'profiles_positions_elem_not_null_8c5582cf',
            sql`array_position("positions", NULL) IS NULL`,
          ),
          checkExpression(
            'profiles_positions_nonempty_fbe59e7d',
            sql`cardinality("positions") > 0`,
          ),
          checkExpression(
            'profiles_regions_check_76fa66e0',
            sql`array_remove("regions", NULL) <@ '{"EMEA","MENA","NORTH_AFRICA","SUB_SAHARAN_AFRICA","MIDDLE_EAST","EUROPE","EU","UK","NORTH_AMERICA","LATAM","APAC","GLOBAL"}'`,
          ),
          checkExpression(
            'profiles_regions_elem_not_null_0c7680bd',
            sql`array_position("regions", NULL) IS NULL`,
          ),
          checkExpression(
            'profiles_seniority_check_2e7615f6',
            sql`"seniority" IN ('junior', 'mid', 'senior', 'staff', 'lead', 'principal', 'unstated')`,
          ),
          checkExpression('profiles_state_check_1caa8f71', sql`"state" IN ('draft', 'published')`),
          checkExpression(
            'profiles_tz_range_530d220d',
            sql`"timezoneCurrent" BETWEEN -720 AND 840 AND "timezoneMin" BETWEEN -720 AND 840 AND "timezoneMax" BETWEEN -720 AND 840 AND "timezoneMin" <= "timezoneMax"`,
          ),
          checkExpression(
            'profiles_years_range_422da6f6',
            sql`"yearsOfExperience" BETWEEN 0 AND 60`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'query_search_builder',
        columns: [
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('city', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('country', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('experience', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('keyword', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('locationRegion', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('params', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('profileId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('technologies', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'query_search_builder_channel_check_687325cb',
            sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
          ),
          checkExpression(
            'query_search_builder_experience_check_da85d416',
            sql`"experience" IN ('junior', 'mid', 'senior', 'staff', 'lead', 'principal', 'unstated')`,
          ),
          checkExpression(
            'query_search_builder_locationRegion_check_eb30a260',
            sql`"locationRegion" IN ('EMEA', 'MENA', 'NORTH_AFRICA', 'SUB_SAHARAN_AFRICA', 'MIDDLE_EAST', 'EUROPE', 'EU', 'UK', 'NORTH_AMERICA', 'LATAM', 'APAC', 'GLOBAL')`,
          ),
          checkExpression(
            'query_search_builder_technologies_check_84960705',
            sql`array_remove("technologies", NULL) <@ '{"javascript","typescript","python","java","kotlin","go","rust","csharp","cpp","php","ruby","scala","elixir","swift","dart","sql","bash","nodejs","nestjs","express","fastify","django","fastapi","flask","spring","dotnet","laravel","rails","graphql","grpc","react","nextjs","vue","nuxt","angular","svelte","tailwindcss","react_native","flutter","postgresql","mysql","mongodb","redis","elasticsearch","kafka","rabbitmq","spark","airflow","dbt","snowflake","aws","gcp","azure","docker","kubernetes","terraform","ansible","github_actions","gitlab_ci","linux","nginx","prometheus","grafana","pytorch","tensorflow","langchain"}'`,
          ),
          checkExpression(
            'query_search_builder_technologies_elem_not_null_89b37e18',
            sql`array_position("technologies", NULL) IS NULL`,
          ),
          checkExpression(
            'query_search_builder_type_check_21429531',
            sql`"type" IN ('remote', 'hybrid', 'onsite', 'unstated')`,
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
      this.createTable({
        schema: 'public',
        table: 'users',
        columns: [
          col('address', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ats_posting_identities',
        constraint: 'ats_posting_identities_provider_tenantKey_postingId_key',
        columns: ['provider', 'tenantKey', 'postingId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'contacts',
        constraint: 'contacts_userId_kind_value_key',
        columns: ['userId', 'kind', 'value'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'profile_skills',
        constraint: 'profile_skills_profileId_technology_domain_key',
        columns: ['profileId', 'technology', 'domain'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_profileId_hash_key',
        columns: ['profileId', 'hash'],
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
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_email_key',
        columns: ['email'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contacts',
        index: 'contacts_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profile_skills',
        index: 'profile_skills_profileId_idx_d9cdfcaf',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profiles',
        index: 'profiles_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'query_search_builder',
        index: 'query_search_builder_profileId_channel_idx_6dd870f6',
        columns: ['profileId', 'channel'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'query_search_builder',
        index: 'query_search_builder_profileId_idx_d9cdfcaf',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'query_search_builder',
        index: 'query_search_builder_userId_idx_a489d58a',
        columns: ['userId'],
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
        table: 'contacts',
        foreignKey: {
          name: 'contacts_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profile_skills',
        foreignKey: {
          name: 'profile_skills_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'profiles', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'profiles',
        foreignKey: {
          name: 'profiles_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'query_search_builder',
        foreignKey: {
          name: 'query_search_builder_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'query_search_builder',
        foreignKey: {
          name: 'query_search_builder_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'profiles', columns: ['id'] },
          onDelete: 'cascade',
        },
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
