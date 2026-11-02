#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4bdafacb4acf80aa9d8e3c49a0be2f74bdedea1ace7542a31a5bb09fa2376833/contract';
import startContract from '../../snapshots/4bdafacb4acf80aa9d8e3c49a0be2f74bdedea1ace7542a31a5bb09fa2376833/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/da432ef0b1859e5225c643c9537143faa94120043b84a291cdd171718f136238/contract';
import endContract from '../../snapshots/da432ef0b1859e5225c643c9537143faa94120043b84a291cdd171718f136238/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('claimExpiresAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('claimRunId', 'uuid', { codecRef: { codecId: 'pg/uuid@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('claimWindowEnd', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('claimWindowStart', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_claim_complete_98a85abe',
        expression: sql`("claimRunId" IS NULL) = ("claimWindowStart" IS NULL) AND ("claimRunId" IS NULL) = ("claimWindowEnd" IS NULL) AND ("claimRunId" IS NULL) = ("claimExpiresAt" IS NULL)`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
