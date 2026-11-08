import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';
import { errorCode } from '@/lib/resume/errors';
import {
  AUTHORIZATION_KINDS,
  LINK_KINDS,
  parseDraft,
  type AboutAnswers,
  type AuthorizationKind,
  type EligibilityAnswers,
  type JobAnswers,
  type TermsAnswers,
} from './answers';
import { fromProfile } from './mapping';
import type { SetupSnapshot } from './next-step';

/**
 * Reads for the setup pages, as the signed-in user: RLS scopes every query to their own
 * rows. A read error throws with the error code only, never the data.
 */

type Client = SupabaseClient<Database>;

export function loadError(what: string, error: unknown): Error {
  return new Error(`setup load: ${what} code=${errorCode(error)}`);
}

function must<T>(
  what: string,
  r: { data: T; error: unknown },
): NonNullable<T> | null {
  if (r.error) throw loadError(what, r.error);
  return r.data ?? null;
}

/**
 * What the next-step rule reads. An unparseable draft counts as none, and so does a draft
 * left over once a profile exists: the profile is what steps 3 and 4 edit.
 */
export async function loadSetupSnapshot(
  supabase: Client,
): Promise<SetupSnapshot> {
  const [user, draft, profile] = await Promise.all([
    supabase
      .from('users')
      .select('name, residenceCountry, acceptsSponsorship')
      .maybeSingle(),
    supabase.from('profile_setup_drafts').select('answers').maybeSingle(),
    supabase
      .from('profiles')
      .select('id, resumeKey')
      .order('createdAt', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const u = must('users read', user);
  const d = must('draft read', draft);
  const p = must('profile read', profile);
  return {
    name: u?.name ?? null,
    residenceCountry: u?.residenceCountry ?? null,
    acceptsSponsorship: u?.acceptsSponsorship ?? null,
    draft: d && !p ? parseDraft(d.answers) : null,
    profile: p ? { id: p.id, hasResume: p.resumeKey !== null } : null,
  };
}

/** Steps 3 and 4 read back from a stored profile, or null when it isn't the user's. */
export async function loadSetupProfile(
  supabase: Client,
  profileId: string,
): Promise<{ job: JobAnswers; terms: TermsAnswers } | null> {
  const row = must(
    'profile read',
    await supabase
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .maybeSingle(),
  );
  if (!row) return null;
  const skills = must(
    'skills read',
    await supabase.from('profile_skills').select('*').eq('profileId', row.id),
  );
  return fromProfile(row, skills ?? []);
}

const isLinkKind = (
  kind: string,
): kind is AboutAnswers['links'][number]['kind'] =>
  (LINK_KINDS as readonly string[]).includes(kind);

/** Step 1: the account email (read-only) and the saved name and contacts. */
export async function loadAbout(
  supabase: Client,
): Promise<{ email: string; answers: AboutAnswers }> {
  const claims = await supabase.auth.getClaims();
  if (claims.error) throw loadError('claims read', claims.error);
  const email = claims.data?.claims.email;
  if (typeof email !== 'string') throw loadError('claims read', null);

  const [user, contacts] = await Promise.all([
    supabase.from('users').select('name').maybeSingle(),
    supabase
      .from('contacts')
      .select('kind, value')
      .order('createdAt', { ascending: true }),
  ]);
  const u = must('users read', user);
  const rows = must('contacts read', contacts) ?? [];
  // One phone and one LinkedIn on the form; the first saved wins.
  const first = (kind: string) =>
    rows.find((c) => c.kind === kind)?.value ?? null;
  return {
    email,
    answers: {
      name: u?.name ?? '',
      phone: first('phone'),
      linkedin: first('linkedin'),
      links: rows.flatMap((c) =>
        isLinkKind(c.kind) ? [{ kind: c.kind, value: c.value }] : [],
      ),
    },
  };
}

const isAuthorizationKind = (kind: string): kind is AuthorizationKind =>
  (AUTHORIZATION_KINDS as readonly string[]).includes(kind);

/**
 * Step 2, or null until it was saved. The "none" tick isn't stored: a saved step with no
 * authorizations means it was ticked.
 */
export async function loadEligibility(
  supabase: Client,
): Promise<EligibilityAnswers | null> {
  const [user, auths] = await Promise.all([
    supabase
      .from('users')
      .select('residenceCountry, acceptsSponsorship')
      .maybeSingle(),
    supabase
      .from('work_authorizations')
      .select('kind, place')
      .order('createdAt', { ascending: true }),
  ]);
  const u = must('users read', user);
  const rows = must('authorizations read', auths) ?? [];
  if (!u || u.residenceCountry === null || u.acceptsSponsorship === null) {
    return null;
  }
  const authorizations = rows.flatMap((a) =>
    isAuthorizationKind(a.kind) ? [{ kind: a.kind, place: a.place }] : [],
  );
  return {
    residenceCountry: u.residenceCountry,
    acceptsSponsorship: u.acceptsSponsorship,
    authorizations,
    noneConfirmed: authorizations.length === 0,
  };
}
