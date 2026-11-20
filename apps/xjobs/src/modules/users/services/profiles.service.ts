import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode, ProfileState, SkillDomain } from 'src/common/enums';
import {
  QuerySearchService,
  type QuerySearchProfileInput,
} from 'src/modules/queries';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { UsersService } from './users.service';
import { allPlaces, placeTexts } from './place-labels';
import type {
  PlaceLabels,
  PlacesByArrangement,
  ProfileView,
  ProfileWithSkills,
  PublishedProfileView,
  Salary,
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
    // Engine-only switch: not part of the API shape.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    postSearch,
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
    languages: [
      ...new Set(
        (profile.languages as SpokenLanguage[]).map(({ lang }) =>
          lang.toLowerCase(),
        ),
      ),
    ],
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

export const ELIGIBILITY_REQUIRED =
  'set your country of residence and answer the visa sponsorship question before publishing';

const PROFILE_NOT_FOUND = 'Profile not found';
export const PROFILE_PUBLISHED =
  'A published profile cannot be changed; delete it and create a new one';

/** A deleted user and another user's profile look the same to the caller: 'Profile not found'. */
async function profileNotFoundIfUserGone<T>(lookup: Promise<T>): Promise<T> {
  try {
    return await lookup;
  } catch (error) {
    if (error instanceof NotFoundException)
      throw new NotFoundException(PROFILE_NOT_FOUND);
    throw error;
  }
}

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
    await profileNotFoundIfUserGone(this.users.getOrThrow(userId));
    const profile = await this.profiles.findById(userId, profileId);
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    return profile;
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
      await profileNotFoundIfUserGone(this.users.eligibility(userId));
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
