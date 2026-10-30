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
import type { UploadedPdf } from '../types';

const pdfBytes = Buffer.from('%PDF-1.7\n%%EOF');
const pdf = (buffer = pdfBytes, mimetype = 'application/pdf'): UploadedPdf => ({
  originalname: 'cv.pdf',
  mimetype,
  buffer,
  size: buffer.length,
});

describe('ResumeService', () => {
  let profiles: FakeProfilesRepository;
  let storage: MemoryStorageService;
  let service: ResumeService;
  let userId: string;

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
    userId = (await users.create('ws', { name: 'A', email: 'a@x.com' })).id;
    await profiles.upsert(
      'ws',
      userId,
      {
        positions: [Position.backend_engineer],
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
      },
      [],
    );
  });

  it('stores a PDF and reports its SHA-256', async () => {
    const view = await service.save('ws', userId, pdf());
    expect(view.resume?.sha256).toBe(
      createHash('sha256').update(pdfBytes).digest('hex'),
    );
    expect(view.resume?.filename).toBe('cv.pdf');
    expect(storage.objects.get('resumes')?.size).toBe(1);
  });

  it('rejects a PDF sent with another mime type', async () => {
    await expect(
      service.save('ws', userId, pdf(pdfBytes, 'text/plain')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file that claims to be a PDF but is not', async () => {
    await expect(
      service.save('ws', userId, pdf(Buffer.from('hello'))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing file', async () => {
    await expect(service.save('ws', userId, undefined)).rejects.toThrow(
      new BadRequestException('A PDF file is required'),
    );
  });

  it('deletes the old file only after the new one is stored', async () => {
    await service.save('ws', userId, pdf());
    const [oldKey] = storage.keys('resumes');
    await service.save('ws', userId, pdf(Buffer.from('%PDF-1.4 second')));
    expect(storage.keys('resumes')).not.toContain(oldKey);
    expect(storage.keys('resumes')).toHaveLength(1);
  });

  it('keeps the old resume when storing the new one fails', async () => {
    const first = await service.save('ws', userId, pdf());
    const [oldKey] = storage.keys('resumes');
    storage.failNextPut = true;
    await expect(service.save('ws', userId, pdf())).rejects.toThrow();
    expect(storage.keys('resumes')).toContain(oldKey);
    expect((await service.view('ws', userId)).resume).toEqual(first.resume);
  });

  it('404s a download when there is no resume', async () => {
    await expect(service.get('ws', userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('removeFor deletes the stored file', async () => {
    await service.save('ws', userId, pdf());
    await service.removeFor('ws', userId);
    expect(storage.keys('resumes')).toHaveLength(0);
  });

  it('removeFor is a no-op for a user without a profile', async () => {
    await expect(service.removeFor('ws', 'nobody')).resolves.toBeUndefined();
  });

  it('a successful upload stands when removing the old file fails', async () => {
    await service.save('ws', userId, pdf());
    storage.failNextDelete = true;
    const view = await service.save(
      'ws',
      userId,
      pdf(Buffer.from('%PDF-1.4 b')),
    );
    expect(view.resume?.sizeBytes).toBe(Buffer.from('%PDF-1.4 b').length);
  });

  it('404s a download whose stored object is gone', async () => {
    await service.save('ws', userId, pdf());
    storage.objects.clear();
    await expect(service.get('ws', userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('ensures its bucket on startup', async () => {
    await service.onModuleInit();
    expect(storage.buckets).toContain('resumes');
  });
});
