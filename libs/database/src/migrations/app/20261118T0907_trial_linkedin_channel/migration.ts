#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/6445f1a93dc43f67978d3e8df96ba5087d849227003d05e95a754d8d62b6d06f/contract';
import startContract from '../../snapshots/6445f1a93dc43f67978d3e8df96ba5087d849227003d05e95a754d8d62b6d06f/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b6e24147863b710157ffe6c6e5b71d5724098742ee41d4f8ebef331e1d55401f/contract';
import endContract from '../../snapshots/b6e24147863b710157ffe6c6e5b71d5724098742ee41d4f8ebef331e1d55401f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'collection_batches',
        constraint: 'collection_batches_channel_check_687325cb',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_processing_reason_0a1726bc',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_channel_check_687325cb',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'raw_items',
        constraint: 'raw_items_channel_check_687325cb',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'search_segment_runs',
        constraint: 'search_segment_runs_channel_check_687325cb',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'collection_batches',
        constraint: 'collection_batches_channel_check_09701322',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'normalized_jobs',
        constraint: 'normalized_jobs_processing_reason_e7149f39',
        expression: sql`"processingReason" IS NULL OR "processingReason" IN ('new', 'reopened', 'joined')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_channel_check_09701322',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'raw_items',
        constraint: 'raw_items_channel_check_09701322',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'search_segment_runs',
        constraint: 'search_segment_runs_channel_check_09701322',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
