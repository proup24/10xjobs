#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/7a9202b8254003df747c0106c86d0819f4e33a3cb129ff331fc2f1a9fafd5a95/contract';
import endContract from '../../snapshots/7a9202b8254003df747c0106c86d0819f4e33a3cb129ff331fc2f1a9fafd5a95/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a0e7e5cdb988c28b56a83fac52a2d9083dc8f30c34ed4db1e7736337e485494d/contract';
import startContract from '../../snapshots/a0e7e5cdb988c28b56a83fac52a2d9083dc8f30c34ed4db1e7736337e485494d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'job_matches',
        constraint: 'job_matches_outcome_99dbf9c9',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'job_matches',
        constraint: 'job_matches_rejected_verified_42d2b1cf',
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_matches',
        column: col('reviewField', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_matches',
        column: col('reviewRule', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'job_matches',
        constraint: 'job_matches_outcome_df17b99b',
        expression: sql`outcome IN ('qualified','rejected','review')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'job_matches',
        constraint: 'job_matches_rejected_verified_13f93349',
        expression: sql`NOT (outcome IN ('rejected','review') AND unverified)`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'job_matches',
        constraint: 'job_matches_review_reason_86bdbab5',
        expression: sql`(outcome = 'review') = ("reviewRule" IS NOT NULL AND "reviewField" IS NOT NULL) AND ("reviewRule" IS NULL) = ("reviewField" IS NULL)`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
