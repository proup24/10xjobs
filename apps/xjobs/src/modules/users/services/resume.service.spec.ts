import type { QuerySearchService } from 'src/modules/queries';
import { createHash } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Arrangement,
  Engagement,
  Language,
  Position,
  Seniority,
} from 'src/common/enums';
import { ProfilesService } from './profiles.service';
import { ResumeService } from './resume.service';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { FakeProfilesRepository, FakeUsersRepository } from '../testing/fakes';
import { UsersService } from './users.service';
import type { ProfileInput, UploadedPdf } from '../types';

const pdfBytes = Buffer.from('%PDF-1.7\n%%EOF');
const pdf = (buffer = pdfBytes, mimetype = 'application/pdf'): UploadedPdf => ({
  originalname: 'cv.pdf',
  mimetype,
  buffer,
  size: buffer.length,
});

const profileInput: ProfileInput = {
  position: Position.backend_engineer,
  languages: [Language.EN],
  country: 'MA',
  city: null,
  regions: [],
  yearsOfExperience: 6,
  timezoneCurrent: 0,
  timezoneMin: 0,
  timezoneMax: 0,
  engagements: [Engagement.employee],
  arrangements: [Arrangement.remote],
  seniority: Seniority.senior,
  noticePeriodDays: 0,
};

describe('ResumeService', () => {
  let profiles: FakeProfilesRepository;
  let storage: MemoryStorageService;
  let service: ResumeService;
  let userId: string;
  let otherUserId: string;
  let profileId: string;

  beforeEach(async () => {
    const users = new UsersService(new FakeUsersRepository());
    profiles = new FakeProfilesRepository();
    storage = new MemoryStorageService();
    service = new ResumeService(
      new ProfilesService(users, profiles, {} as QuerySearchService),
      profiles,
      storage,
      'resumes',
    );
    userId = (await users.create({ name: 'A', email: 'a@x.com' })).id;
    otherUserId = (await users.create({ name: 'B', email: 'b@x.com' })).id;
    profileId = (await profiles.create(userId, profileInput, [])).id;
  });

  it('stores a PDF under the user and profile and reports its SHA-256', async () => {
    const view = await service.save(userId, profileId, pdf());
    expect(view.resume?.sha256).toBe(
      createHash('sha256').update(pdfBytes).digest('hex'),
    );
    expect(view.resume?.filename).toBe('cv.pdf');
    expect(storage.keys('resumes')).toEqual([
      expect.stringMatching(new RegExp(`^${userId}/${profileId}/.+\\.pdf$`)),
    ]);
  });

  it('keeps one resume per profile', async () => {
    const second = (await profiles.create(userId, profileInput, [])).id;
    await service.save(userId, profileId, pdf());
    await service.save(userId, second, pdf(Buffer.from('%PDF-1.4 second')));
    expect(storage.keys('resumes')).toHaveLength(2);
    expect((await service.get(userId, second)).data.toString()).toBe(
      '%PDF-1.4 second',
    );
  });

  it("404s another user's profile and stores nothing", async () => {
    await expect(
      service.save(otherUserId, profileId, pdf()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get(otherUserId, profileId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.keys('resumes')).toHaveLength(0);
  });

  it('rejects a PDF sent with another mime type', async () => {
    await expect(
      service.save(userId, profileId, pdf(pdfBytes, 'text/plain')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file that claims to be a PDF but is not', async () => {
    await expect(
      service.save(userId, profileId, pdf(Buffer.from('hello'))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing file', async () => {
    await expect(service.save(userId, profileId, undefined)).rejects.toThrow(
      new BadRequestException('A PDF file is required'),
    );
  });

  it('deletes the old file only after the new one is stored', async () => {
    await service.save(userId, profileId, pdf());
    const [oldKey] = storage.keys('resumes');
    await service.save(userId, profileId, pdf(Buffer.from('%PDF-1.4 second')));
    expect(storage.keys('resumes')).not.toContain(oldKey);
    expect(storage.keys('resumes')).toHaveLength(1);
  });

  it('keeps the old resume when storing the new one fails', async () => {
    const first = await service.save(userId, profileId, pdf());
    const [oldKey] = storage.keys('resumes');
    storage.failNextPut = true;
    await expect(service.save(userId, profileId, pdf())).rejects.toThrow();
    expect(storage.keys('resumes')).toContain(oldKey);
    expect((await service.view(userId, profileId)).resume).toEqual(
      first.resume,
    );
  });

  it('404s a download when there is no resume', async () => {
    await expect(service.get(userId, profileId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deleteProfile removes the profile and its file', async () => {
    await service.save(userId, profileId, pdf());
    await service.deleteProfile(userId, profileId);
    expect(profiles.rows).toHaveLength(0);
    expect(storage.keys('resumes')).toHaveLength(0);
  });

  it("deleteProfile 404s another user's profile", async () => {
    await expect(
      service.deleteProfile(otherUserId, profileId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(profiles.rows).toHaveLength(1);
  });

  it('removeAllFor deletes the files of every profile the user owns', async () => {
    const second = (await profiles.create(userId, profileInput, [])).id;
    await service.save(userId, profileId, pdf());
    await service.save(userId, second, pdf());
    await service.removeAllFor(userId);
    expect(storage.keys('resumes')).toHaveLength(0);
  });

  it('removeAllFor is a no-op for a user without profiles', async () => {
    await expect(service.removeAllFor('nobody')).resolves.toBeUndefined();
  });

  it('a successful upload stands when removing the old file fails', async () => {
    await service.save(userId, profileId, pdf());
    storage.failNextDelete = true;
    const view = await service.save(
      userId,
      profileId,
      pdf(Buffer.from('%PDF-1.4 b')),
    );
    expect(view.resume?.sizeBytes).toBe(Buffer.from('%PDF-1.4 b').length);
  });

  it('404s a download whose stored object is gone', async () => {
    await service.save(userId, profileId, pdf());
    storage.objects.clear();
    await expect(service.get(userId, profileId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('ensures its bucket on startup', async () => {
    await service.onModuleInit();
    expect(storage.buckets).toContain('resumes');
  });
});
