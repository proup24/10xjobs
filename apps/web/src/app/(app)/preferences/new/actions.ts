'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isSearchableTech } from '@xjobs/database/enums';
import {
  discardNewProfile,
  saveNewProfileJob,
  saveNewProfileTerms,
  startNewProfile,
  type CreateResult,
  type NewProfileSource,
} from '@/lib/preferences/new-profile';
import type { SaveResult } from '@/lib/setup/save';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isProfileId } from '../guard';

const FAILED: SaveResult = { status: 'failed' };

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** The session's client and user, or null without claims. The user never comes from the client. */
async function session(): Promise<{ supabase: Client; userId: string } | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  return userId ? { supabase, userId } : null;
}

/** The nav lists profiles and knows about the draft: re-read it after either changes. */
const refreshNav = () => revalidatePath('/preferences', 'layout');

function parseSource(source: unknown): NewProfileSource | null {
  if (typeof source !== 'object' || source === null) return null;
  const s = source as { kind?: unknown; profileId?: unknown };
  if (s.kind === 'blank') return { kind: 'blank' };
  if (s.kind === 'copy' && isProfileId(s.profileId)) {
    return { kind: 'copy', profileId: s.profileId };
  }
  return null;
}

/** Starts a new profile, blank or copied, and opens its first step. */
export async function startNewProfileAction(
  source: unknown,
): Promise<'limit' | 'failed'> {
  const parsed = parseSource(source);
  if (!parsed) return 'failed';
  const s = await session();
  if (!s) return 'failed';
  const result = await startNewProfile(s.supabase, s.userId, parsed);
  // A draft is already in progress (another tab): its continue-or-start-over choice.
  if (result === 'in-progress') redirect('/preferences/new');
  if (result !== 'started') return result;
  refreshNav();
  redirect('/preferences/new/job');
}

export async function saveNewProfileJobAction(
  input: unknown,
): Promise<SaveResult> {
  const s = await session();
  if (!s) return FAILED;
  return saveNewProfileJob(s.supabase, s.userId, input, isSearchableTech);
}

/** Bound by the terms page to the draft's `newProfileId` it rendered with. */
export async function saveNewProfileTermsAction(
  newProfileId: string,
  input: unknown,
): Promise<CreateResult> {
  if (!isProfileId(newProfileId)) return FAILED;
  const s = await session();
  if (!s) return FAILED;
  const result = await saveNewProfileTerms(
    s.supabase,
    s.userId,
    newProfileId,
    input,
    isSearchableTech,
  );
  if (result.status === 'created') refreshNav();
  return result;
}

export async function discardNewProfileAction(): Promise<
  'discarded' | 'failed'
> {
  const s = await session();
  if (!s) return 'failed';
  const result = await discardNewProfile(s.supabase, s.userId);
  if (result === 'discarded') refreshNav();
  return result;
}
