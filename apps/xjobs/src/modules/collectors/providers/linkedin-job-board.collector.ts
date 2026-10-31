import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  Collector,
  type CollectionResult,
  type CollectorSearch,
} from '../types/collector';
import { LinkedinJobSearchProvider } from './apify/linkedin-job-search.provider';

@Injectable()
export class LinkedinJobBoardCollector extends Collector {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  constructor(private readonly searchProvider: LinkedinJobSearchProvider) {
    super();
  }
  async collect(search: CollectorSearch): Promise<CollectionResult> {
    const jobs = await this.searchProvider.search(search);
    return { jobs, complete: true, truncated: false };
  }
}
