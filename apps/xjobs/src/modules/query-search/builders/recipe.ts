import { createHash } from 'node:crypto';
import type { QuerySearchCombination, QuerySearchRecipe } from '../types';
import { CHANNEL_QUERY_BUILDERS } from '../channels';

export const QUERY_SEARCH_RECIPE_VERSION = 1;

/** Code-point order, never locale order: the result feeds the hash. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, child]) => [key, sortKeys(child)]),
    );
  }
  return value;
}

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
    keywords: recipe.keywords,
    params: sortKeys(recipe.params),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function toRecipe(
  combination: QuerySearchCombination,
): QuerySearchRecipe {
  const query = CHANNEL_QUERY_BUILDERS[combination.channel].build(combination);
  const keywords = [
    ...new Set(query.keywords.map((keyword) => keyword.toLowerCase())),
  ].sort(compare);
  const recipe = {
    ...combination,
    version: QUERY_SEARCH_RECIPE_VERSION,
    keywords,
    params: query.params,
  };
  return { ...recipe, hash: recipeHash(recipe) };
}
