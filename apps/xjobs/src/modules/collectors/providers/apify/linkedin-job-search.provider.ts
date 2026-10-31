import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { channelConfig } from '../../config';
import type { ChannelJob, ChannelSearch } from '../../types/channel-provider';
import { ApifyActorProvider } from './apify-actor.provider';

@Injectable()
export class LinkedinJobSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}
  async search(search: ChannelSearch): Promise<ChannelJob[]> {
    const cfg = channelConfig[Channel.LINKEDIN_JOB_BOARD];
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('APIFY_TOKEN is required for LinkedIn collection');
    const urls = cfg.discovery.locations.flatMap((location) =>
      cfg.discovery.keywords.map((keyword) => ({ url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}` })),
    );
    const items = await this.actor.run(cfg.actor, { startUrls: urls, maxRowsPerUrl: cfg.discovery.maxRowsPerUrl }, token, cfg.maximumOperationBudgetMicroUsd / 1_000_000);
    return items.map((item: any) => ({ externalId: String(item.id ?? item.jobId ?? item.url), url: String(item.url ?? item.link ?? ''), title: String(item.title ?? ''), company: String(item.companyName ?? item.company ?? ''), location: item.location ?? null, description: String(item.description ?? ''), raw: item }));
  }
}
