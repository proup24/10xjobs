import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Engagement, Seniority, SkillDomain } from 'src/common/enums';
import {
  ELIGIBILITY_REQUIRED,
  PROFILE_PUBLISHED,
  ProfilesService,
  toProfileView,
  toQuerySearchInput,
} from './profiles.service';
import { allPlaces } from './place-labels';
import {
  QUERY_SEARCH_RECIPE_VERSION,
  QuerySearchService,
  SKILLS_REQUIRED,
} from 'src/modules/queries';
import { FakeQuerySearchRepository } from 'src/modules/queries/testing/fakes';
import { FakeProfilesRepository, FakeUsersRepository } from '../testing/fakes';
import { UsersService } from './users.service';
import { PostSearchAccess } from './post-search-access';
import { Channel } from 'src/common/enums';
import type { ProfileInput, SkillInput } from '../types';

const profileInput: ProfileInput = {
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

const skill = (
  technology: SkillInput['technology'],
  mastery: number,
  importance = 5,
): SkillInput => ({
  technology,
  domain: SkillDomain.backend,
  mastery,
  importance,
});

describe('ProfilesService', () => {
  let userRows: FakeUsersRepository;
  let profiles: FakeProfilesRepository;
  let querySearches: FakeQuerySearchRepository;
  let service: ProfilesService;
  let listed: string[];
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    userRows = new FakeUsersRepository();
    const users = new UsersService(userRows);
    profiles = new FakeProfilesRepository();
    querySearches = new FakeQuerySearchRepository();
    service = new ProfilesService(
      users,
      profiles,
      new QuerySearchService(querySearches),
      { allows: (id: string) => listed.includes(id) } as PostSearchAccess,
    );
    userId = userRows.add('A').id;
    listed = [userId];
    otherUserId = userRows.add('B').id;
    for (const id of [userId, otherUserId])
      userRows.setEligibility(id, {
        residenceCountry: 'MA',
        acceptsSponsorship: false,
      });
  });

  /** Seeds a draft, as the web app's direct insert does. */
  const create = (techStack = [skill('nodejs', 8)]) =>
    profiles.add(userId, profileInput, techStack);

  it('passes the whole seniority set to query search', async () => {
    const { id } = await profiles.add(
      userId,
      { ...profileInput, seniorities: [Seniority.senior, Seniority.staff] },
      [skill('nodejs', 8)],
    );
    const profile = (await profiles.findById(userId, id))!;
    const input = toQuerySearchInput(
      profile,
      await profiles.placeLabels(allPlaces(toProfileView(profile).locations)),
    );
    expect(input.seniorities).toEqual([Seniority.senior, Seniority.staff]);
  });

  it('passes the spoken languages to query search as lowercased codes', async () => {
    const profile = await profiles.add(
      userId,
      {
        ...profileInput,
        languages: [
          { lang: 'fr', level: 'fluent' },
          { lang: 'EN', level: 'fluent' },
          { lang: 'fr', level: 'working' },
        ],
      },
      [skill('nodejs', 8)],
    );
    const input = toQuerySearchInput(profile, {
      regions: new Map([['MENA', 'Middle East and North Africa']]),
      countries: new Map([['MA', 'Morocco']]),
      cities: new Map(),
    });
    expect(input.languages).toEqual(['fr', 'en']);
  });

  it('passes the places to query search as their label texts', async () => {
    const profile = await profiles.add(
      userId,
      {
        ...profileInput,
        locations: {
          remote: [{ kind: 'region', code: 'MENA' }],
          hybrid: [],
          onsite: [{ kind: 'country', code: 'MA' }],
        },
      },
      [skill('nodejs', 8)],
    );
    const input = toQuerySearchInput(profile, {
      regions: new Map([['MENA', 'Middle East and North Africa']]),
      countries: new Map([['MA', 'Morocco']]),
      cities: new Map(),
    });
    expect(input.locations).toEqual({
      remote: ['Middle East and North Africa'],
      hybrid: [],
      onsite: ['Morocco'],
    });
  });

  it('sorts the stack by importance then mastery', async () => {
    const view = toProfileView(
      await create([skill('rust', 5, 2), skill('go', 5, 9)]),
    );
    expect(view.techStack.map((s) => s.technology)).toEqual(['go', 'rust']);
  });

  it('keeps an explicit importance of 0 and sorts it last', async () => {
    const view = toProfileView(
      await create([skill('rust', 9, 0), skill('go', 1, 1)]),
    );
    expect(view.techStack.map((s) => [s.technology, s.importance])).toEqual([
      ['go', 1],
      ['rust', 0],
    ]);
  });

  it('returns places, languages, contract types and salary in the API shape', async () => {
    const view = toProfileView(await create());
    expect(view).toMatchObject({
      locations: profileInput.locations,
      languages: profileInput.languages,
      contractTypes: ['full_time'],
      salary: { min: 4000, currency: 'EUR', period: 'month' },
    });
    for (const hidden of ['salaryMin', 'salaryCurrency', 'salaryPeriod'])
      expect(view).not.toHaveProperty(hidden);
  });

  it('views hide the storage key and sort equal importance by mastery', async () => {
    const stored = await create([
      skill('go', 9),
      skill('rust', 4),
      skill('java', 7),
    ]);
    const view = toProfileView({
      ...stored,
      resumeKey: 'u/p/secret.pdf',
      resumeFilename: 'cv.pdf',
      resumeSizeBytes: 10,
      resumeSha256: 'abc',
      resumeUploadedAt: new Date(0),
    });
    expect(view).not.toHaveProperty('resumeKey');
    expect(view.resume).toEqual({
      filename: 'cv.pdf',
      sizeBytes: 10,
      sha256: 'abc',
      uploadedAt: new Date(0),
    });
    expect(view.techStack.map((s) => s.technology)).toEqual([
      'go',
      'java',
      'rust',
    ]);
  });

  describe('publishing', () => {
    const stack = [skill('nodejs', 8), skill('go', 5)];

    it.each([
      [null, false],
      ['MA', null],
      [null, null],
    ])(
      'refuses to publish with residence %s and sponsorship %s, writing nothing',
      async (residenceCountry, acceptsSponsorship) => {
        const { id } = await create(stack);
        userRows.setEligibility(userId, {
          residenceCountry,
          acceptsSponsorship,
        });
        const publish = vi.spyOn(profiles, 'publish');
        const error = await service.publish(userId, id).catch((e) => e);
        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse()).toEqual({
          message: ELIGIBILITY_REQUIRED,
          code: 'ELIGIBILITY_REQUIRED',
        });
        expect(ELIGIBILITY_REQUIRED).toBe(
          'set your country of residence and answer the visa sponsorship question before publishing',
        );
        expect(publish).not.toHaveBeenCalled();
        expect(querySearches.links).toHaveLength(0);
        expect((await profiles.findById(userId, id))?.state).toBe('draft');
      },
    );

    it('publishes once eligibility is set, even when sponsorship is false', async () => {
      const { id } = await create(stack);
      userRows.setEligibility(userId, {
        residenceCountry: 'MA',
        acceptsSponsorship: false,
      });
      await expect(service.publish(userId, id)).resolves.toMatchObject({
        state: 'published',
      });
    });

    it('publishes once, attaching its query search builders', async () => {
      const { id } = await create(stack);
      const first = await service.publish(userId, id);
      expect(first.state).toBe('published');
      expect(first.publishedAt).toBeInstanceOf(Date);
      expect(first.querySearches.created).toBeGreaterThan(0);
      expect(querySearches.links.every((link) => link.profileId === id)).toBe(
        true,
      );
      const error = await service.publish(userId, id).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        message: PROFILE_PUBLISHED,
        code: 'PROFILE_PUBLISHED',
      });
      expect(querySearches.links).toHaveLength(first.querySearches.created);
    });

    it('404s publish when the user row is gone, like a missing profile', async () => {
      const { id } = await create(stack);
      userRows.rows = userRows.rows.filter((row) => row.id !== userId);
      const error = await service.publish(userId, id).catch((e) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Profile not found');
      const missing = await service
        .publish(otherUserId, 'missing')
        .catch((e) => e);
      expect(missing.getResponse()).toEqual(error.getResponse());
    });

    it('404s publish when the user row disappears after the profile lookup', async () => {
      const { id } = await create(stack);
      vi.spyOn(userRows, 'eligibility').mockResolvedValue(null);
      const error = await service.publish(userId, id).catch((e) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Profile not found');
    });

    it('publishes one profile without touching the other', async () => {
      const a = await create(stack);
      const b = await create(stack);
      await service.publish(userId, a.id);
      expect((await profiles.findById(userId, b.id))?.state).toBe('draft');
    });

    it('shares builders between profiles with the same recipes', async () => {
      const a = await create(stack);
      const b = await create(stack);
      await service.publish(userId, a.id);
      const second = await service.publish(userId, b.id);
      expect(second.querySearches.created).toBe(0);
      expect(
        querySearches.rows.every((row) => row.associatedProfiles === 2),
      ).toBe(true);
    });

    it('refuses to publish a profile whose skills all have importance 0, leaving it a draft', async () => {
      const { id } = await create([skill('go', 5, 0)]);
      await expect(service.publish(userId, id)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.publish(userId, id)).rejects.toThrow(
        SKILLS_REQUIRED,
      );
      expect((await profiles.findById(userId, id))?.state).toBe('draft');
      expect(querySearches.rows).toHaveLength(0);
    });

    it('stays a draft when generating query search builders fails', async () => {
      const { id } = await create(stack);
      vi.spyOn(querySearches, 'attach').mockRejectedValue(new Error('boom'));
      await expect(service.publish(userId, id)).rejects.toThrow('boom');
      expect((await profiles.findById(userId, id))?.state).toBe('draft');
    });
  });

  describe('regenerating to the current recipe', () => {
    /** Turns every builder into one from an older recipe, as after a version bump. */
    const ageBuilders = () => {
      for (const row of querySearches.rows) {
        row.version = QUERY_SEARCH_RECIPE_VERSION - 1;
        row.hash = `old-${row.hash}`;
      }
    };
    const linkedVersions = (profileId: string) =>
      querySearches.links
        .filter((link) => link.profileId === profileId)
        .map(
          (link) =>
            querySearches.rows.find((row) => row.id === link.queryId)?.version,
        );

    it('moves published profiles to current builders and retires the old ones', async () => {
      const { id } = await create();
      await service.publish(userId, id);
      ageBuilders();
      const old = querySearches.rows.length;

      const result = await service.regeneratePublished();

      expect(result).toEqual({ profiles: 1, retired: old });
      expect(new Set(linkedVersions(id))).toEqual(
        new Set([QUERY_SEARCH_RECIPE_VERSION]),
      );
      const outdated = querySearches.rows.filter(
        (row) => row.version < QUERY_SEARCH_RECIPE_VERSION,
      );
      expect(outdated).toHaveLength(old);
      expect(outdated.every((row) => row.isDeleted && !row.isActive)).toBe(
        true,
      );
    });

    it('changes nothing when run again', async () => {
      const { id } = await create();
      await service.publish(userId, id);
      ageBuilders();
      await service.regeneratePublished();
      const rows = querySearches.rows.length;
      const links = querySearches.links.length;

      expect(await service.regeneratePublished()).toEqual({
        profiles: 1,
        retired: 0,
      });
      expect(querySearches.rows).toHaveLength(rows);
      expect(querySearches.links).toHaveLength(links);
    });

    it('leaves drafts alone', async () => {
      const { id } = await create();
      expect(await service.regeneratePublished()).toEqual({
        profiles: 0,
        retired: 0,
      });
      expect(linkedVersions(id)).toEqual([]);
    });

    it('never retires an old builder something still uses', async () => {
      const { id } = await create();
      await service.publish(userId, id);
      ageBuilders();
      const kept = querySearches.rows[0];
      // A link the regeneration does not own, e.g. a profile mid-deletion.
      querySearches.links.push({ profileId: 'elsewhere', queryId: kept.id });
      kept.associatedProfiles += 1;

      await service.regeneratePublished();

      expect(kept).toMatchObject({ isActive: true, isDeleted: false });
    });
  });

  describe('post search switch', () => {
    const ownerInput: ProfileInput = {
      ...profileInput,
      position: 'fullstack_engineer',
      languages: [
        { lang: 'en', level: 'fluent' },
        { lang: 'fr', level: 'fluent' },
      ],
      locations: {
        remote: [{ kind: 'region', code: 'EMEA' }],
        hybrid: [{ kind: 'country', code: 'MA' }],
        onsite: [{ kind: 'country', code: 'MA' }],
      },
    };
    const ownerSkills = [
      'typescript',
      'nodejs',
      'react',
      'react_native',
      'nextjs',
      'nestjs',
      'aws',
      'postgresql',
    ].map((t) => ({
      technology: t,
      domain: SkillDomain.fullstack,
      mastery: 10,
      importance: 5,
    }));
    const createOwner = () => profiles.add(userId, ownerInput, ownerSkills);
    const linkedPosts = (id: string) =>
      querySearches.links.filter(
        (link) =>
          link.profileId === id &&
          querySearches.rows.find((row) => row.id === link.queryId)?.channel ===
            Channel.LINKEDIN_POSTS,
      );

    it('refuses a user who is not allow-listed', async () => {
      const { id } = await createOwner();
      listed = [];
      await expect(service.setPostSearch(userId, id, true)).rejects.toThrow(
        ForbiddenException,
      );
      expect((await profiles.findById(userId, id))?.postSearch).toBe(false);
      expect(querySearches.links).toHaveLength(0);
    });

    it('404s a profile that is not the callers before checking the list', async () => {
      const { id } = await createOwner();
      listed = [];
      await expect(
        service.setPostSearch(otherUserId, id, true),
      ).rejects.toThrow(NotFoundException);
    });

    it('attaches post builders when turned on for a published profile', async () => {
      const { id } = await createOwner();
      await service.publish(userId, id);
      expect(linkedPosts(id)).toHaveLength(0);
      await expect(service.setPostSearch(userId, id, true)).resolves.toEqual({
        enabled: true,
        allowed: true,
        searches: 4,
      });
      expect(linkedPosts(id)).toHaveLength(4);
      expect((await profiles.findById(userId, id))?.postSearch).toBe(true);
    });

    it('detaches only post builders when turned off', async () => {
      const { id } = await createOwner();
      await service.publish(userId, id);
      await service.setPostSearch(userId, id, true);
      const before = querySearches.links.length;
      await expect(service.setPostSearch(userId, id, false)).resolves.toEqual({
        enabled: false,
        allowed: true,
        searches: 4,
      });
      expect(linkedPosts(id)).toHaveLength(0);
      expect(querySearches.links.length).toBe(before - 4);
      expect(
        querySearches.links.filter((link) => link.profileId === id).length,
      ).toBeGreaterThan(0);
    });

    it('only stores the flag on a draft', async () => {
      const { id } = await createOwner();
      await service.setPostSearch(userId, id, true);
      expect((await profiles.findById(userId, id))?.postSearch).toBe(true);
      expect(querySearches.links).toHaveLength(0);
    });

    it('publishes with post builders when the switch is on', async () => {
      const { id } = await createOwner();
      await service.setPostSearch(userId, id, true);
      await service.publish(userId, id);
      expect(linkedPosts(id)).toHaveLength(4);
    });

    it('publishes without post builders when the owner is not listed', async () => {
      const { id } = await createOwner();
      await service.setPostSearch(userId, id, true);
      listed = [];
      await service.publish(userId, id);
      expect(linkedPosts(id)).toHaveLength(0);
    });

    it('regenerates without post builders for a user no longer listed', async () => {
      const { id } = await createOwner();
      await service.setPostSearch(userId, id, true);
      await service.publish(userId, id);
      expect(linkedPosts(id)).toHaveLength(4);
      await service.regeneratePublished();
      expect(linkedPosts(id)).toHaveLength(4);
      listed = [];
      await service.regeneratePublished();
      expect(linkedPosts(id)).toHaveLength(0);
      expect(
        querySearches.links.filter((link) => link.profileId === id).length,
      ).toBeGreaterThan(0);
    });

    it('reports how many searches the profile would get', async () => {
      const { id } = await createOwner();
      await expect(service.postSearchStatus(userId, id)).resolves.toEqual({
        enabled: false,
        allowed: true,
        searches: 4,
      });
      const english = await profiles.add(
        userId,
        {
          ...profileInput,
          locations: {
            remote: [],
            hybrid: [],
            onsite: [{ kind: 'country', code: 'MA' }],
          },
        },
        [skill('nodejs', 8)],
      );
      listed = [];
      await expect(
        service.postSearchStatus(userId, english.id),
      ).resolves.toEqual({ enabled: false, allowed: false, searches: 0 });
    });
  });
});
