import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { loadSetupSnapshot } from '@/lib/setup/load';
import { nextSetupStep } from '@/lib/setup/next-step';

/** Setup unfinished (by the next-step rule) goes to `/setup`; a finished user to `/`. */
export async function landingPath(
  supabase: SupabaseClient<Database>,
): Promise<'/setup' | '/'> {
  const next = nextSetupStep(await loadSetupSnapshot(supabase));
  return next === 'done' ? '/' : '/setup';
}
