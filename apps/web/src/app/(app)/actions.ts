'use server';

import { revalidatePath } from 'next/cache';
import { clearDecision, saveDecision } from '@/lib/applications/decide';
import { saveReport } from '@/lib/matches/report';
import { saveReview } from '@/lib/matches/review';
import { saveRescue, undoRescue } from '@/lib/posts/rescue';
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

/**
 * Logs a mismatch the signed-in user found in a job's facts. The user comes from the
 * session; the values the processor and LinkedIn gave are read server-side.
 */
export async function reportMismatchAction(
  input: unknown,
): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return FAILED;
  return saveReport(supabase, userId, input);
}

/**
 * Marks a job applied or dismissed for the signed-in user. The user comes from the
 * session; RLS refuses a job the user has no match for.
 */
export async function decideJobAction(input: unknown): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return FAILED;
  return saveDecision(supabase, userId, input);
}

/** Removes the signed-in user's decision on a job. */
export async function clearJobDecisionAction(
  jobId: unknown,
): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return FAILED;
  return clearDecision(supabase, jobId);
}

/**
 * Moves a Junk or Disqualified post into the signed-in user's Matches. The database reads
 * the user from the session; no user id is sent.
 */
export async function rescuePostAction(input: unknown): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return FAILED;
  const result = await saveRescue(supabase, input);
  if (result.status === 'saved') revalidatePath('/posts');
  return result;
}

/** Takes the signed-in user's rescue back. */
export async function undoRescueAction(jobId: unknown): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return FAILED;
  const result = await undoRescue(supabase, jobId);
  if (result.status === 'saved') revalidatePath('/posts');
  return result;
}
