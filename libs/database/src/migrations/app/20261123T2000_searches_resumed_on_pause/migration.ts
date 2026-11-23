#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/fbbefdd7802eb5414e4417952f49b70cb8bf2e3ae4e71bd8caded0f2e4b96f2d/contract';
import endContract from '../../snapshots/fbbefdd7802eb5414e4417952f49b70cb8bf2e3ae4e71bd8caded0f2e4b96f2d/contract.json' with { type: 'json' };
import startContract from '../../snapshots/fbbefdd7802eb5414e4417952f49b70cb8bf2e3ae4e71bd8caded0f2e4b96f2d/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: advancing the `db` ref in ../refs/db.json writes `invariants: []`; keep every earlier
// invariant and add `searches-resumed-backfill-on-pause`, or fresh databases skip the backfill.
//
// PR A already backfilled users.searchesResumedAt, but pausing only ships with PR B. Running the
// backfill again when pausing ships starts the 24-hour grace then, however long PR B waited.
const backfill = `UPDATE public.users u SET "searchesResumedAt" = GREATEST(COALESCE(u."searchesResumedAt", now()), now())
  WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p."userId" = u.id AND p.state = 'published');`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the migration changes no contract.
      rawSql({
        id: 'data.searches_resumed_backfill_on_pause',
        invariantId: 'searches-resumed-backfill-on-pause',
        label: 'Restart the paused-searches grace for users with a published profile',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'users' },
        },
        precheck: [],
        execute: [
          {
            description: 'restart users.searchesResumedAt for published users',
            sql: backfill,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
