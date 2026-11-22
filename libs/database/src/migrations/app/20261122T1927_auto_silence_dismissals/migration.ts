#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4ac2bcc5b523844f1f915c4e73dc8fb05fa6c33a5c253c8ec71f6c33ddf8677b/contract';
import endContract from '../../snapshots/4ac2bcc5b523844f1f915c4e73dc8fb05fa6c33a5c253c8ec71f6c33ddf8677b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/ec52f11675023da7974608e4e29057d636681a978f6b43e77012fe5d69eda55d/contract';
import startContract from '../../snapshots/ec52f11675023da7974608e4e29057d636681a978f6b43e77012fe5d69eda55d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'auto_silence_dismissals',
        columns: [
          col('authorKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('dismissedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('dismissedBy', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
        ],
        constraints: [primaryKey(['authorKey'])],
      }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'auto_silence_dismissals' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
