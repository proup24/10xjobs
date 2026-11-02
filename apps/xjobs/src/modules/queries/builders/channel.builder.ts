import {
  Arrangement,
  type Channel,
  type Position,
  Seniority,
  type Technology,
} from 'src/common/enums';
import { isWorldwide } from '../channels/linkedin_geo';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import { POSITION_TITLES, SENIORITY_WORDS, TECHNOLOGY_TERMS } from './keywords';

/** Turns one combination into the keywords and params one channel searches with. */
export interface ChannelQueryBuilder {
  readonly channel: Channel;
  build(combination: QuerySearchCombination): ChannelQuery;
}

/** One readable phrase, `title technologies`, for logs; channels build their own queries. */
export function keywordPhrase(combination: QuerySearchCombination): string {
  return [
    POSITION_TITLES[combination.position][0],
    ...combination.technologies.map(
      (technology) => TECHNOLOGY_TERMS[technology],
    ),
  ].join(' ');
}

/** Every title people use for the position, quoted and ORed: `("a" OR "b")`, or `"a"` alone. */
export function titleClause(position: Position): string {
  const titles = POSITION_TITLES[position].map((title) => `"${title}"`);
  return titles.length === 1 ? titles[0] : `(${titles.join(' OR ')})`;
}

/** A term with a space or a symbol (`c#`, `.net`, `spring boot`) is quoted so search keeps it whole. */
function searchTerm(term: string): string {
  return /[\s#+.]/.test(term) ? `"${term}"` : term;
}

/** The technologies as search terms, space separated. */
export function technologyTerms(technologies: readonly Technology[]): string {
  return technologies
    .map((technology) => searchTerm(TECHNOLOGY_TERMS[technology]))
    .join(' ');
}

/**
 * The seniority word for platforms without a seniority filter. Mid-level is
 * rarely written and unstated says nothing, so both add no word; neither does
 * a level one of the position's titles already names ("lead" for tech lead).
 */
export function seniorityWord(
  experience: Seniority,
  position?: Position,
): string | null {
  if (experience === Seniority.mid) return null;
  const word = SENIORITY_WORDS[experience];
  if (word === null || position === undefined) return word;
  const named = POSITION_TITLES[position].some((title) =>
    title.split(' ').includes(word),
  );
  return named ? null : word;
}

/**
 * Greenhouse and Ashby are discovered through Google, which has no seniority
 * or place filter: both go in the query. Remote adds `"remote"`; the quoted
 * location follows unless it is worldwide.
 */
export function jobBoardQuery(
  combination: QuerySearchCombination,
): ChannelQuery {
  const keyword = [
    titleClause(combination.position),
    technologyTerms(combination.technologies),
    seniorityWord(combination.experience, combination.position),
    combination.type === Arrangement.remote ? '"remote"' : null,
    isWorldwide(combination.location) ? null : `"${combination.location}"`,
  ]
    .filter((part): part is string => !!part)
    .join(' ');
  return {
    keyword,
    params: {
      remote:
        combination.type === Arrangement.unstated
          ? null
          : combination.type === Arrangement.remote,
    },
  };
}
