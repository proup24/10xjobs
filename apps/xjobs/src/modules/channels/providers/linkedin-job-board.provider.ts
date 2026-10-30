import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { ChannelProvider, type ChannelCollectionResult, type ChannelSearch } from '../types/channel-provider';
import { LinkedinJobSearchProvider } from './apify/linkedin-job-search.provider';

@Injectable()
export class LinkedinJobBoardProvider extends ChannelProvider {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  constructor(private readonly searchProvider: LinkedinJobSearchProvider) { super(); }
  async collect(search: ChannelSearch): Promise<ChannelCollectionResult> {
    const jobs = await this.searchProvider.search(search);
    return { jobs, complete: true, truncated: false };
  }
}
