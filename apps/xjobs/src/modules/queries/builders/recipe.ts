import { createHash } from 'node:crypto';
import { Channel } from 'src/common/enums';
import type { QuerySearchCombination, QuerySearchRecipe } from '../types';
import { CHANNEL_QUERY_BUILDERS } from '../channels';
import { sortKeys } from '../utils';
export const QUERY_SEARCH_RECIPE_VERSION = 14;

/** Hex SHA-256 of the recipe fields in a fixed key order; `params` keys are sorted recursively. */
export function recipeHash(
  recipe: Omit<QuerySearchRecipe, 'hash' | 'position'>,
): string {
  const canonical = {
    version: recipe.version,
    channel: recipe.channel,
    location: recipe.location,
    experience: recipe.experience,
    technologies: recipe.technologies,
    domain: recipe.domain,
    type: recipe.type,
    keyword: recipe.keyword,
    params: sortKeys(recipe.params),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function toRecipe(
  combination: QuerySearchCombination,
): QuerySearchRecipe {
  if (combination.channel === Channel.LINKEDIN_POSTS)
    throw new Error('Post recipes are built by postRecipes');
  if (combination.channel === Channel.INDEED)
    throw new Error('Indeed recipes are built by indeedRecipes');
  const query = CHANNEL_QUERY_BUILDERS[combination.channel].build(combination);
  const recipe = {
    ...combination,
    version: QUERY_SEARCH_RECIPE_VERSION,
    // Builders lowercase their own terms; boolean operators stay uppercase.
    keyword: query.keyword.trim(),
    params: query.params,
  };
  return { ...recipe, hash: recipeHash(recipe) };
}
