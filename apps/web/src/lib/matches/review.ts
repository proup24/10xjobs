import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@xjobs/database/types';
import {
  FAILED,
  SAVED,
  failure,
  fieldErrors,
  logger,
  type Deps,
  type SaveResult,
} from '@/lib/setup/save-result';

export const ReviewDecision = z.object({
  matchId: z.uuid(),
  choice: z.enum(['qualified', 'rejected']),
  note: z.string().trim().max(500).optional(),
});
export type ReviewDecision = z.infer<typeof ReviewDecision>;

export const NOT_IN_REVIEW = 'This job is no longer in review.';

/**
 * Records the user's decision on a match the matcher sent to review. The rule and field
 * come from the match itself, never from the client: the decision applies only while the
 * match stays in review on them (RLS checks the same on insert). A match the user can't
 * read (another user's, or gone) is `failed`; one that left review meanwhile is `invalid`.
 * Log lines carry ids and error codes only.
 */
export async function saveReview(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const parsed = ReviewDecision.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const { matchId, choice, note } = parsed.data;
  const log = logger(deps);

  const read = await supabase
    .from('job_matches')
    .select('profileId, jobId, outcome, reviewRule, reviewField')
    .eq('id', matchId)
    .maybeSingle();
  if (read.error)
    return failure(log, `match read match=${matchId}`, read.error, 'review');
  if (!read.data) {
    log(`review: match not found match=${matchId}`);
    return FAILED;
  }
  const m = read.data;
  if (m.outcome !== 'review' || !m.reviewRule || !m.reviewField)
    return { status: 'invalid', errors: { _form: NOT_IN_REVIEW } };

  const insert = await supabase.from('match_reviews').insert({
    userId,
    matchId,
    profileId: m.profileId,
    jobId: m.jobId,
    rule: m.reviewRule,
    field: m.reviewField,
    choice,
    note: note ? note : null,
  });
  if (insert.error) {
    // The match was read as its owner, so a policy refusal means it left review (or moved to
    // another rule or field) between the read and the insert.
    if ((insert.error as { code?: unknown }).code === '42501') {
      log(`review: insert refused match=${matchId} code=42501`);
      return { status: 'invalid', errors: { _form: NOT_IN_REVIEW } };
    }
    return failure(log, `insert match=${matchId}`, insert.error, 'review');
  }
  return SAVED;
}
