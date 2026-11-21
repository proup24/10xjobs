// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fakeSupabase, type QueryCall, type Reply } from '@/test/fake-supabase';
import type { JobAnswers, TermsAnswers } from '@/lib/setup/answers';
import {
  toProfileWrite,
  type ProfileRow,
  type SkillRow,
} from '@/lib/setup/mapping';
import {
  discardNewProfile,
  loadNewProfileDraft,
  saveNewProfileJob,
  saveNewProfileTerms,
  startNewProfile,
} from './new-profile';

const U = '11111111-1111-4111-8111-111111111111';
const SRC = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const NEW = '44444444-4444-4444-8444-444444444444';
const BERLIN = '8f9c1a52-3b1e-4c7a-9d2e-1f0a2b3c4d5e';

const searchable = (code: string) => code !== 'saas';

// Every field differs from a blank form, so a dropped field would show.
const job: JobAnswers = {
  position: 'frontend_engineer',
  yearsOfExperience: 6,
  seniorities: ['senior', 'staff'],
  techs: [
    { code: 'typescript', rating: 5 },
    { code: 'saas', rating: 2 },
  ],
  languages: [
    { lang: 'en', level: 'fluent' },
    { lang: 'de', level: 'native' },
  ],
};

const terms: TermsAnswers = {
  places: [
    {
      place: { kind: 'region', code: 'EU' },
      remote: true,
      hybrid: false,
      onsite: false,
    },
    {
      place: { kind: 'city', id: BERLIN },
      remote: false,
      hybrid: true,
      onsite: true,
    },
  ],
  timezoneCurrent: 60,
  timezoneMin: -120,
  timezoneMax: 240,
  contractTypes: ['permanent', 'contract'],
  engagements: ['employee'],
  noticePeriodDays: 30,
  salary: { min: 90000, currency: 'EUR', period: 'year' },
  acceptsAnyCurrency: false,
  acceptedCurrencies: ['EUR', 'USD'],
};

function storedRow(): ProfileRow {
  return {
    ...toProfileWrite(job, terms).profile,
    id: SRC,
    userId: U,
    state: 'published',
    publishedAt: '2026-11-08T00:00:00Z',
    postSearch: false,
    matchVersion: 0,
    searchesVersion: null,
    resumeFilename: null,
    resumeKey: null,
    resumeSha256: null,
    resumeSizeBytes: null,
    resumeUploadedAt: null,
    createdAt: '2026-11-08T00:00:00Z',
    updatedAt: '2026-11-08T00:00:00Z',
  };
}

function storedSkills(): SkillRow[] {
  return toProfileWrite(job, terms).skills.map((s, i) => ({
    ...s,
    id: `s${i}`,
    userId: U,
    profileId: SRC,
    createdAt: '2026-11-08T00:00:00Z',
    updatedAt: '2026-11-08T00:00:00Z',
  }));
}

const v2 = (over: Record<string, unknown> = {}) => ({
  version: 2,
  newProfileId: NEW,
  copyFrom: null,
  ...over,
});

type World = {
  /** The user's profiles, as `select id` returns them. */
  profiles?: { id: string }[];
  /** The profile a by-id read returns (the copy source, or the created profile). */
  byId?: Record<string, ProfileRow | { id: string }>;
  skills?: SkillRow[];
  draft?: { id: string; answers: unknown } | null;
  /** False: the draft update matches no row (another request ended the draft). */
  draftUpdateMatches?: boolean;
  failOn?: (call: QueryCall) => Reply | undefined;
  rpcError?: { code?: string; message?: string } | null;
};

const idFilter = (c: QueryCall) =>
  c.filters.find((f) => f[0] === 'eq' && f[1] === 'id')?.[2] as
    | string
    | undefined;

function world(w: World = {}) {
  return fakeSupabase({
    reply(call) {
      const failed = w.failOn?.(call);
      if (failed) return failed;
      if (call.table === 'profiles' && call.action === 'select') {
        const id = idFilter(call);
        if (id !== undefined)
          return { data: w.byId?.[id] ?? null, error: null };
        return { data: w.profiles ?? [], error: null };
      }
      if (call.table === 'profile_skills' && call.action === 'select') {
        return { data: w.skills ?? [], error: null };
      }
      if (call.table === 'profile_setup_drafts' && call.action === 'select') {
        return { data: w.draft ?? null, error: null };
      }
      if (call.table === 'profile_setup_drafts' && call.action === 'update') {
        const matches = w.draftUpdateMatches ?? Boolean(w.draft);
        return { data: matches ? [{ id: D }] : [], error: null };
      }
      return undefined;
    },
    rpc: () =>
      w.rpcError
        ? { data: null, error: w.rpcError }
        : { data: NEW, error: null },
  });
}

const quiet = { log: () => undefined };
const five = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

describe('startNewProfile', () => {
  it('refuses at 5 profiles without writing', async () => {
    const f = world({ profiles: five });
    expect(await startNewProfile(f.supabase, U, { kind: 'blank' }, quiet)).toBe(
      'limit',
    );
    expect(f.queries('profile_setup_drafts', 'upsert')).toHaveLength(0);
  });

  it('blank: a version-2 draft with a fresh id and no answers', async () => {
    const f = world({ profiles: [{ id: SRC }] });
    expect(await startNewProfile(f.supabase, U, { kind: 'blank' }, quiet)).toBe(
      'started',
    );
    const [write] = f.queries('profile_setup_drafts', 'upsert');
    expect(write.options).toEqual({ onConflict: 'userId' });
    const payload = write.payload as { userId: string; answers: unknown };
    expect(payload.userId).toBe(U);
    const answers = payload.answers as Record<string, unknown>;
    expect(answers).toEqual({
      version: 2,
      newProfileId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      copyFrom: null,
    });
    expect(answers.newProfileId).not.toBe(SRC);
  });

  it('copy: carries every job and terms field from the source', async () => {
    const f = world({
      profiles: [{ id: SRC }],
      byId: { [SRC]: storedRow() },
      skills: storedSkills(),
    });
    expect(
      await startNewProfile(
        f.supabase,
        U,
        { kind: 'copy', profileId: SRC },
        quiet,
      ),
    ).toBe('started');
    const [write] = f.queries('profile_setup_drafts', 'upsert');
    const answers = (write.payload as { answers: Record<string, unknown> })
      .answers;
    expect(answers).toEqual({
      version: 2,
      newProfileId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      copyFrom: SRC,
      job,
      terms,
    });
  });

  it('replaces an existing v1 draft, keeping its row id', async () => {
    const f = world({
      profiles: [{ id: SRC }],
      draft: { id: D, answers: { version: 1, job } },
    });
    expect(await startNewProfile(f.supabase, U, { kind: 'blank' }, quiet)).toBe(
      'started',
    );
    const [write] = f.queries('profile_setup_drafts', 'upsert');
    const payload = write.payload as { id: string; answers: unknown };
    expect(payload.id).toBe(D);
    expect(payload.answers).toEqual({
      version: 2,
      newProfileId: expect.any(String),
      copyFrom: null,
    });
  });

  it('leaves a draft in progress (v2) alone and says so', async () => {
    const f = world({
      profiles: [{ id: SRC }],
      draft: { id: D, answers: v2({ job }) },
    });
    expect(await startNewProfile(f.supabase, U, { kind: 'blank' }, quiet)).toBe(
      'in-progress',
    );
    expect(f.queries('profile_setup_drafts', 'upsert')).toHaveLength(0);
  });

  it('a failed source read logs the code, not the message', async () => {
    const log = vi.fn();
    const f = world({
      profiles: [{ id: SRC }],
      failOn: (c) =>
        c.table === 'profile_skills'
          ? { data: null, error: { code: 'XX000', message: 'secret' } }
          : undefined,
      byId: { [SRC]: storedRow() },
    });
    expect(
      await startNewProfile(
        f.supabase,
        U,
        { kind: 'copy', profileId: SRC },
        { log },
      ),
    ).toBe('failed');
    expect(log).toHaveBeenCalledWith(
      'new profile: source read failed code=XX000',
    );
  });

  it('a source RLS does not return fails without writing', async () => {
    const f = world({ profiles: [{ id: SRC }] });
    expect(
      await startNewProfile(
        f.supabase,
        U,
        { kind: 'copy', profileId: SRC },
        quiet,
      ),
    ).toBe('failed');
    expect(f.queries('profile_setup_drafts', 'upsert')).toHaveLength(0);
  });

  it('a read error fails and logs only the code', async () => {
    const log = vi.fn();
    const f = world({
      failOn: (c) =>
        c.table === 'profiles'
          ? { data: null, error: { code: 'XX000', message: 'secret' } }
          : undefined,
    });
    expect(
      await startNewProfile(f.supabase, U, { kind: 'blank' }, { log }),
    ).toBe('failed');
    expect(log.mock.calls.join(' ')).toContain('XX000');
    expect(log.mock.calls.join(' ')).not.toContain('secret');
  });
});

describe('new-profile log lines', () => {
  it('every failure line is prefixed "new profile:", never "setup save:"', async () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    const draft = { id: D, answers: v2({ job }) };
    await saveNewProfileJob(
      world({
        failOn: (c) =>
          c.table === 'profile_setup_drafts'
            ? { data: null, error: { code: 'XX000' } }
            : undefined,
      }).supabase,
      U,
      job,
      searchable,
      { log },
    );
    for (const code of ['P0002', '23505', 'XX000']) {
      await saveNewProfileTerms(
        world({ draft, rpcError: { code } }).supabase,
        U,
        NEW,
        terms,
        searchable,
        { log },
      );
    }
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l).toMatch(/^new profile: /);
  });
});

describe('loadNewProfileDraft', () => {
  it('returns a version-2 draft and null for a v1 draft', async () => {
    const a = world({ draft: { id: D, answers: v2({ job }) } });
    expect(await loadNewProfileDraft(a.supabase)).toEqual(v2({ job }));
    const b = world({ draft: { id: D, answers: { version: 1, job } } });
    expect(await loadNewProfileDraft(b.supabase)).toBeNull();
    const c = world();
    expect(await loadNewProfileDraft(c.supabase)).toBeNull();
  });
});

describe('saveNewProfileJob', () => {
  it('without a v2 draft asks to start again', async () => {
    const f = world({ draft: { id: D, answers: { version: 1, job } } });
    expect(
      await saveNewProfileJob(f.supabase, U, job, searchable, quiet),
    ).toEqual({
      status: 'invalid',
      errors: { _form: 'Start the new profile again' },
    });
    expect(f.queries('profile_setup_drafts', 'update')).toHaveLength(0);
  });

  it('writes job and keeps the existing terms and ids', async () => {
    const f = world({
      draft: { id: D, answers: v2({ copyFrom: SRC, terms }) },
    });
    expect(
      await saveNewProfileJob(f.supabase, U, job, searchable, quiet),
    ).toEqual({ status: 'saved' });
    const [write] = f.queries('profile_setup_drafts', 'update');
    expect(write.payload).toEqual({
      answers: v2({ copyFrom: SRC, job, terms }),
    });
    expect(write.filters).toContainEqual(['eq', 'userId', U]);
  });

  it('refuses invalid job answers without writing', async () => {
    const f = world({ draft: { id: D, answers: v2() } });
    const r = await saveNewProfileJob(
      f.supabase,
      U,
      { ...job, techs: [{ code: 'saas', rating: 2 }] },
      searchable,
      quiet,
    );
    expect(r.status).toBe('invalid');
    expect(f.queries('profile_setup_drafts', 'update')).toHaveLength(0);
  });

  it('a draft ended between the read and the write asks to start again', async () => {
    const f = world({
      draft: { id: D, answers: v2() },
      draftUpdateMatches: false,
    });
    expect(
      await saveNewProfileJob(f.supabase, U, job, searchable, quiet),
    ).toEqual({
      status: 'invalid',
      errors: { _form: 'Start the new profile again' },
    });
  });
});

describe('saveNewProfileTerms', () => {
  it('with job answers creates the profile under the draft id', async () => {
    const f = world({ draft: { id: D, answers: v2({ job }) } });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, quiet),
    ).toEqual({ status: 'created', profileId: NEW });
    const [write] = f.queries('profile_setup_drafts', 'update');
    expect(write.payload).toEqual({ answers: v2({ job, terms }) });
    const rpcs = f.rpcs('create_profile_from_draft');
    expect(rpcs).toHaveLength(1);
    const { profile, skills } = toProfileWrite(job, terms);
    expect(rpcs[0].args).toEqual({
      p_profile_id: NEW,
      p_profile: profile,
      p_skills: skills,
    });
    expect(f.trail().indexOf('profile_setup_drafts.update')).toBeLessThan(
      f.trail().indexOf('rpc create_profile_from_draft'),
    );
  });

  it('a blank flow does not copy a resume', async () => {
    const copyResume = vi.fn();
    const f = world({ draft: { id: D, answers: v2({ job }) } });
    await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, {
      ...quiet,
      copyResume,
    });
    expect(copyResume).not.toHaveBeenCalled();
  });

  it('a copy copies the source resume into the new profile', async () => {
    const copyResume = vi.fn(async () => ({
      status: 'saved' as const,
      resume: { filename: 'cv.pdf', sizeBytes: 10, uploadedAt: 'now' },
    }));
    const f = world({ draft: { id: D, answers: v2({ job, copyFrom: SRC }) } });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, {
        ...quiet,
        copyResume,
      }),
    ).toEqual({ status: 'created', profileId: NEW });
    expect(copyResume).toHaveBeenCalledWith(
      f.supabase,
      U,
      SRC,
      NEW,
      expect.anything(),
    );
    expect(f.trail().indexOf('rpc create_profile_from_draft')).toBe(
      f.trail().length - 1,
    );
  });

  it.each([
    ['failed', async () => ({ status: 'failed' as const })],
    ['none', async () => ({ status: 'none' as const })],
    [
      'thrown',
      async () => {
        throw new Error('boom');
      },
    ],
  ])('a resume copy that is %s still gives created', async (_, impl) => {
    const log = vi.fn();
    const f = world({ draft: { id: D, answers: v2({ job, copyFrom: SRC }) } });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, {
        log,
        copyResume: vi.fn(impl),
      }),
    ).toEqual({ status: 'created', profileId: NEW });
  });

  it('a submit whose draft ends before its write returns the same profile', async () => {
    const copyResume = vi.fn();
    const f = world({
      draft: { id: D, answers: v2({ job, copyFrom: SRC }) },
      draftUpdateMatches: false,
      byId: { [NEW]: { id: NEW } },
    });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, {
        ...quiet,
        copyResume,
      }),
    ).toEqual({ status: 'created', profileId: NEW });
    expect(f.rpcs('create_profile_from_draft')).toHaveLength(0);
    expect(copyResume).not.toHaveBeenCalled();
  });

  it('a draft ended without a profile asks to start again', async () => {
    const f = world({
      draft: { id: D, answers: v2({ job }) },
      draftUpdateMatches: false,
    });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, quiet),
    ).toEqual({
      status: 'invalid',
      errors: { _form: 'Start the new profile again' },
    });
  });

  it('the profile limit comes back under _form', async () => {
    const f = world({
      draft: { id: D, answers: v2({ job }) },
      rpcError: { code: 'P0001', message: 'You can have at most 5 profiles' },
    });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, quiet),
    ).toEqual({
      status: 'invalid',
      errors: { _form: 'You can have at most 5 profiles' },
    });
  });

  it("a forged id (another user's profile) is a generic failure", async () => {
    const f = world({
      draft: { id: D, answers: v2({ job }) },
      rpcError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      },
    });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, quiet),
    ).toEqual({ status: 'failed' });
  });

  it('without job answers saves the terms and creates nothing', async () => {
    const f = world({ draft: { id: D, answers: v2() } });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, quiet),
    ).toEqual({ status: 'saved' });
    expect(f.queries('profile_setup_drafts', 'update')[0].payload).toEqual({
      answers: v2({ terms }),
    });
    expect(f.rpcs('create_profile_from_draft')).toHaveLength(0);
  });

  it('re-checks a hand-edited draft job before creating', async () => {
    const forged = {
      ...job,
      techs: [{ code: 'saas', rating: 2 }],
    };
    const f = world({ draft: { id: D, answers: v2({ job: forged }) } });
    const r = await saveNewProfileTerms(
      f.supabase,
      U,
      NEW,
      terms,
      searchable,
      quiet,
    );
    expect(r).toEqual({
      status: 'invalid',
      errors: { _form: expect.stringContaining('The job you want') },
    });
    expect(f.rpcs('create_profile_from_draft')).toHaveLength(0);
  });

  it('without a draft or profile asks to start again and writes nothing', async () => {
    const f = world();
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, quiet),
    ).toEqual({
      status: 'invalid',
      errors: { _form: 'Start the new profile again' },
    });
    expect(f.queries('profile_setup_drafts', 'update')).toHaveLength(0);
  });

  it('a sequential double submit returns the same profile without creating again', async () => {
    // The first call creates the profile and the function deletes the draft.
    const state: { draft: { id: string; answers: unknown } | null } = {
      draft: { id: D, answers: v2({ job, copyFrom: SRC }) },
    };
    let created = false;
    const copyResume = vi.fn(async () => ({ status: 'none' as const }));
    const f = fakeSupabase({
      reply(call) {
        if (call.table === 'profile_setup_drafts' && call.action === 'select') {
          return { data: state.draft, error: null };
        }
        if (call.table === 'profile_setup_drafts' && call.action === 'update') {
          return { data: state.draft ? [{ id: D }] : [], error: null };
        }
        if (call.table === 'profiles' && call.action === 'select') {
          return { data: created ? { id: NEW } : null, error: null };
        }
        return undefined;
      },
      rpc: () => {
        created = true;
        state.draft = null;
        return { data: NEW, error: null };
      },
    });
    const deps = { ...quiet, copyResume };
    const first = await saveNewProfileTerms(
      f.supabase,
      U,
      NEW,
      terms,
      searchable,
      deps,
    );
    const second = await saveNewProfileTerms(
      f.supabase,
      U,
      NEW,
      terms,
      searchable,
      deps,
    );
    expect(first).toEqual({ status: 'created', profileId: NEW });
    expect(second).toEqual({ status: 'created', profileId: NEW });
    expect(f.rpcs('create_profile_from_draft')).toHaveLength(1);
    expect(f.queries('profile_setup_drafts', 'update')).toHaveLength(1);
    expect(copyResume).toHaveBeenCalledTimes(1);
  });

  it('a draft naming another id is not written; the stale tab asks to start again', async () => {
    const OTHER = '55555555-5555-4555-8555-555555555555';
    const f = world({
      draft: { id: D, answers: v2({ job, newProfileId: OTHER }) },
    });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, quiet),
    ).toEqual({
      status: 'invalid',
      errors: { _form: 'Start the new profile again' },
    });
    expect(f.queries('profile_setup_drafts', 'update')).toHaveLength(0);
    expect(f.rpcs('create_profile_from_draft')).toHaveLength(0);
  });

  it('a draft naming another id, with this profile created, is created', async () => {
    const OTHER = '55555555-5555-4555-8555-555555555555';
    const f = world({
      draft: { id: D, answers: v2({ newProfileId: OTHER }) },
      byId: { [NEW]: { id: NEW } },
    });
    expect(
      await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, quiet),
    ).toEqual({ status: 'created', profileId: NEW });
    expect(f.queries('profile_setup_drafts', 'update')).toHaveLength(0);
  });

  it('the draft write only matches the draft naming this id', async () => {
    const f = world({ draft: { id: D, answers: v2() } });
    await saveNewProfileTerms(f.supabase, U, NEW, terms, searchable, quiet);
    const [write] = f.queries('profile_setup_drafts', 'update');
    expect(write.filters).toContainEqual(['eq', 'answers->>newProfileId', NEW]);
  });

  it('a malformed id asks to start again without a query', async () => {
    const f = world({ draft: { id: D, answers: v2({ job }) } });
    expect(
      await saveNewProfileTerms(
        f.supabase,
        U,
        'nope',
        terms,
        searchable,
        quiet,
      ),
    ).toEqual({
      status: 'invalid',
      errors: { _form: 'Start the new profile again' },
    });
    expect(f.calls).toHaveLength(0);
  });

  it('refuses invalid terms without writing', async () => {
    const f = world({ draft: { id: D, answers: v2({ job }) } });
    const r = await saveNewProfileTerms(
      f.supabase,
      U,
      NEW,
      { ...terms, places: [] },
      searchable,
      quiet,
    );
    expect(r.status).toBe('invalid');
    expect(f.calls).toHaveLength(0);
  });
});

describe('discardNewProfile', () => {
  it("deletes the user's draft row", async () => {
    const f = world();
    expect(await discardNewProfile(f.supabase, U, quiet)).toBe('discarded');
    const [del] = f.queries('profile_setup_drafts', 'delete');
    expect(del.filters).toContainEqual(['eq', 'userId', U]);
  });

  it('a delete error fails', async () => {
    const f = world({
      failOn: (c) =>
        c.action === 'delete'
          ? { data: null, error: { code: 'XX' } }
          : undefined,
    });
    expect(await discardNewProfile(f.supabase, U, quiet)).toBe('failed');
  });
});
