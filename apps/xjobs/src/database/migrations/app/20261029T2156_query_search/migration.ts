#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1866040fed2777d5aee2b8b7dfaac82e7919cc83c40a1ce535f10215c0e9098e/contract';
import endContract from '../../snapshots/1866040fed2777d5aee2b8b7dfaac82e7919cc83c40a1ce535f10215c0e9098e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/69c74630d194988a1211212fe7a1eab60a1879ef0d622fa2803991ca3d6a5cf4/contract';
import startContract from '../../snapshots/69c74630d194988a1211212fe7a1eab60a1879ef0d622fa2803991ca3d6a5cf4/contract.json' with { type: 'json' };
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
          col('keywords', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('locationRegion', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('params', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
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
          col('version', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('workspaceId', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
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
            'query_search_builder_keywords_elem_not_null_f10c6f3f',
            sql`array_position("keywords", NULL) IS NULL`,
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
      this.addColumn({
        schema: 'public',
        table: 'profile_skills',
        column: col('importance', 'int4', {
          notNull: true,
          default: lit(5),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('publishedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('state', 'text', {
          notNull: true,
          default: lit('draft'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profile_skills',
        constraint: 'profile_skills_importance_range_c5238a16',
        expression: sql`importance BETWEEN 0 AND 10`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_state_check_1caa8f71',
        expression: sql`"state" IN ('draft', 'published')`,
      }),
      this.addUnique({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_workspaceId_hash_key',
        columns: ['workspaceId', 'hash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'query_search_builder',
        index: 'query_search_builder_workspaceId_channel_idx_97abd8cd',
        columns: ['workspaceId', 'channel'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'query_search_builder',
        index: 'query_search_builder_workspaceId_idx_ba65f874',
        columns: ['workspaceId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'query_search_builder',
        foreignKey: {
          name: 'query_search_builder_workspaceId_fkey',
          columns: ['workspaceId'],
          references: { schema: 'public', table: 'workspaces', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
