#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/739bfe84606def2e9d718339bcc2f402d2692d2f8b0253bb6ea3a5e4c5acc9e4/contract';
import endContract from '../../snapshots/739bfe84606def2e9d718339bcc2f402d2692d2f8b0253bb6ea3a5e4c5acc9e4/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/888075ad022526b1838845dbd48fde015f395986010ef9199c82d6bec4a6c4db/contract';
import startContract from '../../snapshots/888075ad022526b1838845dbd48fde015f395986010ef9199c82d6bec4a6c4db/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'processing_attempts',
        constraint: 'processing_attempts_step_0068b0ea',
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_extractions',
        column: col('niceTags', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'job_extractions',
        column: col('requiredTags', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'job_extractions',
        constraint: 'job_extractions_niceTags_elem_not_null_3cdb81fc',
        expression: sql`array_position("niceTags", NULL) IS NULL`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'job_extractions',
        constraint: 'job_extractions_requiredTags_elem_not_null_26d3f93d',
        expression: sql`array_position("requiredTags", NULL) IS NULL`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'processing_attempts',
        constraint: 'processing_attempts_step_906f76b1',
        expression: sql`step IN ('decision', 'extraction', 'extraction_retry', 'generation', 'generation_retry', 'verification')`,
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_niceTags_gin_f00ca684',
        columns: ['niceTags'],
        extras: { type: 'gin' },
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_requiredTags_gin_187039b5',
        columns: ['requiredTags'],
        extras: { type: 'gin' },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
