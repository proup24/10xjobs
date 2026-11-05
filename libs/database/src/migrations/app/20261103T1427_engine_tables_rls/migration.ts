#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2ef1383476902d44bfefe23fa388f4d5030f76523f77f7306ccd598d6fe8330a/contract';
import endContract from '../../snapshots/2ef1383476902d44bfefe23fa388f4d5030f76523f77f7306ccd598d6fe8330a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b15f577ff2907eb08f954e867e5e946bab9d5c0fd59ff7ea21b798f256047089/contract';
import startContract from '../../snapshots/b15f577ff2907eb08f954e867e5e946bab9d5c0fd59ff7ea21b798f256047089/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.enableRowLevelSecurity({ schema: 'public', table: 'ats_posting_identities' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'profile_query_search_builders' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'query_search_builder' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'raw_job_identities' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'raw_job_query_hits' }),
      this.enableRowLevelSecurity({ schema: 'public', table: 'raw_jobs' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
