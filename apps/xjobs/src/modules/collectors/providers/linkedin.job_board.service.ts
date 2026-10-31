import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  Collector,
  type LinkedinJobBoardRunConfig,
  type SegmentResult,
  type SegmentSearch,
} from '../types/collector';
import { LinkedinJobSearchProvider } from './apify/linkedin.job_search.collector';

@Injectable()
export class LinkedinJobBoardCollector extends Collector<LinkedinJobBoardRunConfig> {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;

  constructor(private readonly searchProvider: LinkedinJobSearchProvider) {
    super();
  }

  collect(
    segment: SegmentSearch,
    config: LinkedinJobBoardRunConfig,
  ): Promise<SegmentResult> {
    return this.searchProvider.search(segment, config);
  }
}
