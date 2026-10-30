import { Channel } from 'src/common/enums';
import { ChannelProvider, type ChannelCollectionResult, type ChannelSearch } from '../types/channel-provider';

export class GreenhouseProvider extends ChannelProvider {
  readonly channel = Channel.GREEN_HOUSE;
  async collect(_search: ChannelSearch): Promise<ChannelCollectionResult> {
    throw new Error('Greenhouse collector is not configured');
  }
}
