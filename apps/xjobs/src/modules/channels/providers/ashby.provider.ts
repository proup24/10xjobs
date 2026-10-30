import { Channel } from 'src/common/enums';
import { ChannelProvider, type ChannelCollectionResult, type ChannelSearch } from '../types/channel-provider';

export class AshbyProvider extends ChannelProvider {
  readonly channel = Channel.ASHBY;
  async collect(_search: ChannelSearch): Promise<ChannelCollectionResult> {
    throw new Error('Ashby collector is not configured');
  }
}
