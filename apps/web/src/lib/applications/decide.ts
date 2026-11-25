import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { DISMISS_REASONS } from '@xjobs/database/enums';
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

export const Decision = z.discriminatedUnion('status', [
  z.object({ jobId: z.uuid(), status: z.literal('applied') }),
  z.object({ jobId: z.uuid(), status: z.literal('expired') }),
  z.object({
    jobId: z.uuid(),
    status: z.literal('dismissed'),
    reason: z.enum(DISMISS_REASONS).optional(),
    note: z.string().trim().max(500).optional(),
  }),
]);
export type Decision = z.infer<typeof Decision>;

export const NOT_MATCHED = "This job isn't in your matches.";

type Json = NonNullable<
  Database['public']['Tables']['job_decisions']['Row']['matchSnapshot']
>;
type Client = SupabaseClient<Database>;
type Fields = {
  status: string;
  reason: string | null;
  note: string | null;
  matchSnapshot: Json | null;
};

const code = (e: unknown) => (e as { code?: unknown }).code;

/**
 * Marks a job applied, dismissed or expired for the user. A dismissal keeps a snapshot of every
 * current match so the verdict can be read later. Only a job the user has a current match
 * for can be decided (RLS checks it on insert). `decidedAt` moves only when the status
 * changes. Log lines carry ids and error codes only.
 */
export async function saveDecision(
  supabase: Client,
  userId: string,
  input: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const parsed = Decision.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const d = parsed.data;
  const log = logger(deps);

  let fields: Fields;
  if (d.status !== 'dismissed') {
    // Applied and expired are bare: no reason, note or snapshot, and no match read.
    fields = {
      status: d.status,
      reason: null,
      note: null,
      matchSnapshot: null,
    };
  } else {
    const read = await supabase
      .from('job_matches')
      .select('profileId, outcome, matcherVersion, checks')
      .eq('jobId', d.jobId);
    if (read.error)
      return failure(log, `match read job=${d.jobId}`, read.error, 'decision');
    fields = {
      status: 'dismissed',
      reason: d.reason ?? null,
      note: d.note ? d.note : null,
      matchSnapshot: (read.data ?? []).map((m) => ({
        profileId: m.profileId,
        outcome: m.outcome,
        matcherVersion: m.matcherVersion,
        checks: m.checks,
      })),
    };
  }

  const write = async (retry: boolean): Promise<SaveResult> => {
    const existing = await supabase
      .from('job_decisions')
      .select('status, matchSnapshot')
      .eq('jobId', d.jobId)
      .maybeSingle();
    if (existing.error)
      return failure(log, `read job=${d.jobId}`, existing.error, 'decision');

    if (existing.data) {
      const now = new Date().toISOString();
      // Matches gone (profile deleted): the earlier snapshot is the only record, so keep it.
      const { matchSnapshot, ...rest } = fields;
      const keepSnapshot =
        Array.isArray(matchSnapshot) &&
        matchSnapshot.length === 0 &&
        existing.data.matchSnapshot !== null;
      const update = await supabase
        .from('job_decisions')
        .update({
          ...rest,
          source: 'app',
          ...(keepSnapshot ? {} : { matchSnapshot }),
          updatedAt: now,
          ...(existing.data.status !== fields.status ? { decidedAt: now } : {}),
        })
        .eq('jobId', d.jobId);
      if (update.error)
        return failure(log, `update job=${d.jobId}`, update.error, 'decision');
      return SAVED;
    }

    const insert = await supabase
      .from('job_decisions')
      .insert({ userId, jobId: d.jobId, ...fields });
    if (!insert.error) return SAVED;
    if (code(insert.error) === '42501') {
      log(`decision: insert refused job=${d.jobId} code=42501`);
      return { status: 'invalid', errors: { _form: NOT_MATCHED } };
    }
    // A concurrent save created the row between the read and the insert.
    if (code(insert.error) === '23505' && retry) return write(false);
    return failure(log, `insert job=${d.jobId}`, insert.error, 'decision');
  };
  return write(true);
}

/** Removes the user's decision on a job. RLS scopes the delete; a missing row is fine. */
export async function clearDecision(
  supabase: Client,
  jobId: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const parsed = z.uuid().safeParse(jobId);
  if (!parsed.success) return FAILED;
  const log = logger(deps);
  const del = await supabase
    .from('job_decisions')
    .delete()
    .eq('jobId', parsed.data);
  if (del.error)
    return failure(log, `delete job=${parsed.data}`, del.error, 'decision');
  return SAVED;
}
