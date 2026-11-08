#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract';
import startContract from '../../snapshots/1cfd25e269628885ca3ef263392ec32a0390667dcf7f74a7eabfc9c04de0cdd6/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5c5ebc05508c65605769bbcd77d4eb71adc71b016b5cf9fc5cf54cf2cc573806/contract';
import endContract from '../../snapshots/5c5ebc05508c65605769bbcd77d4eb71adc71b016b5cf9fc5cf54cf2cc573806/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profile_skills',
        constraint: 'profile_skills_technology_check_415c1e16',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_engagements_check_8a34079e',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_locations_shape_8e195cce',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_position_check_af0c0d09',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_seniorities_check_c892abac',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_technologies_check_84960705',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_locations_shape_c8b4dcae',
        expression: sql`"locations" IS NULL OR (jsonb_typeof("locations") = 'object' AND "locations" ?& ARRAY['remote', 'hybrid', 'onsite'] AND ("locations" - ARRAY['remote', 'hybrid', 'onsite']) = '{}'::jsonb AND CASE WHEN jsonb_typeof("locations" -> 'remote') = 'array' AND jsonb_typeof("locations" -> 'hybrid') = 'array' AND jsonb_typeof("locations" -> 'onsite') = 'array' THEN jsonb_array_length("locations" -> 'remote') <= 20 AND jsonb_array_length("locations" -> 'hybrid') <= 20 AND jsonb_array_length("locations" -> 'onsite') <= 20 AND NOT jsonb_path_exists("locations", '$.*[*] ? (@.type() != "string")') ELSE false END)`,
      }),
      // No production data exists. A dev profile written before the engine took the
      // new fields is missing one of them and cannot be published or edited in the new
      // shape, so it goes; its profile_skills and profile_query_search_builders cascade.
      rawSql({
        id: 'data.profiles_delete_without_new_fields',
        label:
          'Delete dev profiles missing places, spokenLanguages or contractTypes',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'profiles' },
        },
        precheck: [],
        execute: [
          {
            description: 'delete profiles missing a new field',
            sql: `DELETE FROM public.profiles
WHERE places IS NULL OR "spokenLanguages" IS NULL OR "contractTypes" IS NULL;`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
