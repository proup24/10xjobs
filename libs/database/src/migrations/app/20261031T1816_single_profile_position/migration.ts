#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/64733e95e0c7fb5bff5ac7480083265995823beeb7bc089770bc3bd088a60b13/contract';
import startContract from '../../snapshots/64733e95e0c7fb5bff5ac7480083265995823beeb7bc089770bc3bd088a60b13/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/bfacc3d4a0bb9a652f031e22963be006d874e300384a392fe43c4d1e0975548f/contract';
import endContract from '../../snapshots/bfacc3d4a0bb9a652f031e22963be006d874e300384a392fe43c4d1e0975548f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_positions_check_189b7313',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_positions_elem_not_null_8c5582cf',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_positions_nonempty_fbe59e7d',
      }),
      this.dropColumn({ schema: 'public', table: 'profiles', column: 'positions' }),
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'profiles',
        column: 'position',
        type: 'text',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'profiles',
        constraint: 'profiles_position_check_af0c0d09',
        expression: sql`"position" IN ('backend_engineer', 'frontend_engineer', 'fullstack_engineer', 'mobile_engineer', 'devops_engineer', 'site_reliability_engineer', 'platform_engineer', 'cloud_engineer', 'security_engineer', 'data_engineer', 'ml_engineer', 'ai_engineer', 'qa_engineer', 'embedded_engineer', 'software_architect', 'tech_lead', 'engineering_manager')`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
