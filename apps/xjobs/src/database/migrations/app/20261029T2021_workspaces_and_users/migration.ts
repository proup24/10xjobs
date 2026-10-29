#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/3215d66362906e452511365cd5e91f5c62f0af3fba0b950d1817ae50b3f554af/contract';
import startContract from '../../snapshots/3215d66362906e452511365cd5e91f5c62f0af3fba0b950d1817ae50b3f554af/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/69c74630d194988a1211212fe7a1eab60a1879ef0d622fa2803991ca3d6a5cf4/contract';
import endContract from '../../snapshots/69c74630d194988a1211212fe7a1eab60a1879ef0d622fa2803991ca3d6a5cf4/contract.json' with { type: 'json' };
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
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';

const { sql: db, contract } = postgres({ contract: contractFromJson<End>(endContract) });

// Rows that predate workspaces move into the `default` workspace, which the
// workspaces seed then finds by slug.
const DEFAULT_WORKSPACE_ID = '019a3000-0000-7000-8000-000000000001';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({ schema: 'public', table: 'users', constraint: 'users_email_key' }),
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
          col('workspaceId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
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
          col('mastery', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('preference', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('profileId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('technology', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('workspaceId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'profile_skills_domain_check_5fdc18af',
            sql`"domain" IN ('backend', 'frontend', 'fullstack', 'mobile', 'devops', 'data', 'ml', 'security', 'qa')`,
          ),
          checkExpression('profile_skills_mastery_range_06062a09', sql`mastery BETWEEN 0 AND 10`),
          checkExpression(
            'profile_skills_preference_range_49782760',
            sql`preference BETWEEN 0 AND 10`,
          ),
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
          col('timezoneCurrent', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('timezoneMax', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('timezoneMin', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('workspaceId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
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
        table: 'workspaces',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('slug', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('workspaces_slug_format_570fc1f0', sql`slug ~ '^[a-z0-9-]{2,64}$'`),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('address', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('workspaceId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.dataTransform(contract, 'backfill-users-workspaceId', {
        backfillsColumn: { schema: 'public', table: 'users', column: 'workspaceId' },
        check: () =>
          db.public.users
            .select('id')
            .where((f, fns) => fns.eq(f.workspaceId, null))
            .limit(1),
        run: [
          () =>
            db.public.workspaces.insert([
              { id: DEFAULT_WORKSPACE_ID, name: 'Default', slug: 'default' },
            ]),
          () =>
            db.public.users
              .update({ workspaceId: DEFAULT_WORKSPACE_ID })
              .where((f, fns) => fns.eq(f.workspaceId, null)),
        ],
      }),
      this.setNotNull({ schema: 'public', table: 'users', column: 'workspaceId' }),
      this.dataTransform(contract, 'handle-nulls-users-name', {
        backfillsColumn: { schema: 'public', table: 'users', column: 'name' },
        check: () =>
          db.public.users
            .select('id')
            .where((f, fns) => fns.eq(f.name, null))
            .limit(1),
        run: () =>
          db.public.users.update({ name: '' }).where((f, fns) => fns.eq(f.name, null)),
      }),
      this.setNotNull({ schema: 'public', table: 'users', column: 'name' }),
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
        table: 'profiles',
        constraint: 'profiles_userId_key',
        columns: ['userId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_workspaceId_email_key',
        columns: ['workspaceId', 'email'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'workspaces',
        constraint: 'workspaces_slug_key',
        columns: ['slug'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contacts',
        index: 'contacts_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'contacts',
        index: 'contacts_workspaceId_idx_ba65f874',
        columns: ['workspaceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profile_skills',
        index: 'profile_skills_profileId_idx_d9cdfcaf',
        columns: ['profileId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profile_skills',
        index: 'profile_skills_workspaceId_idx_ba65f874',
        columns: ['workspaceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'profiles',
        index: 'profiles_workspaceId_idx_ba65f874',
        columns: ['workspaceId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_workspaceId_idx_ba65f874',
        columns: ['workspaceId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'contacts',
        foreignKey: {
          name: 'contacts_workspaceId_fkey',
          columns: ['workspaceId'],
          references: { schema: 'public', table: 'workspaces', columns: ['id'] },
          onDelete: 'cascade',
        },
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
          name: 'profile_skills_workspaceId_fkey',
          columns: ['workspaceId'],
          references: { schema: 'public', table: 'workspaces', columns: ['id'] },
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
          name: 'profiles_workspaceId_fkey',
          columns: ['workspaceId'],
          references: { schema: 'public', table: 'workspaces', columns: ['id'] },
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
        table: 'users',
        foreignKey: {
          name: 'users_workspaceId_fkey',
          columns: ['workspaceId'],
          references: { schema: 'public', table: 'workspaces', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
