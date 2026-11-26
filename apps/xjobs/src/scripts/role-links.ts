/**
 * Recomputes, for every `post_role` job, its `linkKeys` from its post's
 * current post extraction (the role with the same `roleKey`) and its
 * `postedAt` by the processor's rule (`roleJobPostedAt`). One-off for role
 * jobs written before they stored link keys. Dry-run first:
 *
 *   pnpm --filter @xjobs/xjobs db:role-links -- [--dry-run]
 *
 * Prints the count changed. A role whose post row no longer reads, or no
 * longer holds the role, keeps its link keys. Refuses a remote database
 * unless `XJOBS_ALLOW_REMOTE_DB=1`.
 */
import { Logger } from '@nestjs/common';
import { assertLocalDatabase, captureRemoteOptIn } from '@xjobs/database/env';
import { loadDatabaseEnvironment, toDatabaseConfig } from 'src/config';
import { createDatabaseClient } from 'src/database';
import { linkKeysOf } from 'src/modules/ingest/normalize/job-key';
import { roleJobPostedAt } from 'src/modules/processor/repositories/role-posted-at';
import { postDocumentSchema } from 'src/modules/processor/schema/post-extraction';

export interface RoleRow {
  id: string;
  roleKey: string | null;
  linkKeys: string[];
  postedAt: Date | null;
  parentPostedAt: Date | null;
  postSources: unknown;
  /** The post's current post extraction `data`; null when it has none. */
  postDocument: unknown;
}

export interface RoleLinksDeps {
  listRoles: () => Promise<RoleRow[]>;
  update: (
    id: string,
    values: { linkKeys: string[]; postedAt: Date | null },
  ) => Promise<void>;
}

const sameKeys = (a: string[], b: string[]) =>
  a.length === b.length && a.every((k, i) => k === b[i]);

const sameDate = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Updates every role whose link keys or date differ; a dry run only counts. */
export async function roleLinks(
  deps: RoleLinksDeps,
  options: { dryRun?: boolean } = {},
): Promise<{ total: number; changed: number }> {
  const roles = await deps.listRoles();
  let changed = 0;
  for (const role of roles) {
    const parsed = postDocumentSchema.safeParse(role.postDocument);
    const found = parsed.success
      ? parsed.data.roles.find((r) => r.roleKey === role.roleKey)
      : undefined;
    const linkKeys = found ? linkKeysOf(found.howToApply.links) : role.linkKeys;
    const postedAt = roleJobPostedAt(role.postSources, role.parentPostedAt);
    if (sameKeys(linkKeys, role.linkKeys) && sameDate(postedAt, role.postedAt))
      continue;
    changed += 1;
    if (!options.dryRun) await deps.update(role.id, { linkKeys, postedAt });
  }
  return { total: roles.length, changed };
}

export function parseRoleLinksArgs(rawArgv: readonly string[]): {
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

const BATCH = 200;

async function main(): Promise<void> {
  const logger = new Logger('RoleLinks');
  // Snapshot the opt-in before any env file loads.
  const optIn = captureRemoteOptIn(process.env);
  let dryRun;
  try {
    ({ dryRun } = parseRoleLinksArgs(process.argv.slice(2)));
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    logger.error('usage: db:role-links -- [--dry-run]');
    process.exit(1);
  }
  const databaseEnv = loadDatabaseEnvironment();
  assertLocalDatabase({ DATABASE_URL: databaseEnv.DATABASE_URL }, optIn);
  const db = createDatabaseClient(toDatabaseConfig(databaseEnv), logger);
  try {
    const jobs = db.orm.public.NormalizedJob;
    const { total, changed } = await roleLinks(
      {
        listRoles: async () => {
          const rows: RoleRow[] = [];
          const roles = await jobs.where({ kind: 'post_role' }).all();
          for (let i = 0; i < roles.length; i += BATCH) {
            const batch = roles.slice(i, i + BATCH);
            const parentIds = [
              ...new Set(
                batch.flatMap((r) => (r.parentJobId ? [r.parentJobId] : [])),
              ),
            ];
            const parents = new Map(
              (await jobs.where((row) => row.id.in(parentIds)).all()).map(
                (p) => [p.id, p],
              ),
            );
            const extractionIds = [
              ...new Set(
                [...parents.values()].flatMap((p) =>
                  p.currentExtractionId ? [p.currentExtractionId] : [],
                ),
              ),
            ];
            const extractions = new Map(
              (
                await db.orm.public.JobExtraction.where((row) =>
                  row.id.in(extractionIds),
                ).all()
              )
                .filter((e) => e.docType === 'post')
                .map((e) => [e.id, e.data]),
            );
            for (const role of batch) {
              const parent = role.parentJobId
                ? parents.get(role.parentJobId)
                : undefined;
              rows.push({
                id: role.id,
                roleKey: role.roleKey,
                linkKeys: [...role.linkKeys],
                postedAt: role.postedAt,
                parentPostedAt: parent?.postedAt ?? null,
                postSources: parent?.postSources ?? null,
                postDocument: parent?.currentExtractionId
                  ? (extractions.get(parent.currentExtractionId) ?? null)
                  : null,
              });
            }
          }
          return rows;
        },
        update: async (id, values) => {
          await jobs.where({ id }).updateAll(values);
        },
      },
      { dryRun },
    );
    logger.log(
      dryRun
        ? `Dry run: would change ${changed} of ${total} role jobs`
        : `Changed ${changed} of ${total} role jobs`,
    );
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith('role-links.ts'))
  main().catch((error: unknown) => {
    Logger.error(
      error instanceof Error ? error.message : String(error),
      undefined,
      'RoleLinks',
    );
    process.exit(1);
  });
