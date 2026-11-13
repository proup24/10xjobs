#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4127c182defde6c4757b9fb233d4eb83b044fa16fbcbaf6a7796087aaa804ee9/contract';
import endContract from '../../snapshots/4127c182defde6c4757b9fb233d4eb83b044fa16fbcbaf6a7796087aaa804ee9/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/881c039aef420519d4c8f137b88287c268d14c2afc804de5813e72c422847ce5/contract';
import startContract from '../../snapshots/881c039aef420519d4c8f137b88287c268d14c2afc804de5813e72c422847ce5/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_processing_status_eba7bd28',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_processing_status_89abdf7d',
        expression: sql`"processingStatus" IS NULL OR "processingStatus" IN ('pending', 'processing', 'processed', 'failed', 'archived')`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
