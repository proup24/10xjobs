#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/5c5ebc05508c65605769bbcd77d4eb71adc71b016b5cf9fc5cf54cf2cc573806/contract';
import endContract from '../../snapshots/5c5ebc05508c65605769bbcd77d4eb71adc71b016b5cf9fc5cf54cf2cc573806/contract.json' with { type: 'json' };
import startContract from '../../snapshots/5c5ebc05508c65605769bbcd77d4eb71adc71b016b5cf9fc5cf54cf2cc573806/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the
// `builder-recount` invariant in ../refs/db.json decides whether it runs on a
// fresh database. Advancing the `db` ref writes `invariants: []`; re-add it.
// 20261107T0249 deletes dev profiles, and their profile_query_search_builders
// links cascade, but a builder's associatedProfiles and isActive are kept by
// the engine, not by a trigger: they stayed as they were. This recounts them
// from the links, so a builder no profile uses is inactive and db:regenerate
// can retire it. It is idempotent: a second run changes no row.

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'data.query_search_builder_recount',
        invariantId: 'builder-recount',
        label:
          'Recount associatedProfiles and isActive of every builder from its profile links',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'query_search_builder',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'recount builders whose count or active flag is stale',
            sql: `UPDATE public.query_search_builder b
SET "associatedProfiles" = c.n, "isActive" = c.n > 0 AND NOT b."isDeleted"
FROM (SELECT b2.id, count(l.id) AS n FROM public.query_search_builder b2
      LEFT JOIN public.profile_query_search_builders l ON l."queryId" = b2.id
      GROUP BY b2.id) c
WHERE c.id = b.id
  AND (b."associatedProfiles" <> c.n OR b."isActive" <> (c.n > 0 AND NOT b."isDeleted"));`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
