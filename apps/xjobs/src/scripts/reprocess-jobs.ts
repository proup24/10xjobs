/**
 * Sends in-scope jobs back to `pending` so the processor worker runs them
 * again. Run after a prompt, schema or model change:
 *
 *   pnpm --filter @xjobs/xjobs db:reprocess -- --null-status
 *   ... --failed | --all-in-scope | --job <id> [--job <id> ...]
 *
 * Out-of-scope jobs are never touched. Opens the client directly, like
 * `renormalize-jobs.ts`.
 */
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database/connection.source';
import { DatabaseService } from 'src/database';
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
    const count = await repo.markPending(filter);
    logger.log(`Marked ${count} jobs pending`);
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
