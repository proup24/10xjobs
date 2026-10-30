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

  beforeEach(async () => {
    const users = new UsersService(new FakeUsersRepository());
    profiles = new FakeProfilesRepository();
    querySearches = new FakeQuerySearchRepository();
    service = new ProfilesService(
      users,
      profiles,
      new QuerySearchService(querySearches),
    );
    userId = (await users.create('ws', { name: 'A', email: 'a@x.com' })).id;
  });

  it('creates a profile for a user without one', async () => {
    const view = await service.upsert('ws', userId, {
      ...profileInput,
      techStack: [skill(Technology.nodejs, 8)],
    });
    expect(view).toMatchObject({ userId, seniority: 'senior' });
    expect(view.techStack).toEqual([
      {
        technology: 'nodejs',
        domain: 'backend',
        mastery: 8,
        importance: 5,
      },
    ]);
  });

  it('replaces the whole tech stack and keeps the profile id', async () => {
    const first = await service.upsert('ws', userId, {
      ...profileInput,
      techStack: [skill(Technology.nodejs, 8)],
    });
    const second = await service.upsert('ws', userId, {
      ...profileInput,
      techStack: [skill(Technology.go, 5), skill(Technology.rust, 3)],
    });
    expect(second.id).toBe(first.id);
    expect(second.techStack.map((s) => s.technology)).toEqual(['rust', 'go']);
  });

  it('stores importance 5 when an upsert omits it', async () => {
    const { importance: _omitted, ...withoutImportance } = skill(
      Technology.go,
      5,
    );
    const view = await service.upsert('ws', userId, {
      ...profileInput,
      techStack: [withoutImportance],
    });
    expect(view.techStack[0].importance).toBe(5);
  });

  it('sorts the stack by importance then mastery', async () => {
    const view = await service.upsert('ws', userId, {
      ...profileInput,
      techStack: [skill(Technology.rust, 5, 2), skill(Technology.go, 5, 9)],
    });
    expect(view.techStack.map((s) => s.technology)).toEqual(['go', 'rust']);
  });

  it('keeps an explicit importance of 0 and sorts it last', async () => {
    const view = await service.upsert('ws', userId, {
      ...profileInput,
      techStack: [skill(Technology.rust, 9, 0), skill(Technology.go, 1, 1)],
    });
    expect(view.techStack.map((s) => [s.technology, s.importance])).toEqual([
      ['go', 1],
      ['rust', 0],
    ]);
  });

  it('404s a user without a profile', async () => {
    await expect(service.get('ws', userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s an unknown user', async () => {
    await expect(
      service.upsert('ws', 'missing', { ...profileInput, techStack: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('views hide the storage key and sort by mastery', async () => {
    await service.upsert('ws', userId, {
      ...profileInput,
      techStack: [
        skill(Technology.go, 9),
        skill(Technology.rust, 4),
        skill(Technology.java, 7),
      ],
    });
    const stored = await profiles.findByUser('ws', userId);
    if (!stored) throw new Error('profile was not stored');
    const view = toProfileView({
      ...stored,
      resumeKey: 'ws/p/secret.pdf',
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
      'java',
      'rust',
      'go',
    ]);
  });

  describe('publishing', () => {
    const stack = [skill(Technology.nodejs, 8), skill(Technology.go, 5)];

    it('creates profiles as unpublished drafts', async () => {
      const view = await service.upsert('ws', userId, {
        ...profileInput,
        techStack: stack,
      });
      expect(view).toMatchObject({ state: 'draft', publishedAt: null });
    });

    it('publishes, generating query search builders once', async () => {
      await service.upsert('ws', userId, { ...profileInput, techStack: stack });
      const first = await service.publish('ws', userId);
      expect(first.state).toBe('published');
      expect(first.publishedAt).toBeInstanceOf(Date);
      expect(first.querySearches.created).toBeGreaterThan(0);
      const again = await service.publish('ws', userId);
      expect(again.state).toBe('published');
      expect(again.querySearches).toEqual({
        created: 0,
        existing: first.querySearches.created,
      });
    });

    it('unpublishes to draft and keeps the query search builders', async () => {
      await service.upsert('ws', userId, { ...profileInput, techStack: stack });
      await service.publish('ws', userId);
      const count = querySearches.rows.length;
      const view = await service.unpublish('ws', userId);
      expect(view).toMatchObject({ state: 'draft', publishedAt: null });
      expect(querySearches.rows).toHaveLength(count);
    });

    it('keeps the state when a published profile is upserted', async () => {
      await service.upsert('ws', userId, { ...profileInput, techStack: stack });
      await service.publish('ws', userId);
      const view = await service.upsert('ws', userId, {
        ...profileInput,
        techStack: stack,
      });
      expect(view.state).toBe('published');
    });

    it('404s publishing without a profile and creates nothing', async () => {
      await expect(service.publish('ws', userId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(querySearches.rows).toHaveLength(0);
    });

    it('publishes a profile whose skills all have importance 0 without technologies', async () => {
      await service.upsert('ws', userId, {
        ...profileInput,
        techStack: [skill(Technology.go, 5, 0)],
      });
      const view = await service.publish('ws', userId);
      expect(view.state).toBe('published');
      expect(querySearches.rows.length).toBeGreaterThan(0);
      for (const row of querySearches.rows)
        expect(row.technologies).toEqual([]);
    });

    it('stays a draft when generating query search builders fails', async () => {
      await service.upsert('ws', userId, { ...profileInput, techStack: stack });
      vi.spyOn(querySearches, 'create').mockRejectedValue(new Error('boom'));
      await expect(service.publish('ws', userId)).rejects.toThrow('boom');
      expect((await service.get('ws', userId)).state).toBe('draft');
    });
  });
});
