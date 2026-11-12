/**
 * Sends jobs back to the match worker with `force`, so each is decided again
 * against every published profile. Run after a rule change, after bumping
 * `MATCHER_VERSION` (so the sweep also covers anything this misses):
 *
 *   pnpm --filter @xjobs/xjobs db:rematch -- --all
 *   ... --job <id> [--job <id> ...]
 *
 * `--all` is every matchable job. Opens the client and the queue directly,
 * like `reprocess-jobs.ts`; needs the match worker running to do the work.
 */
import { Logger } from '@nestjs/common';
import {
  loadDatabaseEnvironment,
  loadEnvironmentFiles,
  toDatabaseConfig,
  type RedisConfig,
} from 'src/config';
import { redisEnvironmentSchema } from 'src/config/environment.validation';
import { createDatabaseClient, type DatabaseService } from 'src/database';
import { MatchQueue } from 'src/infrastructure/jobs/steps/match';
import { PrismaRatesRepository } from 'src/modules/rates/rates.repository';
import { PrismaMatcherRepository } from 'src/modules/matcher/repositories/matcher.repository';
import { parseRematchArgs, REMATCH_USAGE } from './rematch-args';

async function main(): Promise<void> {
  const logger = new Logger('Rematch');
  let selector;
  try {
    selector = parseRematchArgs(process.argv.slice(2));
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    logger.error(REMATCH_USAGE);
    process.exit(1);
  }
  loadEnvironmentFiles();
  const redis = redisEnvironmentSchema.parse(process.env);
  const settings: RedisConfig = {
    url: redis.REDIS_URL,
    cacheUrl: redis.REDIS_CACHE_URL,
    prefix: redis.REDIS_PREFIX,
    commandTimeoutMs: redis.REDIS_COMMAND_TIMEOUT_MS,
    cacheTtlSeconds: redis.CACHE_TTL_SECONDS,
    jobsConcurrency: redis.JOBS_CONCURRENCY,
  };
  const db = createDatabaseClient(
    toDatabaseConfig(loadDatabaseEnvironment()),
    logger,
  );
  const queue = new MatchQueue(settings);
  try {
    const repo = new PrismaMatcherRepository(
      { db } as DatabaseService,
      new PrismaRatesRepository({ db } as DatabaseService),
    );
    const jobIds =
      'all' in selector ? await repo.listMatchableJobs() : selector.jobIds;
    for (const jobId of jobIds) await queue.enqueue(jobId, { force: true });
    logger.log(`Enqueued ${jobIds.length} jobs to match`);
  } finally {
    await queue.onApplicationShutdown();
    await db.close();
  }
}

main().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : String(error),
    undefined,
    'Rematch',
  );
  process.exit(1);
});
