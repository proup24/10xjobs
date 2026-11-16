import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { loadError } from '@/lib/setup/load';
import type { MatchRow } from './group';

type Client = SupabaseClient<Database>;

/**
 * Which list to read, by effective outcome: the matches (a review row the user moved to
 * Matches included), or the review rows the user has not decided on.
 */
export type ListOutcome = 'qualified' | 'review';

/**
 * Every match of every profile since `since` with that outcome, in one read; the page filters by
 * profile in memory, so switching profiles needs no refetch. These are list rows
 * (`p_details: false`): no checks or description, and facts hold only the arrangement.
 * Building the full facts for every row was most of the read's time and of the page's size;
 * the selected job is read in full with `loadMatch`.
 */
export async function loadMatches(
  supabase: Client,
  opts: { since: Date; outcome: ListOutcome },
): Promise<MatchRow[]> {
  const r = await supabase.rpc('match_details', {
    p_since: opts.since.toISOString(),
    p_details: false,
    p_outcome: opts.outcome,
  });
  if (r.error) throw loadError('matches read', r.error);
  return r.data ?? [];
}

/**
 * One job's full rows with that outcome, one per profile, regardless of age. A null
 * outcome reads every outcome (Applications shows a decided job whatever the engine says).
 */
export async function loadMatch(
  supabase: Client,
  jobId: string,
  outcome: ListOutcome | null = 'qualified',
): Promise<MatchRow[]> {
  const r = await supabase.rpc('match_details', {
    p_job_id: jobId,
    // The generated args type has no null, but the function takes null as "any outcome".
    p_outcome: outcome as string,
  });
  if (r.error) throw loadError('match read', r.error);
  return r.data ?? [];
}
