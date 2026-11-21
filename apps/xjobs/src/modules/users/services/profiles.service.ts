import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Channel,
  ErrorCode,
  ProfileState,
  SkillDomain,
} from 'src/common/enums';
import {
  QuerySearchService,
  type QuerySearchProfileInput,
} from 'src/modules/queries';
import { StorageService } from 'src/modules/storage';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { postRecipes } from 'src/modules/queries/posts';
import { describeError } from 'src/utils';
import { PostSearchAccess } from './post-search-access';
import { UsersService } from './users.service';
import { allPlaces, placeTexts } from './place-labels';
import type {
  PlaceLabels,
  PlacesByArrangement,
  PostSearchView,
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
export function labelsFor(
  profiles: Pick<ProfilesRepository, 'placeLabels'>,
  profile: ProfileWithSkills,
): Promise<PlaceLabels> {
  return profiles.placeLabels(allPlaces(profilePlaces(profile)));
}

export const ELIGIBILITY_REQUIRED =
  'set your country of residence and answer the visa sponsorship question before publishing';

const PROFILE_NOT_FOUND = 'Profile not found';
export const PROFILE_PUBLISHED = 'This profile is already published';
export const PROFILE_NOT_PUBLISHED = 'This profile is not published';

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

function notPublishedConflict(): ConflictException {
  return new ConflictException({
    message: PROFILE_NOT_PUBLISHED,
    code: ErrorCode.PROFILE_NOT_PUBLISHED,
  });
}

const regenerateLogger = new Logger('Regenerate');
const deleteLogger = new Logger('DeleteProfile');

/** The web app's resume bucket and folder layout (`apps/web/src/lib/resume/key.ts`). */
export const RESUMES_BUCKET = 'resumes';
export const profileFolder = (userId: string, profileId: string): string =>
  `${userId}/${profileId}`;

/** What regenerating published profiles needs. */
export interface RegenerateDeps {
  profiles: Pick<ProfilesRepository, 'listPublished' | 'placeLabels'>;
  /** Whether the user may have post builders; a switched-on profile of anyone else gets none. */
  postsAllowed: (userId: string) => boolean;
  querySearch: Pick<
    QuerySearchService,
    'recipesFor' | 'replace' | 'retireOutdated'
  >;
}

export interface RegenerateResult {
  /** Published profiles read. */
  profiles: number;
  /** Profiles whose regeneration threw; the others still ran, and so did retiring. */
  failed: number;
  /** Profiles `replace` skipped: unpublished or post search switched since the read. */
  skipped: number;
  retired: number;
  /** Profiles with post search on that kept their post builders. */
  postsKept: number;
  /** Profiles with post search on whose owner is not listed: their post builders were not attached. */
  postsDropped: number;
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
): Promise<RegenerateResult> {
  const published = await deps.profiles.listPublished();
  let postsKept = 0;
  let postsDropped = 0;
  let failed = 0;
  let skipped = 0;
  for (const profile of published) {
    try {
      // Labels first: a missing one throws before the profile's builders change.
      const labels = await labelsFor(deps.profiles, profile);
      const posts = profile.postSearch && deps.postsAllowed(profile.userId);
      const recipes = deps.querySearch.recipesFor(toInput(profile, labels), {
        posts,
      });
      const result = await deps.querySearch.replace(profile.id, recipes, {
        searchesVersion: profile.matchVersion,
        postSearch: profile.postSearch,
      });
      if (result.skipped) {
        skipped += 1;
        continue;
      }
      if (posts) postsKept += 1;
      else if (profile.postSearch) postsDropped += 1;
    } catch (error) {
      // One broken profile must not stop the rest. Ids and codes only.
      failed += 1;
      regenerateLogger.error(
        `Regenerate failed profile=${profile.id}: ${describeError(error)}`,
      );
    }
  }
  return {
    profiles: published.length,
    failed,
    skipped,
    retired: await deps.querySearch.retireOutdated(),
    postsKept,
    postsDropped,
  };
}

/** A user owns many profiles; every operation takes `(userId, profileId)` and checks ownership. */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesRepository,
    private readonly querySearch: QuerySearchService,
    private readonly postSearch: PostSearchAccess,
    private readonly storage: StorageService,
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
  async regeneratePublished(): Promise<RegenerateResult> {
    return regeneratePublished({
      profiles: this.profiles,
      querySearch: this.querySearch,
      postsAllowed: (userId) => this.postSearch.allows(userId),
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
      { posts: profile.postSearch && this.postSearch.allows(userId) },
    );
    const published = await this.profiles.publish(
      userId,
      profile.id,
      new Date(),
      profile.matchVersion,
      profile.postSearch,
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

  /**
   * Deletes a published profile and releases its query search builders in one
   * transaction. 404 like getOrThrow; 409 for a draft. Deleted or unpublished
   * meanwhile (including a repeated delete) is a 404.
   *
   * The profile's resume files go first, with the service role: the user's own
   * Storage policy keeps a published profile's live file, and once the row is
   * gone nobody could reach the folder. A storage failure is a 503 that keeps
   * the row and its searches, so a retry (with an emptied folder) finishes.
   */
  async deletePublished(
    userId: string,
    profileId: string,
  ): Promise<{ id: string }> {
    const profile = await this.getOrThrow(userId, profileId);
    if (profile.state !== ProfileState.published) throw notPublishedConflict();
    try {
      await this.storage.deletePrefix(
        RESUMES_BUCKET,
        profileFolder(userId, profile.id),
      );
    } catch (error) {
      deleteLogger.error(
        `Resume removal failed for profile ${profile.id} (user ${userId}): ${describeError(error)}`,
      );
      throw new ServiceUnavailableException(
        'Could not remove the resume files; try again',
      );
    }
    if (!(await this.querySearch.releaseAndDelete(profile.id)))
      throw new NotFoundException(PROFILE_NOT_FOUND);
    return { id: profile.id };
  }

  /** The switch, for any owner: stored value, whether the owner may turn it on, and the searches it gives. */
  async postSearchStatus(
    userId: string,
    profileId: string,
  ): Promise<PostSearchView> {
    const profile = await this.getOrThrow(userId, profileId);
    return this.postSearchView(userId, profile);
  }

  /**
   * Turns post search on or off, the one change a published profile accepts.
   * Only allow-listed users; on a published profile the post builders are
   * attached or detached at once (a draft gets them when published).
   */
  async setPostSearch(
    userId: string,
    profileId: string,
    enabled: boolean,
  ): Promise<PostSearchView> {
    const { postSearch: previous } = await this.getOrThrow(userId, profileId);
    if (!this.postSearch.allows(userId))
      throw new ForbiddenException({
        message: 'Post search is not available for this account',
        code: ErrorCode.POST_SEARCH_NOT_ALLOWED,
      });
    const profile = await this.profiles.setPostSearch(
      userId,
      profileId,
      enabled,
    );
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    if (profile.state === ProfileState.published) {
      try {
        if (enabled)
          await this.querySearch.attachPosts(
            profile.id,
            toQuerySearchInput(
              profile,
              await labelsFor(this.profiles, profile),
            ),
          );
        else
          await this.querySearch.detachChannel(
            profile.id,
            Channel.LINKEDIN_POSTS,
          );
      } catch (error) {
        // Keep the flag true to the builders: put it back before failing.
        await this.profiles.setPostSearch(userId, profileId, previous);
        throw error;
      }
    }
    return this.postSearchView(userId, profile);
  }

  private async postSearchView(
    userId: string,
    profile: ProfileWithSkills,
  ): Promise<PostSearchView> {
    const input = toQuerySearchInput(
      profile,
      await labelsFor(this.profiles, profile),
    );
    return {
      enabled: profile.postSearch,
      allowed: this.postSearch.allows(userId),
      searches: postRecipes(input).length,
    };
  }
}
