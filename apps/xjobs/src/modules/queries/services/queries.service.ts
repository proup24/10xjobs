import { Injectable } from '@nestjs/common';
import { Arrangement, Channel } from 'src/common/enums';
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

  expand(input: QuerySearchProfileInput): QuerySearchRecipe[] {
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

  private expandTechnologySets(
    context: {
      channel: Channel;
      position: string;
      locationRegion: string;
      type: Arrangement;
      country: string;
      city: string | null;
      input: QuerySearchProfileInput;
    },
    sets: string[][],
    recipes: Map<string, QuerySearchRecipe>,
  ): void {
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
