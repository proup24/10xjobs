import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  Arrangement,
  Engagement,
  Language,
  Position,
  Region,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import {
  PROFILE_PUBLISHED,
  ProfilesService,
  toProfileView,
} from './profiles.service';
import { QuerySearchService } from 'src/modules/queries';
import { FakeQuerySearchRepository } from 'src/modules/queries/testing/fakes';
import { FakeProfilesRepository, FakeUsersRepository } from '../testing/fakes';
import { UsersService } from './users.service';
import type { ProfileInput, SkillInput } from '../types';

const profileInput: ProfileInput = {
  position: Position.backend_engineer,
  languages: [Language.EN],
  country: 'MA',
  city: null,
  regions: [Region.MENA],
  yearsOfExperience: 6,
  timezoneCurrent: 60,
  timezoneMin: -240,
  timezoneMax: 240,
  engagements: [Engagement.employee],
  arrangements: [Arrangement.remote],
  seniority: Seniority.senior,
  noticePeriodDays: 30,
};

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
  let profiles: FakeProfilesRepository;
  let querySearches: FakeQuerySearchRepository;
  let service: ProfilesService;
  let userId: string;
  let otherUserId: string;

  beforeEach(async () => {
    const userRows = new FakeUsersRepository();
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
  });

  const create = (techStack = [skill(Technology.nodejs, 8)]) =>
    service.create(userId, { ...profileInput, techStack });

  it('creates a draft profile with its tech stack', async () => {
    const view = await create();
    expect(view).toMatchObject({
      userId,
      seniority: 'senior',
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

  it('lets one user keep several independent profiles', async () => {
    const backend = await create([skill(Technology.go, 8)]);
    const frontend = await service.create(userId, {
      ...profileInput,
      position: Position.frontend_engineer,
      techStack: [skill(Technology.react, 7)],
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
      techStack: [skill(Technology.go, 5), skill(Technology.rust, 3)],
    });
    expect(second.id).toBe(first.id);
    expect(second.techStack.map((s) => s.technology)).toEqual(['go', 'rust']);
  });

  it('never changes the position on replace, even if a caller sends one', async () => {
    const { id } = await create();
    const sneaky = {
      ...editable,
      noticePeriodDays: 60,
      position: Position.ml_engineer,
      techStack: [],
    };
    const view = await service.replace(userId, id, sneaky);
    expect(view).toMatchObject({
      position: Position.backend_engineer,
      noticePeriodDays: 60,
    });
    expect((await profiles.findById(userId, id))?.position).toBe(
      Position.backend_engineer,
    );
  });

  it('changes position only by deleting the profile and creating another', async () => {
    const backend = await create();
    await service.delete(userId, backend.id);
    const ml = await service.create(userId, {
      ...profileInput,
      position: Position.ml_engineer,
      techStack: [],
    });
    expect((await service.list(userId)).map((p) => p.position)).toEqual([
      Position.ml_engineer,
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
    const { importance: _omitted, ...withoutImportance } = skill(
      Technology.go,
      5,
    );
    const view = await service.create(userId, {
      ...profileInput,
      techStack: [withoutImportance],
    });
    expect(view.techStack[0].importance).toBe(5);
  });

  it('sorts the stack by importance then mastery', async () => {
    const view = await create([
      skill(Technology.rust, 5, 2),
      skill(Technology.go, 5, 9),
    ]);
    expect(view.techStack.map((s) => s.technology)).toEqual(['go', 'rust']);
  });

  it('keeps an explicit importance of 0 and sorts it last', async () => {
    const view = await create([
      skill(Technology.rust, 9, 0),
      skill(Technology.go, 1, 1),
    ]);
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
      skill(Technology.go, 9),
      skill(Technology.rust, 4),
      skill(Technology.java, 7),
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
    const stack = [skill(Technology.nodejs, 8), skill(Technology.go, 5)];

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

    it('publishes a profile whose skills all have importance 0 without technologies', async () => {
      const { id } = await create([skill(Technology.go, 5, 0)]);
      const view = await service.publish(userId, id);
      expect(view.state).toBe('published');
      expect(querySearches.rows.length).toBeGreaterThan(0);
      for (const row of querySearches.rows)
        expect(row.technologies).toEqual([]);
    });

    it('stays a draft when generating query search builders fails', async () => {
      const { id } = await create(stack);
      vi.spyOn(querySearches, 'attach').mockRejectedValue(new Error('boom'));
      await expect(service.publish(userId, id)).rejects.toThrow('boom');
      expect((await service.get(userId, id)).state).toBe('draft');
    });
  });
});
