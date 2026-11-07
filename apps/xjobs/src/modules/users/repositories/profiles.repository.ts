import { Injectable } from '@nestjs/common';
import { ProfileState } from 'src/common/enums';
import {
  DatabaseService,
  type ProfileRow,
  type ProfileSkillRow,
} from 'src/database';
import type { DatabaseTransaction } from '@xjobs/database';
import type {
  Place,
  PlaceLabels,
  ProfileFields,
  ProfileInput,
  ProfileWithSkills,
  ResumeMeta,
  SkillInput,
} from '../types';

/**
 * Injection token and contract for profile persistence. A user owns many profiles;
 * every lookup and write is filtered by both `userId` and `profileId`, so one user
 * can never reach another user's profile.
 */
export abstract class ProfilesRepository {
  abstract list(userId: string): Promise<ProfileWithSkills[]>;
  /** Every published profile, of every user. */
  abstract listPublished(): Promise<ProfileWithSkills[]>;
  abstract findById(
    userId: string,
    profileId: string,
  ): Promise<ProfileWithSkills | null>;
  /** Creates a profile with its whole tech stack, atomically. */
  abstract create(
    userId: string,
    data: ProfileInput,
    skills: SkillInput[],
  ): Promise<ProfileWithSkills>;
  /**
   * Replaces a draft profile's editable fields and whole tech stack atomically.
   * Null when the profile is not the user's or is published: published
   * profiles are frozen. The position never changes.
   */
  abstract replace(
    userId: string,
    profileId: string,
    data: ProfileFields,
    skills: SkillInput[],
  ): Promise<ProfileWithSkills | null>;
  abstract delete(userId: string, profileId: string): Promise<boolean>;
  /** Publishes a draft for good; null when not the user's or already published. */
  abstract publish(
    userId: string,
    profileId: string,
    publishedAt: Date,
  ): Promise<ProfileWithSkills | null>;
  /** Sets or clears a draft's resume; false when not the user's or published. */
  abstract setResume(
    userId: string,
    profileId: string,
    meta: ResumeMeta | null,
  ): Promise<boolean>;
  /** The labels of the regions, countries and cities given, a city's country included. */
  abstract placeLabels(places: Place[]): Promise<PlaceLabels>;
}

/** The region codes, country codes and city ids the places name, each once. */
function placeKeys(places: Place[]) {
  const regions = new Set<string>();
  const countries = new Set<string>();
  const cities = new Set<string>();
  for (const place of places) {
    if (place.kind === 'region') regions.add(place.code);
    else if (place.kind === 'country') countries.add(place.code);
    else if (place.kind === 'city') cities.add(place.id);
  }
  return {
    regions: [...regions],
    countries: [...countries],
    cities: [...cities],
  };
}

/**
 * The columns a profile's editable fields are stored in. The old `languages`,
 * `country`, `city` and `locations` columns are no longer written.
 */
export function toProfileColumns(fields: ProfileFields) {
  // Field by field, so nothing outside the editable fields reaches a write.
  return {
    places: fields.locations,
    spokenLanguages: fields.languages,
    yearsOfExperience: fields.yearsOfExperience,
    timezoneCurrent: fields.timezoneCurrent,
    timezoneMin: fields.timezoneMin,
    timezoneMax: fields.timezoneMax,
    engagements: fields.engagements,
    seniorities: fields.seniorities,
    contractTypes: fields.contractTypes,
    salaryMin: fields.salary?.min ?? null,
    salaryCurrency: fields.salary?.currency ?? null,
    salaryPeriod: fields.salary?.period ?? null,
    acceptsAnyCurrency: fields.acceptsAnyCurrency,
    acceptedCurrencies: fields.acceptedCurrencies,
    noticePeriodDays: fields.noticePeriodDays,
  };
}

@Injectable()
export class PrismaProfilesRepository extends ProfilesRepository {
  constructor(private readonly database: DatabaseService) {
    super();
  }

  private get orm() {
    return this.database.db.orm.public;
  }

  private async withSkills(profile: ProfileRow): Promise<ProfileWithSkills> {
    const techStack = await this.orm.ProfileSkill.where({
      profileId: profile.id,
    }).all();
    return { ...profile, techStack };
  }

  private static async writeSkills(
    tx: DatabaseTransaction,
    userId: string,
    profileId: string,
    skills: SkillInput[],
  ): Promise<ProfileSkillRow[]> {
    await tx.orm.public.ProfileSkill.where({ profileId }).deleteAll();
    const techStack: ProfileSkillRow[] = [];
    for (const skill of skills) {
      techStack.push(
        await tx.orm.public.ProfileSkill.create({
          ...skill,
          userId,
          profileId,
        }),
      );
    }
    return techStack;
  }

  async list(userId: string): Promise<ProfileWithSkills[]> {
    const profiles = await this.orm.Profile.where({ userId })
      .orderBy((p) => p.createdAt.asc())
      .all();
    return Promise.all(profiles.map((profile) => this.withSkills(profile)));
  }

  async listPublished(): Promise<ProfileWithSkills[]> {
    const profiles = await this.orm.Profile.where({
      state: ProfileState.published,
    })
      .orderBy((p) => p.createdAt.asc())
      .all();
    return Promise.all(profiles.map((profile) => this.withSkills(profile)));
  }

  async findById(
    userId: string,
    profileId: string,
  ): Promise<ProfileWithSkills | null> {
    const profile = await this.orm.Profile.where({
      id: profileId,
      userId,
    }).first();
    return profile ? this.withSkills(profile) : null;
  }

  create(
    userId: string,
    data: ProfileInput,
    skills: SkillInput[],
  ): Promise<ProfileWithSkills> {
    return this.database.db.transaction(async (tx) => {
      const { position, ...fields } = data;
      const profile = await tx.orm.public.Profile.create({
        ...toProfileColumns(fields),
        position,
        userId,
      });
      const techStack = await PrismaProfilesRepository.writeSkills(
        tx,
        userId,
        profile.id,
        skills,
      );
      return { ...profile, techStack };
    });
  }

  replace(
    userId: string,
    profileId: string,
    data: ProfileFields,
    skills: SkillInput[],
  ): Promise<ProfileWithSkills | null> {
    return this.database.db.transaction(async (tx) => {
      // Matching drafts only: a profile published meanwhile is left untouched.
      const profile = await tx.orm.public.Profile.where({
        id: profileId,
        userId,
        state: ProfileState.draft,
      }).update(toProfileColumns(data));
      if (!profile) return null;
      const techStack = await PrismaProfilesRepository.writeSkills(
        tx,
        userId,
        profile.id,
        skills,
      );
      return { ...profile, techStack };
    });
  }

  async delete(userId: string, profileId: string): Promise<boolean> {
    const deleted = await this.orm.Profile.where({
      id: profileId,
      userId,
    }).delete();
    return deleted !== null;
  }

  async publish(
    userId: string,
    profileId: string,
    publishedAt: Date,
  ): Promise<ProfileWithSkills | null> {
    const profile = await this.orm.Profile.where({
      id: profileId,
      userId,
      state: ProfileState.draft,
    }).update({ state: ProfileState.published, publishedAt });
    return profile ? this.withSkills(profile) : null;
  }

  async setResume(
    userId: string,
    profileId: string,
    meta: ResumeMeta | null,
  ): Promise<boolean> {
    const profile = await this.orm.Profile.where({
      id: profileId,
      userId,
      state: ProfileState.draft,
    }).update({
      resumeKey: meta?.key ?? null,
      resumeFilename: meta?.filename ?? null,
      resumeSizeBytes: meta?.sizeBytes ?? null,
      resumeSha256: meta?.sha256 ?? null,
      resumeUploadedAt: meta?.uploadedAt ?? null,
    });
    return profile !== null;
  }

  async placeLabels(places: Place[]): Promise<PlaceLabels> {
    const keys = placeKeys(places);
    const cities = keys.cities.length
      ? await this.orm.City.where((city) => city.id.in(keys.cities)).all()
      : [];
    const countryCodes = [
      ...new Set([...keys.countries, ...cities.map((c) => c.countryCode)]),
    ];
    const countries = countryCodes.length
      ? await this.orm.Country.where((country) =>
          country.code.in(countryCodes),
        ).all()
      : [];
    const regions = keys.regions.length
      ? await this.orm.RegionTerm.where((region) =>
          region.code.in(keys.regions),
        ).all()
      : [];
    return {
      regions: new Map(regions.map((r) => [r.code, r.label])),
      countries: new Map(countries.map((c) => [c.code, c.label])),
      cities: new Map(
        cities.map((c) => [c.id, { name: c.name, countryCode: c.countryCode }]),
      ),
    };
  }
}
