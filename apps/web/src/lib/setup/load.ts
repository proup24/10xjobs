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
  const code = errorCode(error);
  // `code` lets callers log it with errorCode() without the message.
  return Object.assign(new Error(`setup load: ${what} code=${code}`), { code });
}

function must<T>(
  what: string,
  r: { data: T; error: unknown },
): NonNullable<T> | null {
  if (r.error) throw loadError(what, r.error);
  return r.data ?? null;
}

/**
 * What the next-step rule reads. `profile` is the first profile with a resume, else the
 * oldest, else null. An unparseable draft counts as none (a v2 new-profile draft is
 * unparseable here), and so does a draft left over once a profile exists: the profile is
 * what steps 3 and 4 edit.
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
      .order('id', { ascending: true }),
  ]);
  const u = must('users read', user);
  const d = must('draft read', draft);
  const rows = must('profile read', profile) ?? [];
  // Setup is done once any profile has a resume; else the oldest is the one to finish.
  const p = rows.find((r) => r.resumeKey !== null) ?? rows[0] ?? null;
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

/** Step 5: the profile's current resume file, or null when it has none. */
export async function loadResume(
  supabase: Client,
  profileId: string,
): Promise<{ filename: string; sizeBytes: number } | null> {
  const row = must(
    'profile read',
    await supabase
      .from('profiles')
      .select('resumeKey, resumeFilename, resumeSizeBytes')
      .eq('id', profileId)
      .maybeSingle(),
  );
  if (!row || row.resumeKey === null) return null;
  return {
    filename: row.resumeFilename ?? '',
    sizeBytes: row.resumeSizeBytes ?? 0,
  };
}

/**
 * A profile's publish state and whether its searches are behind its last matching change
 * (`searchesVersion` null or below `matchVersion`), or null when it isn't the user's.
 */
export async function loadProfileSync(
  supabase: Client,
  profileId: string,
): Promise<{ published: boolean; applying: boolean } | null> {
  const row = must(
    'profile read',
    await supabase
      .from('profiles')
      .select('state, matchVersion, searchesVersion')
      .eq('id', profileId)
      .maybeSingle(),
  );
  if (!row) return null;
  return {
    published: row.state === 'published',
    applying:
      row.searchesVersion === null || row.searchesVersion < row.matchVersion,
  };
}
