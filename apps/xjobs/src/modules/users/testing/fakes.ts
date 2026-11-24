/** In-memory repositories for unit tests; not part of the application build. */
import { ProfileState } from 'src/common/enums';
import type { UserRow } from 'src/database';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { UsersRepository } from '../repositories/users.repository';
import type {
  Place,
  PlaceLabels,
  ProfileInput,
  ProfileWithSkills,
  SkillInput,
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
      eligibilityVersion: 0,
      searchesResumedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
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

  /** Sets the eligibility answers directly, as the web app does through Supabase. */
  setEligibility(
    userId: string,
    data: {
      residenceCountry: string | null;
      acceptsSponsorship: boolean | null;
    },
  ) {
    const row = this.rows.find((r) => r.id === userId);
    if (row) Object.assign(row, data);
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

  async listPublished() {
    return this.rows.filter((row) => row.state === ProfileState.published);
  }

  async listSearchesBehind(limit: number) {
    return this.rows
      .filter(
        (row) =>
          row.state === ProfileState.published &&
          (row.searchesVersion === null ||
            row.searchesVersion < row.matchVersion),
      )
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit);
  }

  async findById(userId: string, profileId: string) {
    return (
      this.rows.find((row) => row.userId === userId && row.id === profileId) ??
      null
    );
  }

  /** Stands in for the web app's direct insert of a draft. */
  async add(
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
      locations: data.locations,
      languages: data.languages,
      yearsOfExperience: data.yearsOfExperience,
      timezoneCurrent: data.timezoneCurrent,
      timezoneMin: data.timezoneMin,
      timezoneMax: data.timezoneMax,
      engagements: data.engagements,
      seniorities: data.seniorities,
      contractTypes: data.contractTypes,
      salaryMin: data.salary?.min ?? null,
      salaryCurrency: data.salary?.currency ?? null,
      salaryPeriod: data.salary?.period ?? null,
      acceptsAnyCurrency: data.acceptsAnyCurrency,
      acceptedCurrencies: data.acceptedCurrencies,
      noticePeriodDays: data.noticePeriodDays,
      resumeKey: null,
      resumeFilename: null,
      resumeSizeBytes: null,
      resumeSha256: null,
      resumeUploadedAt: null,
      state: ProfileState.draft,
      publishedAt: null,
      postSearch: false,
      indeedSearch: false,
      matchVersion: 0,
      searchesVersion: null,
      createdAt: now,
      updatedAt: now,
      techStack: FakeProfilesRepository.techStack(userId, id, skills),
    };
    this.rows.push(profile);
    return profile;
  }

  async publish(
    userId: string,
    profileId: string,
    publishedAt: Date,
    searchesVersion: number,
    postSearch: boolean,
  ) {
    const profile = await this.findById(userId, profileId);
    if (profile?.state !== ProfileState.draft) return null;
    return Object.assign(profile, {
      state: ProfileState.published,
      publishedAt,
      searchesVersion:
        profile.postSearch === postSearch ? searchesVersion : null,
    });
  }

  async setPostSearch(userId: string, profileId: string, enabled: boolean) {
    const profile = await this.findById(userId, profileId);
    if (!profile) return null;
    return Object.assign(profile, { postSearch: enabled });
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
