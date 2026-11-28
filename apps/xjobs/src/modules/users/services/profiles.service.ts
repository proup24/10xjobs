import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ErrorCode, ProfileState, SkillDomain } from 'src/common/enums';
import {
  QuerySearchService,
  SEARCH_SWITCHES,
  SEARCH_SWITCHES_TOKEN,
  switchFlags,
  switchesInEffect,
  type IndeedMarket,
  type LocationArrangement,
  type PlaceCountry,
  type QuerySearchProfileInput,
  type SearchSwitch,
  type SearchSwitchKey,
} from 'src/modules/queries';
import { PostsBudgetService, type PostsBudgetDay } from 'src/modules/segments';
import { StorageService } from 'src/modules/storage';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { describeError } from 'src/utils';
import { UsersService } from './users.service';
import { allPlaces, placeTexts } from './place-labels';
import type {
  Place,
  PlaceLabels,
  PlacesByArrangement,
  ProfileView,
  ProfileWithSkills,
  PublishedProfileView,
  Salary,
  SearchSwitchView,
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
    // Engine-only switches: not part of the API shape.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    postSearch,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    indeedSearch,
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
  markets: readonly IndeedMarket[] = [],
): QuerySearchProfileInput {
  const places = profilePlaces(profile);
  return {
    position: profile.position,
    locations: placeTexts(places, labels),
    placeCountries: placeCountries(places, labels),
    indeedMarkets: markets,
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

/** Per arrangement, the countries the places sit in; regions and worldwide have none. */
function placeCountries(
  places: PlacesByArrangement,
  labels: PlaceLabels,
): Record<LocationArrangement, PlaceCountry[]> {
  const of = (list: Place[]): PlaceCountry[] =>
    list.flatMap((place): PlaceCountry[] => {
      if (place.kind === 'country')
        return [{ countryCode: place.code, city: null }];
      if (place.kind === 'city') {
        const city = labels.cities.get(place.id.toLowerCase());
        if (!city) throw new Error(`No label for city '${place.id}'`);
        return [{ countryCode: city.countryCode, city: city.name }];
      }
      return [];
    });
  return {
    remote: of(places.remote),
    hybrid: of(places.hybrid),
    onsite: of(places.onsite),
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

/** The search input of a profile: its place labels and the Indeed markets, read together. */
export async function searchInputFor(
  profiles: Pick<ProfilesRepository, 'placeLabels' | 'indeedMarkets'>,
  profile: ProfileWithSkills,
): Promise<QuerySearchProfileInput> {
  const [labels, markets] = await Promise.all([
    labelsFor(profiles, profile),
    profiles.indeedMarkets(),
  ]);
  return toQuerySearchInput(profile, labels, markets);
}

export const ELIGIBILITY_REQUIRED =
  'set your country of residence and answer the visa sponsorship question before publishing';

const PROFILE_NOT_FOUND = 'Profile not found';
const SWITCH_NOT_FOUND = 'Search switch not found';
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
const switchLogger = new Logger('SearchSwitches');

/** The web app's resume bucket and folder layout (`apps/web/src/lib/resume/key.ts`). */
export const RESUMES_BUCKET = 'resumes';
export const profileFolder = (userId: string, profileId: string): string =>
  `${userId}/${profileId}`;

/** What regenerating published profiles needs. */
export interface RegenerateDeps {
  profiles: Pick<
    ProfilesRepository,
    'listPublished' | 'placeLabels' | 'indeedMarkets'
  >;
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
  /** Profiles `replace` skipped: unpublished or a search switch moved since the read. */
  skipped: number;
  retired: number;
  /** Per switch, the profiles regenerated with it in effect (their builders kept). */
  switchesOn: Record<SearchSwitchKey, number>;
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
    markets: readonly IndeedMarket[],
  ) => QuerySearchProfileInput = toQuerySearchInput,
): Promise<RegenerateResult> {
  const published = await deps.profiles.listPublished();
  const switchesOn = Object.fromEntries(
    SEARCH_SWITCHES.map((sw) => [sw.key, 0]),
  ) as Record<SearchSwitchKey, number>;
  let failed = 0;
  let skipped = 0;
  for (const profile of published) {
    try {
      // Labels first: a missing one throws before the profile's builders change.
      const [labels, markets] = await Promise.all([
        labelsFor(deps.profiles, profile),
        deps.profiles.indeedMarkets(),
      ]);
      const switches = switchFlags(profile);
      const recipes = deps.querySearch.recipesFor(
        toInput(profile, labels, markets),
        switches,
      );
      const result = await deps.querySearch.replace(profile.id, recipes, {
        searchesVersion: profile.matchVersion,
        switches,
      });
      if (result.skipped) {
        skipped += 1;
        continue;
      }
      for (const sw of switchesInEffect(switches)) switchesOn[sw.key] += 1;
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
    switchesOn,
  };
}

/** A user owns many profiles; every operation takes `(userId, profileId)` and checks ownership. */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesRepository,
    private readonly querySearch: QuerySearchService,
    private readonly storage: StorageService,
    private readonly postsBudget: PostsBudgetService,
    @Inject(SEARCH_SWITCHES_TOKEN)
    private readonly switches: readonly SearchSwitch[] = SEARCH_SWITCHES,
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

    const switches = switchFlags(profile);
    const querySearches = await this.querySearch.generate(
      profile.id,
      await searchInputFor(this.profiles, profile),
      switches,
    );
    const published = await this.profiles.publish(
      userId,
      profile.id,
      new Date(),
      profile.matchVersion,
      switches,
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

  /** The profile's available search switches, in registry order; 404 like getOrThrow. */
  async searchSwitches(
    userId: string,
    profileId: string,
  ): Promise<SearchSwitchView[]> {
    const profile = await this.getOrThrow(userId, profileId);
    const available = this.switches.filter((sw) => sw.available);
    if (available.length === 0) return [];
    const input = await this.searchInput(profile);
    const budget = await this.budgetFor(available, profile);
    return available.map((sw) => switchView(sw, profile, input, budget));
  }

  /**
   * Turns a search switch on or off, the one change a published profile
   * accepts, for any user. An unknown or unavailable key is a 404 before any
   * write. On a published profile the switch's builders are attached or
   * detached at once (a draft gets them when published); if that fails, the
   * flag is put back.
   */
  async setSearchSwitch(
    userId: string,
    profileId: string,
    key: string,
    enabled: boolean,
  ): Promise<SearchSwitchView> {
    const sw = this.switches.find(
      (candidate) => candidate.key === key && candidate.available,
    );
    if (!sw) throw new NotFoundException(SWITCH_NOT_FOUND);
    const current = await this.getOrThrow(userId, profileId);
    const previous = current[sw.column];
    // Before the write: a failed label lookup must leave the flag untouched.
    const input = await this.searchInput(current);
    const profile = await this.profiles.setSwitch(
      userId,
      profileId,
      sw.column,
      enabled,
    );
    if (!profile) throw new NotFoundException(PROFILE_NOT_FOUND);
    if (profile.state === ProfileState.published) {
      try {
        if (enabled) await this.querySearch.attachSwitch(profile.id, sw, input);
        else if (sw.channel)
          await this.querySearch.detachChannel(profile.id, sw.channel);
      } catch (error) {
        // Keep the flag true to the builders: put it back before failing.
        await this.profiles.setSwitch(userId, profileId, sw.column, previous);
        throw error;
      }
    }
    return switchView(sw, profile, input, await this.budgetFor([sw], profile));
  }

  /**
   * Today's posts budget, read once, only when an available posts switch is
   * on; a failed read answers null (not paused) rather than failing the view.
   */
  private async budgetFor(
    switches: readonly SearchSwitch[],
    profile: ProfileWithSkills,
  ): Promise<PostsBudgetDay | null> {
    const posts = switches.find((sw) => sw.key === 'posts' && sw.available);
    if (!posts || !profile[posts.column]) return null;
    try {
      return await this.postsBudget.today(new Date());
    } catch (error) {
      switchLogger.warn(
        `Posts budget read failed profile=${profile.id}: ${describeError(error)}`,
      );
      return null;
    }
  }

  private async searchInput(
    profile: ProfileWithSkills,
  ): Promise<QuerySearchProfileInput> {
    return searchInputFor(this.profiles, profile);
  }
}

function switchView(
  sw: SearchSwitch,
  profile: ProfileWithSkills,
  input: QuerySearchProfileInput,
  budget: PostsBudgetDay | null,
): SearchSwitchView {
  const enabled = profile[sw.column];
  return {
    key: sw.key,
    enabled,
    searches: sw.recipes(input).length,
    pausedUntil:
      sw.key === 'posts' && enabled && budget?.reached
        ? budget.nextDayStart.toISOString()
        : null,
  };
}
