import { Channel } from 'src/common/enums';
import type { ChannelQueryBuilder } from '../builders/channel.builder';
import { AshbyQueryBuilder } from './ashbyhq.builder';
import { GreenhouseQueryBuilder } from './greenhouse.builder';
import { LinkedinJobBoardBuilder } from './linkedin_board.builder';
import { LinkedinPostsBuilder } from './linkedin_posts.builder';

export { AshbyQueryBuilder } from './ashbyhq.builder';
export { GreenhouseQueryBuilder } from './greenhouse.builder';
export { LinkedinJobBoardBuilder } from './linkedin_board.builder';
export { LinkedinPostsBuilder } from './linkedin_posts.builder';

export const CHANNEL_QUERY_BUILDERS: Record<Channel, ChannelQueryBuilder> = {
  [Channel.LINKEDIN_JOB_BOARD]: new LinkedinJobBoardBuilder(),
  [Channel.LINKEDIN_JOB_BOARD_CHEAP]: new LinkedinJobBoardBuilder(
    Channel.LINKEDIN_JOB_BOARD_CHEAP,
  ),
  [Channel.LINKEDIN_JOB_BOARD_BEBITY]: new LinkedinJobBoardBuilder(
    Channel.LINKEDIN_JOB_BOARD_BEBITY,
  ),
  [Channel.LINKEDIN_POSTS]: new LinkedinPostsBuilder(),
  [Channel.GREEN_HOUSE]: new GreenhouseQueryBuilder(),
  [Channel.ASHBY]: new AshbyQueryBuilder(),
};
