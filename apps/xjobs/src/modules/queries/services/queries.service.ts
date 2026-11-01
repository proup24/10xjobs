import { Injectable, NotFoundException } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import { QUERY_SEARCH_RECIPE_VERSION, toRecipe } from '../builders';
import { technologySets } from '../sets/technology';
import { QuerySearchRepository } from '../repositories/queries.repository';
import {
  assertHasSkills,
  assertLocatable,
  dedupeByHash,
  localCombinations,
  normalizeArrangements,
  normalizeProfile,
  remoteCombinations,
} from '../steps';
import type {
  QuerySearchProfileInput,
  QuerySearchRecipe,
  QuerySearchAttachResult,
} from '../types';

@Injectable()
export class QuerySearchService {
  constructor(private readonly builders: QuerySearchRepository) {}

  /**
   * Turns a profile into its search recipes: remote per `channel × region ×
   * technology`, onsite/hybrid per `channel × technology` in the city.
   * Each step is a pure function in `../steps`.
   */
  expand(input: QuerySearchProfileInput): QuerySearchRecipe[] {
    const profile = normalizeProfile(input);
    assertLocatable(profile);
    assertHasSkills(profile);
    const technologies = technologySets(profile.skills);
    const arrangements = normalizeArrangements(profile.arrangements);
    const profileRemoteCombinations = remoteCombinations(profile, arrangements, technologies);
    const profileLocalCombinations = localCombinations(profile, arrangements, technologies);
    const combinations = [
      ...profileRemoteCombinations,
      ...profileLocalCombinations,
    ];
    return dedupeByHash(combinations.map(toRecipe));
  }

  /**
   * Attaches the profile to the shared builder of each of its recipes, reusing
   * builders by hash and creating missing ones. Done once, at publish.
   */
  generate(
    profileId: string,
    input: QuerySearchProfileInput,
  ): Promise<QuerySearchAttachResult> {
    const queries = this.expand(input);
    return this.builders.attach(profileId, queries);
  }

  /** Releases every builder the profile uses: each loses one associated profile, inactive at 0. */
  detach(profileId: string): Promise<number> {
    return this.builders.detach(profileId);
  }

  /** The profile's active-or-idle, non-deleted builders; 404 when the profile is not the user's. */
  async list(
    userId: string,
    profileId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[]> {
    const rows = await this.builders.list(userId, profileId, channel);
    if (!rows) throw new NotFoundException('Profile not found');
    return rows;
  }

  /** A channel's active, non-deleted builders across every profile, oldest first. */
  listActive(channel: Channel): Promise<QuerySearchBuilderRow[]> {
    return this.builders.listActive(channel);
  }

  /**
   * Soft-deletes builders of an older recipe that no profile uses any more:
   * after regeneration, these are the outdated ones.
   */
  retireOutdated(): Promise<number> {
    return this.builders.retireOutdated(QUERY_SEARCH_RECIPE_VERSION);
  }

  /** Retires a builder for good: it is unlinked from every profile and never collected again. */
  async softDelete(queryId: string): Promise<QuerySearchBuilderRow> {
    const row = await this.builders.softDelete(queryId);
    if (!row) throw new NotFoundException('Query search builder not found');
    return row;
  }
}
