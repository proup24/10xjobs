'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isSearchableTech } from '@xjobs/database/enums';
import type { SearchSwitchKey } from '@xjobs/engine-client';
import {
  deleteProfile,
  hrefAfterDelete,
} from '@/lib/preferences/delete-profile';
import { loadProfileList } from '@/lib/preferences/profiles';
import {
  saveContacts,
  saveEligibility,
  saveProfileJob,
  saveProfileTerms,
  type SaveResult,
} from '@/lib/setup/save';
import { engineClient } from '@/lib/engine/server';
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

/**
 * Deletes one of the signed-in user's profiles, directly for a draft, through the engine for a published one. The
 * list is read first so a delete can land on the profile that followed the deleted one.
 */
export async function deleteProfileAction(
  profileId: string,
): Promise<'last' | 'only-resume' | 'failed'> {
  if (!isProfileId(profileId)) return 'failed';
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return 'failed';
  let list: Awaited<ReturnType<typeof loadProfileList>>;
  try {
    list = await loadProfileList(supabase);
  } catch {
    return 'failed';
  }
  let result: Awaited<ReturnType<typeof deleteProfile>>;
  try {
    result = await deleteProfile(supabase, userId, profileId, {
      engine: await engineClient(),
    });
  } catch {
    return 'failed';
  }
  if (result !== 'deleted') return result;
  // The nav lists profiles: re-read it before landing on the next one.
  revalidatePath('/preferences', 'layout');
  redirect(hrefAfterDelete(list, profileId));
}

/**
 * Turns one search switch on or off for one of the user's profiles. Only the engine
 * writes the switch columns; the web app has no grant on them.
 */
export async function setSearchSwitchAction(
  profileId: string,
  key: SearchSwitchKey,
  enabled: boolean,
): Promise<'saved' | 'failed'> {
  if (
    !isProfileId(profileId) ||
    (key !== 'posts' && key !== 'indeed') ||
    typeof enabled !== 'boolean'
  )
    return 'failed';
  try {
    const result = await (
      await engineClient()
    ).setSearchSwitch(profileId, key, enabled);
    return result.kind === 'ok' ? 'saved' : 'failed';
  } catch {
    return 'failed';
  }
}
