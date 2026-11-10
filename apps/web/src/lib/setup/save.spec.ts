// @vitest-environment node
import { isSearchableTech } from '@xjobs/database/enums';
import { describe, expect, it } from 'vitest';
import { fakeSupabase, type QueryCall, type Reply } from '@/test/fake-supabase';
import type { JobAnswers, TermsAnswers } from './answers';
import { termsColumns, toProfileWrite } from './mapping';
import {
  saveAbout,
  saveContacts,
  saveEligibility,
  saveJob,
  saveProfileJob,
  saveProfileTerms,
  saveTerms,
} from './save';

const U = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';

const job: JobAnswers = {
  position: 'frontend_engineer',
  yearsOfExperience: 6,
  seniorities: ['senior'],
  techs: [
    { code: 'typescript', rating: 5, starred: true },
    { code: 'saas', rating: 2, starred: false },
  ],
  languages: [{ lang: 'en', level: 'fluent' }],
};

const terms: TermsAnswers = {
  places: [
    {
      place: { kind: 'region', code: 'EU' },
      remote: true,
      hybrid: false,
      onsite: false,
    },
  ],
  timezoneCurrent: 60,
  timezoneMin: -120,
  timezoneMax: 240,
  contractTypes: ['permanent'],
  engagements: ['employee'],
  noticePeriodDays: 30,
  salary: null,
  acceptsAnyCurrency: true,
  acceptedCurrencies: [],
};

const quiet = { log: () => undefined };

type World = {
  profile?: { id: string } | null;
  draft?: { id: string; answers: unknown } | null;
  existing?: Record<string, unknown>[];
  /** False: the profile update matches no row (e.g. the profile was published meanwhile). */
  profileUpdateMatches?: boolean;
  failOn?: (call: QueryCall) => Reply | undefined;
  rpcError?: { code?: string; message?: string } | null;
};

/** A fake database: one optional profile, one optional draft, rows to prune. */
function world(w: World = {}) {
  return fakeSupabase({
    reply(call) {
      const failed = w.failOn?.(call);
      if (failed) return failed;
      if (call.table === 'profiles' && call.action === 'select') {
        return { data: w.profile ?? null, error: null };
      }
      if (call.table === 'profile_setup_drafts' && call.action === 'select') {
        return { data: w.draft ?? null, error: null };
      }
      if (call.action === 'update') {
        const rows =
          call.table === 'profile_setup_drafts'
            ? w.draft
              ? [{ id: w.draft.id }]
              : []
            : call.table === 'profiles'
              ? w.profileUpdateMatches === false
                ? []
                : [{ id: P }]
              : [{ id: U }];
        return { data: rows, error: null };
      }
      if (
        (call.table === 'contacts' || call.table === 'work_authorizations') &&
        call.action === 'select'
      ) {
        return { data: w.existing ?? [], error: null };
      }
      return undefined;
    },
    rpc: () =>
      w.rpcError ? { data: null, error: w.rpcError } : { data: P, error: null },
  });
}

describe('saveTerms', () => {
  it('creates the profile when the draft has job answers', async () => {
    const f = world({ draft: { id: D, answers: { version: 1, job } } });
    expect(await saveTerms(f.supabase, U, terms, quiet)).toEqual({
      status: 'saved',
    });
    const [draftWrite] = f.queries('profile_setup_drafts', 'update');
    expect(draftWrite.payload).toEqual({
      answers: { version: 1, job, terms },
    });
    const rpcs = f.rpcs('create_profile_from_setup');
    expect(rpcs).toHaveLength(1);
    const { profile, skills } = toProfileWrite(job, terms);
    expect(rpcs[0].args).toEqual({ p_profile: profile, p_skills: skills });
    expect(f.trail().indexOf('profile_setup_drafts.update')).toBeLessThan(
      f.trail().indexOf('rpc create_profile_from_setup'),
    );
  });

  it('treats a missing draft as already created', async () => {
    const f = world({
      draft: { id: D, answers: { version: 1, job } },
      rpcError: { code: 'P0002', message: 'no setup draft' },
    });
    expect(await saveTerms(f.supabase, U, terms, quiet)).toEqual({
      status: 'saved',
    });
  });

  it('a draft deleted before the terms write means another request created the profile', async () => {
    // The draft read sees the row; by the update, another request has turned it into a profile.
    const f = world({
      draft: { id: D, answers: { version: 1, job } },
      failOn: (c) =>
        c.table === 'profile_setup_drafts' && c.action === 'update'
          ? { data: [], error: null }
          : undefined,
    });
    expect(await saveTerms(f.supabase, U, terms, quiet)).toEqual({
      status: 'saved',
    });
    expect(f.rpcs('create_profile_from_setup')).toHaveLength(0);
    expect(f.queries('profile_setup_drafts', 'upsert')).toHaveLength(0);
  });

  it('keeps the draft and returns invalid on a check error', async () => {
    const message =
      'new row for relation "profiles" violates check constraint on profiles.contractTypes';
    const f = world({
      draft: { id: D, answers: { version: 1, job } },
      rpcError: { code: '23514', message },
    });
    expect(await saveTerms(f.supabase, U, terms, quiet)).toEqual({
      status: 'invalid',
      errors: { _form: message },
    });
    expect(f.queries('profile_setup_drafts', 'delete')).toHaveLength(0);
    expect(
      f.calls.filter((c) => c.kind === 'query' && c.action === 'delete'),
    ).toHaveLength(0);
    const [draftWrite] = f.queries('profile_setup_drafts', 'update');
    expect(draftWrite.payload).toEqual({
      answers: { version: 1, job, terms },
    });
  });

  it('returns failed on an unknown rpc error', async () => {
    const f = world({
      draft: { id: D, answers: { version: 1, job } },
      rpcError: { code: 'PGRST000', message: 'upstream' },
    });
    expect(await saveTerms(f.supabase, U, terms, quiet)).toEqual({
      status: 'failed',
    });
  });

  it('updates the profile when it exists', async () => {
    const f = world({ profile: { id: P } });
    expect(await saveTerms(f.supabase, U, terms, quiet)).toEqual({
      status: 'saved',
    });
    const [update] = f.queries('profiles', 'update');
    expect(update.filters).toContainEqual(['eq', 'id', P]);
    expect(update.payload).toEqual(termsColumns(terms));
    expect(f.rpcs('create_profile_from_setup')).toHaveLength(0);
    expect(f.queries('profile_setup_drafts')).toHaveLength(0);
  });

  it('a profile update matching no row returns failed', async () => {
    const f = world({ profile: { id: P }, profileUpdateMatches: false });
    expect(await saveTerms(f.supabase, U, terms, quiet)).toEqual({
      status: 'failed',
    });
    expect(f.rpcs('create_profile_from_setup')).toHaveLength(0);
    expect(f.queries('profile_setup_drafts')).toHaveLength(0);
  });

  it('without job answers in the draft writes the terms and creates nothing', async () => {
    const f = world();
    expect(await saveTerms(f.supabase, U, terms, quiet)).toEqual({
      status: 'saved',
    });
    const [upsert] = f.queries('profile_setup_drafts', 'upsert');
    expect(upsert.payload).toMatchObject({
      userId: U,
      answers: { version: 1, terms },
    });
    expect(upsert.options).toEqual({ onConflict: 'userId' });
    expect(f.rpcs('create_profile_from_setup')).toHaveLength(0);
  });

  it('refuses invalid terms without writing', async () => {
    const f = world();
    const result = await saveTerms(
      f.supabase,
      U,
      { ...terms, places: [] },
      quiet,
    );
    expect(result).toMatchObject({
      status: 'invalid',
      errors: { places: 'Add at least one place' },
    });
    expect(f.calls).toEqual([]);
  });

  it('logs only the error code', async () => {
    const lines: string[] = [];
    const f = world({
      draft: { id: D, answers: { version: 1, job } },
      rpcError: { code: '23514', message: 'contractTypes permanent' },
    });
    await saveTerms(f.supabase, U, terms, { log: (l) => lines.push(l) });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('code=23514');
    expect(lines[0]).not.toContain('permanent');
  });
});

describe('saveJob', () => {
  it('on an existing profile replaces skills with the new domain', async () => {
    const f = world({ profile: { id: P } });
    const result = await saveJob(
      f.supabase,
      U,
      { ...job, position: 'frontend_engineer' },
      isSearchableTech,
      quiet,
    );
    expect(result).toEqual({ status: 'saved' });
    const [update] = f.queries('profiles', 'update');
    expect(update.payload).toEqual({
      position: 'frontend_engineer',
      yearsOfExperience: 6,
      seniorities: ['senior'],
      languages: [{ lang: 'en', level: 'fluent' }],
    });
    const [rpc] = f.rpcs('replace_profile_skills');
    const args = rpc.args as {
      p_profile_id: string;
      p_skills: { technology: string; domain: string }[];
    };
    expect(args.p_profile_id).toBe(P);
    expect(args.p_skills.map((s) => s.technology)).toEqual([
      'typescript',
      'saas',
    ]);
    expect(args.p_skills.every((s) => s.domain === 'frontend')).toBe(true);
    expect(f.queries('profile_setup_drafts')).toHaveLength(0);
  });

  it('without a profile writes only the draft', async () => {
    const f = world({ draft: { id: D, answers: { version: 1, terms } } });
    expect(await saveJob(f.supabase, U, job, isSearchableTech, quiet)).toEqual({
      status: 'saved',
    });
    const [upsert] = f.queries('profile_setup_drafts', 'upsert');
    expect(upsert.payload).toEqual({
      id: D,
      userId: U,
      answers: { version: 1, job, terms },
    });
    expect(upsert.options).toEqual({ onConflict: 'userId' });
    expect(f.trail().filter((t) => !t.startsWith('profile'))).toEqual([]);
    expect(f.queries('profiles', 'update')).toHaveLength(0);
    expect(f.calls.filter((c) => c.kind === 'rpc')).toHaveLength(0);
  });

  it('validates with the given searchable rule', async () => {
    const f = world();
    const result = await saveJob(f.supabase, U, job, () => false, quiet);
    expect(result.status).toBe('invalid');
    expect(f.calls).toEqual([]);
  });

  it('a profile update matching no row returns failed without replacing skills', async () => {
    const f = world({ profile: { id: P }, profileUpdateMatches: false });
    expect(await saveJob(f.supabase, U, job, isSearchableTech, quiet)).toEqual({
      status: 'failed',
    });
    expect(f.rpcs('replace_profile_skills')).toHaveLength(0);
    expect(f.queries('profile_setup_drafts')).toHaveLength(0);
  });

  it('a replace_profile_skills P0002 returns failed', async () => {
    const f = world({ profile: { id: P }, rpcError: { code: 'P0002' } });
    expect(await saveJob(f.supabase, U, job, isSearchableTech, quiet)).toEqual({
      status: 'failed',
    });
  });
});

describe('saveAbout', () => {
  const about = {
    name: 'Ada Lovelace',
    phone: '+44 20 1234',
    linkedin: '',
    links: [{ kind: 'github', value: 'https://github.com/ada' }],
  };

  it('upserts before it prunes and never touches email contacts', async () => {
    const f = world({
      existing: [
        { id: 'c-old-phone', kind: 'phone', value: '+1 555' },
        { id: 'c-keep', kind: 'github', value: 'https://github.com/ada' },
        {
          id: 'c-old-in',
          kind: 'linkedin',
          value: 'https://linkedin.com/in/a',
        },
      ],
    });
    expect(await saveAbout(f.supabase, U, about, quiet)).toEqual({
      status: 'saved',
    });
    expect(f.trail()).toEqual([
      'users.update',
      'contacts.upsert',
      'contacts.select',
      'contacts.delete',
    ]);
    const [user] = f.queries('users', 'update');
    expect(user.payload).toEqual({ name: 'Ada Lovelace' });
    expect(user.filters).toContainEqual(['eq', 'id', U]);
    const [upsert] = f.queries('contacts', 'upsert');
    expect(
      (upsert.payload as { kind: string; value: string; userId: string }[]).map(
        ({ kind, value, userId }) => ({ kind, value, userId }),
      ),
    ).toEqual([
      { kind: 'phone', value: '+44 20 1234', userId: U },
      { kind: 'github', value: 'https://github.com/ada', userId: U },
    ]);
    expect(upsert.options).toMatchObject({
      onConflict: 'userId,kind,value',
    });
    const [read] = f.queries('contacts', 'select');
    const kinds = read.filters.find((x) => x[0] === 'in' && x[1] === 'kind');
    expect(kinds?.[2]).not.toContain('email');
    expect(kinds?.[2]).toEqual(
      expect.arrayContaining(['phone', 'linkedin', 'github', 'other']),
    );
    const [del] = f.queries('contacts', 'delete');
    expect(del.filters).toContainEqual([
      'in',
      'id',
      ['c-old-phone', 'c-old-in'],
    ]);
  });

  it('a failed upsert stops before any prune', async () => {
    const f = world({
      failOn: (c) =>
        c.table === 'contacts' && c.action === 'upsert'
          ? { data: null, error: { code: '08006' } }
          : undefined,
    });
    expect(await saveAbout(f.supabase, U, about, quiet)).toEqual({
      status: 'failed',
    });
    expect(f.queries('contacts', 'delete')).toHaveLength(0);
  });

  it('refuses a blank name without writing', async () => {
    const f = world();
    const result = await saveAbout(
      f.supabase,
      U,
      { ...about, name: ' ' },
      quiet,
    );
    expect(result).toEqual({
      status: 'invalid',
      errors: { name: 'Enter your name' },
    });
    expect(f.calls).toEqual([]);
  });
});

describe('saveEligibility', () => {
  it('rejects empty authorizations without the tick', async () => {
    const f = world();
    const result = await saveEligibility(
      f.supabase,
      U,
      {
        residenceCountry: 'DE',
        acceptsSponsorship: false,
        authorizations: [],
        noneConfirmed: false,
      },
      quiet,
    );
    expect(result).toEqual({
      status: 'invalid',
      errors: {
        noneConfirmed: 'Add a work authorization, or tick that you hold none',
      },
    });
    expect(f.calls).toEqual([]);
  });

  it('saves the user columns, upserts then prunes authorizations', async () => {
    const f = world({
      existing: [
        { id: 'w-old', kind: 'residency', place: 'FR' },
        { id: 'w-keep', kind: 'citizenship', place: 'DE' },
      ],
    });
    const result = await saveEligibility(
      f.supabase,
      U,
      {
        residenceCountry: 'DE',
        acceptsSponsorship: true,
        authorizations: [{ kind: 'citizenship', place: 'DE' }],
        noneConfirmed: false,
      },
      quiet,
    );
    expect(result).toEqual({ status: 'saved' });
    expect(f.trail()).toEqual([
      'users.update',
      'work_authorizations.upsert',
      'work_authorizations.select',
      'work_authorizations.delete',
    ]);
    expect(f.queries('users', 'update')[0].payload).toEqual({
      residenceCountry: 'DE',
      acceptsSponsorship: true,
    });
    expect(f.queries('work_authorizations', 'upsert')[0].options).toMatchObject(
      { onConflict: 'userId,kind,place' },
    );
    expect(
      f.queries('work_authorizations', 'delete')[0].filters,
    ).toContainEqual(['in', 'id', ['w-old']]);
  });

  it('with none confirmed upserts nothing and prunes everything', async () => {
    const f = world({
      existing: [{ id: 'w-old', kind: 'residency', place: 'FR' }],
    });
    const result = await saveEligibility(
      f.supabase,
      U,
      {
        residenceCountry: 'DE',
        acceptsSponsorship: false,
        authorizations: [],
        noneConfirmed: true,
      },
      quiet,
    );
    expect(result).toEqual({ status: 'saved' });
    expect(f.trail()).toEqual([
      'users.update',
      'work_authorizations.select',
      'work_authorizations.delete',
    ]);
  });
});

describe('saveContacts', () => {
  const contacts = {
    phone: '+44 20 1234',
    linkedin: null,
    links: [{ kind: 'github', value: 'https://github.com/ada' }],
  };

  it('never updates users', async () => {
    const f = world();
    expect(await saveContacts(f.supabase, U, contacts, quiet)).toEqual({
      status: 'saved',
    });
    expect(f.queries('users')).toHaveLength(0);
    const [upsert] = f.queries('contacts', 'upsert');
    expect(
      (upsert.payload as { kind: string; value: string }[]).map((r) => [
        r.kind,
        r.value,
      ]),
    ).toEqual([
      ['phone', '+44 20 1234'],
      ['github', 'https://github.com/ada'],
    ]);
  });

  it('ignores a name in the input', async () => {
    const f = world();
    const input = { name: 'X', phone: null, linkedin: null, links: [] };
    expect(await saveContacts(f.supabase, U, input, quiet)).toEqual({
      status: 'saved',
    });
    expect(f.queries('users')).toHaveLength(0);
  });
});

describe('saveProfileJob', () => {
  const OTHER = '44444444-4444-4444-8444-444444444444';

  it('writes the given profile, not the oldest', async () => {
    const f = world({ profile: { id: P } });
    expect(
      await saveProfileJob(f.supabase, OTHER, job, isSearchableTech, quiet),
    ).toEqual({ status: 'saved' });
    const [update] = f.queries('profiles', 'update');
    expect(update.filters).toContainEqual(['eq', 'id', OTHER]);
    const [rpc] = f.rpcs('replace_profile_skills');
    expect((rpc.args as { p_profile_id: string }).p_profile_id).toBe(OTHER);
    expect(f.queries('profiles', 'select')).toHaveLength(0);
  });

  it('returns failed when the update matches no row', async () => {
    const f = world({ profileUpdateMatches: false });
    expect(
      await saveProfileJob(f.supabase, P, job, isSearchableTech, quiet),
    ).toEqual({ status: 'failed' });
    expect(f.rpcs('replace_profile_skills')).toHaveLength(0);
  });
});

describe('saveProfileTerms', () => {
  const OTHER = '44444444-4444-4444-8444-444444444444';

  it('writes the given profile, not the oldest', async () => {
    const f = world({ profile: { id: P } });
    expect(await saveProfileTerms(f.supabase, OTHER, terms, quiet)).toEqual({
      status: 'saved',
    });
    const [update] = f.queries('profiles', 'update');
    expect(update.filters).toContainEqual(['eq', 'id', OTHER]);
    expect(update.payload).toEqual(termsColumns(terms));
    expect(f.queries('profiles', 'select')).toHaveLength(0);
  });

  it('returns failed when the update matches no row', async () => {
    const f = world({ profileUpdateMatches: false });
    expect(await saveProfileTerms(f.supabase, P, terms, quiet)).toEqual({
      status: 'failed',
    });
  });
});
