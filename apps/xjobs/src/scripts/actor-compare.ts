/**
 * Compares the LinkedIn job-board actors (harvestapi and the trial actors) on
 * real outcomes: overlap, qualified jobs, decisions, cost per qualified job,
 * field coverage, AI-search behaviour and joined jobs.
 *
 *   pnpm --filter @xjobs/xjobs db:actor-compare -- [--since <iso> | --days <n>]
 *
 * Credit is by `collection_batches.actor`, not channel. `--since` defaults to
 * the first batch of a trial actor; with none yet, it says so and stops. Only
 * SELECTs, inside a READ ONLY transaction.
 */
import { Logger } from '@nestjs/common';
import {
  loadDatabaseEnvironment,
  loadEnvironmentFiles,
  toDatabaseConfig,
} from 'src/config';
import { createDatabaseClient } from 'src/database';
import { MATCHER_VERSION } from 'src/modules/matcher/config/matcher.config';
import {
  loadOutcomes,
  loadRuns,
  loadSightings,
  resolveSince,
} from './actor-compare/queries';
import { buildActorReport, formatActorReport } from './actor-compare/report';

export function parseArgs(argv: string[]): { since?: Date; days?: number } {
  let since: Date | undefined;
  let days: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--since') {
      since = new Date(argv[++i] ?? '');
      if (Number.isNaN(since.getTime()))
        throw new Error('--since needs an ISO date');
    } else if (arg === '--days') {
      days = Number(argv[++i]);
      if (!Number.isInteger(days) || days <= 0)
        throw new Error('--days needs a positive whole number');
    } else throw new Error(`Unknown argument ${arg}`);
  }
  if (since && days) throw new Error('Use --since or --days, not both');
  return { since, days };
}

async function main(): Promise<void> {
  const logger = new Logger('ActorCompare');
  loadEnvironmentFiles();
  const args = parseArgs(process.argv.slice(2));
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        tx.raw.sql`SET TRANSACTION READ ONLY`.affectedCount().build(),
      );
      const since = await resolveSince(tx, args);
      if (!since) {
        console.log(
          'No trial batch yet: nothing to compare. Pass --since or --days to report anyway.',
        );
        return;
      }
      const iso = since.toISOString();
      const [sightings, outcomes, runs] = [
        await loadSightings(tx, iso),
        await loadOutcomes(tx, iso),
        await loadRuns(tx, iso),
      ];
      console.log(
        `Actor comparison since ${iso} (Morocco days), ${sightings.length} sightings, ${runs.length} runs, matcher version >= ${MATCHER_VERSION}`,
      );
      console.log(
        formatActorReport(buildActorReport(sightings, outcomes, runs)),
      );
    });
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'ActorCompare',
  );
  process.exit(1);
});
