import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  Collector,
  type CollectionResult,
  type CollectorSearch,
  type CollectedJob,
} from '../types/collector';
import { plainText, record, text } from '../utils/collected-job';
import { GoogleJobsSearchProvider } from './apify/google_search.collector';
import { AshbyPostingProvider } from './extraction/ashby.provider';

@Injectable()
export class AshbyCollector extends Collector {
  readonly channel = Channel.ASHBY;
  constructor(
    private readonly discovery: GoogleJobsSearchProvider,
    private readonly postings: AshbyPostingProvider,
  ) {
    super();
  }

  async collect(search: CollectorSearch): Promise<CollectionResult> {
    const hits = await this.discovery.search(this.channel, search.keywords);
    const jobs = await Promise.all(
      hits.map(async (hit): Promise<CollectedJob> => {
        const posting = record(await this.postings.fetch(hit.url));
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
      }),
    );
    return { jobs, complete: true, truncated: false };
  }
}
