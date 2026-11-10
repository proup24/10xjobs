import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { checkViolationMessage } from 'src/database';
import {
  ErrorCode,
  ProfileState,
  Seniority,
  SkillDomain,
} from 'src/common/enums';
import {
  normalizeSeniorities,
  QuerySearchService,
  type QuerySearchProfileInput,
} from 'src/modules/queries';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { UsersService } from './users.service';
import { allPlaces, placeTexts } from './place-labels';
import type {
  PlaceLabels,
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

/** The API shape of a profile: no storage key, stack ordered by importance, then mastery. */
export function toProfileView(profile: ProfileWithSkills): ProfileView {
  const {
    techStack,
    resumeKey,
    resumeFilename,
    resumeSizeBytes,
    resumeSha256,
    resumeUploadedAt,
    locations,
    languages,
    contractTypes,
    salaryMin,
    salaryCurrency,
    salaryPeriod,
    ...columns
  } = profile;
  return {
    ...columns,
    // jsonb columns the database checks into these shapes (assert_places, assert_languages).
    locations: locations as PlacesByArrangement,
    languages: languages as SpokenLanguage[],
    contractTypes: [...contractTypes],
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

/**
 * What query search builders are generated from: the codes as stored, and the
 * places as the texts their labels give. Importance 0 skills stay in so the
 * builders can drop them.
 */
export function toQuerySearchInput(
  profile: ProfileWithSkills,
  labels: PlaceLabels,
): QuerySearchProfileInput {
  return {
    position: profile.position,
    locations: placeTexts(profilePlaces(profile), labels),
    seniorities: [...profile.seniorities],
    skills: profile.techStack.map(
      ({ technology, domain, importance, mastery }) => ({
        technology,
        domain: domain as SkillDomain,
        importance,
        mastery,
      }),
    ),
  };
}

/** The jsonb `locations` column, which the database checks into this shape (assert_places). */
function profilePlaces(profile: ProfileWithSkills): PlacesByArrangement {
  return profile.locations as PlacesByArrangement;
}

/** The labels of every place the profile lists. */
function labelsFor(
  profiles: Pick<ProfilesRepository, 'placeLabels'>,
  profile: ProfileWithSkills,
): Promise<PlaceLabels> {
  return profiles.placeLabels(allPlaces(profilePlaces(profile)));
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
    ...normalizeSeniorities(unique.filter((code) => known.has(code))),
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

export const ELIGIBILITY_REQUIRED =
  'set your country of residence and answer the visa sponsorship question before publishing';

const PROFILE_NOT_FOUND = 'Profile not found';
export const PROFILE_PUBLISHED =
  'A published profile cannot be changed; delete it and create a new one';

function publishedConflict(): ConflictException {
  return new ConflictException({
    message: PROFILE_PUBLISHED,
    code: ErrorCode.PROFILE_PUBLISHED,
  });
}

/** What regenerating published profiles needs. */
export interface RegenerateDeps {
  profiles: Pick<ProfilesRepository, 'listPublished' | 'placeLabels'>;
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
    labels: PlaceLabels,
  ) => QuerySearchProfileInput = toQuerySearchInput,
): Promise<{ profiles: number; retired: number }> {
  const published = await deps.profiles.listPublished();
  for (const profile of published) {
    // Labels first: a missing one throws before the profile loses its builders.
    const labels = await labelsFor(deps.profiles, profile);
    await deps.querySearch.detach(profile.id);
    await deps.querySearch.generate(profile.id, toInput(profile, labels));
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
    try {
      await this.users.getOrThrow(userId);
    } catch (error) {
      // A deleted user and another user's profile look the same to the caller.
      if (error instanceof NotFoundException)
        throw new NotFoundException(PROFILE_NOT_FOUND);
      throw error;
    }
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
    if (profile.state !== ProfileState.draft) throw publishedConflict();
    return profile;
  }

  /** After a guarded write matched nothing: 404 if the profile is gone, otherwise it was published. */
  private async rejectWrite(userId: string, profileId: string): Promise<never> {
    await this.getDraftOrThrow(userId, profileId);
    // Still a draft yet the write missed: treat it as a lost race on publish.
    throw publishedConflict();
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
    const { residenceCountry, acceptsSponsorship } =
      await this.users.eligibility(userId);
    if (residenceCountry === null || acceptsSponsorship === null)
      throw new ConflictException({
        message: ELIGIBILITY_REQUIRED,
        code: ErrorCode.ELIGIBILITY_REQUIRED,
      });
    const querySearches = await this.querySearch.generate(
      profile.id,
      toQuerySearchInput(profile, await labelsFor(this.profiles, profile)),
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
