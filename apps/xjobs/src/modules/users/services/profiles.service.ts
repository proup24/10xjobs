import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { checkViolationMessage, type ProfileRow } from 'src/database';
import {
  Position,
  ProfileState,
  Seniority,
  SkillDomain,
  Technology,
} from 'src/common/enums';
import {
  type LocationsByArrangement,
  normalizeSeniorities,
  QuerySearchService,
  type QuerySearchProfileInput,
} from 'src/modules/queries';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { UsersService } from './users.service';
import type {
  PlacesByArrangement,
  ProfileFields,
  ProfileInput,
  ProfileView,
  ProfileWithSkills,
  PublishedProfileView,
  Salary,
  SkillInput,
  SpokenLanguage,
} from '../types';

/** The old shape: no longer written, and left out of the API. */
const OLD_SHAPE_COLUMNS = [
  'languages',
  'country',
  'city',
  'locations',
] as const satisfies readonly (keyof ProfileRow)[];
type OldShapeColumn = (typeof OLD_SHAPE_COLUMNS)[number];

/** The API shape of a profile: no storage key or old-shape columns, stack ordered by importance, then mastery. */
export function toProfileView(profile: ProfileWithSkills): ProfileView {
  const {
    techStack,
    resumeKey,
    resumeFilename,
    resumeSizeBytes,
    resumeSha256,
    resumeUploadedAt,
    places,
    spokenLanguages,
    contractTypes,
    salaryMin,
    salaryCurrency,
    salaryPeriod,
    ...columns
  } = profile;
  const row: Partial<typeof columns> = { ...columns };
  for (const column of OLD_SHAPE_COLUMNS) delete row[column];
  return {
    ...(row as Omit<typeof columns, OldShapeColumn>),
    // jsonb columns the database checks into these shapes (assert_places, assert_languages).
    locations: places as PlacesByArrangement,
    languages: spokenLanguages as SpokenLanguage[],
    // Non-null for every profile since the dev-profile cleanup; [] only guards the type.
    contractTypes: [...(contractTypes ?? [])],
    // All three or none (profiles_salary_all_or_none).
    salary:
      salaryMin !== null && salaryCurrency !== null && salaryPeriod !== null
        ? {
            min: salaryMin,
            currency: salaryCurrency,
            period: salaryPeriod as Salary['period'],
          }
        : null,
    techStack: techStack
      .map(({ technology, domain, mastery, importance }) => ({
        technology,
        domain,
        mastery,
        importance,
      }))
      .sort((a, b) => b.importance - a.importance || b.mastery - a.mastery),
    resume:
      resumeKey && resumeFilename && resumeSha256 && resumeUploadedAt
        ? {
            filename: resumeFilename,
            sizeBytes: resumeSizeBytes ?? 0,
            sha256: resumeSha256,
            uploadedAt: resumeUploadedAt,
          }
        : null,
  };
}

/** What query search builders are generated from; importance 0 skills stay in so the builders can drop them. */
export function toQuerySearchInput(
  profile: ProfileWithSkills,
): QuerySearchProfileInput {
  // Rows carry plain strings; the enums have the same values.
  return {
    position: profile.position as Position,
    // TODO: still the old `locations` text column, which profile writes now leave
    // null. Query generation moves to `places` with their labels next.
    locations: profile.locations as LocationsByArrangement,
    seniorities: profile.seniorities as Seniority[],
    skills: profile.techStack.map(
      ({ technology, domain, importance, mastery }) => ({
        technology: technology as Technology,
        domain: domain as SkillDomain,
        importance,
        mastery,
      }),
    ),
  };
}

/** A profile write as the API sends it: salary may be left out, and importance defaults to 5. */
export type ProfileWrite = Omit<ProfileInput, 'salary'> & {
  salary?: Salary | null;
  techStack: (Omit<SkillInput, 'importance'> & { importance?: number })[];
};

/** A replacement as the API sends it: the position is fixed at creation and cannot be sent. */
export type ProfileReplaceWrite = Omit<ProfileWrite, 'position'>;

/** The editable fields of a write, built field by field so a stray `position` can never reach a replace. */
function toFields(data: ProfileReplaceWrite): ProfileFields {
  return {
    locations: data.locations,
    languages: data.languages,
    yearsOfExperience: data.yearsOfExperience,
    timezoneCurrent: data.timezoneCurrent,
    timezoneMin: data.timezoneMin,
    timezoneMax: data.timezoneMax,
    engagements: data.engagements,
    seniorities: orderSeniorities(data.seniorities),
    contractTypes: data.contractTypes,
    salary: data.salary ?? null,
    acceptsAnyCurrency: data.acceptsAnyCurrency,
    acceptedCurrencies: data.acceptedCurrencies,
    noticePeriodDays: data.noticePeriodDays,
  };
}

function toSkills(techStack: ProfileReplaceWrite['techStack']): SkillInput[] {
  return techStack.map(({ technology, domain, mastery, importance }) => ({
    technology,
    domain,
    mastery,
    importance: importance ?? 5,
  }));
}

/**
 * Dedupes seniorities into Seniority enum order. A code the enum does not know
 * is kept, after the known ones, so the database refuses it with a 400 rather
 * than it being dropped silently.
 */
function orderSeniorities(seniorities: string[]): string[] {
  const known = new Set<string>(Object.values(Seniority));
  const unique = [...new Set(seniorities)];
  return [
    ...normalizeSeniorities(
      unique.filter((code) => known.has(code)) as Seniority[],
    ),
    ...unique.filter((code) => !known.has(code)),
  ];
}

/** Turns a database check violation (a bad code, a bad shape) into a 400 with its message; rethrows anything else. */
async function badRequestOnCheck<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    const message = checkViolationMessage(error);
    if (message !== null) throw new BadRequestException(message);
    throw error;
  }
}

const PROFILE_NOT_FOUND = 'Profile not found';
export const PROFILE_PUBLISHED =
  'A published profile cannot be changed; delete it and create a new one';

/** What regenerating published profiles needs. */
export interface RegenerateDeps {
  profiles: Pick<ProfilesRepository, 'listPublished'>;
  querySearch: Pick<
    QuerySearchService,
    'detach' | 'generate' | 'retireOutdated'
  >;
}

/**
 * Moves every published profile to the query search builders of the current
 * recipe, then retires the builders no profile uses any more. A plain
 * function, so scripts can run it without Nest injection.
 */
export async function regeneratePublished(
  deps: RegenerateDeps,
  toInput: (
    profile: ProfileWithSkills,
  ) => QuerySearchProfileInput = toQuerySearchInput,
): Promise<{ profiles: number; retired: number }> {
  const published = await deps.profiles.listPublished();
  for (const profile of published) {
    await deps.querySearch.detach(profile.id);
    await deps.querySearch.generate(profile.id, toInput(profile));
  }
  return {
    profiles: published.length,
    retired: await deps.querySearch.retireOutdated(),
  };
}

/** A user owns many profiles; every operation takes `(userId, profileId)` and checks ownership. */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesRepository,
    private readonly querySearch: QuerySearchService,
  ) {}

  /** 404s an unknown user, or a profile that is not this user's. */
  async getOrThrow(
    userId: string,
    profileId: string,
  ): Promise<ProfileWithSkills> {
    await this.users.getOrThrow(userId);
    const profile = await this.profiles.findById(userId, profileId);
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    return profile;
  }

  async list(userId: string): Promise<ProfileView[]> {
    await this.users.getOrThrow(userId);
    return (await this.profiles.list(userId)).map(toProfileView);
  }

  /** 404s like getOrThrow, and 409s a published profile: only drafts can change. */
  async getDraftOrThrow(
    userId: string,
    profileId: string,
  ): Promise<ProfileWithSkills> {
    const profile = await this.getOrThrow(userId, profileId);
    if (profile.state !== ProfileState.draft)
      throw new ConflictException(PROFILE_PUBLISHED);
    return profile;
  }

  /** After a guarded write matched nothing: 404 if the profile is gone, otherwise it was published. */
  private async rejectWrite(userId: string, profileId: string): Promise<never> {
    await this.getDraftOrThrow(userId, profileId);
    // Still a draft yet the write missed: treat it as a lost race on publish.
    throw new ConflictException(PROFILE_PUBLISHED);
  }

  async get(userId: string, profileId: string): Promise<ProfileView> {
    return toProfileView(await this.getOrThrow(userId, profileId));
  }

  /** New profiles start as unpublished drafts. */
  async create(userId: string, data: ProfileWrite): Promise<ProfileView> {
    await this.users.getOrThrow(userId);
    return toProfileView(
      await badRequestOnCheck(
        this.profiles.create(
          userId,
          { position: data.position, ...toFields(data) },
          toSkills(data.techStack),
        ),
      ),
    );
  }

  /** Replaces a draft's editable fields and whole tech stack; the position is kept. Published profiles are frozen. */
  async replace(
    userId: string,
    profileId: string,
    data: ProfileReplaceWrite,
  ): Promise<ProfileView> {
    await this.getDraftOrThrow(userId, profileId);
    const profile = await badRequestOnCheck(
      this.profiles.replace(
        userId,
        profileId,
        toFields(data),
        toSkills(data.techStack),
      ),
    );
    if (!profile) return this.rejectWrite(userId, profileId);
    return toProfileView(profile);
  }

  /**
   * The only way out of a profile, published or not: releases its shared query
   * search builders (each loses one associated profile and goes inactive at 0),
   * then deletes the row. The caller removes its resume file.
   */
  async delete(userId: string, profileId: string): Promise<void> {
    const profile = await this.getOrThrow(userId, profileId);
    await this.querySearch.detach(profile.id);
    if (!(await this.profiles.delete(userId, profile.id)))
      throw new NotFoundException(PROFILE_NOT_FOUND);
  }

  /**
   * Releases the builders of every profile a user owns, so the shared counters
   * stay right when the user's rows cascade away.
   */
  async releaseAll(userId: string): Promise<void> {
    for (const profile of await this.profiles.list(userId)) {
      await this.querySearch.detach(profile.id);
    }
  }

  /**
   * Re-attaches every published profile to the builders of the current recipe,
   * then retires the outdated builders nothing uses any more. Run once after a
   * recipe version bump; running it again changes nothing.
   */
  async regeneratePublished(): Promise<{ profiles: number; retired: number }> {
    return regeneratePublished({
      profiles: this.profiles,
      querySearch: this.querySearch,
    });
  }

  /**
   * Publishes a draft for good. Its shared query search builders are attached
   * first, so a failure leaves it a draft; after this it can only be deleted.
   */
  async publish(
    userId: string,
    profileId: string,
  ): Promise<PublishedProfileView> {
    const profile = await this.getDraftOrThrow(userId, profileId);
    const querySearches = await this.querySearch.generate(
      profile.id,
      toQuerySearchInput(profile),
    );
    const published = await this.profiles.publish(
      userId,
      profile.id,
      new Date(),
    );
    if (!published) {
      // Deleted meanwhile: release what was just attached so counts stay right.
      // Published meanwhile: the winner attached the same builders; keep them.
      if (!(await this.profiles.findById(userId, profile.id)))
        await this.querySearch.detach(profile.id);
      return this.rejectWrite(userId, profile.id);
    }
    return { ...toProfileView(published), querySearches };
  }
}
