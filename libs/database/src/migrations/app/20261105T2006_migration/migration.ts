#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3c41b71f8adc0ec4e812059c1a4d627b2bbc7d9eb5b36c4c557ac4c8478620e3/contract';
import endContract from '../../snapshots/3c41b71f8adc0ec4e812059c1a4d627b2bbc7d9eb5b36c4c557ac4c8478620e3/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/8f1715e4755f3ef514f24cf2090ce086ef24f4c0a113dc0bdbbe76cc5e6accd3/contract';
import startContract from '../../snapshots/8f1715e4755f3ef514f24cf2090ce086ef24f4c0a113dc0bdbbe76cc5e6accd3/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, primaryKey, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'iso_currencies',
        columns: [
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['code'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'iso_languages',
        columns: [
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['code'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'role_kinds',
        column: col('isEngineering', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'iso_currencies' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'iso_languages' }),
      rawSql({
        id: 'data.role_kinds_is_engineering',
        label: 'Mark the 17 engineering role kinds',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'role_kinds' },
        },
        precheck: [],
        execute: [
          {
            description: 'set isEngineering on the engineering role kinds',
            sql: `UPDATE public.role_kinds SET "isEngineering" = true WHERE code = ANY(ARRAY['backend_engineer', 'frontend_engineer', 'fullstack_engineer', 'mobile_engineer', 'devops_engineer', 'site_reliability_engineer', 'platform_engineer', 'cloud_engineer', 'security_engineer', 'data_engineer', 'ml_engineer', 'ai_engineer', 'qa_engineer', 'embedded_engineer', 'software_architect', 'tech_lead', 'engineering_manager'])`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
