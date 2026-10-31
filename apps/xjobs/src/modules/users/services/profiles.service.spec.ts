import { NotFoundException } from '@nestjs/common';
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
import { ProfilesService, toProfileView } from './profiles.service';
import { QuerySearchService } from 'src/modules/queries';
import { FakeQuerySearchRepository } from 'src/modules/queries/testing/fakes';
import { FakeProfilesRepository, FakeUsersRepository } from '../testing/fakes';
import { UsersService } from './users.service';
import type { ProfileInput, SkillInput } from '../types';

const profileInput: ProfileInput = {
  positions: [Position.backend_engineer],
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
    const users = new UsersService(new FakeUsersRepository());
    profiles = new FakeProfilesRepository();
    querySearches = new FakeQuerySearchRepository();
    service = new ProfilesService(
      users,
      profiles,
      new QuerySearchService(querySearches),
    );
    userId = (await users.create({ name: 'A', email: 'a@x.com' })).id;
    otherUserId = (await users.create({ name: 'B', email: 'b@x.com' })).id;
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
      positions: [Position.frontend_engineer],
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
    const input = { ...profileInput, techStack: [] };
    for (const attempt of [
      () => service.get(otherUserId, id),
      () => service.replace(otherUserId, id, input),
      () => service.publish(otherUserId, id),
      () => service.unpublish(otherUserId, id),
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
      ...profileInput,
      techStack: [skill(Technology.go, 5), skill(Technology.rust, 3)],
    });
    expect(second.id).toBe(first.id);
    expect(second.techStack.map((s) => s.technology)).toEqual(['go', 'rust']);
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

    it('publishes, generating query search builders once', async () => {
      const { id } = await create(stack);
      const first = await service.publish(userId, id);
      expect(first.state).toBe('published');
      expect(first.publishedAt).toBeInstanceOf(Date);
      expect(first.querySearches.created).toBeGreaterThan(0);
      expect(querySearches.rows.every((row) => row.profileId === id)).toBe(
        true,
      );
      const again = await service.publish(userId, id);
      expect(again.state).toBe('published');
      expect(again.querySearches).toEqual({
        created: 0,
        existing: first.querySearches.created,
      });
    });

    it('publishes one profile without touching the other', async () => {
      const a = await create(stack);
      const b = await create(stack);
      await service.publish(userId, a.id);
      expect((await service.get(userId, b.id)).state).toBe('draft');
    });

    it('unpublishes to draft and keeps the query search builders', async () => {
      const { id } = await create(stack);
      await service.publish(userId, id);
      const count = querySearches.rows.length;
      const view = await service.unpublish(userId, id);
      expect(view).toMatchObject({ state: 'draft', publishedAt: null });
      expect(querySearches.rows).toHaveLength(count);
    });

    it('keeps the state when a published profile is replaced', async () => {
      const { id } = await create(stack);
      await service.publish(userId, id);
      const view = await service.replace(userId, id, {
        ...profileInput,
        techStack: stack,
      });
      expect(view.state).toBe('published');
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
      vi.spyOn(querySearches, 'create').mockRejectedValue(new Error('boom'));
      await expect(service.publish(userId, id)).rejects.toThrow('boom');
      expect((await service.get(userId, id)).state).toBe('draft');
    });
  });
});
