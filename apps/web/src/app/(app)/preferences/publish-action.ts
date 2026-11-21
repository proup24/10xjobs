'use server';

import { revalidatePath } from 'next/cache';
import { engineClient } from '@/lib/engine/server';
import {
  PUBLISH_FAILED_MESSAGE,
  publishProfile,
  type PublishOutcome,
} from '@/lib/profiles/publish';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isProfileId } from './guard';

const FAILED: PublishOutcome = {
  status: 'failed',
  message: PUBLISH_FAILED_MESSAGE,
};

/** Publishes one of the signed-in user's draft profiles through the engine. */
export async function publishProfileAction(
  profileId: string,
): Promise<PublishOutcome> {
  if (!isProfileId(profileId)) return FAILED;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return FAILED;
  try {
    const outcome = await publishProfile(await engineClient(), profileId);
    if (outcome.status === 'published') revalidatePath('/', 'layout');
    return outcome;
  } catch {
    console.error(`publish profile=${profileId} outcome=threw`);
    return FAILED;
  }
}
