#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/23a126fe874387bd7fdd1898a4c88df9bf5fde05c8ca860d262c15d8865dfdda/contract';
import startContract from '../../snapshots/23a126fe874387bd7fdd1898a4c88df9bf5fde05c8ca860d262c15d8865dfdda/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/6445f1a93dc43f67978d3e8df96ba5087d849227003d05e95a754d8d62b6d06f/contract';
import endContract from '../../snapshots/6445f1a93dc43f67978d3e8df96ba5087d849227003d05e95a754d8d62b6d06f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'job_decisions',
        constraint: 'job_decisions_status_87345d2c',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'job_decisions',
        constraint: 'job_decisions_status_b69754e0',
        expression: sql`status IN ('applied','dismissed','expired')`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
