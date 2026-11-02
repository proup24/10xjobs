#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/d63d407c65b181083ae45e022582f6caa9704846c24a2c204a4612ba8adfc38d/contract';
import startContract from '../../snapshots/d63d407c65b181083ae45e022582f6caa9704846c24a2c204a4612ba8adfc38d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/dd2bee4d84c2645ce32848a522a3f0f3afddd186f4df9d922c4a60326320b8e1/contract';
import endContract from '../../snapshots/dd2bee4d84c2645ce32848a522a3f0f3afddd186f4df9d922c4a60326320b8e1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'search_segment_runs',
        column: col('searchTotals', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
