import { Injectable, Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  type BoardSearchRunConfig,
  type SegmentResult,
  type SegmentSearch,
} from '../types/collector';
import { GoogleJobsSearchProvider } from './apify/google-search.provider';
import { withPostings } from './board-postings';
import { AshbyPostingProvider } from './extraction/ashby.provider';

/** Ashby postings: discovered through Google, fetched from the board's public API. */
@Injectable()
export class AshbyCollector {
  /** The actor and its limits; fixed for every run of this collector. */
  static readonly config: Readonly<BoardSearchRunConfig> = {
    actor: 'apify/google-search-scraper',
    maxRunChargeUsd: 0.5,
    site: 'jobs.ashbyhq.com',
    suffix:
      '(intitle:engineer OR intitle:developer OR intitle:lead) -intitle:manager -intitle:director -intitle:intern -intitle:recruiter',
    // Google serves 10 results per page (no `num=100` since Sept 2025);
    // at 3 pages every query was truncated.
    maxPagesPerQuery: 10,
  };

  readonly channel = Channel.ASHBY;
  private readonly logger = new Logger(AshbyCollector.name);

  constructor(
    private readonly discovery: GoogleJobsSearchProvider,
    private readonly postings: AshbyPostingProvider,
  ) {}

  async collect(segment: SegmentSearch): Promise<SegmentResult> {
    const found = await this.discovery.search(segment, AshbyCollector.config);
    return withPostings(found, (url) => this.postings.fetch(url), this.logger);
  }
}
