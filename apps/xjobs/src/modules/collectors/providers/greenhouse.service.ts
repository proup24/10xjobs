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
import { GreenhousePostingProvider } from './extraction/greenhouse.provider';

/** Greenhouse postings: discovered through Google, fetched from the board's public API. */
@Injectable()
export class GreenhouseCollector extends Collector<BoardSearchRunConfig> {
  readonly channel = Channel.GREEN_HOUSE;
  private readonly logger = new Logger(GreenhouseCollector.name);

  constructor(
    private readonly discovery: GoogleJobsSearchProvider,
    private readonly postings: GreenhousePostingProvider,
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
