import { Injectable, Logger } from '@nestjs/common';
import { QuerySearchService } from 'src/modules/queries';
import { ProfilesRepository } from '../repositories/profiles.repository';
import { PostSearchAccess } from './post-search-access';
import { toQuerySearchInput, labelsFor } from './profiles.service';

/** Profiles whose searches one tick brings up to date. */
export const SEARCH_SYNC_LIMIT = 20;

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

  async applyPending(
    limit = SEARCH_SYNC_LIMIT,
  ): Promise<{ applied: number; failed: number }> {
    const behind = await this.profiles.listSearchesBehind(limit);
    let applied = 0;
    let failed = 0;
    for (const profile of behind) {
      try {
        const labels = await labelsFor(this.profiles, profile);
        const recipes = this.querySearch.recipesFor(
          toQuerySearchInput(profile, labels),
          {
            posts: profile.postSearch && this.postSearch.allows(profile.userId),
          },
        );
        // Never swap to nothing: the profile keeps its searches and the next tick retries.
        if (recipes.length === 0) throw new Error('no searches');
        await this.querySearch.replace(
          profile.id,
          recipes,
          profile.matchVersion,
        );
        applied += 1;
      } catch (error) {
        failed += 1;
        // Ids and error names only: an error message may quote profile content.
        this.logger.error(
          `Search sync failed profile=${profile.id}: ${describe(error)}`,
        );
      }
    }
    return { applied, failed };
  }
}

/** 'no searches' is ours; anything else is reported by code or class name, never its message. */
function describe(error: unknown): string {
  if (error instanceof Error && error.message === 'no searches')
    return 'no searches';
  if (typeof error === 'object' && error !== null) {
    const { code, sqlState } = error as { code?: unknown; sqlState?: unknown };
    if (typeof code === 'string') return code;
    if (typeof sqlState === 'string') return sqlState;
    return error.constructor.name;
  }
  return typeof error;
}
