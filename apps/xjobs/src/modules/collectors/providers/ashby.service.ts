import { Injectable, Logger } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  type BoardSearchRunConfig,
  type CollectedJob,
  Collector,
  type SegmentResult,
  type SegmentSearch,
} from '../types/collector';
import { plainText, record, settledByKey, text } from '../utils/collected-job';
import {
  type DiscoveryHit,
  GoogleJobsSearchProvider,
} from './apify/google_search.collector';
import { AshbyPostingProvider } from './extraction/ashby.provider';

/** Postings fetched at once from the board's public API. */
const POSTING_CONCURRENCY = 4;

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
      truncatedQueryIds: found.truncatedQueryIds,
    };
  }
}

function toJob(
  hit: DiscoveryHit,
  posting: Record<string, unknown>,
): CollectedJob {
  const postedAt = text(posting.publishedDate);
  return {
    source: 'ashby',
    sourceJobId: text(posting.id) ?? '',
    url: hit.url,
    applyUrl: hit.url,
    title: text(posting.title) ?? '',
    // The posting API does not name the employer; the board slug is not a company name.
    company: text(hit.raw.company) ?? '',
    location: text(posting.locationName),
    postedAt,
    // Ashby publishes dates without a meaningful time of day.
    postedAtPrecision: 'day',
    description: plainText(text(posting.descriptionHtml) ?? ''),
    contact: null,
    search: hit.search,
    raw: { hit: hit.raw, posting },
  };
}
