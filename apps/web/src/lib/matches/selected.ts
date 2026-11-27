import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { appViewHref, isAppStatus } from '@/lib/applications/view-state';
import { UUID } from '@/lib/setup/answers';
import { publishedRows, type MatchRow } from './group';
import { loadMatch, type ListOutcome, type MatchKind } from './load';

type Profiles = { id: string; state: 'draft' | 'published' }[];

/**
 * The full rows of the job in the URL, published profiles only: null without one. Always a
 * read of its own, since the window holds only list rows (and a job opened by URL outside
 * the window still loads). Empty means "not in your matches", which is also the answer for a
 * closed job (it has no detail to show) and for a malformed id: the read takes a uuid and
 * would fail in Postgres (22P02) instead. `profiles` may still be loading: the read starts
 * first, so the page runs it alongside its other reads.
 */
export async function selectedRows(
  supabase: SupabaseClient<Database>,
  jobId: string | null,
  profiles: Profiles | Promise<Profiles>,
  outcome: ListOutcome | null = 'qualified',
  kind: MatchKind = 'job',
): Promise<MatchRow[] | null> {
  if (!jobId) return null;
  if (!UUID.test(jobId)) return [];
  const [rows, known] = await Promise.all([
    loadMatch(supabase, jobId, outcome, kind),
    profiles,
  ]);
  return publishedRows(
    rows.filter((r) => !r.closed),
    known,
  );
}

/**
 * Where a job opened on Matches belongs once the user has decided on it: its Applications
 * detail, under the tab of its decision. Null for no job, no rows or an undecided job. A
 * decided job shown on Matches would offer Applied / Not for me / Expired again, and their Undo
 * would delete the earlier mark.
 */
export function decidedJobHref(rows: MatchRow[] | null): string | null {
  const row = rows?.find((r) => r.decisionStatus != null);
  if (!row) return null;
  return appViewHref({
    status: isAppStatus(row.decisionStatus) ? row.decisionStatus : 'applied',
    job: row.jobId,
  });
}
