#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4bdafacb4acf80aa9d8e3c49a0be2f74bdedea1ace7542a31a5bb09fa2376833/contract';
import startContract from '../../snapshots/4bdafacb4acf80aa9d8e3c49a0be2f74bdedea1ace7542a31a5bb09fa2376833/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/793fa85bf51730236dcd5b86ba17417fbc3a6d1cc782b40ef94b4f2dda9e58ba/contract';
import endContract from '../../snapshots/793fa85bf51730236dcd5b86ba17417fbc3a6d1cc782b40ef94b4f2dda9e58ba/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_seniority_check_2e7615f6',
      }),
      this.dropColumn({ schema: 'public', table: 'profiles', column: 'seniority' }),
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'profiles',
        column: 'seniorities',
        type: 'text[]',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_seniorities_check_c892abac',
        expression: sql`array_remove("seniorities", NULL) <@ '{"junior","mid","senior","staff","lead","principal","unstated"}'`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_seniorities_elem_not_null_f6b227c2',
        expression: sql`array_position("seniorities", NULL) IS NULL`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_seniorities_nonempty_798996d1',
        expression: sql`cardinality("seniorities") > 0`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
