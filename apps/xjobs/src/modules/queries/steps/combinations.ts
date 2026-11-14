import { ACTIVE_CHANNELS, Channel } from 'src/common/enums';
import type {
  QuerySearchCombination,
  QuerySearchProfileInput,
  QuerySearchRecipe,
  TechnologySet,
} from '../types';
import { LOCATION_ARRANGEMENTS } from '../types';
import { linkedinLevels } from '../channels/linkedin_board.builder';
import { searchPlaces } from '../channels/linkedin_search_map';
import { sortKeys } from '../utils';
import { locationKey } from './normalize';

/** The `f_E` levels to search: one entry without a level when there is none to filter by. */
function levelsFor(board: boolean, seniority: string): (string | undefined)[] {
  if (!board) return [undefined];
  const levels = linkedinLevels(seniority);
  return levels.length === 0 ? [undefined] : levels;
}

/** The LinkedIn job board searches every technology in one set. */
function collapse(sets: TechnologySet[]): TechnologySet[] {
  if (sets.length <= 1) return sets;
  return [
    {
      technologies: [...new Set(sets.flatMap((set) => set.technologies))],
      domain: sets[0].domain,
    },
  ];
}

/**
 * One combination per `arrangement × active channel × location × technology set ×
 * seniority`. The location is searched as given, whatever the arrangement, so
 * profiles listing the same location share builders.
 *
 * The LinkedIn job board differs: each location expands into its LinkedIn
 * search places and each seniority into its single `f_E` levels (one
 * combination without a level when the seniority has none), over one
 * technology set holding every technology.
 */
export function locationCombinations(
  profile: QuerySearchProfileInput,
  technologies: TechnologySet[] | ((channel: Channel) => TechnologySet[]),
): QuerySearchCombination[] {
  const setsFor = (channel: Channel): TechnologySet[] => {
    const sets =
      typeof technologies === 'function' ? technologies(channel) : technologies;
    return channel === Channel.LINKEDIN_JOB_BOARD ? collapse(sets) : sets;
  };
  return LOCATION_ARRANGEMENTS.flatMap((type) =>
    ACTIVE_CHANNELS.flatMap((channel) => {
      const board = channel === Channel.LINKEDIN_JOB_BOARD;
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
