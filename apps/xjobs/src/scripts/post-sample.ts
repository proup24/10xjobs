/**
 * Exports a random sample of LinkedIn post items, for labelling the post drop
 * rules. Read-only: it runs SELECTs only.
 *
 *   pnpm --filter @xjobs/xjobs db:post-sample -- --size <n> [--days <n>] --out <path>
 *
 * Writes a JSON array of `{ rawItemId, payload, label: null }`, where payload is
 * the item's latest raw version. `--days` keeps items last seen within n days.
 * Refuses a remote database unless `XJOBS_ALLOW_REMOTE_DB=1`.
 */
import { writeFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { assertLocalDatabase, captureRemoteOptIn } from '@xjobs/database/env';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database';
import { parsePostSampleArgs, POST_SAMPLE_USAGE } from './post-sample-args';

async function main(): Promise<void> {
  const logger = new Logger('PostSample');
  // Snapshot the opt-in before any env file loads.
  const optIn = captureRemoteOptIn(process.env);
  let args;
  try {
    args = parsePostSampleArgs(process.argv.slice(2));
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${POST_SAMPLE_USAGE}`,
    );
  }
  const env = loadDatabaseEnvironment();
  assertLocalDatabase({ DATABASE_URL: env.DATABASE_URL }, optIn);
  const db = createDatabaseClient(toDatabaseConfig(env), logger);
  try {
    const { raw } = db;
    // 0 means no window; --days is validated as at least 1.
    const days = args.days ?? 0;
    const rows = await db.query(
      raw.sql`SELECT i.id AS "rawItemId", v.payload AS payload
        FROM raw_items i
        JOIN raw_item_versions v ON v.id = i."latestVersionId"
        WHERE i.channel = 'LINKEDIN_POSTS'
          AND (${days}::int = 0
            OR i."lastSeenAt" >= now() - make_interval(days => ${days}::int))
        ORDER BY random()
        LIMIT ${args.size}::int`
        .returnsRow({ rawItemId: 'pg/uuid@1', payload: 'pg/jsonb@1' })
        .build(),
    );
    const sample = rows.map((row) => ({
      rawItemId: String(row.rawItemId),
      payload: row.payload,
      label: null,
    }));
    writeFileSync(args.out, `${JSON.stringify(sample, null, 2)}\n`);
    logger.log(`Wrote ${sample.length} posts to ${args.out}`);
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith('post-sample.ts'))
  main().catch((error: unknown) => {
    Logger.error(
      error instanceof Error ? error.message : String(error),
      undefined,
      'PostSample',
    );
    process.exit(1);
  });
