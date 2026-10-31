import { Injectable, Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  type BoardSearchRunConfig,
  Collector,
  type SegmentResult,
  type SegmentSearch,
} from '../types/collector';
import { GoogleJobsSearchProvider } from './apify/google_search.collector';
import { withPostings } from './board-postings';
import { AshbyPostingProvider } from './extraction/ashby.provider';

/** Ashby postings: discovered through Google, fetched from the board's public API. */
@Injectable()
export class AshbyCollector extends Collector<BoardSearchRunConfig> {
  readonly channel = Channel.ASHBY;
  private readonly logger = new Logger(AshbyCollector.name);

  constructor(
    private readonly discovery: GoogleJobsSearchProvider,
    private readonly postings: AshbyPostingProvider,
  ) {
    super();
  }

  async collect(
    segment: SegmentSearch,
    config: BoardSearchRunConfig,
  ): Promise<SegmentResult> {
    const found = await this.discovery.search(segment, config);
    return withPostings(found, (url) => this.postings.fetch(url), this.logger);
  }
}
