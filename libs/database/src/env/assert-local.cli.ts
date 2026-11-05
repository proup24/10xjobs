/**
 * Runs before schema-writing Prisma commands (`db:migrate`, `db:update`,
 * `db:init`) and exits 1 when the target database is not local.
 */
import { loadDatabaseEnvironment } from './database-environment';
import { assertLocalDatabase, captureRemoteOptIn } from './local-guard';

// Snapshot the opt-in before loadDatabaseEnvironment() reads any .env file.
const optIn = captureRemoteOptIn(process.env);

try {
  const { DIRECT_DATABASE_URL, DATABASE_URL } = loadDatabaseEnvironment();
  assertLocalDatabase({ DIRECT_DATABASE_URL, DATABASE_URL }, optIn);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
