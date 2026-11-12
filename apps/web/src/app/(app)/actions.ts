'use server';

import { saveReview } from '@/lib/matches/review';
import { FAILED, type SaveResult } from '@/lib/setup/save-result';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Records the signed-in user's decision on a job in their review list. The user always
 * comes from the session; the match id is only a target, and RLS refuses another user's.
 */
export async function decideReviewAction(input: unknown): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return FAILED;
  return saveReview(supabase, userId, input);
}
