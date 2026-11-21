#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/ba7d3a586ecbf6b46889147363e2b2ecf663ae7aaa277d415cecf10b118944ff/contract';
import startContract from '../../snapshots/ba7d3a586ecbf6b46889147363e2b2ecf663ae7aaa277d415cecf10b118944ff/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/bc188ee2df77d5a2f08e4dc0a6fd622430566439e4da3bace451f077c5ed4b1d/contract';
import endContract from '../../snapshots/bc188ee2df77d5a2f08e4dc0a6fd622430566439e4da3bace451f077c5ed4b1d/contract.json' with { type: 'json' };
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
