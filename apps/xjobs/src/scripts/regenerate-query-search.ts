/**
 * Moves every published profile to the query search builders of the current
 * recipe and retires the outdated ones. Run once after a recipe version bump:
 *
 *   pnpm db:regenerate
 *
 * Needs only the database variables. It builds its services by hand instead
 * of through Nest: tsx does not emit decorator metadata, so Nest constructor
 * injection cannot resolve services in scripts run with it.
 */
import { Logger } from '@nestjs/common';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import type { DatabaseService } from 'src/database';
import { createDatabaseClient } from 'src/database/connection.source';
import { QuerySearchService } from 'src/modules/queries';
import { PrismaQuerySearchRepository } from 'src/modules/queries/repositories/queries.repository';
import { PrismaProfilesRepository } from 'src/modules/users/repositories/profiles.repository';
import { regeneratePublished } from 'src/modules/users/services/profiles.service';

async function main(): Promise<void> {
  const logger = new Logger('Regenerate');
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  // The repositories only read `db` from the database service.
  const database = { db } as DatabaseService;
  try {
    const { profiles, retired } = await regeneratePublished({
      profiles: new PrismaProfilesRepository(database),
      querySearch: new QuerySearchService(
        new PrismaQuerySearchRepository(database),
      ),
    });
    logger.log(
      `Regenerated ${profiles} published profiles; retired ${retired} outdated builders`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Regenerate',
  );
  process.exit(1);
});
