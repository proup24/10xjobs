import { Channel } from 'src/common/enums';
import type { ProfileRow } from 'src/database';
import { indeedRecipes } from './indeed';
import { postRecipes } from './posts';
import type { QuerySearchProfileInput, QuerySearchRecipe } from './types';

/** A switch's name in URLs and views. */
export type SearchSwitchKey = 'posts' | 'indeed';
/** The profile column that stores a switch. */
export type SwitchColumn = 'postSearch' | 'indeedSearch';
/** Every switch column of a profile, as read. */
export type SwitchFlags = Record<SwitchColumn, boolean>;

/** A per-profile search switch: turning it on adds its channel's searches. */
export type SearchSwitch = {
  key: SearchSwitchKey;
  column: SwitchColumn;
  /** Builders' channel, for detach. */
  channel: Channel | null;
  /** Shown and changeable, for every user. A later slice (Indeed rollout, Phase 4 slice 04b for posts) sets it. */
  available: boolean;
  /** The recipes the switch adds after the board recipes. */
  recipes(input: QuerySearchProfileInput): QuerySearchRecipe[];
};

/**
 * Every per-profile search switch, in the order their recipes are added.
 * A new switch column must also join `bump_profile_match_version`'s exclusion
 * arrays (latest in `20261124T1043_profile_indeed_search`), or flipping it
 * rematches the profile and resumes paused searches. It also joins the
 * hand-written checks in `queries.repository.ts` (the swap's early check and
 * final `UPDATE … WHERE`), the publish `CASE` in `profiles.repository.ts`, and
 * the fakes in `queries/testing/fakes.ts` and `users/testing/fakes.ts`.
 */
export const SEARCH_SWITCHES: readonly SearchSwitch[] = [
  {
    key: 'posts',
    column: 'postSearch',
    channel: Channel.LINKEDIN_POSTS,
    available: false,
    recipes: postRecipes,
  },
  {
    key: 'indeed',
    column: 'indeedSearch',
    channel: Channel.INDEED,
    available: false,
    recipes: indeedRecipes,
  },
];

/** Nest provider token for the registry, so tests can inject one with an available switch. */
export const SEARCH_SWITCHES_TOKEN: unique symbol = Symbol('SEARCH_SWITCHES');

/** The switch columns of a profile row. */
export function switchFlags(row: Pick<ProfileRow, SwitchColumn>): SwitchFlags {
  return { postSearch: row.postSearch, indeedSearch: row.indeedSearch };
}

/**
 * The switches whose flag is on, whatever `available` says: availability gates
 * only showing and changing a switch, so a hidden switch already on keeps its
 * searches.
 */
export function switchesInEffect(
  flags: SwitchFlags,
  registry: readonly SearchSwitch[] = SEARCH_SWITCHES,
): SearchSwitch[] {
  return registry.filter((sw) => flags[sw.column]);
}
