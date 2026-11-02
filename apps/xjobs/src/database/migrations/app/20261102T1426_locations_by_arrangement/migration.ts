#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/06f6a3c9df66daa597bce413868406741cef2abdbc83fb2b5167a6b4dc555e56/contract';
import endContract from '../../snapshots/06f6a3c9df66daa597bce413868406741cef2abdbc83fb2b5167a6b4dc555e56/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/944233e509d9126dc6f0d7e64cc2c8229c1661126b49d35a36427a3f75e7a262/contract';
import startContract from '../../snapshots/944233e509d9126dc6f0d7e64cc2c8229c1661126b49d35a36427a3f75e7a262/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_arrangements_check_7606728b',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_arrangements_elem_not_null_d7d34c79',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_arrangements_nonempty_52fb6f2a',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_regions_check_76fa66e0',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_regions_elem_not_null_0c7680bd',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'profiles',
        column: 'arrangements',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'profiles',
        column: 'regions',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_locationRegion_check_eb30a260',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: 'city',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: 'country',
      }),
      this.dropColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: 'locationRegion',
      }),
      // No data conversion: the local DB is rebuilt, so refuse to run on rows.
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'profiles',
        column: 'locations',
        type: 'jsonb',
      }),
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'query_search_builder',
        column: 'location',
        type: 'text',
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
