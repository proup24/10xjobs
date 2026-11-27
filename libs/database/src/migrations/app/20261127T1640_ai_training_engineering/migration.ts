#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/5939ea1853a407103172fa96c99abb769846b6154c9478bb1c69034452cded06/contract';
import endContract from '../../snapshots/5939ea1853a407103172fa96c99abb769846b6154c9478bb1c69034452cded06/contract.json' with { type: 'json' };
import startContract from '../../snapshots/5939ea1853a407103172fa96c99abb769846b6154c9478bb1c69034452cded06/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      rawSql({
        id: 'data.ai_training_engineering',
        invariantId: 'ai-training-engineering',
        label: 'Make ai_training an engineering role kind (pickable position)',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'role_kinds',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'set isEngineering on ai_training',
            sql: `UPDATE public.role_kinds SET "isEngineering" = true WHERE code = 'ai_training'`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
