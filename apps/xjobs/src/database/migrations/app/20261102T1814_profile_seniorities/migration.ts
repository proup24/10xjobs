#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/da432ef0b1859e5225c643c9537143faa94120043b84a291cdd171718f136238/contract';
import startContract from '../../snapshots/da432ef0b1859e5225c643c9537143faa94120043b84a291cdd171718f136238/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/eb0f366d51b0fedb19b470dde53b69cbbe1fc892bb3471c9bb95af7005385b57/contract';
import endContract from '../../snapshots/eb0f366d51b0fedb19b470dde53b69cbbe1fc892bb3471c9bb95af7005385b57/contract.json' with { type: 'json' };
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
