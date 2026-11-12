/**
 * Reports the share of decisions (job x profile) per outcome, and for `review`
 * the share per rule and per field, so review stays the exception:
 *
 *   pnpm --filter @xjobs/xjobs db:match-shares -- --days 7
 *
 * Counts `job_matches` rows written in the last N days (default 7) by the
 * current matcher version or later, so decisions from older rules do not skew
 * the shares. The window is `updatedAt`, not `decidedAt`: a re-match that keeps
 * the outcome keeps `decidedAt` but still bumps `updatedAt`.
 */
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database';
import { MATCHER_VERSION } from 'src/modules/matcher/config/matcher.config';
import {
  outcomeShares,
  type ShareRow,
} from 'src/modules/matcher/services/shares';

function parseDays(args: string[]): number {
  const i = args.indexOf('--days');
  if (i === -1) return 7;
  const days = Number(args[i + 1]);
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('--days needs a positive whole number');
  }
  return days;
}

function print(title: string, shares: Record<string, number>): void {
  console.log(`\n${title}`);
  const entries = Object.entries(shares).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) console.log('  (none)');
  for (const [key, share] of entries) {
    console.log(`  ${key.padEnd(20)} ${(share * 100).toFixed(1)}%`);
  }
}

async function main(): Promise<void> {
  const logger = new Logger('MatchShares');
  const days = parseDays(process.argv.slice(2));
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    const { raw } = db;
    const text = 'pg/text@1';
    const rows = (await db.query(
      raw.sql`SELECT m.outcome, m."reviewRule", m."reviewField"
        FROM job_matches m
        WHERE m."updatedAt" >= now() - make_interval(days => ${days}::int)
          AND m."matcherVersion" >= ${MATCHER_VERSION}::int`
        .returnsRow({ outcome: text, reviewRule: text, reviewField: text })
        .build(),
    )) as ShareRow[];
    const result = outcomeShares(rows);
    console.log(
      `Match shares: last ${days} days, matcher version >= ${MATCHER_VERSION}, ${result.total} decisions`,
    );
    print('Outcome', result.byOutcome);
    print('Review by rule (of review rows)', result.reviewByRule);
    print('Review by field (of review rows)', result.reviewByField);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'MatchShares',
  );
  process.exit(1);
});
