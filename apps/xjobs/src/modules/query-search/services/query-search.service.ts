import { Injectable } from '@nestjs/common';
import { Arrangement, Channel } from 'src/common/enums';
import { isUniqueViolation, type QuerySearchBuilderRow } from 'src/database';
import { WorkspacesService } from 'src/modules/workspaces';
import { toRecipe } from '../builders';
import { technologySets } from '../sets/technology';
import { QuerySearchRepository } from '../repositories/query-search.repository';
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

  /** Every channel, position, region, arrangement and technology set of the profile, one recipe each. */
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
            const located =
              type === Arrangement.onsite || type === Arrangement.hybrid;
            for (const technologies of sets) {
              const combination: QuerySearchCombination = {
                channel,
                position,
                locationRegion,
                country: located ? country : null,
                city: located ? city : null,
                experience: input.seniority,
                type,
                technologies,
              };
              const recipe = toRecipe(combination);
              if (!recipes.has(recipe.hash)) recipes.set(recipe.hash, recipe);
            }
          }
        }
      }
    }
    return [...recipes.values()];
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
