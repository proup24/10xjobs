'use server';

import { isSearchableTech } from '@xjobs/database/enums';
import {
  saveAbout,
  saveEligibility,
  saveJob,
  saveTerms,
  type SaveResult,
} from '@/lib/setup/save';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Runs a save as the signed-in user, or fails when there are no claims. */
async function run(
  save: (
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
    userId: string,
  ) => Promise<SaveResult>,
): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return { status: 'failed' };
  return save(supabase, userId);
}

export async function saveAboutAction(input: unknown): Promise<SaveResult> {
  return run((s, u) => saveAbout(s, u, input));
}

export async function saveEligibilityAction(
  input: unknown,
): Promise<SaveResult> {
  return run((s, u) => saveEligibility(s, u, input));
}

export async function saveJobAction(input: unknown): Promise<SaveResult> {
  return run((s, u) => saveJob(s, u, input, isSearchableTech));
}

export async function saveTermsAction(input: unknown): Promise<SaveResult> {
  return run((s, u) => saveTerms(s, u, input));
}
