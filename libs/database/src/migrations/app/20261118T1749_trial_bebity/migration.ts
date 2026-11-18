#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1d9c360ab7e1f94820c35389f4fc5e6779dadfbab7e6b3c330e3d9ce6e1fd55f/contract';
import endContract from '../../snapshots/1d9c360ab7e1f94820c35389f4fc5e6779dadfbab7e6b3c330e3d9ce6e1fd55f/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b6e24147863b710157ffe6c6e5b71d5724098742ee41d4f8ebef331e1d55401f/contract';
import startContract from '../../snapshots/b6e24147863b710157ffe6c6e5b71d5724098742ee41d4f8ebef331e1d55401f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'collection_batches',
        constraint: 'collection_batches_channel_check_09701322',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_channel_check_09701322',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'raw_items',
        constraint: 'raw_items_channel_check_09701322',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'search_segment_runs',
        constraint: 'search_segment_runs_channel_check_09701322',
      }),
      this.addColumn({
        schema: 'public',
        table: 'search_segment_runs',
        column: col('apifyRunId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'search_segment_runs',
        column: col('costFinalAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'collection_batches',
        constraint: 'collection_batches_channel_check_6c2cc154',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_channel_check_6c2cc154',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'raw_items',
        constraint: 'raw_items_channel_check_6c2cc154',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'search_segment_runs',
        constraint: 'search_segment_runs_channel_check_6c2cc154',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
