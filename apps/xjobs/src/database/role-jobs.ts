import type { DatabaseTransaction } from '@xjobs/database';

/**
 * Archives the role jobs (`kind = 'post_role'`) read from these post jobs:
 * `processingStatus = 'archived'`, `status` left `active`, the same as Process
 * does for a role its post no longer lists. Shared by every path that retires
 * a post job (ingest's drop and merge, `db:archive-actor`), so slice 04 never
 * matches the roles of a post that is gone. Runs in the caller's transaction.
 * Returns how many role jobs it archived.
 */
export async function archivePostRoleJobs(
  tx: Pick<DatabaseTransaction, 'raw' | 'query'>,
  postJobIds: readonly string[],
): Promise<number> {
  if (postJobIds.length === 0) return 0;
  const { raw } = tx;
  const rows = await tx.query(
    raw.sql`UPDATE normalized_jobs SET "processingStatus" = 'archived', "updatedAt" = now()
      WHERE kind = 'post_role'
        AND "parentJobId" = ANY(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(postJobIds)}::jsonb))::uuid[])
        AND "processingStatus" IS DISTINCT FROM 'archived'
      RETURNING id`
      .returnsRow({ id: 'pg/uuid@1' })
      .build(),
  );
  return rows.length;
}
