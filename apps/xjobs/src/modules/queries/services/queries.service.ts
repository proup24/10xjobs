import { Injectable } from '@nestjs/common';
import { Arrangement, Channel, Position, Region, Technology } from 'src/common/enums';
import { isUniqueViolation, type QuerySearchBuilderRow } from 'src/database';
import { WorkspacesService } from 'src/modules/workspaces';
import { toRecipe } from '../builders';
import { technologySets } from '../sets/technology';
import { QuerySearchRepository } from '../repositories/queries.repository';
import type {
  QuerySearchCombination,
  QuerySearchProfileInput,
  QuerySearchRecipe,
} from '../types';

@Injectable()
export class QuerySearchService {
  constructor(
    private readonly builders: QuerySearchRepository,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Expands a profile into one recipe per `(channel × position × region × arrangement × technology-set)` combination. */
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
    for (const channel of Object.values(Channel)) {
      for (const position of input.positions) {
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

  /** Stores the recipes the workspace does not have yet; existing ones are left untouched. */
  async generate(
    workspaceId: string,
    input: QuerySearchProfileInput,
  ): Promise<{ created: number; existing: number }> {
    const recipes = this.expand(input);
    const stored = await this.builders.findHashes(
      workspaceId,
      recipes.map((recipe) => recipe.hash),
    );
    let created = 0;
    let existing = stored.size;
    for (const recipe of recipes) {
      if (stored.has(recipe.hash)) continue;
      try {
        await this.builders.create(workspaceId, recipe);
        created += 1;
      } catch (error) {
        // A concurrent generate stored it between the lookup and the insert.
        if (!isUniqueViolation(error)) throw error;
        existing += 1;
      }
    }
    return { created, existing };
  }

  async list(
    workspaceId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[]> {
    await this.workspaces.getOrThrow(workspaceId);
    return this.builders.list(workspaceId, channel);
  }
}
