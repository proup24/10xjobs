// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fakeSupabase, type QueryCall, type Reply } from '@/test/fake-supabase';
import {
  loadAbout,
  loadEligibility,
  loadResume,
  loadProfileSync,
  loadSetupProfile,
  loadSetupSnapshot,
} from './load';
import { nextSetupStep } from './next-step';
import { loadValueLists } from './value-lists';

const P = '22222222-2222-4222-8222-222222222222';
const Q = '33333333-3333-4333-8333-333333333333';
const CITY = '8f9c1a52-3b1e-4c7a-9d2e-1f0a2b3c4d5e';

function tables(rows: Record<string, unknown>) {
  return fakeSupabase({
    claims: { sub: 'u1', email: 'ada@example.com' },
    reply(call: QueryCall): Reply | undefined {
      if (!(call.table in rows)) return undefined;
      return { data: rows[call.table], error: null };
    },
  });
}

describe('loadSetupSnapshot', () => {
  it('reads the user and the draft while there is no profile', async () => {
    const f = tables({
      users: { name: 'Ada', residenceCountry: 'DE', acceptsSponsorship: true },
      profile_setup_drafts: { answers: { version: 1 } },
      profiles: [],
    });
    expect(await loadSetupSnapshot(f.supabase)).toEqual({
      name: 'Ada',
      residenceCountry: 'DE',
      acceptsSponsorship: true,
      draft: { version: 1 },
      profile: null,
    });
    const [profiles] = f.queries('profiles');
    expect(profiles.filters).toContainEqual([
      'order',
      'createdAt',
      { ascending: true },
    ]);
    expect(profiles.filters).toContainEqual([
      'order',
      'id',
      { ascending: true },
    ]);
    expect(profiles.filters).not.toContainEqual(['limit', 1]);
  });

  it('reads the oldest profile and ignores a stray draft once it exists', async () => {
    const f = tables({
      users: { name: 'Ada', residenceCountry: 'DE', acceptsSponsorship: true },
      profile_setup_drafts: { answers: { version: 1 } },
      profiles: [{ id: P, resumeKey: 'u1/p/x.pdf' }],
    });
    expect(await loadSetupSnapshot(f.supabase)).toEqual({
      name: 'Ada',
      residenceCountry: 'DE',
      acceptsSponsorship: true,
      draft: null,
      profile: { id: P, hasResume: true },
    });
  });

  it('picks the first profile with a resume, not the oldest', async () => {
    const f = tables({
      users: { name: 'Ada', residenceCountry: 'DE', acceptsSponsorship: true },
      profile_setup_drafts: null,
      profiles: [
        { id: P, resumeKey: null },
        { id: Q, resumeKey: 'u1/q/x.pdf' },
      ],
    });
    const snap = await loadSetupSnapshot(f.supabase);
    expect(snap.profile).toEqual({ id: Q, hasResume: true });
    expect(nextSetupStep(snap)).toBe('done');
  });

  it('falls back to the oldest profile when none has a resume', async () => {
    const f = tables({
      users: { name: 'Ada', residenceCountry: 'DE', acceptsSponsorship: true },
      profile_setup_drafts: null,
      profiles: [
        { id: P, resumeKey: null },
        { id: Q, resumeKey: null },
      ],
    });
    const snap = await loadSetupSnapshot(f.supabase);
    expect(snap.profile).toEqual({ id: P, hasResume: false });
    expect(nextSetupStep(snap)).toBe('resume');
  });

  it('never returns a v2 new-profile draft as the setup draft', async () => {
    const f = tables({
      users: { name: 'Ada', residenceCountry: 'DE', acceptsSponsorship: true },
      profile_setup_drafts: {
        answers: { version: 2, newProfileId: Q, copyFrom: null },
      },
      profiles: [],
    });
    const snap = await loadSetupSnapshot(f.supabase);
    expect(snap.draft).toBeNull();
    expect(nextSetupStep(snap)).toBe('job');
  });

  it('ignores a v2 draft once a profile exists, picking the profile as usual', async () => {
    const f = tables({
      users: { name: 'Ada', residenceCountry: 'DE', acceptsSponsorship: true },
      profile_setup_drafts: {
        answers: { version: 2, newProfileId: Q, copyFrom: null },
      },
      profiles: [
        { id: P, resumeKey: null },
        { id: Q, resumeKey: 'u1/q/x.pdf' },
      ],
    });
    const snap = await loadSetupSnapshot(f.supabase);
    expect(snap.draft).toBeNull();
    expect(snap.profile).toEqual({ id: Q, hasResume: true });
  });

  it('ignores an unparseable draft', async () => {
    const f = tables({
      users: { name: 'Ada', residenceCountry: null, acceptsSponsorship: null },
      profile_setup_drafts: { answers: { version: 99, job: 'nope' } },
      profiles: [],
    });
    expect(await loadSetupSnapshot(f.supabase)).toEqual({
      name: 'Ada',
      residenceCountry: null,
      acceptsSponsorship: null,
      draft: null,
      profile: null,
    });
  });

  it('throws on a read error, naming only the code', async () => {
    const f = fakeSupabase({
      reply: (c) =>
        c.table === 'users'
          ? { data: null, error: { code: '42501', message: 'secret Ada' } }
          : undefined,
    });
    await expect(loadSetupSnapshot(f.supabase)).rejects.toThrow(/code=42501$/);
  });
});

describe('loadEligibility', () => {
  it('returns noneConfirmed when saved with no authorizations', async () => {
    const f = tables({
      users: { residenceCountry: 'DE', acceptsSponsorship: false },
      work_authorizations: [],
    });
    expect(await loadEligibility(f.supabase)).toEqual({
      residenceCountry: 'DE',
      acceptsSponsorship: false,
      authorizations: [],
      noneConfirmed: true,
    });
  });

  it('returns the authorizations without the tick', async () => {
    const f = tables({
      users: { residenceCountry: 'DE', acceptsSponsorship: true },
      work_authorizations: [{ kind: 'citizenship', place: 'DE' }],
    });
    expect(await loadEligibility(f.supabase)).toEqual({
      residenceCountry: 'DE',
      acceptsSponsorship: true,
      authorizations: [{ kind: 'citizenship', place: 'DE' }],
      noneConfirmed: false,
    });
  });

  it('is null until step 2 was saved', async () => {
    const f = tables({
      users: { residenceCountry: null, acceptsSponsorship: null },
    });
    expect(await loadEligibility(f.supabase)).toBeNull();
  });
});

describe('loadAbout', () => {
  it('maps contacts back to phone, LinkedIn and links, with the claims email', async () => {
    const f = tables({
      users: { name: 'Ada' },
      contacts: [
        { kind: 'email', value: 'other@example.com' },
        { kind: 'phone', value: '+44 1' },
        { kind: 'linkedin', value: 'https://linkedin.com/in/ada' },
        { kind: 'github', value: 'https://github.com/ada' },
        { kind: 'website', value: 'https://ada.dev' },
      ],
    });
    expect(await loadAbout(f.supabase)).toEqual({
      email: 'ada@example.com',
      answers: {
        name: 'Ada',
        phone: '+44 1',
        linkedin: 'https://linkedin.com/in/ada',
        links: [
          { kind: 'github', value: 'https://github.com/ada' },
          { kind: 'website', value: 'https://ada.dev' },
        ],
      },
    });
  });

  it('starts empty for a new user', async () => {
    const f = tables({ users: { name: null }, contacts: [] });
    expect((await loadAbout(f.supabase)).answers).toEqual({
      name: '',
      phone: null,
      linkedin: null,
      links: [],
    });
  });
});

describe('loadSetupProfile', () => {
  it('is null when the profile is not found', async () => {
    const f = tables({ profiles: null });
    expect(await loadSetupProfile(f.supabase, P)).toBeNull();
    expect(f.queries('profile_skills')).toHaveLength(0);
  });
});

describe('loadResume', () => {
  it('reads the stored file name and size', async () => {
    const f = tables({
      profiles: {
        resumeKey: 'u1/p/x.pdf',
        resumeFilename: 'cv.pdf',
        resumeSizeBytes: 1234,
      },
    });
    expect(await loadResume(f.supabase, P)).toEqual({
      filename: 'cv.pdf',
      sizeBytes: 1234,
    });
    const [profiles] = f.queries('profiles');
    expect(profiles.filters).toContainEqual(['eq', 'id', P]);
  });

  it('is null without a resume', async () => {
    const f = tables({
      profiles: {
        resumeKey: null,
        resumeFilename: null,
        resumeSizeBytes: null,
      },
    });
    expect(await loadResume(f.supabase, P)).toBeNull();
  });
});

describe('loadValueLists', () => {
  it('builds picker options with aliases, labels and the documented exclusions', async () => {
    const f = tables({
      role_kinds: [
        {
          code: 'frontend_engineer',
          label: 'Frontend engineer',
          aliases: ['FE'],
        },
      ],
      seniorities: [
        { code: 'senior', label: 'Senior', aliases: [] },
        { code: 'unstated', label: 'Unstated', aliases: [] },
        { code: 'junior', label: 'Junior', aliases: [] },
      ],
      contract_types: [
        { code: 'permanent', label: 'Permanent', aliases: [] },
        { code: 'unstated', label: 'Unstated', aliases: [] },
      ],
      engagements: [
        { code: 'unstated', label: 'Unstated', aliases: [] },
        { code: 'employee', label: 'Employee', aliases: [] },
      ],
      tech_tags: [
        { code: 'typescript', label: 'TypeScript', aliases: ['ts'] },
        { code: 'saas', label: 'SaaS', aliases: [] },
      ],
      iso_languages: [{ code: 'en', label: 'English' }],
      iso_currencies: [{ code: 'EUR', label: 'Euro' }],
      countries: [{ code: 'DE', label: 'Germany', aliases: ['Deutschland'] }],
      regions: [
        { code: 'GLOBAL', label: 'Global', aliases: [] },
        { code: 'EU', label: 'European Union', aliases: [] },
      ],
      cities: [
        { id: CITY, name: 'Berlin', countryCode: 'DE', aliases: ['Berlín'] },
      ],
    });
    const lists = await loadValueLists(f.supabase);
    expect(lists.positions).toEqual([
      {
        value: 'frontend_engineer',
        label: 'Frontend engineer',
        keywords: ['FE'],
      },
    ]);
    expect(lists.seniorities.map((o) => o.value)).toEqual(['junior', 'senior']);
    expect(lists.contractTypes.map((o) => o.value)).toEqual(['permanent']);
    expect(lists.engagements.map((o) => o.value)).toEqual(['employee']);
    expect(lists.techs).toEqual([
      { value: 'saas', label: 'SaaS', keywords: [], searchable: false },
      {
        value: 'typescript',
        label: 'TypeScript',
        keywords: ['ts'],
        searchable: true,
      },
    ]);
    expect(lists.languages).toEqual([{ value: 'en', label: 'English' }]);
    expect(lists.currencies).toEqual([{ value: 'EUR', label: 'Euro' }]);
    expect(lists.regions.map((o) => o.value)).toEqual(['EU']);
    expect(lists.cities).toEqual([
      { value: CITY, label: 'Berlin, Germany', keywords: ['Berlín'] },
    ]);

    const [roles] = f.queries('role_kinds');
    expect(roles.filters).toContainEqual(['eq', 'isEngineering', true]);
  });

  it('marks the new tags searchable', async () => {
    const f = tables({
      tech_tags: [
        { code: 'claude_code', label: 'Claude Code', aliases: [] },
        { code: 'seo', label: 'SEO', aliases: [] },
      ],
    });
    const lists = await loadValueLists(f.supabase);
    expect(
      Object.fromEntries(lists.techs.map((t) => [t.value, t.searchable])),
    ).toEqual({ claude_code: true, seo: false });
  });

  it('never filters on the hidden status column (the read policies return approved rows only)', async () => {
    const f = fakeSupabase();
    await loadValueLists(f.supabase);
    const tables = [
      'role_kinds',
      'seniorities',
      'contract_types',
      'engagements',
      'tech_tags',
      'countries',
      'regions',
      'cities',
    ];
    for (const table of tables) {
      expect(f.queries(table).length).toBeGreaterThan(0);
      for (const call of f.queries(table)) {
        expect(call.filters.some((x) => x[1] === 'status')).toBe(false);
      }
    }
  });

  it('pages past the row limit', async () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({
      code: `t${i}`,
      label: `T${i}`,
      aliases: [],
    }));
    let page = 0;
    const f = fakeSupabase({
      reply(call) {
        if (call.table !== 'tech_tags') return undefined;
        page += 1;
        return {
          data: page === 1 ? big : [{ code: 'z', label: 'Z', aliases: [] }],
          error: null,
        };
      },
    });
    const lists = await loadValueLists(f.supabase);
    expect(lists.techs).toHaveLength(1001);
    expect(f.queries('tech_tags').map((c) => c.filters.at(-1))).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
    ]);
  });
});

describe('loadProfileSync', () => {
  const row = (searchesVersion: number | null, state = 'published') =>
    tables({ profiles: { state, matchVersion: 3, searchesVersion } });

  it('is applying while searches are null or behind', async () => {
    expect(await loadProfileSync(row(null).supabase, P)).toEqual({
      published: true,
      applying: true,
    });
    expect(await loadProfileSync(row(2).supabase, P)).toEqual({
      published: true,
      applying: true,
    });
  });

  it('is not applying once searches caught up, and reports drafts', async () => {
    expect(await loadProfileSync(row(3).supabase, P)).toEqual({
      published: true,
      applying: false,
    });
    expect(
      (await loadProfileSync(row(3, 'draft').supabase, P))?.published,
    ).toBe(false);
  });

  it('is null when the profile is not found', async () => {
    expect(
      await loadProfileSync(tables({ profiles: null }).supabase, P),
    ).toBeNull();
  });
});
