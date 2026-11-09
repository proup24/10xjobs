import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { copyResume } from '@/lib/resume/copy';
import { errorCode } from '@/lib/resume/errors';
import {
  jobSchema,
  parseNewProfileDraft,
  termsSchema,
  UUID,
  type NewProfileDraft,
} from '@/lib/setup/answers';
import { loadError, loadSetupProfile } from '@/lib/setup/load';
import { toProfileWrite } from '@/lib/setup/mapping';
import {
  failure,
  fieldErrors,
  logger,
  FAILED,
  SAVED,
  type SaveResult,
} from '@/lib/setup/save-result';
import { MAX_PROFILES } from './profiles';

/**
 * The new-profile flow, as the signed-in user under RLS. Its answers live in the user's
 * one setup draft row as a version-2 draft that names the new profile's id up front, so
 * creating it is idempotent. Log lines carry ids and error codes only, never answers.
 */

type Client = SupabaseClient<Database>;
type Json =
  Database['public']['Functions']['create_profile_from_draft']['Args']['p_profile'];

export type NewProfileSource =
  | { kind: 'blank' }
  | { kind: 'copy'; profileId: string };

export type CreateResult =
  | SaveResult
  | { status: 'created'; profileId: string };

type Deps = {
  log?: (line: string) => void;
  /** Injected in tests; the real `copyResume` otherwise. */
  copyResume?: typeof copyResume;
};

const DRAFTS = 'profile_setup_drafts';
const START_AGAIN: SaveResult = {
  status: 'invalid',
  errors: { _form: 'Start the new profile again' },
};

const draftJson = (draft: NewProfileDraft): NonNullable<Json> =>
  draft as unknown as NonNullable<Json>;

async function readDraft(supabase: Client, userId: string) {
  return supabase
    .from(DRAFTS)
    .select('id, answers')
    .eq('userId', userId)
    .maybeSingle();
}

/**
 * Starts a new profile: a fresh version-2 draft (replacing any draft), blank or filled
 * from one of the user's profiles. The 5-profile limit is checked first.
 */
export async function startNewProfile(
  supabase: Client,
  userId: string,
  source: NewProfileSource,
  deps: Deps = {},
): Promise<'started' | 'limit' | 'failed'> {
  const log = logger(deps);
  const fail = (what: string, error: unknown) => {
    log(`new profile: ${what} code=${errorCode(error)}`);
    return 'failed' as const;
  };

  const profiles = await supabase
    .from('profiles')
    .select('id')
    .eq('userId', userId);
  if (profiles.error) return fail('profiles read', profiles.error);
  if ((profiles.data ?? []).length >= MAX_PROFILES) return 'limit';

  let answers: NewProfileDraft = {
    version: 2,
    newProfileId: crypto.randomUUID(),
    copyFrom: null,
  };
  if (source.kind === 'copy') {
    let copied: Awaited<ReturnType<typeof loadSetupProfile>>;
    try {
      copied = await loadSetupProfile(supabase, source.profileId);
    } catch (e) {
      // loadSetupProfile's message is "setup load: <what> code=<code>", no data.
      log(`new profile: source read failed (${(e as Error).message})`);
      return 'failed';
    }
    if (!copied) {
      log(`new profile: source not found profile=${source.profileId}`);
      return 'failed';
    }
    answers = { ...answers, copyFrom: source.profileId, ...copied };
  }

  const draft = await readDraft(supabase, userId);
  if (draft.error) return fail('draft read', draft.error);
  const write = await supabase.from(DRAFTS).upsert(
    {
      // Reuse the row's id, so the upsert's update doesn't replace it.
      id: draft.data?.id ?? crypto.randomUUID(),
      userId,
      answers: draftJson(answers),
    },
    { onConflict: 'userId' },
  );
  if (write.error) return fail('draft write', write.error);
  return 'started';
}

/** The user's new-profile draft, or null when there is none or it is a setup (v1) draft. */
export async function loadNewProfileDraft(
  supabase: Client,
): Promise<NewProfileDraft | null> {
  const r = await supabase.from(DRAFTS).select('answers').maybeSingle();
  if (r.error) throw loadError('draft read', r.error);
  return r.data ? parseNewProfileDraft(r.data.answers) : null;
}

/**
 * Writes `answers` into the user's draft. An update, not an upsert: if another request has
 * just turned the draft into the profile (double submit), recreating it would be wrong.
 * `matched` is false when the update found no row.
 */
async function updateDraft(
  supabase: Client,
  userId: string,
  answers: NewProfileDraft,
): Promise<{ error: unknown } | { matched: boolean }> {
  const write = await supabase
    .from(DRAFTS)
    .update({ answers: draftJson(answers) })
    .eq('userId', userId)
    // Only the draft read: one replaced meanwhile (another tab) matches nothing.
    .eq('answers->>newProfileId', answers.newProfileId)
    .select('id');
  if (write.error) return { error: write.error };
  return { matched: (write.data ?? []).length > 0 };
}

/** Step 1 of the flow: the draft's `job`, keeping the rest. */
export async function saveNewProfileJob(
  supabase: Client,
  userId: string,
  input: unknown,
  isSearchable: (code: string) => boolean,
  deps: Deps = {},
): Promise<SaveResult> {
  const log = logger(deps);
  const parsed = jobSchema(isSearchable).safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);

  const draft = await readDraft(supabase, userId);
  if (draft.error)
    return failure(log, 'new profile job draft read', draft.error);
  const current = draft.data ? parseNewProfileDraft(draft.data.answers) : null;
  if (!current) return START_AGAIN;

  const write = await updateDraft(supabase, userId, {
    ...current,
    job: parsed.data,
  });
  if ('error' in write) {
    return failure(log, 'new profile job draft write', write.error);
  }
  return write.matched ? SAVED : START_AGAIN;
}

/**
 * Step 2 of the flow: the draft's `terms`, then, when the draft has a valid `job`, the
 * profile under the draft's `newProfileId`, and for a copy, the source's resume. A resume
 * copy that fails is logged only: the Resume step then asks for an upload.
 */
export async function saveNewProfileTerms(
  supabase: Client,
  userId: string,
  newProfileId: string,
  input: unknown,
  isSearchable: (code: string) => boolean,
  deps: Deps = {},
): Promise<CreateResult> {
  const log = logger(deps);
  if (typeof newProfileId !== 'string' || !UUID.test(newProfileId)) {
    return START_AGAIN;
  }
  const parsed = termsSchema.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const terms = parsed.data;

  // Already created (a repeated submit, or the draft replaced since this page rendered):
  // the caller's own profile with this id, read under RLS, and nothing is written.
  const alreadyCreated = async (): Promise<CreateResult> => {
    const existing = await supabase
      .from('profiles')
      .select('id')
      .eq('id', newProfileId)
      .maybeSingle();
    if (existing.error) {
      return failure(log, 'new profile created read', existing.error);
    }
    return existing.data
      ? { status: 'created', profileId: newProfileId }
      : START_AGAIN;
  };

  const draft = await readDraft(supabase, userId);
  if (draft.error) {
    return failure(log, 'new profile terms draft read', draft.error);
  }
  const current = draft.data ? parseNewProfileDraft(draft.data.answers) : null;
  // Never write into a draft for another profile: a stale tab mustn't overwrite a newer one.
  if (!current || current.newProfileId !== newProfileId) return alreadyCreated();
  const { copyFrom, job } = current;

  const write = await updateDraft(supabase, userId, { ...current, terms });
  if ('error' in write) {
    return failure(log, 'new profile terms draft write', write.error);
  }
  // The draft ended or changed between our read and write.
  if (!write.matched) return alreadyCreated();
  if (!job) return SAVED;

  // The draft row is client-writable: its job runs the full rules again before creating.
  const checked = jobSchema(isSearchable).safeParse(job);
  if (!checked.success) {
    log(`new profile: draft job no longer valid profile=${newProfileId}`);
    return {
      status: 'invalid',
      errors: { _form: 'Check your answers in “The job you want”' },
    };
  }

  const { profile, skills } = toProfileWrite(checked.data, terms);
  const created = await supabase.rpc('create_profile_from_draft', {
    p_profile_id: newProfileId,
    p_profile: profile as unknown as Json,
    p_skills: skills,
  });
  if (created.error) {
    const code = (created.error as { code?: unknown }).code;
    if (code === 'P0002') {
      log(`setup save: new profile create code=P0002`);
      return START_AGAIN;
    }
    // A forged id that is someone else's profile: never echo the database message.
    if (code === '23505') {
      log(`setup save: new profile create code=23505`);
      return FAILED;
    }
    return failure(log, 'new profile create', created.error);
  }

  if (copyFrom) {
    const copy = deps.copyResume ?? copyResume;
    try {
      const r = await copy(supabase, userId, copyFrom, newProfileId, { log });
      if (r.status !== 'saved') {
        log(
          `new profile: resume not copied status=${r.status} profile=${newProfileId}`,
        );
      }
    } catch (e) {
      log(
        `new profile: resume copy threw profile=${newProfileId} code=${errorCode(e)}`,
      );
    }
  }
  return { status: 'created', profileId: newProfileId };
}

/** Ends the new-profile flow: deletes the user's draft row. */
export async function discardNewProfile(
  supabase: Client,
  userId: string,
  deps: Deps = {},
): Promise<'discarded' | 'failed'> {
  const log = logger(deps);
  const del = await supabase.from(DRAFTS).delete().eq('userId', userId);
  if (del.error) {
    log(`new profile: draft delete code=${errorCode(del.error)}`);
    return 'failed';
  }
  return 'discarded';
}
