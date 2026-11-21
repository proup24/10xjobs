import { Injectable, Logger } from '@nestjs/common';
import { QuerySearchService } from 'src/modules/queries';
import { describeError } from 'src/utils';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { PostSearchAccess } from './post-search-access';
import { toQuerySearchInput, labelsFor } from './profiles.service';

/** Profiles whose searches one tick swaps (calls to `replace`). */
export const SEARCH_SYNC_LIMIT = 20;
/**
 * How many profiles behind one tick reads per swap it may make: profiles that
 * fail before the swap do not use up the limit, so a run of broken ones at the
 * head cannot starve the rest, and this cap keeps one tick bounded.
 */
export const SEARCH_SYNC_READ_FACTOR = 10;

export type SearchSyncResult = {
  /** Profiles whose searches were swapped and whose searchesVersion moved. */
  applied: number;
  /** Profiles that threw (or built no searches); the next tick retries them. */
  failed: number;
  /** Profiles `replace` skipped: unpublished or post search switched since the read. Retried next tick. */
  skipped: number;
};

/**
 * Brings the searches of published profiles to their current version: those
 * with no `searchesVersion` yet or one behind `matchVersion`. Each swap is one
 * transaction, so a profile never loses searches it still needs.
 */
@Injectable()
export class ProfileSearchSync {
  private readonly logger = new Logger(ProfileSearchSync.name);

  constructor(
    private readonly profiles: ProfilesRepository,
    private readonly querySearch: QuerySearchService,
    private readonly postSearch: PostSearchAccess,
  ) {}

  async applyPending(limit = SEARCH_SYNC_LIMIT): Promise<SearchSyncResult> {
    const behind = await this.profiles.listSearchesBehind(
      limit * SEARCH_SYNC_READ_FACTOR,
    );
    const result: SearchSyncResult = { applied: 0, failed: 0, skipped: 0 };
    let swaps = 0;
    for (const profile of behind) {
      if (swaps >= limit) break;
      try {
        const labels = await labelsFor(this.profiles, profile);
        const recipes = this.querySearch.recipesFor(
          toQuerySearchInput(profile, labels),
          {
            posts: profile.postSearch && this.postSearch.allows(profile.userId),
          },
        );
        // Never swap to nothing: the profile keeps its searches and the next tick retries.
        if (recipes.length === 0) throw new NoSearches();
        swaps += 1;
        const { skipped } = await this.querySearch.replace(
          profile.id,
          recipes,
          {
            searchesVersion: profile.matchVersion,
            postSearch: profile.postSearch,
          },
        );
        if (skipped) result.skipped += 1;
        else result.applied += 1;
      } catch (error) {
        result.failed += 1;
        // Ids and error codes only: an error message may quote profile content.
        this.logger.error(
          `Search sync failed profile=${profile.id}: ${
            error instanceof NoSearches ? 'no searches' : describeError(error)
          }`,
        );
      }
    }
    return result;
  }
}

/** The profile builds no searches; swapping to none would release them all. */
class NoSearches extends Error {}
