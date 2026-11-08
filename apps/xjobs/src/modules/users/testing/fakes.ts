/** In-memory repositories for unit tests; not part of the application build. */
import { ProfileState } from 'src/common/enums';
import type { ContactRow, UserRow } from 'src/database';
import { ContactsRepository } from '../repositories/contacts.repository';
import {
  ProfilesRepository,
  toProfileColumns,
} from '../repositories/profiles.repository';
import { UsersRepository } from '../repositories/users.repository';
import type {
  ContactInput,
  Place,
  PlaceLabels,
  ProfileFields,
  ProfileInput,
  ProfileWithSkills,
  SkillInput,
  UserInput,
} from '../types';

export class FakeUsersRepository extends UsersRepository {
  rows: UserRow[] = [];

  /** Stands in for the sign-up trigger, which creates real rows. */
  add(name: string | null = null): UserRow {
    const now = new Date();
    const row: UserRow = {
      id: `user-${this.rows.length + 1}`,
      name,
      address: null,
      residenceCountry: null,
      acceptsSponsorship: null,
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

  async eligibility(userId: string) {
    const row = await this.findById(userId);
    return row
      ? {
          residenceCountry: row.residenceCountry,
          acceptsSponsorship: row.acceptsSponsorship,
        }
      : null;
  }

  async update(userId: string, data: UserInput) {
    const row = await this.findById(userId);
    if (!row) return null;
    Object.assign(row, data);
    return row;
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
  /** The vocabulary labels `placeLabels` answers from, whatever it is asked. */
  labels: PlaceLabels = {
    regions: new Map([
      ['EMEA', 'EMEA'],
      ['MENA', 'MENA'],
    ]),
    countries: new Map([
      ['FR', 'France'],
      ['MA', 'Morocco'],
    ]),
    cities: new Map(),
  };

  private static techStack(
    userId: string,
    profileId: string,
    skills: SkillInput[],
  ) {
    const now = new Date();
    return skills.map((skill, index) => ({
      ...skill,
      id: `${profileId}-skill-${index}`,
      userId,
      profileId,
      createdAt: now,
      updatedAt: now,
    }));
  }

  async list(userId: string) {
    return this.rows.filter((row) => row.userId === userId);
  }

  async listPublished() {
    return this.rows.filter((row) => row.state === ProfileState.published);
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
      position: data.position,
      ...toProfileColumns(data),
      resumeKey: null,
      resumeFilename: null,
      resumeSizeBytes: null,
      resumeSha256: null,
      resumeUploadedAt: null,
      state: ProfileState.draft,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      techStack: FakeProfilesRepository.techStack(userId, id, skills),
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
    if (profile?.state !== ProfileState.draft) return null;
    return Object.assign(profile, toProfileColumns(data), {
      techStack: FakeProfilesRepository.techStack(userId, profileId, skills),
    });
  }

  async delete(userId: string, profileId: string) {
    const profile = await this.findById(userId, profileId);
    this.rows = this.rows.filter((row) => row !== profile);
    return profile !== null;
  }

  async publish(userId: string, profileId: string, publishedAt: Date) {
    const profile = await this.findById(userId, profileId);
    if (profile?.state !== ProfileState.draft) return null;
    return Object.assign(profile, {
      state: ProfileState.published,
      publishedAt,
    });
  }

  /** The labels of `labels` the places name, a city's country included; unknown ones are left out. */
  async placeLabels(places: Place[]): Promise<PlaceLabels> {
    const named = new Set(
      places.map((place) =>
        place.kind === 'city'
          ? place.id.toLowerCase()
          : place.kind === 'worldwide'
            ? ''
            : place.code,
      ),
    );
    const pick = <T>(map: Map<string, T>, keys: Set<string>) =>
      new Map([...map].filter(([key]) => keys.has(key)));
    const cities = pick(this.labels.cities, named);
    for (const city of cities.values()) named.add(city.countryCode);
    return {
      regions: pick(this.labels.regions, named),
      countries: pick(this.labels.countries, named),
      cities,
    };
  }
}
