#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0c74e930b09092645e0058b0a3fe21e9324c1a44e0e7ad61e1ca876cc385b365/contract';
import startContract from '../../snapshots/0c74e930b09092645e0058b0a3fe21e9324c1a44e0e7ad61e1ca876cc385b365/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/84883c684e9b8bc81b7fad1234576075a5a08a30f80a9c2b08f617b52f123c72/contract';
import endContract from '../../snapshots/84883c684e9b8bc81b7fad1234576075a5a08a30f80a9c2b08f617b52f123c72/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  lit,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

// NOTE: advancing the `db` ref in ../refs/db.json writes `invariants: []`; re-add every earlier
// invariant and role-link-keys-index.

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'normalized_jobs',
        column: col('linkKeys', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_linkKeys_elem_not_null_4d31732c',
        expression: sql`array_position("linkKeys", NULL) IS NULL`,
      }),
      rawSql({
        id: 'indexes.normalized_jobs_linkKeys_gin',
        invariantId: 'role-link-keys-index',
        label: 'GIN index on normalized_jobs."linkKeys"',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'normalized_jobs',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'index linkKeys for array containment and overlap',
            sql: `CREATE INDEX IF NOT EXISTS normalized_jobs_link_keys_gin ON public.normalized_jobs USING gin ("linkKeys")`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
