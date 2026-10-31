import { Channel } from 'src/common/enums';
import { ChannelProvider, type ChannelCollectionResult, type ChannelSearch } from '../types/channel-provider';
import { Injectable } from '@nestjs/common';
import { GoogleJobsSearchProvider } from './apify/google-jobs-search.provider';
import { GreenhousePostingProvider } from './extraction/greenhouse-posting.provider';

@Injectable()
export class GreenhouseProvider extends ChannelProvider {
  readonly channel = Channel.GREEN_HOUSE;
  constructor(private readonly discovery: GoogleJobsSearchProvider, private readonly postings: GreenhousePostingProvider) { super(); }
  async collect(search: ChannelSearch): Promise<ChannelCollectionResult> {
    const hits = await this.discovery.search(this.channel, search.keywords);
    const jobs = await Promise.all((hits as any[]).map(async (hit) => {
      const url = String(hit.url ?? hit.link ?? '');
      const posting = await this.postings.fetch(url) as any;
      return { externalId: String(posting.id), url, title: String(posting.title ?? ''), company: String(posting.company?.name ?? 'Unknown'), location: posting.location?.name ?? null, description: String(posting.content ?? ''), raw: { hit, posting } };
    }));
    return { jobs, complete: true, truncated: false };
  }
}
