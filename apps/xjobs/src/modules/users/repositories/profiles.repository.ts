import { Injectable } from '@nestjs/common';
import { ProfileState } from 'src/common/enums';
import { DatabaseService, type ProfileRow } from 'src/database';
import type { Place, PlaceLabels, ProfileWithSkills } from '../types';

/**
 * Injection token and contract for profile persistence. A user owns many profiles;
 * every lookup and write is filtered by both `userId` and `profileId`, so one user
 * can never reach another user's profile.
 */
export abstract class ProfilesRepository {
  /** Every published profile, of every user. */
  abstract listPublished(): Promise<ProfileWithSkills[]>;
  abstract findById(
    userId: string,
    profileId: string,
  ): Promise<ProfileWithSkills | null>;
  /** Publishes a draft for good; null when not the user's or already published. */
  abstract publish(
    userId: string,
    profileId: string,
    publishedAt: Date,
  ): Promise<ProfileWithSkills | null>;
  /** The labels of the regions, countries and cities given, a city's country included. */
  abstract placeLabels(places: Place[]): Promise<PlaceLabels>;
}

/**
 * The region codes, country codes and city ids the places name, each once.
 * City ids are lower-cased, as Postgres prints a uuid.
 */
function placeKeys(places: Place[]) {
  const regions = new Set<string>();
  const countries = new Set<string>();
  const cities = new Set<string>();
  for (const place of places) {
    if (place.kind === 'region') regions.add(place.code);
    else if (place.kind === 'country') countries.add(place.code);
    else if (place.kind === 'city') cities.add(place.id.toLowerCase());
  }
  return {
    regions: [...regions],
    countries: [...countries],
    cities: [...cities],
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
        cities.map((c) => [
          c.id.toLowerCase(),
          { name: c.name, countryCode: c.countryCode },
        ]),
      ),
    };
  }
}
