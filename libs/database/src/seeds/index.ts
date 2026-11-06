/**
 * Seed runner — Prisma 8 has no built-in seed command.
 *
 *   pnpm db:seed                    run every seed, in order
 *   pnpm db:seed --only users        run the named seeds
 *   pnpm db:seed --only users,processor-lists
 *   pnpm db:seed --allow-production required when NODE_ENV=production
 *
 * Every seed must be idempotent: CI re-runs all of them on the shared dev
 * database after each merge.
 */
import { createDatabaseClient } from '../client/connection.source';
import { consoleLogger } from '../client/database-logger';
import {
  assertLocalDatabase,
  captureRemoteOptIn,
  EnvironmentType,
  loadSeedEnvironment,
  toDatabaseConfig,
} from '../env';
import type { SeedEnvironmentVariables } from '../env';
import type { Seed } from './seed.interface';
import { isoSeed } from './iso.seed';
import { processorListsSeed } from './processor.seed';
import { usersSeed } from './users.seed';

/** Order matters: seeds run sequentially, so list parents before children. */
const seeds: Seed[] = [usersSeed, processorListsSeed, isoSeed];

function parseArgs(argv: string[]) {
  const onlyIndex = argv.indexOf('--only');
  const only =
    onlyIndex === -1
      ? undefined
      : argv[onlyIndex + 1]?.split(',').filter(Boolean);
  return { only, allowProduction: argv.includes('--allow-production') };
}

/**
 * @description Refuses to seed unless both the database and the Supabase API
 * (the users seed creates auth users there) are local, so the two cannot
 * point at different stacks. `processEnv` must be the opt-in snapshot taken
 * before env files load. `XJOBS_ALLOW_REMOTE_DB=1` opts out.
 */
export function assertSeedTargets(
  env: SeedEnvironmentVariables,
  processEnv: NodeJS.ProcessEnv,
): void {
  assertLocalDatabase(
    { DATABASE_URL: env.DATABASE_URL, SUPABASE_URL: env.SUPABASE_URL },
    processEnv,
  );
}

async function main(): Promise<void> {
  const logger = consoleLogger('Seed');
  const { only, allowProduction } = parseArgs(process.argv.slice(2));
  // Snapshot the opt-in before loadSeedEnvironment() reads any .env file.
  const optIn = captureRemoteOptIn(process.env);
  const env = loadSeedEnvironment();

  if (env.NODE_ENV === EnvironmentType.production && !allowProduction) {
    throw new Error(
      'Refusing to seed with NODE_ENV=production; pass --allow-production.',
    );
  }

  assertSeedTargets(env, optIn);

  const unknown = only?.filter(
    (name) => !seeds.some((seed) => seed.name === name),
  );
  if (unknown?.length) {
    throw new Error(`Unknown seed(s): ${unknown.join(', ')}`);
  }
  const selected = only
    ? seeds.filter((seed) => only.includes(seed.name))
    : seeds;

  const db = createDatabaseClient(toDatabaseConfig(env), logger);
  try {
    for (const seed of selected) {
      const startedAt = Date.now();
      await db.transaction((tx) => seed.run(tx, env));
      logger.log(`${seed.name} seeded in ${Date.now() - startedAt}ms`);
    }
  } finally {
    // The pool keeps the event loop alive; the process hangs without this.
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    consoleLogger('Seed').error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
