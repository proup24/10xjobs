#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1cd5de0e80eaf25816ef11aaa269f6372fda3c935e90621032e65f56392bd741/contract';
import endContract from '../../snapshots/1cd5de0e80eaf25816ef11aaa269f6372fda3c935e90621032e65f56392bd741/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7a9202b8254003df747c0106c86d0819f4e33a3cb129ff331fc2f1a9fafd5a95/contract';
import startContract from '../../snapshots/7a9202b8254003df747c0106c86d0819f4e33a3cb129ff331fc2f1a9fafd5a95/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'exchange_rates',
        columns: [
          col('currency', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('fetchedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('perUsd', 'numeric', { notNull: true, codecRef: { codecId: 'pg/numeric@1' } }),
        ],
        constraints: [primaryKey(['currency'])],
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'exchange_rates' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
