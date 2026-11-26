#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/e895fa0426d33acc98a4ca64cd48bed7a9b21d8e3e52eee9f083ed68c0b324b1/contract';
import endContract from '../../snapshots/e895fa0426d33acc98a4ca64cd48bed7a9b21d8e3e52eee9f083ed68c0b324b1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/bfda5e93e4e7ecad4a8630730b553996ce2a804563293fb68414cf72428dbed1/contract';
import startContract from '../../snapshots/bfda5e93e4e7ecad4a8630730b553996ce2a804563293fb68414cf72428dbed1/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  lit,
  primaryKey,
  rawSql,
  sql,
} from '@prisma/orm-postgres/migration';

// Indeed's country sites as valig's actor lists them (62). The country code is the site
// upper-cased, except uk (Indeed's site code) which is GB. Remote jobs are searched with the
// main remote search only on the five sites in MAIN_REMOTE.
const SITES =
  'ar au at bh be br ca cl cn co cr cz dk ec eg fi fr de gr hk hu in id ie il it jp kw lu my mx ma nl nz ng no om pk pa pe ph pl pt qa ro sa sg za kr es se ch tw th tr ua ae uk us uy ve vn'.split(
    ' ',
  );
const MAIN_REMOTE = new Set(['us', 'br', 'pl', 'uk', 'ca']);

const seed = `INSERT INTO public.indeed_markets (site, "countryCode", "mainRemote")
VALUES ${SITES.map(
  (site) =>
    `('${site}', '${site === 'uk' ? 'GB' : site.toUpperCase()}', ${MAIN_REMOTE.has(site)})`,
).join(',\n  ')}
ON CONFLICT (site) DO NOTHING;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'collection_batches',
        constraint: 'collection_batches_channel_check_6c2cc154',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_channel_check_6c2cc154',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'raw_items',
        constraint: 'raw_items_channel_check_6c2cc154',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'search_segment_runs',
        constraint: 'search_segment_runs_channel_check_6c2cc154',
      }),
      this.createTable({
        schema: 'public',
        table: 'indeed_markets',
        columns: [
          col('countryCode', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('mainRemote', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('remoteLocation', 'text', {
            notNull: true,
            default: lit('Remote'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('site', 'text', {
            notNull: true,
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [primaryKey(['site'])],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'collection_batches',
        constraint: 'collection_batches_channel_check_b2699671',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY', 'INDEED')`,
      }),
      this.addUnique({
        schema: 'public',
        table: 'indeed_markets',
        constraint: 'indeed_markets_countryCode_key',
        columns: ['countryCode'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'query_search_builder',
        constraint: 'query_search_builder_channel_check_b2699671',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY', 'INDEED')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'raw_items',
        constraint: 'raw_items_channel_check_b2699671',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY', 'INDEED')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'search_segment_runs',
        constraint: 'search_segment_runs_channel_check_b2699671',
        expression: sql`"channel" IN ('LINKEDIN_JOB_BOARD', 'LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY', 'LINKEDIN_POSTS', 'GREEN_HOUSE', 'ASHBY', 'INDEED')`,
      }),
      this.enableRowLevelSecurity({
        schema: 'public',
        table: 'indeed_markets',
      }),
      rawSql({
        id: 'data.indeed_markets_seed',
        invariantId: 'indeed-markets-seed',
        label: 'Seed indeed_markets with the 62 Indeed sites',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'indeed_markets',
          },
        },
        precheck: [],
        execute: [{ description: 'insert the Indeed sites', sql: seed }],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
