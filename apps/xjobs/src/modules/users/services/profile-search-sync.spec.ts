import { Channel, Engagement, Seniority, SkillDomain } from 'src/common/enums';
import { QuerySearchService } from 'src/modules/queries';
import { FakeQuerySearchRepository } from 'src/modules/queries/testing/fakes';
import { FakeProfilesRepository } from '../testing/fakes';
import type { ProfileInput } from '../types';
import { ProfileSearchSync } from './profile-search-sync';

const input: ProfileInput = {
  position: 'backend_engineer',
  languages: [{ lang: 'en', level: 'fluent' }],
  locations: {
    remote: [{ kind: 'region', code: 'MENA' }],
    hybrid: [],
    onsite: [],
  },
  yearsOfExperience: 6,
  timezoneCurrent: 60,
  timezoneMin: -240,
  timezoneMax: 240,
  engagements: [Engagement.employee],
  seniorities: [Seniority.senior],
  contractTypes: ['full_time'],
  salary: { min: 4000, currency: 'EUR', period: 'month' },
  acceptsAnyCurrency: false,
  acceptedCurrencies: ['EUR'],
  noticePeriodDays: 30,
};
const stack = [
  {
    technology: 'nodejs' as const,
    domain: SkillDomain.backend,
    mastery: 8,
    importance: 5,
  },
];

describe('ProfileSearchSync', () => {
  let profiles: FakeProfilesRepository;
  let builders: FakeQuerySearchRepository;
  let sync: ProfileSearchSync;
  let querySearch: QuerySearchService;
  let replaceSpy: ReturnType<typeof spyReplace>;
  const spyReplace = (b: FakeQuerySearchRepository) => vi.spyOn(b, 'replace');

  beforeEach(() => {
    profiles = new FakeProfilesRepository();
    builders = new FakeQuerySearchRepository();
    querySearch = new QuerySearchService(builders);
    sync = new ProfileSearchSync(profiles, querySearch);
    // The real swap writes searchesVersion on the profile row itself.
    const replace = builders.replace.bind(builders);
    replaceSpy = spyReplace(builders);
    replaceSpy.mockImplementation(async (id, r, expected) => {
      const result = await replace(id, r, expected);
      const row = profiles.rows.find((p) => p.id === id);
      if (row && !result.skipped)
        row.searchesVersion = expected.searchesVersion;
      return result;
    });
  });

  const published = async (
    matchVersion: number,
    searchesVersion: number | null,
    userId = 'user-1',
  ) => {
    const profile = await profiles.add(userId, input, stack);
    Object.assign(profile, {
      state: 'published',
      matchVersion,
      searchesVersion,
    });
    builders.published.add(profile.id);
    return profile;
  };

  it('applies a profile whose searches are behind', async () => {
    const profile = await published(2, 1);
    await expect(sync.applyPending()).resolves.toEqual({
      applied: 1,
      failed: 0,
      skipped: 0,
    });
    expect(replaceSpy).toHaveBeenCalledWith(profile.id, expect.any(Array), {
      searchesVersion: 2,
      switches: { postSearch: false, indeedSearch: false },
    });
    expect(profile.searchesVersion).toBe(2);
  });

  it('skips a profile that is up to date', async () => {
    await published(2, 2);
    await expect(sync.applyPending()).resolves.toEqual({
      applied: 0,
      failed: 0,
      skipped: 0,
    });
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('applies a published profile with no searchesVersion yet', async () => {
    await published(0, null);
    expect(await sync.applyPending()).toEqual({
      applied: 1,
      failed: 0,
      skipped: 0,
    });
  });

  it('reapplies when the version moved during a swap', async () => {
    const profile = await published(2, 1);
    const replace = replaceSpy.getMockImplementation()!;
    replaceSpy.mockImplementationOnce(async (id, r, expected) => {
      profile.matchVersion = 3;
      return replace(id, r, expected);
    });
    await sync.applyPending();
    expect(profile.searchesVersion).toBe(2);
    await sync.applyPending();
    expect(profile.searchesVersion).toBe(3);
  });

  it('keeps going after one profile fails', async () => {
    const first = await published(1, null);
    const second = await published(1, null);
    const labels = vi.spyOn(profiles, 'placeLabels');
    labels.mockRejectedValueOnce(new Error('boom'));
    await expect(sync.applyPending()).resolves.toEqual({
      applied: 1,
      failed: 1,
      skipped: 0,
    });
    expect(first.searchesVersion).toBeNull();
    expect(second.searchesVersion).toBe(1);
  });

  it('does not release every search when a profile builds none', async () => {
    const profile = await published(1, null);
    vi.spyOn(querySearch, 'recipesFor').mockReturnValue([]);
    await expect(sync.applyPending()).resolves.toEqual({
      applied: 0,
      failed: 1,
      skipped: 0,
    });
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(profile.searchesVersion).toBeNull();
  });

  it('counts a profile with no skills as failed, its searches untouched', async () => {
    const profile = await published(1, null);
    profile.techStack = [];
    await expect(sync.applyPending()).resolves.toEqual({
      applied: 0,
      failed: 1,
      skipped: 0,
    });
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(profile.searchesVersion).toBeNull();
  });

  it('counts a swap skipped for a moved switch as skipped, not applied', async () => {
    const profile = await published(1, null);
    // The switch was turned on after the sync read the profile.
    builders.switches.set(profile.id, {
      postSearch: true,
      indeedSearch: false,
    });
    await expect(sync.applyPending()).resolves.toEqual({
      applied: 0,
      failed: 0,
      skipped: 1,
    });
    expect(profile.searchesVersion).toBeNull();
    expect(builders.links).toHaveLength(0);
  });

  it('still applies a good profile behind a run of failing ones', async () => {
    for (let i = 0; i < 20; i++) {
      const profile = await published(1, null);
      profile.updatedAt = new Date(2026, 0, 1, 0, i);
    }
    const good = await published(1, null);
    good.updatedAt = new Date(2026, 0, 2);
    // The 20 oldest fail before their swap (on their labels); the last succeeds.
    const labels = vi.spyOn(profiles, 'placeLabels');
    for (let i = 0; i < 20; i++)
      labels.mockRejectedValueOnce(new Error('boom'));
    await expect(sync.applyPending()).resolves.toEqual({
      applied: 1,
      failed: 20,
      skipped: 0,
    });
    expect(good.searchesVersion).toBe(1);
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('stops after `limit` swaps and reads at most ten times the limit', async () => {
    for (let i = 0; i < 5; i++) await published(1, null);
    const read = vi.spyOn(profiles, 'listSearchesBehind');
    await expect(sync.applyPending(2)).resolves.toEqual({
      applied: 2,
      failed: 0,
      skipped: 0,
    });
    expect(read).toHaveBeenCalledWith(20);
    expect(replaceSpy).toHaveBeenCalledTimes(2);
  });

  const channelsOf = (id: string) =>
    replaceSpy.mock.calls
      .find(([profileId]) => profileId === id)![1]
      .map((recipe) => recipe.channel);

  it('keeps post recipes for a hidden switch that is on', async () => {
    // Post search is unavailable, and no allow-list exists: the flag alone counts.
    const profile = await published(1, null, 'anyone');
    profile.postSearch = true;
    builders.switches.set(profile.id, {
      postSearch: true,
      indeedSearch: false,
    });
    await expect(sync.applyPending()).resolves.toMatchObject({ applied: 1 });
    expect(channelsOf(profile.id)).toContain(Channel.LINKEDIN_POSTS);
    expect(replaceSpy).toHaveBeenCalledWith(profile.id, expect.any(Array), {
      searchesVersion: 1,
      switches: { postSearch: true, indeedSearch: false },
    });
  });

  it('builds no post recipes with the switch off', async () => {
    const profile = await published(1, null);
    await sync.applyPending();
    expect(channelsOf(profile.id)).not.toContain(Channel.LINKEDIN_POSTS);
  });

  it('adds nothing for an Indeed flag set in the database (no recipes yet)', async () => {
    const off = await published(1, null);
    const on = await published(1, null);
    on.indeedSearch = true;
    builders.switches.set(on.id, { postSearch: false, indeedSearch: true });
    await expect(sync.applyPending()).resolves.toMatchObject({ applied: 2 });
    expect(replaceSpy.mock.calls.find(([id]) => id === on.id)![2]).toEqual({
      searchesVersion: 1,
      switches: { postSearch: false, indeedSearch: true },
    });
    const hashes = (id: string) =>
      replaceSpy.mock.calls
        .find(([profileId]) => profileId === id)![1]
        .map((recipe) => recipe.hash);
    expect(hashes(on.id)).toEqual(hashes(off.id));
  });
});
