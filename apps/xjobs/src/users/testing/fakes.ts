/** In-memory repositories for unit tests; not part of the application build. */
import type { ContactKind } from 'src/common/enums';
import {
  toStoredAddress,
  type ContactRow,
  type UserRow,
} from 'src/database';
import { ContactsRepository, type ContactInput } from '../contacts.repository';
import {
  ProfilesRepository,
  type ProfileInput,
  type ProfileWithSkills,
  type ResumeMeta,
  type SkillInput,
} from '../profiles.repository';
import { ResumeStorage } from '../resume-storage';
import { UsersRepository, type UserInput } from '../users.repository';

export class FakeUsersRepository extends UsersRepository {
  rows: UserRow[] = [];

  async create(workspaceId: string, data: UserInput): Promise<UserRow> {
    if (
      this.rows.some(
        (row) => row.workspaceId === workspaceId && row.email === data.email,
      )
    ) {
      throw { sqlState: '23505' };
    }
    const now = new Date();
    const row: UserRow = {
      id: `user-${this.rows.length + 1}`,
      workspaceId,
      name: data.name,
      email: data.email,
      address: data.address ? toStoredAddress(data.address) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async list(workspaceId: string): Promise<UserRow[]> {
    return this.rows.filter((row) => row.workspaceId === workspaceId);
  }

  async findById(workspaceId: string, userId: string) {
    return (
      this.rows.find(
        (row) => row.workspaceId === workspaceId && row.id === userId,
      ) ?? null
    );
  }

  async update(workspaceId: string, userId: string, data: Partial<UserInput>) {
    const row = await this.findById(workspaceId, userId);
    if (!row) return null;
    Object.assign(row, data);
    return row;
  }

  async delete(workspaceId: string, userId: string): Promise<boolean> {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (row) => !(row.workspaceId === workspaceId && row.id === userId),
    );
    return this.rows.length < before;
  }
}

export class FakeContactsRepository extends ContactsRepository {
  rows: ContactRow[] = [];

  async create(
    workspaceId: string,
    userId: string,
    data: ContactInput,
  ): Promise<ContactRow> {
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
      workspaceId,
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

  async list(workspaceId: string, userId: string): Promise<ContactRow[]> {
    return this.rows.filter(
      (row) => row.workspaceId === workspaceId && row.userId === userId,
    );
  }

  async findById(workspaceId: string, userId: string, contactId: string) {
    return (
      this.rows.find(
        (row) =>
          row.workspaceId === workspaceId &&
          row.userId === userId &&
          row.id === contactId,
      ) ?? null
    );
  }

  async update(
    workspaceId: string,
    userId: string,
    contactId: string,
    data: Partial<ContactInput>,
  ) {
    const row = await this.findById(workspaceId, userId, contactId);
    if (!row) return null;
    Object.assign(row, data);
    return row;
  }

  async delete(workspaceId: string, userId: string, contactId: string) {
    const row = await this.findById(workspaceId, userId, contactId);
    this.rows = this.rows.filter((candidate) => candidate !== row);
    return row !== null;
  }

  async setPrimary(
    workspaceId: string,
    userId: string,
    contactId: string,
    kind: ContactKind,
  ): Promise<ContactRow> {
    for (const row of await this.list(workspaceId, userId)) {
      if (row.kind === kind) row.isPrimary = row.id === contactId;
    }
    const row = await this.findById(workspaceId, userId, contactId);
    if (!row) throw new Error('missing contact');
    return row;
  }
}

export class FakeProfilesRepository extends ProfilesRepository {
  rows: ProfileWithSkills[] = [];

  async findByUser(workspaceId: string, userId: string) {
    return (
      this.rows.find(
        (row) => row.workspaceId === workspaceId && row.userId === userId,
      ) ?? null
    );
  }

  async upsert(
    workspaceId: string,
    userId: string,
    data: ProfileInput,
    skills: SkillInput[],
  ): Promise<ProfileWithSkills> {
    const now = new Date();
    let profile = await this.findByUser(workspaceId, userId);
    if (!profile) {
      profile = {
        id: `profile-${this.rows.length + 1}`,
        workspaceId,
        userId,
        ...data,
        resumeKey: null,
        resumeFilename: null,
        resumeSizeBytes: null,
        resumeSha256: null,
        resumeUploadedAt: null,
        createdAt: now,
        updatedAt: now,
        techStack: [],
      };
      this.rows.push(profile);
    }
    const profileId = profile.id;
    Object.assign(profile, data, {
      techStack: skills.map((skill, index) => ({
        ...skill,
        id: `skill-${index}`,
        workspaceId,
        profileId,
        createdAt: now,
        updatedAt: now,
      })),
    });
    return profile;
  }

  async setResume(
    workspaceId: string,
    profileId: string,
    meta: ResumeMeta | null,
  ): Promise<void> {
    const profile = this.rows.find(
      (row) => row.workspaceId === workspaceId && row.id === profileId,
    );
    if (!profile) return;
    Object.assign(profile, {
      resumeKey: meta?.key ?? null,
      resumeFilename: meta?.filename ?? null,
      resumeSizeBytes: meta?.sizeBytes ?? null,
      resumeSha256: meta?.sha256 ?? null,
      resumeUploadedAt: meta?.uploadedAt ?? null,
    });
  }
}

export class MemoryResumeStorage extends ResumeStorage {
  files = new Map<string, Buffer>();
  failNextPut = false;

  async put(key: string, data: Buffer): Promise<void> {
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('disk full');
    }
    this.files.set(key, data);
  }

  async get(key: string): Promise<Buffer> {
    const data = this.files.get(key);
    if (!data) throw new Error(`missing ${key}`);
    return data;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}
