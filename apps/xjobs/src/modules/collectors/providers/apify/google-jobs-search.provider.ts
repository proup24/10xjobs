import { Injectable } from '@nestjs/common';
import { channelConfig } from '../../config';
import { Channel } from 'src/common/enums';
import { ApifyActorProvider } from './apify-actor.provider';

@Injectable()
export class GoogleJobsSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}
  async search(channel: Channel.ASHBY | Channel.GREEN_HOUSE, keywords: string[]) {
    const cfg = channelConfig[channel];
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('APIFY_TOKEN is required for job discovery');
    const queries = (keywords.length ? keywords : cfg.discovery.terms as string[]).map((term) => `site:${cfg.discovery.site} "${term}" ${cfg.discovery.suffix}`);
    return this.actor.run(cfg.actor, { queries: queries.join('\n'), maxPagesPerQuery: cfg.discovery.maxPagesPerQuery }, token, cfg.maximumOperationBudgetMicroUsd / 1_000_000);
  }
}
