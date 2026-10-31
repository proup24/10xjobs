import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Arrangement,
  Channel,
  Position,
  Region,
  Technology,
} from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import { toRecipe } from '../builders';
import { technologySets } from '../sets/technology';
import { QuerySearchRepository } from '../repositories/queries.repository';
import type {
  QuerySearchCombination,
  QuerySearchProfileInput,
  QuerySearchRecipe,
  QuerySearchAttachResult,
} from '../types';

@Injectable()
export class QuerySearchService {
  constructor(private readonly builders: QuerySearchRepository) {}

  /** Expands a profile's single position into one recipe per `(channel × region × arrangement × technology-set)` combination. */
  expand(input: QuerySearchProfileInput): QuerySearchRecipe[] {
    // Formatting differences must not create duplicate permanent rows.
    const country = input.country.trim().toUpperCase();
    const city = input.city?.trim() || null;
    const stated = input.arrangements.filter(
      (arrangement) => arrangement !== Arrangement.unstated,
    );
    const arrangements = stated.length > 0 ? stated : [Arrangement.unstated];
    const sets = technologySets(input.skills);

    const recipes = new Map<string, QuerySearchRecipe>();
    const { position } = input;
    for (const channel of Object.values(Channel)) {
      for (const locationRegion of input.regions) {
        for (const type of arrangements) {
          this.expandTechnologySets(
            { channel, position, locationRegion, type, country, city, input },
            sets,
            recipes,
          );
        }
      }
    }
    return [...recipes.values()];
  }

  /** Adds one deduplicated recipe per technology set for the given combination context. */
  private expandTechnologySets(
    context: {
      /** The channel being expanded (e.g. LinkedIn, Greenhouse). */
      channel: Channel;
      /** The target job position (e.g. "software-engineer"). */
      position: Position;
      /** The broad location region (e.g. "Europe", "Remote – US"). */
      locationRegion: Region;
      /** The work arrangement type; determines whether city/country are applied. */
      type: Arrangement;
      /** Normalised (trimmed + uppercased) country code from the profile. */
      country: string;
      /** Trimmed city name, or `null` when absent. */
      city: string | null;
      /** The original profile input, used for seniority. */
      input: QuerySearchProfileInput;
    },
    /** Each element is one technology set to produce a recipe for. */
    sets: Technology[][],
    /** Accumulator — keyed by hash to prevent duplicates. */
    recipes: Map<string, QuerySearchRecipe>,
  ): void {
    // Only onsite/hybrid searches are bound to a specific city or country.
    const located =
      context.type === Arrangement.onsite ||
      context.type === Arrangement.hybrid;
    for (const technologies of sets) {
      const combination: QuerySearchCombination = {
        channel: context.channel,
        position: context.position,
        locationRegion: context.locationRegion,
        country: located ? context.country : null,
        city: located ? context.city : null,
        experience: context.input.seniority,
        type: context.type,
        technologies,
      };
      const recipe = toRecipe(combination);
      if (!recipes.has(recipe.hash)) recipes.set(recipe.hash, recipe);
    }
  }

  /**
   * Attaches the profile to the shared builder of each of its recipes, reusing
   * builders by hash and creating missing ones. Done once, at publish.
   */
  generate(
    profileId: string,
    input: QuerySearchProfileInput,
  ): Promise<QuerySearchAttachResult> {
    return this.builders.attach(profileId, this.expand(input));
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

  /** Retires a builder for good: it is unlinked from every profile and never collected again. */
  async softDelete(queryId: string): Promise<QuerySearchBuilderRow> {
    const row = await this.builders.softDelete(queryId);
    if (!row) throw new NotFoundException('Query search builder not found');
    return row;
  }
}
