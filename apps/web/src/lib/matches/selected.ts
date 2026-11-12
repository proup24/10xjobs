import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { UUID } from '@/lib/setup/answers';
import { publishedRows, type MatchRow } from './group';
import { loadMatch, type ListOutcome } from './load';

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
  outcome: ListOutcome = 'qualified',
): Promise<MatchRow[] | null> {
  if (!jobId) return null;
  if (!UUID.test(jobId)) return [];
  const [rows, known] = await Promise.all([
    loadMatch(supabase, jobId, outcome),
    profiles,
  ]);
  return publishedRows(
    rows.filter((r) => !r.closed),
    known,
  );
}
