#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/8efec91cbf32348047d5188f086d7fc07ba38a6a22a20c02f9e5ae387e4ad123/contract';
import endContract from '../../snapshots/8efec91cbf32348047d5188f086d7fc07ba38a6a22a20c02f9e5ae387e4ad123/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c51c7914f0f544daa1a0e22a4d406646bccf81ca2d88613e66422c47fd69fb1d/contract';
import startContract from '../../snapshots/c51c7914f0f544daa1a0e22a4d406646bccf81ca2d88613e66422c47fd69fb1d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'query_search_builder',
        column: 'domain',
        type: 'text',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_domain_check_5fdc18af',
        expression: sql`"domain" IN ('backend', 'frontend', 'fullstack', 'mobile', 'devops', 'data', 'ml', 'security', 'qa')`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
