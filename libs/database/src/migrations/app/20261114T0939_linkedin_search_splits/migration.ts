#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5201f9230494207e174126f3348a3d6713e841a1997ba7f264ec11f62038f179/contract';
import startContract from '../../snapshots/5201f9230494207e174126f3348a3d6713e841a1997ba7f264ec11f62038f179/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/bb8af43bca30e6471e52cd0c0d8d90c51a1f0c5ed462b52a7aad80dbed142948/contract';
import endContract from '../../snapshots/bb8af43bca30e6471e52cd0c0d8d90c51a1f0c5ed462b52a7aad80dbed142948/contract.json' with { type: 'json' };
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
        table: 'linkedin_search_splits',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
          col('groupKey', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('parts', 'int4', {
            notNull: true,
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('splitAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: {
              codecId: 'pg/timestamptz-date@1',
              typeParams: { precision: 3 },
            },
          }),
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
          primaryKey(['groupKey']),
          checkExpression(
            'linkedin_search_splits_parts_10bfeb33',
            sql`"parts" >= 1`,
          ),
        ],
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'linkedin_search_splits',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
