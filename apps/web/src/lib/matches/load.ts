import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { loadError } from '@/lib/setup/load';
import type { MatchRow } from './group';

type Client = SupabaseClient<Database>;

/**
 * Every qualified match of every profile since `since`, in one read; the page filters by
 * profile in memory, so switching profiles needs no refetch. These are list rows
 * (`p_details: false`): no checks or description, and facts hold only the arrangement.
 * Building the full facts for every row was most of the read's time and of the page's size;
 * the selected job is read in full with `loadMatch`.
 */
export async function loadMatches(
  supabase: Client,
  opts: { since: Date },
): Promise<MatchRow[]> {
  const r = await supabase.rpc('match_details', {
    p_since: opts.since.toISOString(),
    p_details: false,
  });
  if (r.error) throw loadError('matches read', r.error);
  return r.data ?? [];
}

/** One job's full rows, one per profile, regardless of age. */
export async function loadMatch(
  supabase: Client,
  jobId: string,
): Promise<MatchRow[]> {
  const r = await supabase.rpc('match_details', { p_job_id: jobId });
  if (r.error) throw loadError('match read', r.error);
  return r.data ?? [];
}
