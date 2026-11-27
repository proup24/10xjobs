/**
 * Publishes every draft profile that has a resume, once. Profiles made before
 * publish-on-finish never got published; this does what finishing setup now
 * does, through `ProfilesService.publish`. Dry-run first:
 *
 *   pnpm --filter @xjobs/xjobs db:publish-drafts -- [--dry-run]
 *
 * Prints profile ids and outcome codes only. A draft that publish refuses
 * (incomplete, no eligibility answers) is reported and skipped; the exit code
 * is 1 if any failed. Refuses a remote database unless `XJOBS_ALLOW_REMOTE_DB=1`.
 *
 * It builds its services by hand instead of through Nest: tsx does not emit
 * decorator metadata, so Nest constructor injection cannot resolve services
 * in scripts run with it.
 */
import { HttpException, Logger } from '@nestjs/common';
import { assertLocalDatabase, captureRemoteOptIn } from '@xjobs/database/env';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient, type DatabaseService } from 'src/database';
import { QuerySearchService } from 'src/modules/queries';
import { PrismaQuerySearchRepository } from 'src/modules/queries/repositories/queries.repository';
import { PrismaProfilesRepository } from 'src/modules/users/repositories/profiles.repository';
import { PrismaUsersRepository } from 'src/modules/users/repositories/users.repository';
import type { StorageService } from 'src/modules/storage';
import { ProfilesService } from 'src/modules/users/services/profiles.service';
import { UsersService } from 'src/modules/users/services/users.service';
import { describeError } from 'src/utils';

export interface DraftRef {
  id: string;
  userId: string;
}

export interface PublishDraftsDeps {
  /** Drafts that have a resume. */
  listDrafts: () => Promise<DraftRef[]>;
  publish: (userId: string, profileId: string) => Promise<unknown>;
}

export interface PublishDraftsResult {
  published: number;
  failed: number;
  outcomes: { id: string; outcome: string }[];
}

/** The error code of a refusal, else its status or class: never its message. */
function outcomeOf(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'object' && body !== null && 'code' in body)
      return String((body as { code: unknown }).code);
    return `HTTP_${error.getStatus()}`;
  }
  return describeError(error);
}

/**
 * Publishes each draft in turn. One refused draft is recorded and the rest
 * still run. A dry run publishes nothing.
 */
export async function publishDrafts(
  deps: PublishDraftsDeps,
  options: { dryRun?: boolean } = {},
): Promise<PublishDraftsResult> {
  const result: PublishDraftsResult = { published: 0, failed: 0, outcomes: [] };
  for (const draft of await deps.listDrafts()) {
    if (options.dryRun) {
      result.outcomes.push({ id: draft.id, outcome: 'would publish' });
      continue;
    }
    try {
      await deps.publish(draft.userId, draft.id);
      result.published += 1;
      result.outcomes.push({ id: draft.id, outcome: 'published' });
    } catch (error) {
      result.failed += 1;
      result.outcomes.push({ id: draft.id, outcome: outcomeOf(error) });
    }
  }
  return result;
}

export function parsePublishDraftsArgs(rawArgv: readonly string[]): {
  dryRun: boolean;
} {
  const argv = rawArgv[0] === '--' ? rawArgv.slice(1) : rawArgv;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return { dryRun };
}

async function main(): Promise<void> {
  const logger = new Logger('PublishDrafts');
  // Snapshot the opt-in before any env file loads.
  const optIn = captureRemoteOptIn(process.env);
  let dryRun;
  try {
    ({ dryRun } = parsePublishDraftsArgs(process.argv.slice(2)));
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    logger.error('usage: db:publish-drafts -- [--dry-run]');
    process.exit(1);
  }
  const databaseEnv = loadDatabaseEnvironment();
  assertLocalDatabase({ DATABASE_URL: databaseEnv.DATABASE_URL }, optIn);
  const db = createDatabaseClient(toDatabaseConfig(databaseEnv), logger);
  // The repositories only read `db` from the database service.
  const database = { db } as DatabaseService;
  try {
    const profiles = new PrismaProfilesRepository(database);
    // publish never touches storage; only deletePublished removes resume files.
    const unusedStorage = Object.fromEntries(
      ['put', 'get', 'delete', 'deletePrefix', 'ensureBucket'].map((method) => [
        method,
        () => {
          throw new Error('publish-drafts does not use storage');
        },
      ]),
    ) as unknown as StorageService;
    const service = new ProfilesService(
      new UsersService(new PrismaUsersRepository(database)),
      profiles,
      new QuerySearchService(new PrismaQuerySearchRepository(database)),
      unusedStorage,
      // publish never reads the posts budget; only the switch view does.
      undefined as never,
    );
    const { published, failed, outcomes } = await publishDrafts(
      {
        listDrafts: async () => {
          const rows = await db.query(
            db.raw.sql`SELECT id, "userId" FROM profiles
                WHERE state = 'draft' AND "resumeKey" IS NOT NULL
                ORDER BY "createdAt" ASC, id ASC`
              .returnsRow({ id: 'pg/uuid@1', userId: 'pg/uuid@1' })
              .build(),
          );
          return rows.map((row) => ({
            id: row.id as string,
            userId: row.userId as string,
          }));
        },
        publish: (userId, profileId) => service.publish(userId, profileId),
      },
      { dryRun },
    );
    for (const { id, outcome } of outcomes)
      logger.log(`profile=${id} ${outcome}`);
    logger.log(
      dryRun
        ? `Dry run: would publish ${outcomes.length} drafts`
        : `Published ${published} of ${outcomes.length} drafts; ${failed} refused`,
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith('publish-drafts.ts'))
  main().catch((error: unknown) => {
    Logger.error(
      error instanceof Error ? error.message : String(error),
      undefined,
      'PublishDrafts',
    );
    process.exit(1);
  });
