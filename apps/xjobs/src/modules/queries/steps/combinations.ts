import { Arrangement, Channel, type Technology } from 'src/common/enums';
import type {
  QuerySearchCombination,
  QuerySearchProfileInput,
  QuerySearchRecipe,
} from '../types';
import { PLACE_BOUND } from './locatable';

/** Remote: one combination per `channel × region × technology set`, with no city or country. */
export function remoteCombinations(
  profile: QuerySearchProfileInput,
  arrangements: Arrangement[],
  technologies: Technology[][],
): QuerySearchCombination[] {
  if (!arrangements.includes(Arrangement.remote)) return [];
  return Object.values(Channel).flatMap((channel) =>
    profile.regions.flatMap((locationRegion) =>
      technologies.map((set) => ({
        channel,
        position: profile.position,
        locationRegion,
        country: null,
        city: null,
        experience: profile.seniority,
        type: Arrangement.remote,
        technologies: set,
      })),
    ),
  );
}

/**
 * Onsite and hybrid: one combination per `channel × arrangement × city × technology set`.
 * Never multiplied by region, so profiles in the same city share builders.
 */
export function localCombinations(
  profile: QuerySearchProfileInput,
  arrangements: Arrangement[],
  technologies: Technology[][],
): QuerySearchCombination[] {
  // One city for now; a list later only changes this source.
  const cities = [profile.city];
  const local = arrangements.filter((arrangement) =>
    PLACE_BOUND.includes(arrangement),
  );
  return local.flatMap((type) =>
    Object.values(Channel).flatMap((channel) =>
      cities.flatMap((city) =>
        technologies.map((set) => ({
          channel,
          position: profile.position,
          locationRegion: null,
          country: profile.country,
          city,
          experience: profile.seniority,
          type,
          technologies: set,
        })),
      ),
    ),
  );
}

/** The first recipe of each hash, in order. */
export function dedupeByHash(recipes: QuerySearchRecipe[]): QuerySearchRecipe[] {
  const unique = new Map<string, QuerySearchRecipe>();
  for (const recipe of recipes)
    if (!unique.has(recipe.hash)) unique.set(recipe.hash, recipe);
  return [...unique.values()];
}
