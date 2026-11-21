#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/102e61ccb77605cd7b61d1362d8667349060173f0c1fdade6bec81e50f63117f/contract';
import endContract from '../../snapshots/102e61ccb77605cd7b61d1362d8667349060173f0c1fdade6bec81e50f63117f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/edf1f976e9ec105106b12ed01062b9ef47fe15757a5b00d2487d18afebc8e4ac/contract';
import startContract from '../../snapshots/edf1f976e9ec105106b12ed01062b9ef47fe15757a5b00d2487d18afebc8e4ac/contract.json' with { type: 'json' };
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
        table: 'silenced_authors',
        columns: [
          col('authorKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('createdBy', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
          col('evidence', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('origin', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reason', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'silenced_authors_origin_d1fb74ff',
            sql`origin IN ('manual', 'automatic')`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'silenced_authors',
        constraint: 'silenced_authors_authorKey_key',
        columns: ['authorKey'],
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'silenced_authors' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
