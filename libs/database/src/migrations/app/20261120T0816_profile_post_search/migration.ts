#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1d9c360ab7e1f94820c35389f4fc5e6779dadfbab7e6b3c330e3d9ce6e1fd55f/contract';
import startContract from '../../snapshots/1d9c360ab7e1f94820c35389f4fc5e6779dadfbab7e6b3c330e3d9ce6e1fd55f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e7b08e363baaa0a3e156ae4de9f711a51863b987540910924cedef23bf467e55/contract';
import endContract from '../../snapshots/e7b08e363baaa0a3e156ae4de9f711a51863b987540910924cedef23bf467e55/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'profiles',
        column: col('postSearch', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
