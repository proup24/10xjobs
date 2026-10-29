import { Channel } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  jobBoardFilterQuery,
  type ChannelQueryBuilder,
} from '../builders/channel-query.builder';

export class GreenhouseQueryBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.GREEN_HOUSE;

  build(combination: QuerySearchCombination): ChannelQuery {
    return jobBoardFilterQuery(combination);
  }
}
