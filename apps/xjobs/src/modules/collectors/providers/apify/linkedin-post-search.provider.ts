import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { channelConfig } from '../../config';
import type { ChannelJob, ChannelSearch } from '../../types/channel-provider';
import { ApifyActorProvider } from './apify-actor.provider';

@Injectable()
export class LinkedinPostSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}
  async search(search: ChannelSearch): Promise<ChannelJob[]> {
    const cfg = channelConfig[Channel.LINKEDIN_POSTS];
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('APIFY_TOKEN is required for LinkedIn collection');
    const queries = search.keywords.length ? search.keywords : cfg.discovery.queries as string[];
    const items = await this.actor.run(cfg.actor, { searchQueries: queries, maxPosts: cfg.discovery.maxPostsPerQuery, sortBy: 'date' }, token, cfg.maximumOperationBudgetMicroUsd / 1_000_000);
    return items.map((item: any) => ({ externalId: String(item.id ?? item.urn ?? item.url), url: String(item.url ?? item.postUrl ?? ''), title: String(item.text ?? item.description ?? ''), company: String(item.authorName ?? item.author ?? 'Unknown'), location: null, description: String(item.text ?? item.description ?? ''), raw: item }));
  }
}
