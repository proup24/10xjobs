import {
  BadRequestException,
  ConflictException,
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

/** What the code-check trigger raises for a code outside its value list. */
const checkViolation = () =>
  Object.assign(
    new Error(
      "profiles.position: 'support' is not an approved role_kinds code",
    ),
    { sqlState: '23514' },
  );

/** What a replacement may send: everything but the position. */
const { position: _position, ...editable } = profileInput;

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
    );
    userId = userRows.add('A').id;
    otherUserId = userRows.add('B').id;
    for (const id of [userId, otherUserId])
      await userRows.update(id, {
        residenceCountry: 'MA',
        acceptsSponsorship: false,
      });
  });

  const create = (techStack = [skill('nodejs', 8)]) =>
    service.create(userId, { ...profileInput, techStack });

  it('creates a draft profile with its tech stack', async () => {
    const view = await create();
    expect(view).toMatchObject({
      userId,
      seniorities: ['senior'],
      state: 'draft',
      publishedAt: null,
    });
    expect(view.techStack).toEqual([
      {
        technology: 'nodejs',
        domain: 'backend',
        mastery: 8,
        importance: 5,
      },
    ]);
  });

  it('stores seniorities deduped, in enum order', async () => {
    const view = await service.create(userId, {
      ...profileInput,
      seniorities: [Seniority.staff, Seniority.senior, Seniority.staff],
      techStack: [skill('nodejs', 8)],
    });
    expect(view.seniorities).toEqual([Seniority.senior, Seniority.staff]);
    const row = await profiles.findById(userId, view.id);
    expect(row?.seniorities).toEqual([Seniority.senior, Seniority.staff]);
  });

  it('replaces the seniority set rather than merging it', async () => {
    const { id } = await create();
    const view = await service.replace(userId, id, {
      ...editable,
      seniorities: [Seniority.lead],
      techStack: [],
    });
    expect(view.seniorities).toEqual([Seniority.lead]);
  });

  it('passes the whole seniority set to query search', async () => {
    const { id } = await service.create(userId, {
      ...profileInput,
      seniorities: [Seniority.senior, Seniority.staff],
      techStack: [skill('nodejs', 8)],
    });
    const profile = (await profiles.findById(userId, id))!;
    const input = toQuerySearchInput(
      profile,
      await profiles.placeLabels(allPlaces(toProfileView(profile).locations)),
    );
    expect(input.seniorities).toEqual([Seniority.senior, Seniority.staff]);
  });

  it('passes the places to query search as their label texts', async () => {
    await service.create(userId, {
      ...profileInput,
      locations: {
        remote: [{ kind: 'region', code: 'MENA' }],
        hybrid: [],
        onsite: [{ kind: 'country', code: 'MA' }],
      },
      techStack: [skill('nodejs', 8)],
    });
    const [profile] = await profiles.list(userId);
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

  it('stores places, spoken languages, contract types, salary and currencies, and returns them in the API shape', async () => {
    const view = await create();
    expect(view).toMatchObject({
      locations: profileInput.locations,
      languages: profileInput.languages,
      contractTypes: ['full_time'],
      salary: { min: 4000, currency: 'EUR', period: 'month' },
      acceptsAnyCurrency: false,
      acceptedCurrencies: ['EUR'],
    });
    const row = await profiles.findById(userId, view.id);
    expect(row).toMatchObject({
      locations: profileInput.locations,
      languages: profileInput.languages,
      contractTypes: ['full_time'],
      salaryMin: 4000,
      salaryCurrency: 'EUR',
      salaryPeriod: 'month',
      acceptsAnyCurrency: false,
      acceptedCurrencies: ['EUR'],
    });
    for (const hidden of ['salaryMin', 'salaryCurrency', 'salaryPeriod']) {
      expect(view).not.toHaveProperty(hidden);
    }
  });

  it('stores no salary when the write leaves it out', async () => {
    const view = await service.create(userId, {
      ...profileInput,
      salary: undefined,
      techStack: [],
    });
    expect(view.salary).toBeNull();
    const row = await profiles.findById(userId, view.id);
    expect(row).toMatchObject({
      salaryMin: null,
      salaryCurrency: null,
      salaryPeriod: null,
    });
  });

  it('replaces the new fields too', async () => {
    const { id } = await create();
    const view = await service.replace(userId, id, {
      ...editable,
      locations: { remote: [], hybrid: [], onsite: [{ kind: 'worldwide' }] },
      languages: [{ lang: 'ar', level: 'native' }],
      contractTypes: ['freelance'],
      salary: null,
      acceptsAnyCurrency: true,
      acceptedCurrencies: [],
      techStack: [],
    });
    expect(view).toMatchObject({
      locations: { remote: [], hybrid: [], onsite: [{ kind: 'worldwide' }] },
      languages: [{ lang: 'ar', level: 'native' }],
      contractTypes: ['freelance'],
      salary: null,
      acceptsAnyCurrency: true,
      acceptedCurrencies: [],
    });
  });

  it('keeps seniority codes it does not know, for the database to refuse', async () => {
    const view = await service.create(userId, {
      ...profileInput,
      seniorities: ['wizard', Seniority.staff, Seniority.senior],
      techStack: [],
    });
    expect(view.seniorities).toEqual([
      Seniority.senior,
      Seniority.staff,
      'wizard',
    ]);
  });

  it('turns a database code check into a 400 with its message on create', async () => {
    vi.spyOn(profiles, 'create').mockRejectedValue(checkViolation());
    await expect(create()).rejects.toThrow(
      new BadRequestException(
        "profiles.position: 'support' is not an approved role_kinds code",
      ),
    );
  });

  it('turns a database code check into a 400 with its message on replace', async () => {
    const { id } = await create();
    vi.spyOn(profiles, 'replace').mockRejectedValue(
      new Error('query failed', { cause: checkViolation() }),
    );
    await expect(
      service.replace(userId, id, { ...editable, techStack: [] }),
    ).rejects.toThrow(
      new BadRequestException(
        "profiles.position: 'support' is not an approved role_kinds code",
      ),
    );
  });

  it('lets other database errors through unchanged', async () => {
    const error = Object.assign(new Error('fk'), { sqlState: '23503' });
    vi.spyOn(profiles, 'create').mockRejectedValue(error);
    await expect(create()).rejects.toBe(error);
  });

  it('lets one user keep several independent profiles', async () => {
    const backend = await create([skill('go', 8)]);
    const frontend = await service.create(userId, {
      ...profileInput,
      position: 'frontend_engineer',
      techStack: [skill('react', 7)],
    });
    expect(frontend.id).not.toBe(backend.id);
    const listed = await service.list(userId);
    expect(listed.map((p) => p.id)).toEqual([backend.id, frontend.id]);
    expect((await service.get(userId, backend.id)).techStack).toEqual([
      expect.objectContaining({ technology: 'go' }),
    ]);
    expect(await service.list(otherUserId)).toEqual([]);
  });

  it("404s every operation on another user's profile and changes nothing", async () => {
    const { id } = await create();
    const input = { ...editable, techStack: [] };
    for (const attempt of [
      () => service.get(otherUserId, id),
      () => service.replace(otherUserId, id, input),
      () => service.publish(otherUserId, id),
      () => service.delete(otherUserId, id),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(await service.get(userId, id)).toMatchObject({
      state: 'draft',
      techStack: [expect.objectContaining({ technology: 'nodejs' })],
    });
    expect(querySearches.rows).toHaveLength(0);
  });

  it('replaces the whole tech stack and keeps the profile id', async () => {
    const first = await create();
    const second = await service.replace(userId, first.id, {
      ...editable,
      techStack: [skill('go', 5), skill('rust', 3)],
    });
    expect(second.id).toBe(first.id);
    expect(second.techStack.map((s) => s.technology)).toEqual(['go', 'rust']);
  });

  it('never changes the position on replace, even if a caller sends one', async () => {
    const { id } = await create();
    const sneaky = {
      ...editable,
      noticePeriodDays: 60,
      position: 'ml_engineer',
      techStack: [],
    };
    const view = await service.replace(userId, id, sneaky);
    expect(view).toMatchObject({
      position: 'backend_engineer',
      noticePeriodDays: 60,
    });
    expect((await profiles.findById(userId, id))?.position).toBe(
      'backend_engineer',
    );
  });

  it('changes position only by deleting the profile and creating another', async () => {
    const backend = await create();
    await service.delete(userId, backend.id);
    const ml = await service.create(userId, {
      ...profileInput,
      position: 'ml_engineer',
      techStack: [],
    });
    expect((await service.list(userId)).map((p) => p.position)).toEqual([
      'ml_engineer',
    ]);
    expect(ml.id).not.toBe(backend.id);
  });

  it('deletes only the named profile', async () => {
    const a = await create();
    const b = await create();
    await service.delete(userId, a.id);
    expect((await service.list(userId)).map((p) => p.id)).toEqual([b.id]);
  });

  it('stores importance 5 when a write omits it', async () => {
    const { importance: _omitted, ...withoutImportance } = skill('go', 5);
    const view = await service.create(userId, {
      ...profileInput,
      techStack: [withoutImportance],
    });
    expect(view.techStack[0].importance).toBe(5);
  });

  it('sorts the stack by importance then mastery', async () => {
    const view = await create([skill('rust', 5, 2), skill('go', 5, 9)]);
    expect(view.techStack.map((s) => s.technology)).toEqual(['go', 'rust']);
  });

  it('keeps an explicit importance of 0 and sorts it last', async () => {
    const view = await create([skill('rust', 9, 0), skill('go', 1, 1)]);
    expect(view.techStack.map((s) => [s.technology, s.importance])).toEqual([
      ['go', 1],
      ['rust', 0],
    ]);
  });

  it('404s an unknown profile', async () => {
    await expect(service.get(userId, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s an unknown user', async () => {
    await expect(
      service.create('missing', { ...profileInput, techStack: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.list('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('views hide the storage key and sort equal importance by mastery', async () => {
    const { id } = await create([
      skill('go', 9),
      skill('rust', 4),
      skill('java', 7),
    ]);
    const stored = await profiles.findById(userId, id);
    if (!stored) throw new Error('profile was not stored');
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
        await userRows.update(userId, { residenceCountry, acceptsSponsorship });
        const publish = vi.spyOn(profiles, 'publish');
        await expect(service.publish(userId, id)).rejects.toThrow(
          new ConflictException(ELIGIBILITY_REQUIRED),
        );
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
      await userRows.update(userId, {
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
      await expect(service.publish(userId, id)).rejects.toThrow(
        new ConflictException(PROFILE_PUBLISHED),
      );
      expect(querySearches.links).toHaveLength(first.querySearches.created);
    });

    it('freezes a published profile: replacing it is a 409 and changes nothing', async () => {
      const { id } = await create(stack);
      await service.publish(userId, id);
      await expect(
        service.replace(userId, id, {
          ...editable,
          noticePeriodDays: 90,
          techStack: [],
        }),
      ).rejects.toThrow(new ConflictException(PROFILE_PUBLISHED));
      expect(await service.get(userId, id)).toMatchObject({
        state: 'published',
        noticePeriodDays: profileInput.noticePeriodDays,
        techStack: [
          expect.objectContaining({ technology: 'nodejs' }),
          expect.objectContaining({ technology: 'go' }),
        ],
      });
    });

    it('still 404s a missing profile before any 409', async () => {
      await expect(
        service.replace(userId, 'missing', { ...editable, techStack: [] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.publish(userId, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('publishes one profile without touching the other', async () => {
      const a = await create(stack);
      const b = await create(stack);
      await service.publish(userId, a.id);
      expect((await service.get(userId, b.id)).state).toBe('draft');
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

    it('deleting a published profile takes one associated profile off each shared builder, down to 0', async () => {
      const a = await create(stack);
      const b = await create(stack);
      await service.publish(userId, a.id);
      await service.publish(userId, b.id);
      const total = querySearches.rows.length;

      await service.delete(userId, a.id);
      expect(
        querySearches.rows.every(
          (row) => row.associatedProfiles === 1 && row.isActive,
        ),
      ).toBe(true);

      await service.delete(userId, b.id);
      expect(
        querySearches.rows.every(
          (row) => row.associatedProfiles === 0 && !row.isActive,
        ),
      ).toBe(true);
      // The shared rows stay, with their job hits; only the associations go.
      expect(querySearches.rows).toHaveLength(total);
      expect(querySearches.links).toHaveLength(0);
    });

    it('deleting a draft leaves shared builder counts alone', async () => {
      const published = await create(stack);
      const draft = await create(stack);
      await service.publish(userId, published.id);
      await service.delete(userId, draft.id);
      expect(
        querySearches.rows.every((row) => row.associatedProfiles === 1),
      ).toBe(true);
    });

    it('releases every profile of a user before the user goes', async () => {
      const a = await create(stack);
      await service.publish(userId, a.id);
      await service.releaseAll(userId);
      expect(querySearches.links).toHaveLength(0);
      expect(querySearches.rows.some((row) => row.isActive)).toBe(false);
    });

    it('refuses to publish a profile whose skills all have importance 0, leaving it a draft', async () => {
      const { id } = await create([skill('go', 5, 0)]);
      await expect(service.publish(userId, id)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.publish(userId, id)).rejects.toThrow(
        SKILLS_REQUIRED,
      );
      expect((await service.get(userId, id)).state).toBe('draft');
      expect(querySearches.rows).toHaveLength(0);
    });

    it('stays a draft when generating query search builders fails', async () => {
      const { id } = await create(stack);
      vi.spyOn(querySearches, 'attach').mockRejectedValue(new Error('boom'));
      await expect(service.publish(userId, id)).rejects.toThrow('boom');
      expect((await service.get(userId, id)).state).toBe('draft');
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
});
