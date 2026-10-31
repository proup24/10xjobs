#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/50cbd7ca417f2c3da56f15b50646afb61b9dee953bb30211f3bf3a4e06817933/contract';
import startContract from '../../snapshots/50cbd7ca417f2c3da56f15b50646afb61b9dee953bb30211f3bf3a4e06817933/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/71f86469bdf4706dad90b99722716a5ad1b9e428c15e1aa3a09ec99a443fbe95/contract';
import endContract from '../../snapshots/71f86469bdf4706dad90b99722716a5ad1b9e428c15e1aa3a09ec99a443fbe95/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropTable({ schema: 'public', table: 'raw_job_identities' }),
      this.dropTable({ schema: 'public', table: 'raw_job_query_hits' }),
      this.dropTable({ schema: 'public', table: 'raw_jobs' }),
      this.dropTable({ schema: 'public', table: 'ats_posting_identities' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
