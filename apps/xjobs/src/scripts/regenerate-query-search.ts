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
import {
  loadDatabaseEnvironment,
  parseEnvironment,
  postSearchEnvironmentSchema,
  toDatabaseConfig,
} from 'src/config';
import { createDatabaseClient, type DatabaseService } from 'src/database';
import { QuerySearchService } from 'src/modules/queries';
import { PrismaQuerySearchRepository } from 'src/modules/queries/repositories/queries.repository';
import { PrismaProfilesRepository } from 'src/modules/users/repositories/profiles.repository';
import { regeneratePublished } from 'src/modules/users/services/profiles.service';

async function main(): Promise<void> {
  const logger = new Logger('Regenerate');
  const databaseEnv = loadDatabaseEnvironment();
  // loadDatabaseEnvironment has loaded the env files into process.env.
  const { POST_SEARCH_USERS } = parseEnvironment(
    postSearchEnvironmentSchema,
    process.env,
  );
  const postsAllowed = (userId: string) => POST_SEARCH_USERS.includes(userId);
  const db = createDatabaseClient(toDatabaseConfig(databaseEnv), logger);
  // The repositories only read `db` from the database service.
  const database = { db } as DatabaseService;
  try {
    const { profiles, failed, skipped, retired, postsKept, postsDropped } =
      await regeneratePublished({
        profiles: new PrismaProfilesRepository(database),
        postsAllowed,
        querySearch: new QuerySearchService(
          new PrismaQuerySearchRepository(database),
        ),
      });
    logger.log(
      `Regenerated ${profiles - failed - skipped} of ${profiles} published profiles; retired ${retired} outdated builders`,
    );
    if (failed > 0 || skipped > 0)
      logger.warn(
        `${failed} profiles failed and ${skipped} were skipped (unpublished or post search switched meanwhile); their builders did not change. Run it again.`,
      );
    logger.log(
      `Post search on: ${postsKept} profiles kept their post builders, ${postsDropped} did not`,
    );
    if (failed > 0) process.exitCode = 1;
    if (postsDropped > 0)
      logger.warn(
        `${postsDropped} profiles have post search on but their owner is not in POST_SEARCH_USERS: their post builders were not attached. Set POST_SEARCH_USERS where you run this and run it again.`,
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
