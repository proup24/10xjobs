#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5939ea1853a407103172fa96c99abb769846b6154c9478bb1c69034452cded06/contract';
import startContract from '../../snapshots/5939ea1853a407103172fa96c99abb769846b6154c9478bb1c69034452cded06/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/668c4a1752b51f2e7aa44792a829918d5251da7b7d8c2ccad6fdeb544f3d9a9f/contract';
import endContract from '../../snapshots/668c4a1752b51f2e7aa44792a829918d5251da7b7d8c2ccad6fdeb544f3d9a9f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'processing_attempts',
        column: col('turns', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
