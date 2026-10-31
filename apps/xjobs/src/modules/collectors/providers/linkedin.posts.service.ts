import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  Collector,
  type LinkedinPostsRunConfig,
  type SegmentResult,
  type SegmentSearch,
} from '../types/collector';
import { LinkedinPostSearchProvider } from './apify/linkedin.post_search.collector';

@Injectable()
export class LinkedinPostsCollector extends Collector<LinkedinPostsRunConfig> {
  readonly channel = Channel.LINKEDIN_POSTS;

  constructor(private readonly searchProvider: LinkedinPostSearchProvider) {
    super();
  }

  collect(
    segment: SegmentSearch,
    config: LinkedinPostsRunConfig,
  ): Promise<SegmentResult> {
    return this.searchProvider.search(segment, config);
  }
}
