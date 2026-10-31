import { Channel } from 'src/common/enums';
import { ChannelProvider, type ChannelCollectionResult, type ChannelSearch } from '../types/channel-provider';
import { Injectable } from '@nestjs/common';
import { LinkedinPostSearchProvider } from './apify/linkedin-post-search.provider';

@Injectable()
export class LinkedinPostsProvider extends ChannelProvider {
  readonly channel = Channel.LINKEDIN_POSTS;
  constructor(private readonly searchProvider: LinkedinPostSearchProvider) { super(); }
  async collect(search: ChannelSearch): Promise<ChannelCollectionResult> {
    const jobs = await this.searchProvider.search(search);
    return { jobs, complete: true, truncated: false };
  }
}
