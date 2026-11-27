/**
 * Sends the listings the prefilter skipped in the last 24 hours (by first
 * seen) back to `pending`, so the processor sweep checks them again. Run once
 * after a `PREFILTER_VERSION` change (a check or word-list change); a profile
 * change does this by itself. Dry-run first:
 *
 *   pnpm --filter @xjobs/xjobs db:recheck-skips -- [--dry-run]
 *
 * Closed and expired jobs stay skipped. Refuses a remote database unless
 * `XJOBS_ALLOW_REMOTE_DB=1`.
 */
import { Logger } from '@nestjs/common';
import { assertLocalDatabase, captureRemoteOptIn } from '@xjobs/database/env';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient, type DatabaseService } from 'src/database';
import { RECHECK_WINDOW_MS } from 'src/modules/prefilter/config/prefilter.config';
import { PrismaPrefilterRepository } from 'src/modules/prefilter/repositories/prefilter.repository';

export function parseRecheckArgs(argv: string[]): { dryRun: boolean } {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--dry-run') dryRun = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  return { dryRun };
}

async function main(): Promise<void> {
  const logger = new Logger('RecheckSkips');
  // Snapshot the opt-in before any env file loads.
  const optIn = captureRemoteOptIn(process.env);
  const { dryRun } = parseRecheckArgs(process.argv.slice(2));
  const env = loadDatabaseEnvironment();
  assertLocalDatabase({ DATABASE_URL: env.DATABASE_URL }, optIn);
  const db = createDatabaseClient(toDatabaseConfig(env), logger);
  try {
    const repo = new PrismaPrefilterRepository({ db } as DatabaseService);
    const filter = {
      firstSeenSince: new Date(Date.now() - RECHECK_WINDOW_MS),
    };
    if (dryRun)
      logger.log(
        `Dry run: would reopen ${await repo.countReopenable(filter)} skipped listings`,
      );
    else
      logger.log(
        `Reopened ${await repo.reopenSkipped(filter)} skipped listings`,
      );
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith('recheck-skips.ts'))
  main().catch((error: unknown) => {
    Logger.error(
      error instanceof Error ? error.message : String(error),
      undefined,
      'RecheckSkips',
    );
    process.exit(1);
  });
