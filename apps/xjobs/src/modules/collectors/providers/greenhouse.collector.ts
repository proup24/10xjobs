import { Injectable, Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  type BoardSearchRunConfig,
  type SegmentResult,
  type SegmentSearch,
} from '../types/collector';
import { GoogleJobsSearchProvider } from './apify/google-search.provider';
import { withPostings } from './board-postings';
import { GreenhousePostingProvider } from './extraction/greenhouse.provider';

/** Greenhouse postings: discovered through Google, fetched from the board's public API. */
@Injectable()
export class GreenhouseCollector {
  /** The actor and its limits; fixed for every run of this collector. */
  static readonly config: Readonly<BoardSearchRunConfig> = {
    actor: 'apify/google-search-scraper',
    maxRunChargeUsd: 0.5,
    site: 'job-boards.greenhouse.io',
    suffix: '',
    // Google serves 10 results per page (no `num=100` since Sept 2025);
    // at 3 pages every query was truncated.
    maxPagesPerQuery: 10,
  };

  readonly channel = Channel.GREEN_HOUSE;
  private readonly logger = new Logger(GreenhouseCollector.name);

  constructor(
    private readonly discovery: GoogleJobsSearchProvider,
    private readonly postings: GreenhousePostingProvider,
  ) {}

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const found = await this.discovery.search(segment, GreenhouseCollector.config);
    return withPostings(found, (url) => this.postings.fetch(url), this.logger);
  }
}
