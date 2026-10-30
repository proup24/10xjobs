import { Arrangement, type Channel } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  ARRANGEMENT_WORDS,
  POSITION_TITLES,
  SENIORITY_WORDS,
  TECHNOLOGY_TERMS,
} from './keywords';

/** Turns one combination into the keywords and params one channel searches with. */
export interface ChannelQueryBuilder {
  readonly channel: Channel;
  build(combination: QuerySearchCombination): ChannelQuery;
}

/** One canonical phrase: `[seniority, title, ...technologies]`, nulls skipped. */
export function keywordPhrase(combination: QuerySearchCombination): string {
  const seniorityWord = SENIORITY_WORDS[combination.experience];
  const technologyTerms = combination.technologies.map(
    (technology) => TECHNOLOGY_TERMS[technology],
  );
  const title = POSITION_TITLES[combination.position][0]!;
  // "lead" + "tech lead" would read "lead tech lead", so the title wins.
  const repeatsTitle =
    seniorityWord !== null && title.split(' ').includes(seniorityWord);
  return [repeatsTitle ? null : seniorityWord, title, ...technologyTerms]
    .filter((part): part is string => part !== null)
    .join(' ');
}

export function arrangementWord(
  combination: QuerySearchCombination,
): string | null {
  return ARRANGEMENT_WORDS[combination.type];
}

/** The region for remote or unstated work, otherwise `city, country` or `country`. */
export function locationText(combination: QuerySearchCombination): string {
  const placeBound =
    combination.type === Arrangement.onsite ||
    combination.type === Arrangement.hybrid;
  if (!placeBound || !combination.country) return combination.locationRegion;
  return combination.city
    ? `${combination.city}, ${combination.country}`
    : combination.country;
}

/** Greenhouse and Ashby boards are filtered after fetching, not searched by text. */
export function jobBoardFilterQuery(
  combination: QuerySearchCombination,
): ChannelQuery {
  const locationTerms =
    combination.type === Arrangement.remote
      ? [combination.locationRegion]
      : [combination.country, combination.city].filter(
        (term): term is string => !!term,
      );
  const remote =
    combination.type === Arrangement.unstated
      ? null
      : combination.type === Arrangement.remote;
  return {
    keyword: keywordPhrase(combination),
    params: { locationTerms, remote },
  };
}
