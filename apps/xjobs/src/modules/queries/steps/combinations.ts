import { ACTIVE_CHANNELS, Channel, isLinkedinJobBoard } from 'src/common/enums';
import type {
  QuerySearchCombination,
  QuerySearchProfileInput,
  QuerySearchRecipe,
  TechnologySet,
} from '../types';
import { LOCATION_ARRANGEMENTS } from '../types';
import { roleWords } from '../builders/role-words';
import { linkedinLevels } from '../channels/linkedin_board.builder';
import { searchPlaces } from '../channels/linkedin_search_map';
import { packLinkedinTechnologies } from '../sets/technology';
import { sortKeys } from '../utils';
import { locationKey } from './normalize';

/** The `f_E` levels to search: one entry without a level when there is none to filter by. */
function levelsFor(board: boolean, seniority: string): (string | undefined)[] {
  if (!board) return [undefined];
  const levels = linkedinLevels(seniority);
  return levels.length === 0 ? [undefined] : levels;
}

/**
 * The LinkedIn job board's sets: every technology once, in the order given,
 * each under the domain of the set it first came in, packed into the fewest
 * sets whose keyword fits with `roles` (`packLinkedinTechnologies`). Sets
 * `technologySets` already packed with the same role words come back as they were.
 */
function pack(
  sets: TechnologySet[],
  roles: readonly string[],
): TechnologySet[] {
  const seen = new Set<string>();
  const ranked = sets.flatMap(({ technologies, domain }) =>
    technologies
      .filter((technology) => !seen.has(technology) && seen.add(technology))
      .map((technology) => ({ technology, domain })),
  );
  return packLinkedinTechnologies(ranked, roles);
}

/**
 * One combination per `arrangement × active channel × location × technology set ×
 * seniority`. The location is searched as given, whatever the arrangement, so
 * profiles listing the same location share builders.
 *
 * The LinkedIn job board differs: each location expands into its LinkedIn
 * search places and each seniority into its single `f_E` levels (one
 * combination without a level when the seniority has none), over the fewest
 * technology sets whose keyword fits LinkedIn's limits (one for most profiles).
 */
export function locationCombinations(
  profile: QuerySearchProfileInput,
  technologies: TechnologySet[] | ((channel: Channel) => TechnologySet[]),
): QuerySearchCombination[] {
  const setsFor = (channel: Channel): TechnologySet[] => {
    const sets =
      typeof technologies === 'function' ? technologies(channel) : technologies;
    return isLinkedinJobBoard(channel)
      ? pack(sets, roleWords(profile.position, profile.languages))
      : sets;
  };
  return LOCATION_ARRANGEMENTS.flatMap((type) =>
    ACTIVE_CHANNELS.flatMap((channel) => {
      const board = isLinkedinJobBoard(channel);
      return profile.locations[type].flatMap((text) =>
        (board ? searchPlaces(text) : [locationKey(text)]).flatMap((location) =>
          setsFor(channel).flatMap(({ technologies: set, domain }) =>
            profile.seniorities.flatMap((experience) =>
              levelsFor(board, experience).map((experienceLevel) => ({
                channel,
                position: profile.position,
                location,
                experience,
                type,
                technologies: set,
                domain,
                languages: profile.languages,
                ...(experienceLevel === undefined ? {} : { experienceLevel }),
              })),
            ),
          ),
        ),
      );
    }),
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
