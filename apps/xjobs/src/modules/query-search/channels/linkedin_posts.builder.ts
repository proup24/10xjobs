import { Channel } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  arrangementWord,
  keywordPhrases,
  locationText,
  type ChannelQueryBuilder,
} from '../builders/channel-query.builder';

/** Searches hiring posts, so every phrase starts with `hiring`. */
export class LinkedinPostsBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.LINKEDIN_POSTS;

  build(combination: QuerySearchCombination): ChannelQuery {
    const word = arrangementWord(combination);
    const keywords = keywordPhrases(combination).map((phrase) =>
      ['hiring', phrase, word].filter((part) => part !== null).join(' '),
    );
    return { keywords, params: { location: locationText(combination) } };
  }
}
