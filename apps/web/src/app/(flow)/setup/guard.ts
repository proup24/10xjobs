import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { loadSetupSnapshot } from '@/lib/setup/load';
import { nextSetupStep, type SetupSnapshot } from '@/lib/setup/next-step';
import { SETUP_STEPS, stepPath, type SetupStepId } from '@/lib/setup/steps';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ORDER: readonly string[] = [...SETUP_STEPS.map((s) => s.id), 'review'];

/**
 * Where a visit to `step` should go instead, or null to render it. `/setup` goes to the
 * next unfinished step (or `/` when done); a step after the next unfinished one is not
 * open yet; `review` is open only once everything is done. Finished users may revisit
 * any step.
 */
export function setupRedirect(
  step: SetupStepId | 'review' | 'index',
  next: SetupStepId | 'done',
): string | null {
  if (step === 'index') return next === 'done' ? '/' : stepPath(next);
  if (next === 'done') return null;
  return ORDER.indexOf(step) > ORDER.indexOf(next) ? stepPath(next) : null;
}

/** Guards a setup page: signed in, and not ahead of the next unfinished step. */
export async function requireSetupStep(
  step: SetupStepId | 'review' | 'index',
): Promise<{
  supabase: SupabaseClient<Database>;
  userId: string;
  snapshot: SetupSnapshot;
}> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) redirect('/sign-in');
  const snapshot = await loadSetupSnapshot(supabase);
  const to = setupRedirect(step, nextSetupStep(snapshot));
  if (to) redirect(to);
  return { supabase, userId, snapshot };
}
