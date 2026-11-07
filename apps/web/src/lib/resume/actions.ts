'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { confirmResume, type ConfirmResult } from './confirm';
import { deleteDraftProfile } from './delete-draft';

export async function confirmResumeAction(input: {
  profileId: string;
  key: string;
  filename: string;
}): Promise<ConfirmResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return { status: 'failed' };
  return confirmResume(supabase, userId, input);
}

export async function deleteDraftProfileAction(
  profileId: string,
): Promise<'deleted' | 'not-draft' | 'failed'> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return 'failed';
  return deleteDraftProfile(supabase, userId, profileId);
}
