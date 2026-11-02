import { ACTIVE_CHANNELS } from 'src/common/enums';
import type {
  QuerySearchCombination,
  QuerySearchProfileInput,
  QuerySearchRecipe,
  TechnologySet,
} from '../types';
import { LOCATION_ARRANGEMENTS } from '../types';
import { sortKeys } from '../utils';
import { locationKey } from './normalize';

/**
 * One combination per `arrangement × active channel × location × technology set ×
 * seniority`.
 * The location is searched as given, whatever the arrangement, so profiles
 * listing the same location share builders.
 */
export function locationCombinations(
  profile: QuerySearchProfileInput,
  technologies: TechnologySet[],
): QuerySearchCombination[] {
  return LOCATION_ARRANGEMENTS.flatMap((type) =>
    ACTIVE_CHANNELS.flatMap((channel) =>
      profile.locations[type].flatMap((text) =>
        technologies.flatMap(({ technologies: set, domain }) =>
          profile.seniorities.map((experience) => ({
            channel,
            position: profile.position,
            location: locationKey(text),
            experience,
            type,
            technologies: set,
            domain,
          })),
        ),
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

/** What a channel actually runs: every recipe field except the seniority it came from. */
function searchKey(recipe: QuerySearchRecipe): string {
  return JSON.stringify([
    recipe.channel,
    recipe.type,
    recipe.location,
    recipe.technologies,
    recipe.domain,
    recipe.keyword,
    sortKeys(recipe.params),
  ]);
}

/**
 * The first recipe of each distinct search, in order. Seniorities can build
 * the same search (staff, lead and principal share LinkedIn's f_E 4,5; mid
 * and unstated add no word), and running it twice adds cost, not recall.
 * Combinations list seniorities in enum order, so the lowest level is kept.
 */
export function dedupeBySearch(
  recipes: QuerySearchRecipe[],
): QuerySearchRecipe[] {
  const unique = new Map<string, QuerySearchRecipe>();
  for (const recipe of recipes) {
    const key = searchKey(recipe);
    if (!unique.has(key)) unique.set(key, recipe);
  }
  return [...unique.values()];
}
