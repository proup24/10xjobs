import { createHash } from 'node:crypto';
import type { QuerySearchCombination, QuerySearchRecipe } from '../types';
import { CHANNEL_QUERY_BUILDERS } from '../channels';
import { sortKeys } from '../utils';
export const QUERY_SEARCH_RECIPE_VERSION = 2;

/** Hex SHA-256 of the recipe fields in a fixed key order; `params` keys are sorted recursively. */
export function recipeHash(
  recipe: Omit<QuerySearchRecipe, 'hash' | 'position'>,
): string {
  const canonical = {
    version: recipe.version,
    channel: recipe.channel,
    locationRegion: recipe.locationRegion,
    country: recipe.country,
    city: recipe.city,
    experience: recipe.experience,
    technologies: recipe.technologies,
    type: recipe.type,
    keyword: recipe.keyword,
    params: sortKeys(recipe.params),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function toRecipe(
  combination: QuerySearchCombination,
): QuerySearchRecipe {
  const query = CHANNEL_QUERY_BUILDERS[combination.channel].build(combination);
  const recipe = {
    ...combination,
    version: QUERY_SEARCH_RECIPE_VERSION,
    keyword: query.keyword.trim().toLowerCase(),
    params: query.params,
  };
  return { ...recipe, hash: recipeHash(recipe) };
}
