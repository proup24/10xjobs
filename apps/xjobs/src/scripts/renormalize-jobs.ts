/**
 * Rebuilds every normalized job from raw storage at the current normalizer
 * version, without sending anything to Process. Run once after a
 * `NORMALIZER_VERSION` bump, and once to backfill existing raw items:
 *
 *   pnpm db:renormalize
 *
 * Needs only the database variables. It opens the client directly instead of
 * through Nest: tsx does not emit decorator metadata, so Nest constructor
 * injection cannot resolve services in scripts run with it.
 */
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database';
import { renormalizeJobs } from 'src/modules/ingest/services/renormalize.service';

async function main(): Promise<void> {
  const logger = new Logger('Renormalize');
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    const { items, invalid, jobs } = await renormalizeJobs({ db });
    logger.log(
      `Renormalized ${items} raw items into ${jobs} active jobs; ${invalid} items did not normalize`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Renormalize',
  );
  process.exit(1);
});
