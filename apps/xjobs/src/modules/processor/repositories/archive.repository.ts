import type { DatabaseClient } from '@xjobs/database';

type Raw = DatabaseClient['raw'];

const UUID = 'pg/uuid@1';
const TEXT = 'pg/text@1';

export interface ArchiveResult {
  jobs: number;
  /** Jobs by the status they had before; `none` for a null status. */
  byStatus: Record<string, number>;
  matchesDeleted: number;
}

/**
 * Jobs linked to at least one sighted raw item, none of whose sightings is in
 * a batch of another actor, and not archived yet. Spliced in as `id IN (…)`.
 */
function archivableIds(raw: Raw, actor: string) {
  return raw.sql`SELECT j.id FROM normalized_jobs j
    WHERE j."processingStatus" IS DISTINCT FROM 'archived'
      AND EXISTS (
        SELECT 1 FROM normalized_job_sources s
        JOIN raw_item_sightings x ON x."rawItemId" = s."rawItemId"
        JOIN collection_batches b ON b.id = x."batchId"
        WHERE s."jobId" = j.id AND b.actor = ${actor}::text)
      AND NOT EXISTS (
        SELECT 1 FROM normalized_job_sources s
        JOIN raw_item_sightings x ON x."rawItemId" = s."rawItemId"
        JOIN collection_batches b ON b.id = x."batchId"
        WHERE s."jobId" = j.id AND b.actor <> ${actor}::text)`.returnsRow({
    id: UUID,
  });
}

/**
 * Archives every job whose sources were seen only in batches of `actor`: the
 * job leaves the processor and the matcher, and its `job_matches` rows are
 * deleted. One transaction, so a failure leaves nothing half-archived. With
 * `dryRun` nothing is written and the counts say what would change. Already
 * archived jobs are skipped, so a second run archives nothing.
 */
export async function archiveActorJobs(
  db: DatabaseClient,
  actor: string,
  opts: { dryRun: boolean },
): Promise<ArchiveResult> {
  return db.transaction(async (tx) => {
    const { raw } = tx;
    const rows = await tx.query(
      raw.sql`SELECT COALESCE("processingStatus", 'none') AS status
        FROM normalized_jobs WHERE id IN (${archivableIds(raw, actor)})`
        .returnsRow({ status: TEXT })
        .build(),
    );
    const byStatus: Record<string, number> = {};
    for (const r of rows) {
      const status = r.status as string;
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    const jobs = rows.length;
    if (jobs === 0) return { jobs, byStatus, matchesDeleted: 0 };

    if (opts.dryRun) {
      const counted = await tx.query(
        raw.sql`SELECT id FROM job_matches
          WHERE "jobId" IN (${archivableIds(raw, actor)})`
          .returnsRow({ id: UUID })
          .build(),
      );
      return { jobs, byStatus, matchesDeleted: counted.length };
    }

    // Matches first, then the status; `currentExtractionId` stays for the record.
    const deleted = await tx.query(
      raw.sql`DELETE FROM job_matches
        WHERE "jobId" IN (${archivableIds(raw, actor)}) RETURNING id`
        .returnsRow({ id: UUID })
        .build(),
    );
    await tx.query(
      raw.sql`UPDATE normalized_jobs
        SET "processingStatus" = 'archived', "processingError" = NULL,
          "processingStartedAt" = NULL, "updatedAt" = now()
        WHERE id IN (${archivableIds(raw, actor)}) RETURNING id`
        .returnsRow({ id: UUID })
        .build(),
    );
    return { jobs, byStatus, matchesDeleted: deleted.length };
  });
}
