#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/60c648669fe744bbcd8b2df78952fce8b68af22bf5ea5704e018486bdeef149e/contract';
import endContract from '../../snapshots/60c648669fe744bbcd8b2df78952fce8b68af22bf5ea5704e018486bdeef149e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/8efec91cbf32348047d5188f086d7fc07ba38a6a22a20c02f9e5ae387e4ad123/contract';
import startContract from '../../snapshots/8efec91cbf32348047d5188f086d7fc07ba38a6a22a20c02f9e5ae387e4ad123/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'search_segment_runs',
        columns: [
          col('capped', 'bool', { notNull: true, codecRef: { codecId: 'pg/bool@1' } }),
          col('channel', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('costMicroUsd', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('error', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('fetched', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('finishedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'uuid', { notNull: true, codecRef: { codecId: 'pg/uuid@1' } }),
          col('perQuery', 'jsonb', { notNull: true, codecRef: { codecId: 'pg/jsonb@1' } }),
          col('queryIds', 'uuid[]', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1', many: true },
          }),
          col('segmentHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('segmentKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('status', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('truncatedQueryIds', 'uuid[]', {
            notNull: true,
            codecRef: { codecId: 'pg/uuid@1', many: true },
          }),
          col('windowEnd', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('windowStart', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'search_segment_runs_channel_check_687325cb',
            sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY')`,
          ),
          checkExpression(
            'search_segment_runs_queryIds_elem_not_null_4915023e',
            sql`array_position("queryIds", NULL) IS NULL`,
          ),
          checkExpression(
            'search_segment_runs_status_c2d610e5',
            sql`status IN ('succeeded', 'partial', 'failed')`,
          ),
          checkExpression(
            'search_segment_runs_truncatedQueryIds_elem_not_null_f687001d',
            sql`array_position("truncatedQueryIds", NULL) IS NULL`,
          ),
          checkExpression('search_segment_runs_window_83d3058e', sql`"windowStart" < "windowEnd"`),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'query_search_builder',
        column: col('coveredUntil', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'search_segment_runs',
        index: 'search_segment_runs_channel_startedAt_idx_346540ce',
        columns: ['channel', 'startedAt'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
