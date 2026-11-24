import { Injectable, NotFoundException } from '@nestjs/common';
import type { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import { QUERY_SEARCH_RECIPE_VERSION, toRecipe } from '../builders';
import { roleWords } from '../builders/role-words';
import { technologySets } from '../sets/technology';
import { QuerySearchRepository } from '../repositories/queries.repository';
import {
  switchesInEffect,
  type SearchSwitch,
  type SwitchFlags,
} from '../switches';
import {
  assertHasLocations,
  assertHasSeniorities,
  assertHasSkills,
  dedupeByHash,
  dedupeBySearch,
  locationCombinations,
  normalizeProfile,
} from '../steps';
import type {
  QuerySearchProfileInput,
  QuerySearchRecipe,
  QuerySearchAttachResult,
  QuerySearchReplaceExpected,
  QuerySearchReplaceResult,
} from '../types';

@Injectable()
export class QuerySearchService {
  constructor(private readonly builders: QuerySearchRepository) {}

  /**
   * Turns a profile into its search recipes: one per `arrangement × channel ×
   * location × technology × seniority`. Each step is a pure function in `../steps`.
   */
  expand(input: QuerySearchProfileInput): QuerySearchRecipe[] {
    const profile = normalizeProfile(input);
    assertHasLocations(profile);
    assertHasSeniorities(profile);
    assertHasSkills(profile);
    const roles = roleWords(profile.position, profile.languages);
    const combinations = locationCombinations(profile, (channel) =>
      technologySets(profile.skills, channel, roles),
    );
    return dedupeBySearch(dedupeByHash(combinations.map(toRecipe)));
  }

  /**
   * Attaches the profile to the shared builder of each of its recipes, reusing
   * builders by hash and creating missing ones. Done once, at publish.
   */
  generate(
    profileId: string,
    input: QuerySearchProfileInput,
    flags?: SwitchFlags,
  ): Promise<QuerySearchAttachResult> {
    return this.builders.attach(profileId, this.recipesFor(input, flags));
  }

  /**
   * Every recipe a profile's searches consist of: its board recipes, then the
   * recipes of each switch in effect, in registry order. No flags means board
   * recipes only.
   */
  recipesFor(
    input: QuerySearchProfileInput,
    flags?: SwitchFlags,
  ): QuerySearchRecipe[] {
    return [
      ...this.expand(input),
      ...(flags
        ? switchesInEffect(flags).flatMap((sw) => sw.recipes(input))
        : []),
    ];
  }

  /**
   * Swaps the profile's builders for `recipes` in one transaction and records
   * `searchesVersion`; skipped when the profile no longer matches `expected`.
   */
  replace(
    profileId: string,
    recipes: QuerySearchRecipe[],
    expected: QuerySearchReplaceExpected,
  ): Promise<QuerySearchReplaceResult> {
    return this.builders.replace(profileId, recipes, expected);
  }

  /** Releases every builder and deletes the published profile in one transaction; false when none matched. */
  releaseAndDelete(profileId: string): Promise<boolean> {
    return this.builders.releaseAndDelete(profileId);
  }

  /** Attaches only the recipes of one switch (that switch turned on). */
  attachSwitch(
    profileId: string,
    sw: SearchSwitch,
    input: QuerySearchProfileInput,
  ): Promise<QuerySearchAttachResult> {
    return this.builders.attach(profileId, sw.recipes(input));
  }

  /** Releases the profile's builders of one channel; other channels stay attached. */
  detachChannel(profileId: string, channel: Channel): Promise<number> {
    return this.builders.detachChannel(profileId, channel);
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
