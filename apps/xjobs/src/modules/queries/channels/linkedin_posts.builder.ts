import { Channel } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  arrangementWord,
  keywordPhrase,
  locationText,
  type ChannelQueryBuilder,
} from '../builders/channel.builder';

/** Searches hiring posts, so every phrase starts with `hiring`. */
export class LinkedinPostsBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.LINKEDIN_POSTS;

  build(combination: QuerySearchCombination): ChannelQuery {
    const word = arrangementWord(combination);
    const keyword = ['hiring', keywordPhrase(combination), word]
      .filter((part) => part !== null)
      .join(' ');
    return { keyword, params: { location: locationText(combination) } };
  }
}
