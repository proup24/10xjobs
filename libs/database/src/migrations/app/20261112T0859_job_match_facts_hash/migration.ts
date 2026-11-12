#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a0e7e5cdb988c28b56a83fac52a2d9083dc8f30c34ed4db1e7736337e485494d/contract';
import endContract from '../../snapshots/a0e7e5cdb988c28b56a83fac52a2d9083dc8f30c34ed4db1e7736337e485494d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/be873e1827fcd83ca4eaf63b7e76adc2c945ae78c1b594cfacd84b05fde9e3c6/contract';
import startContract from '../../snapshots/be873e1827fcd83ca4eaf63b7e76adc2c945ae78c1b594cfacd84b05fde9e3c6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'job_matches',
        column: col('factsHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
