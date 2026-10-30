import { Channel } from 'src/common/enums';
import { ChannelProvider, type ChannelCollectionResult, type ChannelSearch } from '../types/channel-provider';

export class LinkedinJobBoardProvider extends ChannelProvider {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  async collect(_search: ChannelSearch): Promise<ChannelCollectionResult> {
    throw new Error('LinkedIn job board collector is not configured');
  }
}
