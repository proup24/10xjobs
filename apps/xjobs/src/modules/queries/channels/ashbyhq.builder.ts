import { Channel } from 'src/common/enums';
import type { ChannelQuery, QuerySearchCombination } from '../types';
import {
  jobBoardQuery,
  type ChannelQueryBuilder,
} from '../builders/channel.builder';

export class AshbyQueryBuilder implements ChannelQueryBuilder {
  readonly channel = Channel.ASHBY;

  build(combination: QuerySearchCombination): ChannelQuery {
    return jobBoardQuery(combination);
  }
}
