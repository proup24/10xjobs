import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { loadError } from '@/lib/setup/load';

export type DecisionRow =
  Database['public']['Functions']['job_decision_list']['Returns'][number];

/**
 * The user's applied and not-for-me jobs, newest decision first. The jobs are read through
 * the decisions, so a job stays listed after its match is gone.
 */
export async function loadDecisions(
  supabase: SupabaseClient<Database>,
): Promise<DecisionRow[]> {
  const r = await supabase.rpc('job_decision_list');
  if (r.error) throw loadError('decisions read', r.error);
  return r.data ?? [];
}
