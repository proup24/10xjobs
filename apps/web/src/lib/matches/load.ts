import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { loadError } from '@/lib/setup/load';
import type { MatchRow } from './group';

type Client = SupabaseClient<Database>;

/**
 * Which list to read, by effective outcome: the matches (a review row the user moved to
 * Matches included), or the review rows the user has not decided on.
 */
export type ListOutcome = 'qualified' | 'review' | 'rejected';

export type MatchKind = 'job' | 'post_role' | null;

/**
 * Every match of every profile since `since` with that outcome, in one read; the page filters by
 * profile in memory, so switching profiles needs no refetch. These are list rows
 * (`p_details: false`): no checks or description, and facts hold only the arrangement.
 * Building the full facts for every row was most of the read's time and of the page's size;
 * the selected job is read in full with `loadMatch`. `details` reads full rows instead (the
 * social posts' Disqualified list shows each row's failed check).
 */
export async function loadMatches(
  supabase: Client,
  opts: {
    since: Date;
    outcome: ListOutcome;
    kind?: MatchKind;
    details?: boolean;
  },
): Promise<MatchRow[]> {
  const r = await supabase.rpc('match_details', {
    p_since: opts.since.toISOString(),
    p_details: opts.details ?? false,
    p_outcome: opts.outcome,
    // The generated args type has no null, but the function takes null as "any kind".
    p_kind: (opts.kind === undefined ? 'job' : opts.kind) as string,
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
  kind: MatchKind = 'job',
): Promise<MatchRow[]> {
  const r = await supabase.rpc('match_details', {
    p_job_id: jobId,
    // The generated args type has no null, but the function takes null as "any outcome".
    p_outcome: outcome as string,
    p_kind: kind as string,
  });
  if (r.error) throw loadError('match read', r.error);
  return r.data ?? [];
}
