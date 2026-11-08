import type { SupabaseClient } from '@supabase/supabase-js';
import { isSearchableTech } from '@xjobs/database/enums';
import type { Database } from '@xjobs/database/types';
import type { ZodError } from 'zod';
import { errorCode } from '@/lib/resume/errors';
import {
  aboutSchema,
  eligibilitySchema,
  jobSchema,
  LINK_KINDS,
  parseDraft,
  termsSchema,
  type SetupDraft,
} from './answers';
import { jobColumns, jobSkills, termsColumns, toProfileWrite } from './mapping';

/**
 * Saves for each setup step, as the signed-in user under RLS. Log lines carry the step,
 * what failed and an error code, never the answers.
 */

type Client = SupabaseClient<Database>;
type Json =
  Database['public']['Functions']['create_profile_from_setup']['Args']['p_profile'];
type Deps = { log?: (line: string) => void };

export type SaveResult =
  | { status: 'saved' }
  | { status: 'invalid'; errors: Record<string, string> }
  | { status: 'failed' };

const SAVED: SaveResult = { status: 'saved' };
const FAILED: SaveResult = { status: 'failed' };

/** The first message per field path ("links.0.value"); a top-level issue goes under `_form`. */
function fieldErrors(error: ZodError): SaveResult {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_form';
    errors[key] ??= issue.message;
  }
  return { status: 'invalid', errors };
}

/**
 * Codes the database raises for a value it refuses: integrity (23*: check, not null,
 * foreign key), data exceptions (22*: e.g. 22023, 22P02) and the triggers' RAISE (P0001).
 */
function isRefusal(code: unknown): boolean {
  return (
    typeof code === 'string' &&
    (code.startsWith('22') || code.startsWith('23') || code === 'P0001')
  );
}

/** Logs the code, then `invalid` with the database message when it refused a value, else `failed`. */
function failure(
  log: (line: string) => void,
  what: string,
  error: unknown,
): SaveResult {
  log(`setup save: ${what} code=${errorCode(error)}`);
  const e = error as { code?: unknown; message?: unknown } | null;
  if (e && isRefusal(e.code) && typeof e.message === 'string') {
    return { status: 'invalid', errors: { _form: e.message } };
  }
  return FAILED;
}

const logger = (deps: Deps) =>
  deps.log ?? ((line: string) => console.error(line));

/** The oldest of the user's profiles, the one setup edits, or null. */
async function readProfile(supabase: Client, userId: string) {
  return supabase
    .from('profiles')
    .select('id')
    .eq('userId', userId)
    .order('createdAt', { ascending: true })
    .limit(1)
    .maybeSingle();
}

async function readDraft(supabase: Client, userId: string) {
  return supabase
    .from('profile_setup_drafts')
    .select('id, answers')
    .eq('userId', userId)
    .maybeSingle();
}

const draftJson = (draft: SetupDraft): NonNullable<Json> =>
  draft as unknown as NonNullable<Json>;

/**
 * Writes `rows` (insert, keeping what is already there), then deletes the user's rows
 * among `kinds` that aren't in `rows`. Insert before prune, so a failure never loses a row.
 */
async function replaceRows(
  supabase: Client,
  log: (line: string) => void,
  what: string,
  table: 'contacts' | 'work_authorizations',
  userId: string,
  keys: readonly ['kind', 'value' | 'place'],
  kinds: readonly string[],
  rows: { kind: string; value?: string; place?: string }[],
): Promise<SaveResult | null> {
  const [, second] = keys;
  const key = (r: Record<string, unknown>) => `${r.kind} ${r[second]}`;
  if (rows.length > 0) {
    const upsert = await supabase
      .from(table)
      .upsert(
        rows.map((r) => ({ id: crypto.randomUUID(), userId, ...r })) as never,
        { onConflict: `userId,${keys.join(',')}`, ignoreDuplicates: true },
      );
    if (upsert.error) return failure(log, `${what} upsert`, upsert.error);
  }
  const existing = await supabase
    .from(table)
    .select(`id, ${keys.join(', ')}`)
    .eq('userId', userId)
    .in('kind', [...kinds]);
  if (existing.error) return failure(log, `${what} read`, existing.error);
  const wanted = new Set(rows.map(key));
  const stale = ((existing.data ?? []) as unknown as Record<string, unknown>[])
    .filter((r) => !wanted.has(key(r)))
    .map((r) => r.id as string);
  if (stale.length > 0) {
    const del = await supabase
      .from(table)
      .delete()
      .eq('userId', userId)
      .in('id', stale);
    if (del.error) return failure(log, `${what} prune`, del.error);
  }
  return null;
}

/** "" or blank for phone or LinkedIn means none; the schema wants null for that. */
function blankToNull(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const out: Record<string, unknown> = { ...input };
  for (const k of ['phone', 'linkedin']) {
    if (typeof out[k] === 'string' && out[k].trim() === '') out[k] = null;
  }
  return out;
}

/** The contact kinds step 1 owns; `email` contacts are left alone. */
const ABOUT_KINDS = ['phone', 'linkedin', ...LINK_KINDS] as const;

/** Step 1: the name, then the user's phone, LinkedIn and link contacts. */
export async function saveAbout(
  supabase: Client,
  userId: string,
  input: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const log = logger(deps);
  const parsed = aboutSchema.safeParse(blankToNull(input));
  if (!parsed.success) return fieldErrors(parsed.error);
  const about = parsed.data;

  const user = await supabase
    .from('users')
    .update({ name: about.name })
    .eq('id', userId);
  if (user.error) return failure(log, 'about user update', user.error);

  const contacts = [
    ...(about.phone ? [{ kind: 'phone', value: about.phone }] : []),
    ...(about.linkedin ? [{ kind: 'linkedin', value: about.linkedin }] : []),
    ...about.links.map((l) => ({ kind: l.kind, value: l.value })),
  ];
  return (
    (await replaceRows(
      supabase,
      log,
      'about contacts',
      'contacts',
      userId,
      ['kind', 'value'],
      ABOUT_KINDS,
      contacts,
    )) ?? SAVED
  );
}

/** Step 2: residence and sponsorship, then the work authorizations. */
export async function saveEligibility(
  supabase: Client,
  userId: string,
  input: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const log = logger(deps);
  const parsed = eligibilitySchema.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const e = parsed.data;

  const user = await supabase
    .from('users')
    .update({
      residenceCountry: e.residenceCountry,
      acceptsSponsorship: e.acceptsSponsorship,
    })
    .eq('id', userId);
  if (user.error) return failure(log, 'eligibility user update', user.error);

  return (
    (await replaceRows(
      supabase,
      log,
      'eligibility authorizations',
      'work_authorizations',
      userId,
      ['kind', 'place'],
      // Every kind: the table holds only these (its check), all owned by step 2.
      ['citizenship', 'residency', 'work-permit', 'clearance'],
      e.authorizations.map((a) => ({ kind: a.kind, place: a.place })),
    )) ?? SAVED
  );
}

/**
 * Step 3. With a profile, its columns and skills (every skill takes the position's
 * domain); without one, the draft's `job`, keeping its `terms`.
 */
export async function saveJob(
  supabase: Client,
  userId: string,
  input: unknown,
  isSearchable: (code: string) => boolean,
  deps: Deps = {},
): Promise<SaveResult> {
  const log = logger(deps);
  const parsed = jobSchema(isSearchable).safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const job = parsed.data;

  const profile = await readProfile(supabase, userId);
  if (profile.error) return failure(log, 'job profile read', profile.error);

  if (profile.data) {
    const id = profile.data.id;
    const update = await supabase
      .from('profiles')
      .update(jobColumns(job))
      .eq('id', id)
      .select('id');
    if (update.error) return failure(log, 'job profile update', update.error);
    if (!update.data || update.data.length === 0) {
      log('setup save: job profile update matched no draft profile');
      return FAILED;
    }
    const skills = await supabase.rpc('replace_profile_skills', {
      p_profile_id: id,
      p_skills: jobSkills(job),
    });
    // P0002 (not a draft of yours) isn't a refusal of the answers: failed.
    if (skills.error) return failure(log, 'job skills replace', skills.error);
    return SAVED;
  }

  const draft = await readDraft(supabase, userId);
  if (draft.error) return failure(log, 'job draft read', draft.error);
  const terms = draft.data ? parseDraft(draft.data.answers)?.terms : undefined;
  const answers: SetupDraft = { version: 1, job, ...(terms ? { terms } : {}) };
  const write = await supabase.from('profile_setup_drafts').upsert(
    {
      // Reuse the row's id, so the upsert's update doesn't replace it.
      id: draft.data?.id ?? crypto.randomUUID(),
      userId,
      answers: draftJson(answers),
    },
    { onConflict: 'userId' },
  );
  if (write.error) return failure(log, 'job draft write', write.error);
  return SAVED;
}

/**
 * Step 4. With a profile, its columns. Without one, the draft's `terms`, then, when the
 * draft has `job`, the profile is created from both. A refused creation keeps the draft
 * with these terms and returns the database message under `_form`.
 */
export async function saveTerms(
  supabase: Client,
  userId: string,
  input: unknown,
  deps: Deps = {},
): Promise<SaveResult> {
  const log = logger(deps);
  const parsed = termsSchema.safeParse(input);
  if (!parsed.success) return fieldErrors(parsed.error);
  const terms = parsed.data;

  const profile = await readProfile(supabase, userId);
  if (profile.error) return failure(log, 'terms profile read', profile.error);

  if (profile.data) {
    const update = await supabase
      .from('profiles')
      .update(termsColumns(terms))
      .eq('id', profile.data.id)
      .select('id');
    if (update.error) return failure(log, 'terms profile update', update.error);
    if (!update.data || update.data.length === 0) {
      log('setup save: terms profile update matched no draft profile');
      return FAILED;
    }
    return SAVED;
  }

  const draft = await readDraft(supabase, userId);
  if (draft.error) return failure(log, 'terms draft read', draft.error);
  const job = draft.data ? parseDraft(draft.data.answers)?.job : undefined;
  const answers = draftJson({ version: 1, ...(job ? { job } : {}), terms });

  if (draft.data) {
    // An update, not an upsert: if another request has just turned the draft into the
    // profile (double submit), recreating the draft here would let a second profile in.
    const write = await supabase
      .from('profile_setup_drafts')
      .update({ answers })
      .eq('userId', userId)
      .select('id');
    if (write.error) return failure(log, 'terms draft write', write.error);
    if (!write.data || write.data.length === 0) return SAVED;
  } else {
    const write = await supabase
      .from('profile_setup_drafts')
      .upsert(
        { id: crypto.randomUUID(), userId, answers },
        { onConflict: 'userId' },
      );
    if (write.error) return failure(log, 'terms draft write', write.error);
  }
  if (!job) return SAVED;

  // The draft's job was only shape-checked; its rules run again before the profile.
  const checked = jobSchema(isSearchableTech).safeParse(job);
  if (!checked.success) {
    log('setup save: terms draft job no longer valid');
    return {
      status: 'invalid',
      errors: { _form: 'Check your answers in “The job you want”' },
    };
  }

  const { profile: p, skills } = toProfileWrite(checked.data, terms);
  const created = await supabase.rpc('create_profile_from_setup', {
    p_profile: p as unknown as Json,
    p_skills: skills,
  });
  if (created.error) {
    // No draft left: another request already created the profile.
    if (created.error.code === 'P0002') return SAVED;
    return failure(log, 'terms profile create', created.error);
  }
  return SAVED;
}
