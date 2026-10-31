import { Channel } from 'src/common/enums';
import { ChannelProvider, type ChannelCollectionResult, type ChannelSearch } from '../types/channel-provider';
import { Injectable } from '@nestjs/common';
import { GoogleJobsSearchProvider } from './apify/google-jobs-search.provider';
import { AshbyPostingProvider } from './extraction/ashby-posting.provider';

@Injectable()
export class AshbyProvider extends ChannelProvider {
  readonly channel = Channel.ASHBY;
  constructor(private readonly discovery: GoogleJobsSearchProvider, private readonly postings: AshbyPostingProvider) { super(); }
  async collect(search: ChannelSearch): Promise<ChannelCollectionResult> {
    const hits = await this.discovery.search(this.channel, search.keywords);
    const jobs = await Promise.all((hits as any[]).map(async (hit) => {
      const url = String(hit.url ?? hit.link ?? '');
      const posting = await this.postings.fetch(url) as any;
      return { externalId: String(posting.id), url, title: String(posting.title ?? ''), company: String(hit.company ?? 'Unknown'), location: posting.locationName ?? null, description: String(posting.descriptionHtml ?? ''), raw: { hit, posting } };
    }));
    return { jobs, complete: true, truncated: false };
  }
}
