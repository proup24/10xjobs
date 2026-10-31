import { Arrangement, Channel } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  type ChannelQueryBuilder,
  seniorityWord,
  technologyTerms,
  titleClause,
} from '../builders/channel.builder';

/**
 * Searches hiring posts. The actor has no seniority or location filter, so
 * both go in the query: the seniority word, then the city for onsite and
 * hybrid work or "remote" for remote work.
 */
export class LinkedinPostsBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.LINKEDIN_POSTS;

  build(combination: QuerySearchCombination): ChannelQuery {
    const keyword = [
      'hiring',
      titleClause(combination.position),
      technologyTerms(combination.technologies),
      seniorityWord(combination.experience, combination.position),
      placeWord(combination),
    ]
      .filter((part): part is string => !!part)
      .join(' ');
    return { keyword, params: {} };
  }
}

function placeWord(combination: QuerySearchCombination): string | null {
  if (combination.type === Arrangement.remote) return 'remote';
  if (
    combination.type === Arrangement.onsite ||
    combination.type === Arrangement.hybrid
  )
    return combination.city?.toLowerCase() ?? null;
  return null;
}
