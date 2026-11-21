#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/ba7d3a586ecbf6b46889147363e2b2ecf663ae7aaa277d415cecf10b118944ff/contract';
import endContract from '../../snapshots/ba7d3a586ecbf6b46889147363e2b2ecf663ae7aaa277d415cecf10b118944ff/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e7b08e363baaa0a3e156ae4de9f711a51863b987540910924cedef23bf467e55/contract';
import startContract from '../../snapshots/e7b08e363baaa0a3e156ae4de9f711a51863b987540910924cedef23bf467e55/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('postSources', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
