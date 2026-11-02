#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/06f6a3c9df66daa597bce413868406741cef2abdbc83fb2b5167a6b4dc555e56/contract';
import startContract from '../../snapshots/06f6a3c9df66daa597bce413868406741cef2abdbc83fb2b5167a6b4dc555e56/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/4bdafacb4acf80aa9d8e3c49a0be2f74bdedea1ace7542a31a5bb09fa2376833/contract';
import endContract from '../../snapshots/4bdafacb4acf80aa9d8e3c49a0be2f74bdedea1ace7542a31a5bb09fa2376833/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_locations_nonempty_dfbcb81c',
        expression: sql`jsonb_path_exists("locations", '$.*[*]')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_locations_shape_8e195cce',
        expression: sql`jsonb_typeof("locations") = 'object' AND "locations" ?& ARRAY['remote', 'hybrid', 'onsite'] AND ("locations" - ARRAY['remote', 'hybrid', 'onsite']) = '{}'::jsonb AND CASE WHEN jsonb_typeof("locations" -> 'remote') = 'array' AND jsonb_typeof("locations" -> 'hybrid') = 'array' AND jsonb_typeof("locations" -> 'onsite') = 'array' THEN jsonb_array_length("locations" -> 'remote') <= 20 AND jsonb_array_length("locations" -> 'hybrid') <= 20 AND jsonb_array_length("locations" -> 'onsite') <= 20 AND NOT jsonb_path_exists("locations", '$.*[*] ? (@.type() != "string")') ELSE false END`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
