import { Channel } from 'src/common/enums';
import { ChannelProvider, type ChannelCollectionResult, type ChannelSearch } from '../types/channel-provider';

export class LinkedinPostsProvider extends ChannelProvider {
  readonly channel = Channel.LINKEDIN_POSTS;
  async collect(_search: ChannelSearch): Promise<ChannelCollectionResult> {
    throw new Error('LinkedIn posts collector is not configured');
  }
}
