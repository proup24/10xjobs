/**
 * Archives every job seen only in batches of one Apify actor, and deletes
 * their matches. Run once per retired actor; dry-run first:
 *
 *   pnpm --filter @xjobs/xjobs db:archive-actor -- --actor <name> [--dry-run]
 *
 * Refuses a remote database unless `XJOBS_ALLOW_REMOTE_DB=1`.
 */
import { Logger } from '@nestjs/common';
import { assertLocalDatabase, captureRemoteOptIn } from '@xjobs/database/env';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database';
import type { DatabaseClient } from '@xjobs/database';
import { archiveActorJobs } from 'src/modules/processor/repositories/archive.repository';

export function parseArchiveArgs(argv: string[]): {
  actor: string;
  dryRun: boolean;
} {
  let actor: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--actor') actor = argv[++i];
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!actor || actor.startsWith('--'))
    throw new Error('--actor <name> is required');
  return { actor, dryRun };
}

async function countArchived(db: DatabaseClient): Promise<number> {
  const [row] = await db.query(
    db.raw
      .sql`SELECT count(*)::int AS n FROM normalized_jobs WHERE "processingStatus" = 'archived'`
      .returnsRow({ n: 'pg/int4@1' })
      .build(),
  );
  return row ? Number(row.n) : 0;
}

async function main(): Promise<void> {
  const logger = new Logger('ArchiveActor');
  // Snapshot the opt-in before any env file loads.
  const optIn = captureRemoteOptIn(process.env);
  const { actor, dryRun } = parseArchiveArgs(process.argv.slice(2));
  const env = loadDatabaseEnvironment();
  assertLocalDatabase({ DATABASE_URL: env.DATABASE_URL }, optIn);
  const db = createDatabaseClient(toDatabaseConfig(env), logger);
  try {
    logger.log(`${dryRun ? 'Dry run: ' : ''}archiving jobs of ${actor}`);
    const before = await countArchived(db);
    const result = await archiveActorJobs(db, actor, { dryRun });
    const after = await countArchived(db);
    logger.log(
      `${dryRun ? 'Would archive' : 'Archived'} ${result.jobs} jobs ${JSON.stringify(result.byStatus)}; ${dryRun ? 'would delete' : 'deleted'} ${result.matchesDeleted} matches`,
    );
    logger.log(`Archived jobs: ${before} before, ${after} after`);
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith('archive-actor-jobs.ts'))
  main().catch((error: unknown) => {
    Logger.error(
      error instanceof Error ? error.message : String(error),
      undefined,
      'ArchiveActor',
    );
    process.exit(1);
  });
