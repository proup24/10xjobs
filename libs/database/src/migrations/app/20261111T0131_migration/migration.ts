#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract';
import startContract from '../../snapshots/692de7e1f3a1de4d1810971aad16ccc8e77c43000f9f6446faf2b873a6ce64fe/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/8cb2265e8040192761e58010428f07e29b9732beeba0a262e6073575ab0125da/contract';
import endContract from '../../snapshots/8cb2265e8040192761e58010428f07e29b9732beeba0a262e6073575ab0125da/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('postedAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
