#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/c7e224b8457ff39be47ce7029466d362a15f7c5c9d93c0db4aa43ab160462815/contract';
import endContract from '../../snapshots/c7e224b8457ff39be47ce7029466d362a15f7c5c9d93c0db4aa43ab160462815/contract.json' with { type: 'json' };
import startContract from '../../snapshots/c7e224b8457ff39be47ce7029466d362a15f7c5c9d93c0db4aa43ab160462815/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the
// `users-update-columns` invariant in ../refs/db.json decides whether it runs on a fresh
// database. Advancing the `db` ref writes `invariants: []`; re-add it.
// Users kept table-level UPDATE on users, so they could write their own eligibilityVersion
// (and id, address, timestamps) and keep the matcher from re-deciding their jobs. They now
// update only what the web app writes: name (setup about) and residenceCountry and
// acceptsSponsorship (setup eligibility). The bump_eligibility_version trigger still writes
// eligibilityVersion: it is SECURITY DEFINER.

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'grants.users_update_columns',
        invariantId: 'users-update-columns',
        label:
          'Limit authenticated updates on users to name, residenceCountry and acceptsSponsorship',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'users' },
        },
        precheck: [],
        execute: [
          {
            description:
              'revoke table-level updates, grant the user-editable columns',
            sql: `REVOKE UPDATE ON public.users FROM authenticated, anon;
GRANT UPDATE ("name", "residenceCountry", "acceptsSponsorship") ON public.users TO authenticated;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
