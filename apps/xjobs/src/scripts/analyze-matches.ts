/**
 * Read-only report on match quality: why jobs qualify with unknown checks,
 * how the processor fills position and tech stack.
 *
 *   pnpm --filter @xjobs/xjobs db:analyze
 *
 * Reads the database named by the environment files, like the other db:
 * scripts. Only SELECTs, inside a READ ONLY transaction.
 */
import { Logger } from '@nestjs/common';
import {
  loadDatabaseEnvironment,
  loadEnvironmentFiles,
  toDatabaseConfig,
} from 'src/config';
import { createDatabaseClient } from 'src/database';
import { SECTIONS } from './analyze-matches/sections';

const JSONB = 'pg/jsonb@1';

async function main(): Promise<void> {
  const logger = new Logger('AnalyzeMatches');
  loadEnvironmentFiles();
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        tx.raw.sql`SET TRANSACTION READ ONLY`.affectedCount().build(),
      );
      for (const section of SECTIONS) {
        const [row] = await tx.query(
          section.sql(tx.raw).returnsRow({ rows: JSONB }).build(),
        );
        const rows = (row?.rows ?? []) as Record<string, unknown>[];
        console.log(`\n== ${section.title} ==`);
        if (rows.length === 0) console.log('(no rows)');
        else console.table(rows);
      }
    });
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'AnalyzeMatches',
  );
  process.exit(1);
});
