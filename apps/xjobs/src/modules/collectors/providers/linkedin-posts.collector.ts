import { Channel } from 'src/common/enums';
import {
  Collector,
  type CollectionResult,
  type CollectorSearch,
} from '../types/collector';
import { Injectable } from '@nestjs/common';
import { LinkedinPostSearchProvider } from './apify/linkedin-post-search.provider';

@Injectable()
export class LinkedinPostsCollector extends Collector {
  readonly channel = Channel.LINKEDIN_POSTS;
  constructor(private readonly searchProvider: LinkedinPostSearchProvider) {
    super();
  }
  async collect(search: CollectorSearch): Promise<CollectionResult> {
    const jobs = await this.searchProvider.search(search);
    return { jobs, complete: true, truncated: false };
  }
}
