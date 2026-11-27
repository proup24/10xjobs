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

export const RescueInput = z.object({
  jobId: z.uuid(),
  note: z.string().trim().max(500).optional(),
});
export type RescueInput = z.infer<typeof RescueInput>;

export const NOT_RESCUABLE = 'This post can no longer be rescued.';
export const DECIDED = 'Undo the decision first.';

const raised = (error: unknown, text: string) =>
  String((error as { message?: unknown } | null)?.message ?? '').includes(text);

/**
 * Moves a Junk or Disqualified post into the user's Matches. The database reads the user from
 * the session and decides whether the post can be rescued; a post that can't (any more) is
 * `invalid`. Log lines carry ids and error codes only.
 */
export async function saveRescue(
  supabase: SupabaseClient<Database>,
  input: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const parsed = RescueInput.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const { jobId, note } = parsed.data;
  const r = await supabase.rpc('post_rescue', {
    p_job_id: jobId,
    p_note: note ? note : undefined,
  });
  if (r.error) {
    if (raised(r.error, 'not rescuable')) {
      logger(deps)(`rescue: not rescuable job=${jobId}`);
      return { status: 'invalid', errors: { _form: NOT_RESCUABLE } };
    }
    return failure(logger(deps), `rescue job=${jobId}`, r.error, 'rescue');
  }
  return SAVED;
}

/** Takes a rescue back; refused while the post's linked group has a decision. */
export async function undoRescue(
  supabase: SupabaseClient<Database>,
  jobId: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const parsed = z.uuid().safeParse(jobId);
  if (!parsed.success) return FAILED;
  const r = await supabase.rpc('post_rescue_undo', { p_job_id: parsed.data });
  if (r.error) {
    if (raised(r.error, 'decided')) {
      logger(deps)(`rescue: undo refused job=${parsed.data}`);
      return { status: 'invalid', errors: { _form: DECIDED } };
    }
    return failure(logger(deps), `undo job=${parsed.data}`, r.error, 'rescue');
  }
  return SAVED;
}
