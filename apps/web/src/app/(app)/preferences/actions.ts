'use server';

import { isSearchableTech } from '@xjobs/database/enums';
import {
  saveContacts,
  saveEligibility,
  saveProfileJob,
  saveProfileTerms,
  type SaveResult,
} from '@/lib/setup/save';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isProfileId } from './guard';

const FAILED: SaveResult = { status: 'failed' };

/**
 * Runs a save as the signed-in user, or fails when there are no claims. The user always
 * comes from the session; a profile id from the client is only a target, and RLS plus the
 * save's own zero-row check turn another user's or a deleted profile into `failed`.
 */
async function run(
  save: (
    supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
    userId: string,
  ) => Promise<SaveResult>,
): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return FAILED;
  return save(supabase, userId);
}

export async function saveContactsAction(input: unknown): Promise<SaveResult> {
  return run((s, u) => saveContacts(s, u, input));
}

export async function saveEligibilityPrefsAction(
  input: unknown,
): Promise<SaveResult> {
  return run((s, u) => saveEligibility(s, u, input));
}

export async function saveProfileJobAction(
  profileId: string,
  input: unknown,
): Promise<SaveResult> {
  if (!isProfileId(profileId)) return FAILED;
  return run((s) => saveProfileJob(s, profileId, input, isSearchableTech));
}

export async function saveProfileTermsAction(
  profileId: string,
  input: unknown,
): Promise<SaveResult> {
  if (!isProfileId(profileId)) return FAILED;
  return run((s) => saveProfileTerms(s, profileId, input));
}
