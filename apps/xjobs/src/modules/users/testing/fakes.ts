/** In-memory repositories for unit tests; not part of the application build. */
import { ProfileState } from 'src/common/enums';
import { toStoredAddress, type ContactRow, type UserRow } from 'src/database';
import { ContactsRepository } from '../repositories/contacts.repository';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { UsersRepository } from '../repositories/users.repository';
import type {
  ContactInput,
  ProfileFields,
  ProfileInput,
  ProfileWithSkills,
  ResumeMeta,
  SkillInput,
  UserInput,
} from '../types';

export class FakeUsersRepository extends UsersRepository {
  rows: UserRow[] = [];

  async create(data: UserInput): Promise<UserRow> {
    if (this.rows.some((row) => row.email === data.email)) {
      throw { sqlState: '23505' };
    }
    const now = new Date();
    const row: UserRow = {
      id: `user-${this.rows.length + 1}`,
      name: data.name,
      email: data.email,
      address: data.address ? toStoredAddress(data.address) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async list(): Promise<UserRow[]> {
    return this.rows;
  }

  async findById(userId: string) {
    return this.rows.find((row) => row.id === userId) ?? null;
  }

  async update(userId: string, data: Partial<UserInput>) {
    const row = await this.findById(userId);
    if (!row) return null;
    Object.assign(row, data);
    return row;
  }

  async delete(userId: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.id !== userId);
    return this.rows.length < before;
  }
}

export class FakeContactsRepository extends ContactsRepository {
  rows: ContactRow[] = [];

  async create(userId: string, data: ContactInput): Promise<ContactRow> {
    if (
      this.rows.some(
        (row) =>
          row.userId === userId &&
          row.kind === data.kind &&
          row.value === data.value,
      )
    ) {
      throw { sqlState: '23505' };
    }
    const now = new Date();
    const row: ContactRow = {
      id: `contact-${this.rows.length + 1}`,
      userId,
      kind: data.kind,
      value: data.value,
      label: data.label ?? null,
      isPrimary: data.isPrimary ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async list(userId: string): Promise<ContactRow[]> {
    return this.rows.filter((row) => row.userId === userId);
  }

  async findById(userId: string, contactId: string) {
    return (
      this.rows.find((row) => row.userId === userId && row.id === contactId) ??
      null
    );
  }

  async update(userId: string, contactId: string, data: Partial<ContactInput>) {
    const row = await this.findById(userId, contactId);
    if (!row) return null;
    Object.assign(row, data);
    return row;
  }

  async delete(userId: string, contactId: string) {
    const row = await this.findById(userId, contactId);
    this.rows = this.rows.filter((candidate) => candidate !== row);
    return row !== null;
  }

  async setPrimary(
    userId: string,
    contactId: string,
    kind: ContactRow['kind'],
  ): Promise<ContactRow> {
    for (const row of await this.list(userId)) {
      if (row.kind === kind) row.isPrimary = row.id === contactId;
    }
    const row = await this.findById(userId, contactId);
    if (!row) throw new Error('missing contact');
    return row;
  }
}

export class FakeProfilesRepository extends ProfilesRepository {
  rows: ProfileWithSkills[] = [];
  private nextId = 1;

  private static techStack(profileId: string, skills: SkillInput[]) {
    const now = new Date();
    return skills.map((skill, index) => ({
      ...skill,
      id: `${profileId}-skill-${index}`,
      profileId,
      createdAt: now,
      updatedAt: now,
    }));
  }

  async list(userId: string) {
    return this.rows.filter((row) => row.userId === userId);
  }

  async findById(userId: string, profileId: string) {
    return (
      this.rows.find((row) => row.userId === userId && row.id === profileId) ??
      null
    );
  }

  async create(
    userId: string,
    data: ProfileInput,
    skills: SkillInput[],
  ): Promise<ProfileWithSkills> {
    const now = new Date();
    // A counter, not the row count: ids are never reused after a delete.
    const id = `profile-${this.nextId++}`;
    const profile: ProfileWithSkills = {
      id,
      userId,
      ...data,
      resumeKey: null,
      resumeFilename: null,
      resumeSizeBytes: null,
      resumeSha256: null,
      resumeUploadedAt: null,
      state: ProfileState.draft,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      techStack: FakeProfilesRepository.techStack(id, skills),
    };
    this.rows.push(profile);
    return profile;
  }

  async replace(
    userId: string,
    profileId: string,
    data: ProfileFields,
    skills: SkillInput[],
  ) {
    const profile = await this.findById(userId, profileId);
    if (!profile) return null;
    return Object.assign(profile, data, {
      techStack: FakeProfilesRepository.techStack(profileId, skills),
    });
  }

  async delete(userId: string, profileId: string) {
    const profile = await this.findById(userId, profileId);
    this.rows = this.rows.filter((row) => row !== profile);
    return profile !== null;
  }

  async setState(
    userId: string,
    profileId: string,
    state: ProfileState,
    publishedAt: Date | null,
  ) {
    const profile = await this.findById(userId, profileId);
    return profile ? Object.assign(profile, { state, publishedAt }) : null;
  }

  async setResume(
    userId: string,
    profileId: string,
    meta: ResumeMeta | null,
  ): Promise<boolean> {
    const profile = await this.findById(userId, profileId);
    if (!profile) return false;
    Object.assign(profile, {
      resumeKey: meta?.key ?? null,
      resumeFilename: meta?.filename ?? null,
      resumeSizeBytes: meta?.sizeBytes ?? null,
      resumeSha256: meta?.sha256 ?? null,
      resumeUploadedAt: meta?.uploadedAt ?? null,
    });
    return true;
  }
}
