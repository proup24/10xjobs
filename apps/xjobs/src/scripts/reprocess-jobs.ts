/**
 * Sends in-scope jobs back to `pending` so the processor worker runs them
 * again. Run after a prompt, schema or model change:
 *
 *   pnpm --filter @xjobs/xjobs db:reprocess -- --null-status
 *   ... --failed | --matched | --all-in-scope | --job <id> [--job <id> ...]
 *
 * `--matched` sends the jobs with a current qualified or review decision (the job's current extraction, the current matcher version).
 *
 * Out-of-scope and archived jobs are never touched, nor `--all-in-scope` the
 * jobs the prefilter skipped (never processed; `--job` sends one back to `pending`, where the next sweep skips it again if it still fails the check). Opens the client directly, like
 * `renormalize-jobs.ts`.
 */
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient, DatabaseService } from 'src/database';
import { PrismaProcessorRepository } from 'src/modules/processor/repositories/processor.repository';
import { parseReprocessArgs } from './processor-args';

async function main(): Promise<void> {
  const logger = new Logger('Reprocess');
  const filter = parseReprocessArgs(process.argv.slice(2));
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    const repo = new PrismaProcessorRepository({ db } as DatabaseService);
    const { marked, skippedArchived, leftSkipped } =
      await repo.markPending(filter);
    logger.log(
      `Marked ${marked} jobs pending; skipped ${skippedArchived} archived; left ${leftSkipped} the prefilter skipped`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Reprocess',
  );
  process.exit(1);
});
