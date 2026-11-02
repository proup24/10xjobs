/**
 * Seed runner — Prisma 8 has no built-in seed command.
 *
 *   pnpm db:seed                    run every seed, in order
 *   pnpm db:seed --only users       run the named seeds
 *   pnpm db:seed --allow-production required when NODE_ENV=production
 */
import { Logger } from '@nestjs/common';
import { EnvironmentType } from 'src/common/enums';
import { loadSeedEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from '../connection.source';
import type { Seed } from './seed.interface';
import { processorListsSeed } from './processor.seed';
import { usersSeed } from './users.seed';

/** Order matters: seeds run sequentially, so list parents before children. */
const seeds: Seed[] = [usersSeed, processorListsSeed];

function parseArgs(argv: string[]) {
  const onlyIndex = argv.indexOf('--only');
  const only =
    onlyIndex === -1
      ? undefined
      : argv[onlyIndex + 1]?.split(',').filter(Boolean);
  return { only, allowProduction: argv.includes('--allow-production') };
}

async function main(): Promise<void> {
  const logger = new Logger('Seed');
  const { only, allowProduction } = parseArgs(process.argv.slice(2));
  const env = loadSeedEnvironment();

  if (env.NODE_ENV === EnvironmentType.production && !allowProduction) {
    throw new Error(
      'Refusing to seed with NODE_ENV=production; pass --allow-production.',
    );
  }

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
      await db.transaction((tx) => seed.run(tx));
      logger.log(`${seed.name} seeded in ${Date.now() - startedAt}ms`);
    }
  } finally {
    // The pool keeps the event loop alive; the process hangs without this.
    await db.close();
  }
}

main().catch((error: unknown) => {
  new Logger('Seed').error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
