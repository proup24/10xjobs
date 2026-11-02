import { Arrangement, Channel } from 'src/common/enums';
import { isWorldwide } from './linkedin_geo';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  type ChannelQueryBuilder,
  seniorityWord,
  technologyTerms,
  titleClause,
} from '../builders/channel.builder';

/**
 * Searches hiring posts. The actor has no seniority or location filter, so
 * both go in the query: the seniority word, "remote" for remote work, then
 * the location unless it is worldwide.
 */
export class LinkedinPostsBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.LINKEDIN_POSTS;

  build(combination: QuerySearchCombination): ChannelQuery {
    const keyword = [
      'hiring',
      titleClause(combination.position),
      technologyTerms(combination.technologies),
      seniorityWord(combination.experience, combination.position),
      ...placeWords(combination),
    ]
      .filter((part): part is string => !!part)
      .join(' ');
    return { keyword, params: {} };
  }
}

function placeWords(combination: QuerySearchCombination): string[] {
  return [
    ...(combination.type === Arrangement.remote ? ['remote'] : []),
    ...(isWorldwide(combination.location) ? [] : [combination.location]),
  ];
}
