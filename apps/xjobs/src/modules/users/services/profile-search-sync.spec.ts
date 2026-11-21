import { Channel, Engagement, Seniority, SkillDomain } from 'src/common/enums';
import { QuerySearchService } from 'src/modules/queries';
import { FakeQuerySearchRepository } from 'src/modules/queries/testing/fakes';
import { FakeProfilesRepository } from '../testing/fakes';
import type { ProfileInput } from '../types';
import { PostSearchAccess } from './post-search-access';
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
  let allowed: string[];
  let sync: ProfileSearchSync;
  let replaceSpy: ReturnType<typeof spyReplace>;
  const spyReplace = (b: FakeQuerySearchRepository) => vi.spyOn(b, 'replace');

  beforeEach(() => {
    profiles = new FakeProfilesRepository();
    builders = new FakeQuerySearchRepository();
    allowed = [];
    sync = new ProfileSearchSync(profiles, new QuerySearchService(builders), {
      allows: (id: string) => allowed.includes(id),
    } as PostSearchAccess);
    // The real swap writes searchesVersion on the profile row itself.
    const replace = builders.replace.bind(builders);
    replaceSpy = spyReplace(builders);
    replaceSpy.mockImplementation(async (id, r, v) => {
      const result = await replace(id, r, v);
      const row = profiles.rows.find((p) => p.id === id);
      if (row) row.searchesVersion = v;
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
    });
    expect(replaceSpy).toHaveBeenCalledWith(profile.id, expect.any(Array), 2);
    expect(profile.searchesVersion).toBe(2);
  });

  it('skips a profile that is up to date', async () => {
    await published(2, 2);
    await expect(sync.applyPending()).resolves.toEqual({
      applied: 0,
      failed: 0,
    });
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('applies a published profile with no searchesVersion yet', async () => {
    await published(0, null);
    expect(await sync.applyPending()).toEqual({ applied: 1, failed: 0 });
  });

  it('reapplies when the version moved during a swap', async () => {
    const profile = await published(2, 1);
    const replace = replaceSpy.getMockImplementation()!;
    replaceSpy.mockImplementationOnce(async (id, r, v) => {
      profile.matchVersion = 3;
      return replace(id, r, v);
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
    });
    expect(first.searchesVersion).toBeNull();
    expect(second.searchesVersion).toBe(1);
  });

  it('does not release every search when a profile builds none', async () => {
    const profile = await published(1, null);
    profile.techStack = [];
    await expect(sync.applyPending()).resolves.toEqual({
      applied: 0,
      failed: 1,
    });
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(profile.searchesVersion).toBeNull();
  });

  it('drops post builders for an owner not allowed', async () => {
    const mine = await published(1, null, 'user-1');
    const theirs = await published(1, null, 'user-2');
    mine.postSearch = true;
    theirs.postSearch = true;
    allowed = ['user-1'];
    await sync.applyPending();
    const channelsOf = (id: string) =>
      replaceSpy.mock.calls
        .find(([profileId]) => profileId === id)![1]
        .map((recipe) => recipe.channel);
    expect(channelsOf(mine.id)).toContain(Channel.LINKEDIN_POSTS);
    expect(channelsOf(theirs.id)).not.toContain(Channel.LINKEDIN_POSTS);
  });
});
