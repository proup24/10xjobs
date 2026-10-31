import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import {
  Collector,
  type CollectionResult,
  type CollectorSearch,
  type CollectedJob,
} from '../types/collector';
import { plainText, precisionOf, record, text } from '../utils/collected-job';
import { GoogleJobsSearchProvider } from './apify/google-jobs-search.provider';
import { GreenhousePostingProvider } from './extraction/greenhouse-posting.provider';

@Injectable()
export class GreenhouseProvider extends Collector {
  readonly channel = Channel.GREEN_HOUSE;
  constructor(
    private readonly discovery: GoogleJobsSearchProvider,
    private readonly postings: GreenhousePostingProvider,
  ) {
    super();
  }

  async collect(search: CollectorSearch): Promise<CollectionResult> {
    const hits = await this.discovery.search(this.channel, search.keywords);
    const jobs = await Promise.all(
      hits.map(async (hit): Promise<CollectedJob> => {
        const posting = record(await this.postings.fetch(hit.url));
        const postedAt = text(posting.first_published);
        return {
          source: 'greenhouse',
          sourceJobId: text(posting.id) ?? '',
          url: hit.url,
          applyUrl: text(posting.absolute_url) ?? hit.url,
          title: text(posting.title) ?? '',
          company:
            text(posting.company_name) ??
            text(record(posting.company).name) ??
            '',
          location: text(record(posting.location).name),
          postedAt,
          postedAtPrecision: precisionOf(postedAt),
          description: plainText(text(posting.content) ?? '', true),
          contact: null,
          search: hit.search,
          raw: { hit: hit.raw, posting },
        };
      }),
    );
    return { jobs, complete: true, truncated: false };
  }
}
