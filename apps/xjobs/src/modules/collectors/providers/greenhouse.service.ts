import { Injectable, Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  type BoardSearchRunConfig,
  type CollectedJob,
  Collector,
  type SegmentResult,
  type SegmentSearch,
} from '../types/collector';
import {
  plainText,
  precisionOf,
  record,
  settledByKey,
  text,
} from '../utils/collected-job';
import {
  type DiscoveryHit,
  GoogleJobsSearchProvider,
} from './apify/google_search.collector';
import { GreenhousePostingProvider } from './extraction/greenhouse.provider';

/** Postings fetched at once from the board's public API. */
const POSTING_CONCURRENCY = 4;

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
    const hits = [...found.hitsByQuery.values()].flat();
    // A posting found by several members is fetched once.
    const { values: postings, failed } = await settledByKey(
      hits.map((hit) => hit.url),
      POSTING_CONCURRENCY,
      (url) => this.postings.fetch(url),
    );
    if (failed.size)
      this.logger.warn(
        `Skipped ${failed.size} postings that could not be fetched`,
      );

    const jobsByQuery = new Map<string, CollectedJob[]>();
    for (const [id, queryHits] of found.hitsByQuery)
      jobsByQuery.set(
        id,
        queryHits.flatMap((hit) =>
          postings.has(hit.url)
            ? [toJob(hit, record(postings.get(hit.url)))]
            : [],
        ),
      );
    return {
      jobsByQuery,
      fetched: found.fetched,
      costUsd: found.costUsd,
      capped: found.capped,
      // Google reports no row limit per query, so no member is marked truncated.
      truncatedQueryIds: [],
    };
  }
}

function toJob(
  hit: DiscoveryHit,
  posting: Record<string, unknown>,
): CollectedJob {
  const postedAt = text(posting.first_published);
  return {
    source: 'greenhouse',
    sourceJobId: text(posting.id) ?? '',
    url: hit.url,
    applyUrl: text(posting.absolute_url) ?? hit.url,
    title: text(posting.title) ?? '',
    company:
      text(posting.company_name) ?? text(record(posting.company).name) ?? '',
    location: text(record(posting.location).name),
    postedAt,
    postedAtPrecision: precisionOf(postedAt),
    description: plainText(text(posting.content) ?? '', true),
    contact: null,
    search: hit.search,
    raw: { hit: hit.raw, posting },
  };
}
