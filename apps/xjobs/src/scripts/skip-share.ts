import type { DatabaseTransaction } from '@xjobs/database';
import { hasLinkedInSourceSql } from 'src/modules/processor/repositories/processor.repository';

type Raw = DatabaseTransaction['raw'];

/**
 * The listings the pre-LLM check can skip: active `job` rows with a LinkedIn
 * job board source (the processor's scope), on the table `normalized_jobs`.
 * Ashby and Greenhouse listings and merged rows are never skipped, so they are
 * left out of the denominator.
 */
export function skippableListingSql(raw: Raw) {
  return raw.sql`kind = 'job' AND status = 'active'
    AND ${hasLinkedInSourceSql(raw, 'normalized_jobs')}`.returns('pg/bool@1');
}

/** Skipped and total skippable listings first seen in the last `days` days. */
export function skipShareSql(raw: Raw, days: number) {
  return raw.sql`SELECT count(*) FILTER (WHERE "processingStatus" = 'skipped')::int AS skipped,
      count(*)::int AS total
    FROM normalized_jobs
    WHERE ${skippableListingSql(raw)}
      AND "firstSeenAt" >= now() - make_interval(days => ${days}::int)`
    .returnsRow({ skipped: 'pg/int4@1', total: 'pg/int4@1' })
    .build();
}

export function skipShareLine(skipped: number, total: number): string {
  const share =
    total === 0 ? 'n/a' : ((skipped / total) * 100).toFixed(1) + '%';
  return `Skipped before processing: ${skipped} of ${total} new LinkedIn listings (${share})`;
}
