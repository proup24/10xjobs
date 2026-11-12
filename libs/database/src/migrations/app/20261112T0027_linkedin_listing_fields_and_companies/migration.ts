#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/00a042d35d22a4fbebf6e55bab0e9ab945de091f26bbd6f41fef3e4023030455/contract';
import startContract from '../../snapshots/00a042d35d22a4fbebf6e55bab0e9ab945de091f26bbd6f41fef3e4023030455/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a770004147015113556bc2c1c38562bfe20c02fe2d9ee05087874392fe44a59d/contract';
import endContract from '../../snapshots/a770004147015113556bc2c1c38562bfe20c02fe2d9ee05087874392fe44a59d/contract.json' with { type: 'json' };
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
        table: 'companies',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('employeeCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('employeeCountMax', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('employeeCountMin', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('firstSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('headquartersCountryCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('industries', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('lastSeenAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('linkedinId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('linkedinUrl', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('specialities', 'text[]', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1', many: true },
          }),
          col('universalName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('website', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'companies_industries_elem_not_null_c09111b6',
            sql`array_position("industries", NULL) IS NULL`,
          ),
          checkExpression('companies_seen_order_9de70718', sql`"firstSeenAt" <= "lastSeenAt"`),
          checkExpression(
            'companies_specialities_elem_not_null_e9e5ed87',
            sql`array_position("specialities", NULL) IS NULL`,
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('applicantCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('applicantTrackingSystem', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('companyId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('countryCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('employmentType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('expiresAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('listingState', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('regionCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('remoteAllowed', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('workplaceType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'companies',
        constraint: 'companies_linkedinId_key',
        columns: ['linkedinId'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_workplace_type_bb7c0a82',
        expression: sql`"workplaceType" IS NULL OR "workplaceType" IN ('remote', 'hybrid', 'onsite')`,
      }),
      this.createIndex({
        schema: 'public',
        table: 'normalized_jobs',
        index: 'normalized_jobs_companyId_idx_33acc5ed',
        columns: ['companyId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'normalized_jobs',
        foreignKey: {
          name: 'normalized_jobs_companyId_fkey',
          columns: ['companyId'],
          references: { schema: 'public', table: 'companies', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'companies' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
