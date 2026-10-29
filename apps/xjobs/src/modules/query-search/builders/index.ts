import { Channel } from 'src/common/enums';
import type { ChannelQueryBuilder } from './channel-query.builder';
import { JobBoardFilterBuilder } from './job-board-filter.builder';
import { LinkedinJobBoardBuilder } from './linkedin-job-board.builder';
import { LinkedinPostsBuilder } from './linkedin-posts.builder';

export type { ChannelQueryBuilder } from './channel-query.builder';
export { QUERY_SEARCH_RECIPE_VERSION, recipeHash, toRecipe } from './recipe';

export const CHANNEL_QUERY_BUILDERS: Record<Channel, ChannelQueryBuilder> = {
  [Channel.LINKEDIN_JOB_BOARD]: new LinkedinJobBoardBuilder(),
  [Channel.LINKEDIN_POSTS]: new LinkedinPostsBuilder(),
  [Channel.GREEN_HOUSE]: new JobBoardFilterBuilder(Channel.GREEN_HOUSE),
  [Channel.ASHBY]: new JobBoardFilterBuilder(Channel.ASHBY),
};
