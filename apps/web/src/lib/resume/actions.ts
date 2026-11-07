'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { confirmResume, type ConfirmResult } from './confirm';

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
