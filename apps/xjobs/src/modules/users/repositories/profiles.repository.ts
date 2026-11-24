import { Injectable } from '@nestjs/common';
import { ProfileState } from 'src/common/enums';
import { DatabaseService, type ProfileRow } from 'src/database';
import type { SwitchColumn, SwitchFlags } from 'src/modules/queries';
import type { Place, PlaceLabels, ProfileWithSkills } from '../types';

/**
 * Injection token and contract for profile persistence. A user owns many profiles;
 * every lookup and write is filtered by both `userId` and `profileId`, so one user
 * can never reach another user's profile.
 */
export abstract class ProfilesRepository {
  /** Every published profile, of every user. */
  abstract listPublished(): Promise<ProfileWithSkills[]>;
  /** Published profiles whose searches were attached for an older version than their match version (or never), oldest update first. */
  abstract listSearchesBehind(limit: number): Promise<ProfileWithSkills[]>;
  abstract findById(
    userId: string,
    profileId: string,
  ): Promise<ProfileWithSkills | null>;
  /**
   * Publishes a draft for good, recording the version its searches were
   * attached for; null when not the user's or already published. When any
   * search switch is no longer as in `switches` (the values the searches were
   * built from), `searchesVersion` stays null so the search sync rebuilds them.
   */
  abstract publish(
    userId: string,
    profileId: string,
    publishedAt: Date,
    searchesVersion: number,
    switches: SwitchFlags,
  ): Promise<ProfileWithSkills | null>;
  /** Stores one search switch; null when the profile is not the user's. Allowed on published profiles. */
  abstract setSwitch(
    userId: string,
    profileId: string,
    column: SwitchColumn,
    enabled: boolean,
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

  async listSearchesBehind(limit: number): Promise<ProfileWithSkills[]> {
    const { raw, orm } = this.database.db;
    const rows = await this.database.db.query(
      raw.sql`SELECT id FROM profiles
        WHERE state = 'published'
          AND ("searchesVersion" IS NULL OR "searchesVersion" < "matchVersion")
        ORDER BY "updatedAt" ASC, id ASC
        LIMIT ${limit}::int`
        .returnsRow({ id: 'pg/uuid@1' })
        .build(),
    );
    if (rows.length === 0) return [];
    // The profile row (and its matchVersion) is read before its skills: skills
    // newer than the version only make the next tick reapply.
    const ids = rows.map((row) => row.id as string);
    const profiles = await orm.public.Profile.where((p) => p.id.in(ids))
      .orderBy((p) => p.updatedAt.asc())
      .orderBy((p) => p.id.asc())
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
    searchesVersion: number,
    switches: SwitchFlags,
  ): Promise<ProfileWithSkills | null> {
    const { db } = this.database;
    // The CASE reads the row as locked by this UPDATE, so a switch committed
    // after the caller's read is seen; one committed after this sees a
    // published profile and attaches or detaches its builders itself. Every
    // switch column of `SEARCH_SWITCHES` is compared.
    const rows = await db.query(
      db.raw.sql`UPDATE profiles
        SET state = 'published',
          "publishedAt" = ${publishedAt.toISOString()}::timestamptz,
          "searchesVersion" = CASE
            WHEN "postSearch" = ${switches.postSearch}::boolean
              AND "indeedSearch" = ${switches.indeedSearch}::boolean
            THEN ${searchesVersion}::int ELSE NULL END
        WHERE id = ${profileId}::uuid AND "userId" = ${userId}::uuid
          AND state = 'draft'
        RETURNING id`
        .returnsRow({ id: 'pg/uuid@1' })
        .build(),
    );
    return rows.length ? this.findById(userId, profileId) : null;
  }

  async setSwitch(
    userId: string,
    profileId: string,
    column: SwitchColumn,
    enabled: boolean,
  ): Promise<ProfileWithSkills | null> {
    const profile = await this.orm.Profile.where({
      id: profileId,
      userId,
    }).update({ [column]: enabled });
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
