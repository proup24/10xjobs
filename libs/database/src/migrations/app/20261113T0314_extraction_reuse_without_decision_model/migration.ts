#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4127c182defde6c4757b9fb233d4eb83b044fa16fbcbaf6a7796087aaa804ee9/contract';
import startContract from '../../snapshots/4127c182defde6c4757b9fb233d4eb83b044fa16fbcbaf6a7796087aaa804ee9/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5201f9230494207e174126f3348a3d6713e841a1997ba7f264ec11f62038f179/contract';
import endContract from '../../snapshots/5201f9230494207e174126f3348a3d6713e841a1997ba7f264ec11f62038f179/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_reuse',
      }),
      this.dropNotNull({
        schema: 'public',
        table: 'job_extractions',
        column: 'decisionModel',
      }),
      this.createIndex({
        schema: 'public',
        table: 'job_extractions',
        index: 'job_extractions_reuse',
        columns: ['inputHash', 'schemaVersion', 'promptHash', 'extractionModel'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
