#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a770004147015113556bc2c1c38562bfe20c02fe2d9ee05087874392fe44a59d/contract';
import startContract from '../../snapshots/a770004147015113556bc2c1c38562bfe20c02fe2d9ee05087874392fe44a59d/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f7a1c0acc4b8baef72167a011f0293c8e81285ca85739d0f73171cb5e648de76/contract';
import endContract from '../../snapshots/f7a1c0acc4b8baef72167a011f0293c8e81285ca85739d0f73171cb5e648de76/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('city', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('geoId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('salaryProvidedByEmployer', 'bool', { codecRef: { codecId: 'pg/bool@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('state', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
