import { QuerySearchService } from 'src/modules/queries';
import { FakeQuerySearchRepository } from 'src/modules/queries/testing/fakes';
import { NotFoundException } from '@nestjs/common';
import { Engagement, ProfileState, Seniority } from 'src/common/enums';
import { ProfilesService } from './profiles.service';
import { ResumeService } from './resume.service';
import { MemoryStorageService } from 'src/modules/storage/testing';
import { FakeProfilesRepository, FakeUsersRepository } from '../testing/fakes';
import { UsersService } from './users.service';
import type { ProfileInput } from '../types';

const pdfBytes = Buffer.from('%PDF-1.7\n%%EOF');

const profileInput: ProfileInput = {
  position: 'backend_engineer',
  languages: [{ lang: 'en', level: 'fluent' }],
  locations: { remote: [{ kind: 'worldwide' }], hybrid: [], onsite: [] },
  yearsOfExperience: 6,
  timezoneCurrent: 0,
  timezoneMin: 0,
  timezoneMax: 0,
  engagements: [Engagement.employee],
  seniorities: [Seniority.senior],
  contractTypes: ['full_time'],
  salary: null,
  acceptsAnyCurrency: true,
  acceptedCurrencies: [],
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
    const userRows = new FakeUsersRepository();
    const users = new UsersService(userRows);
    profiles = new FakeProfilesRepository();
    storage = new MemoryStorageService();
    service = new ResumeService(
      new ProfilesService(
        users,
        profiles,
        new QuerySearchService(new FakeQuerySearchRepository()),
      ),
      storage,
      'resumes',
    );
    userId = userRows.add('A').id;
    otherUserId = userRows.add('B').id;
    profileId = (await profiles.create(userId, profileInput, [])).id;
  });

  /** Stands in for the web app's upload: a file in the profile's folder, pointed at by the row. */
  const upload = async (owner: string, profile: string, name: string) => {
    const key = `${owner}/${profile}/${name}`;
    await storage.put('resumes', key, pdfBytes);
    const row = profiles.rows.find((r) => r.id === profile);
    if (row) row.resumeKey = key;
    return key;
  };

  it('deletes a published profile with its resume file', async () => {
    await upload(userId, profileId, 'first.pdf');
    profiles.rows[0].state = ProfileState.published;
    await service.deleteProfile(userId, profileId);
    expect(profiles.rows).toHaveLength(0);
    expect(storage.keys('resumes')).toHaveLength(0);
  });

  it("deleteProfile removes every file in the profile's folder, not only resumeKey", async () => {
    await upload(userId, profileId, 'first.pdf');
    await upload(userId, profileId, 'second.pdf');
    await service.deleteProfile(userId, profileId);
    expect(profiles.rows).toHaveLength(0);
    expect(storage.keys('resumes')).toEqual([]);
  });

  it("deleteProfile leaves the user's other profiles and other users alone", async () => {
    const second = (await profiles.create(userId, profileInput, [])).id;
    const theirs = (await profiles.create(otherUserId, profileInput, [])).id;
    await upload(userId, profileId, 'first.pdf');
    const kept = await upload(userId, second, 'cv.pdf');
    const other = await upload(otherUserId, theirs, 'cv.pdf');
    await service.deleteProfile(userId, profileId);
    expect(storage.keys('resumes').sort()).toEqual([kept, other].sort());
  });

  it('deleteProfile removes the folder of a profile without a resumeKey', async () => {
    await storage.put('resumes', `${userId}/${profileId}/draft.pdf`, pdfBytes);
    await service.deleteProfile(userId, profileId);
    expect(storage.keys('resumes')).toEqual([]);
  });

  it("deleteProfile 404s another user's profile", async () => {
    const key = await upload(userId, profileId, 'first.pdf');
    await expect(
      service.deleteProfile(otherUserId, profileId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(profiles.rows).toHaveLength(1);
    expect(storage.keys('resumes')).toEqual([key]);
  });

  it('deleteProfile stands when removing the files fails', async () => {
    await upload(userId, profileId, 'first.pdf');
    storage.failNextDelete = true;
    await expect(
      service.deleteProfile(userId, profileId),
    ).resolves.toBeUndefined();
    expect(profiles.rows).toHaveLength(0);
  });

  it("removeAllFor clears everything under the user's prefix", async () => {
    const second = (await profiles.create(userId, profileInput, [])).id;
    await upload(userId, profileId, 'first.pdf');
    await upload(userId, profileId, 'second.pdf');
    await upload(userId, second, 'cv.pdf');
    await service.removeAllFor(userId);
    expect(storage.keys('resumes')).toEqual([]);
  });

  it('removeAllFor removes files under a folder with no profile row', async () => {
    await storage.put('resumes', `${userId}/unknown-profile/x.pdf`, pdfBytes);
    await service.removeAllFor(userId);
    expect(storage.keys('resumes')).toEqual([]);
  });

  it("removeAllFor leaves other users' files alone", async () => {
    const theirs = (await profiles.create(otherUserId, profileInput, [])).id;
    await upload(userId, profileId, 'first.pdf');
    const other = await upload(otherUserId, theirs, 'cv.pdf');
    await service.removeAllFor(userId);
    expect(storage.keys('resumes')).toEqual([other]);
  });

  it('removeAllFor stops at the folder boundary of the user id', async () => {
    const sibling = `${userId}0/p/x.pdf`;
    await storage.put('resumes', sibling, pdfBytes);
    await upload(userId, profileId, 'first.pdf');
    await service.removeAllFor(userId);
    expect(storage.keys('resumes')).toEqual([sibling]);
  });

  it('removeAllFor is a no-op for a user without files', async () => {
    await expect(service.removeAllFor('nobody')).resolves.toBeUndefined();
  });

  it('removeAllFor does not throw when removing the files fails', async () => {
    await upload(userId, profileId, 'first.pdf');
    storage.failNextDelete = true;
    await expect(service.removeAllFor(userId)).resolves.toBeUndefined();
  });
});
