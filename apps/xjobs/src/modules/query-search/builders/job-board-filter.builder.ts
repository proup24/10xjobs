import { Arrangement, type Channel } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  keywordPhrases,
  type ChannelQueryBuilder,
} from './channel-query.builder';

/** Greenhouse and Ashby boards are filtered after fetching, not searched by text. */
export class JobBoardFilterBuilder implements ChannelQueryBuilder {
  constructor(readonly channel: Channel) {}

  build(combination: QuerySearchCombination): ChannelQuery {
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
      keywords: keywordPhrases(combination),
      params: { locationTerms, remote },
    };
  }
}
