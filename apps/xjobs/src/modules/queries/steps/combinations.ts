import { Channel } from 'src/common/enums';
import type {
  QuerySearchCombination,
  QuerySearchProfileInput,
  QuerySearchRecipe,
  TechnologySet,
} from '../types';
import { LOCATION_ARRANGEMENTS } from '../types';
import { locationKey } from './normalize';

/**
 * One combination per `arrangement × channel × location × technology set`.
 * The location is searched as given, whatever the arrangement, so profiles
 * listing the same location share builders.
 */
export function locationCombinations(
  profile: QuerySearchProfileInput,
  technologies: TechnologySet[],
): QuerySearchCombination[] {
  return LOCATION_ARRANGEMENTS.flatMap((type) =>
    Object.values(Channel).filter((c)=> c !== Channel.LINKEDIN_JOB_BOARD).flatMap((channel) =>
      profile.locations[type].flatMap((text) =>
        technologies.map(({ technologies: set, domain }) => ({
          channel,
          position: profile.position,
          location: locationKey(text),
          experience: profile.seniority,
          type,
          technologies: set,
          domain,
        })),
      ),
    ),
  );
}

/** The first recipe of each hash, in order. */
export function dedupeByHash(
  recipes: QuerySearchRecipe[],
): QuerySearchRecipe[] {
  const unique = new Map<string, QuerySearchRecipe>();
  for (const recipe of recipes)
    if (!unique.has(recipe.hash)) unique.set(recipe.hash, recipe);
  return [...unique.values()];
}
