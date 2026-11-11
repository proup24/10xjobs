import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { UUID } from '@/lib/setup/answers';
import { publishedRows, type MatchRow } from './group';
import { loadMatch } from './load';

/**
 * The full rows of the job in the URL, published profiles only: null without one. Always a
 * read of its own, since the window holds only list rows (and a job opened by URL outside
 * the window still loads). Empty means "not in your matches", which is also the answer for a
 * malformed id: the read takes a uuid and would fail in Postgres (22P02) instead.
 */
export async function selectedRows(
  supabase: SupabaseClient<Database>,
  jobId: string | null,
  profiles: { id: string; state: 'draft' | 'published' }[],
): Promise<MatchRow[] | null> {
  if (!jobId) return null;
  if (!UUID.test(jobId)) return [];
  return publishedRows(await loadMatch(supabase, jobId), profiles);
}
