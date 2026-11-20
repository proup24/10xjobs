/**
 * One-off paid check, run only by the maintainer: does halving a LinkedIn
 * search group keep at least 95% of the merged search's jobs?
 *
 *   pnpm --filter @xjobs/xjobs db:split-check -- --dry-run
 *   pnpm --filter @xjobs/xjobs db:split-check -- [--group <key>]
 *
 * Picks one active LINKEDIN_JOB_BOARD group (the named key, else the one with
 * most rows in the last 24 hours under 120), then makes three harvestapi runs
 * of at most 150 rows over the last 24 hours: the merged keyword and its two
 * halves. Prints the jobs the halves cover. `--dry-run` prints the group, the
 * three keywords and the reserved spend, and exits before APIFY_TOKEN is
 * read. The paid path reserves $0.16 per run and refuses above $0.50.
 */
import { Logger } from '@nestjs/common';
import { parseArgs } from 'node:util';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient, type QuerySearchBuilderRow } from 'src/database';
import { toHarvestJobSearchInput } from 'src/modules/collectors/providers/mappers/linkedin-job-board.mapper';
import { segmentKey } from 'src/modules/segments';
import {
  RUN_CAP_USD,
  RUN_ROWS,
  TOTAL_CAP_USD,
  checkPlan,
  coverage,
  halfKeywords,
  inconclusive,
  pickGroup,
  runFailure,
  type GroupCandidate,
} from './split-check/logic';

const ACTOR = 'harvestapi/linkedin-job-search';
const MEMORY_MBYTES = 1024;

async function loadGroups(logger: Logger): Promise<GroupCandidate[]> {
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    const { raw } = db;
    const text = 'pg/text@1';
    const JSONB = 'pg/jsonb@1';
    const int = 'pg/int4@1';
    const builders = (await db.query(
      raw.sql`SELECT id::text AS id, channel::text AS channel, type::text AS type,
          domain::text AS domain, location, hash, to_jsonb(params) AS params
        FROM query_search_builder
        WHERE channel = 'LINKEDIN_JOB_BOARD' AND "isActive" AND NOT "isDeleted"`
        .returnsRow({
          id: text,
          channel: text,
          type: text,
          domain: text,
          location: text,
          hash: text,
          params: JSONB,
        })
        .build(),
    )) as {
      id: string;
      channel: string;
      type: string;
      domain: string;
      location: string;
      hash: string;
      params: unknown;
    }[];
    const runs = (await db.query(
      raw.sql`SELECT r."segmentKey" AS key, COALESCE(sum(r.fetched), 0)::int AS rows
        FROM search_segment_runs r
        JOIN collection_batches b ON b."segmentRunId" = r.id AND b.actor = ${ACTOR}
        WHERE r.channel = 'LINKEDIN_JOB_BOARD'
          AND r."startedAt" >= now() - interval '24 hours'
        GROUP BY r."segmentKey"`
        .returnsRow({ key: text, rows: int })
        .build(),
    )) as { key: string; rows: number }[];
    const rows = new Map(runs.map((r) => [r.key, r.rows]));
    const groups = new Map<string, GroupCandidate>();
    for (const b of builders) {
      const params = (
        typeof b.params === 'string' ? JSON.parse(b.params) : (b.params ?? {})
      ) as Record<string, unknown>;
      const key = segmentKey({
        ...b,
        params,
      } as unknown as QuerySearchBuilderRow);
      const group = groups.get(key) ?? {
        key,
        rows24h: rows.get(key) ?? 0,
        members: [],
      };
      group.members.push({ id: b.id, hash: b.hash, params });
      groups.set(key, group);
    }
    return [...groups.values()];
  } finally {
    await db.close();
  }
}

/** The paid path: the only code that builds an Apify client. Never reached with --dry-run. */
async function runPaid(
  keywords: string[],
  params: Record<string, unknown>,
): Promise<{ ids: Set<string>[]; costUsd: number }> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN is required');
  const { ApifyClient } = await import('apify-client');
  const client = new ApifyClient({ token });
  const ids: Set<string>[] = [];
  let costUsd = 0;
  for (const keyword of keywords) {
    const started = await client.actor(ACTOR).start(
      {
        ...toHarvestJobSearchInput(keyword, params, RUN_ROWS),
        postedLimit: '24h',
      },
      { maxTotalChargeUsd: RUN_CAP_USD, memory: MEMORY_MBYTES },
    );
    const finished = await client
      .run(started.id)
      .waitForFinish({ waitSecs: 900 });
    costUsd += finished.usageTotalUsd ?? RUN_CAP_USD;
    const failure = runFailure(finished.id, finished.status, costUsd);
    if (failure) throw new Error(failure);
    const items = (await client.dataset(finished.defaultDatasetId).listItems())
      .items as Record<string, unknown>[];
    ids.push(
      new Set(
        items
          .map((item) => item.id)
          .filter((id): id is string | number => id != null)
          .map(String),
      ),
    );
    const role = ids.length === 1 ? 'merged' : 'half';
    const reason = inconclusive(
      items.length,
      finished.usageTotalUsd ?? 0,
      role,
    );
    if (reason) {
      throw new Error(
        `Inconclusive: the ${role} search (${keyword}) returned ${items.length} rows (${reason}); stopped after $${costUsd.toFixed(3)}`,
      );
    }
  }
  return { ids, costUsd };
}

async function main(): Promise<void> {
  const logger = new Logger('SplitCheck');
  const { values } = parseArgs({
    // pnpm forwards a literal `--` separator.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      group: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const group = pickGroup(await loadGroups(logger), values.group);
  const { merged, halves, by } = halfKeywords(group);
  const keywords = [merged, ...halves];
  const plan = checkPlan();
  const summary = {
    group: group.key,
    rows24h: group.rows24h,
    members: group.members.length,
    by,
    keywords,
    reservedUsd: Number(plan.reservedUsd.toFixed(4)),
    capUsd: TOTAL_CAP_USD,
    fits: plan.fits,
  };
  if (values['dry-run']) {
    console.log(JSON.stringify({ dryRun: true, ...summary }, null, 2));
    return;
  }
  if (!plan.fits) {
    throw new Error(
      `Refusing: $${plan.reservedUsd.toFixed(3)} reserved passes the $${TOTAL_CAP_USD} cap`,
    );
  }
  const { ids, costUsd } = await runPaid(keywords, group.members[0].params);
  console.log(
    JSON.stringify(
      {
        group: group.key,
        by,
        keywords,
        coverage: coverage(ids[0], ids[1], ids[2]),
        costUsd: Number(costUsd.toFixed(4)),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
