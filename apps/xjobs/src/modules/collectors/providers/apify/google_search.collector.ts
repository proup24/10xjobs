import { Injectable } from '@nestjs/common';
import { channelConfig } from '../../config';
import { Channel } from 'src/common/enums';
import { record, text } from '../../utils/collected-job';
import { ApifyActorProvider } from './apify.provider';

export interface DiscoveryHit {
  url: string;
  /** Google query that returned this result. */
  search: string;
  raw: Record<string, unknown>;
}

@Injectable()
export class GoogleJobsSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}

  async search(
    channel: Channel.ASHBY | Channel.GREEN_HOUSE,
    keyword: string,
  ): Promise<DiscoveryHit[]> {
    const cfg = channelConfig[channel];
    const queries = [
      `site:${cfg.discovery.site} "${keyword}" ${cfg.discovery.suffix}`,
    ];
    const pages = await this.actor.run(
      cfg.actor,
      {
        queries: queries.join('\n'),
        maxPagesPerQuery: cfg.discovery.maxPagesPerQuery,
      },
      { maxChargeUsd: cfg.maximumOperationBudgetMicroUsd / 1_000_000 },
    );
    return pages.flatMap((value) => {
      const page = record(value);
      // Each dataset item is one results page; its query is echoed in searchQuery.term.
      const search =
        text(record(page.searchQuery).term) ??
        (queries.length === 1 ? queries[0] : null);
      const results = Array.isArray(page.organicResults)
        ? page.organicResults.map(record)
        : [page];
      return results.flatMap((result) => {
        const url = text(result.url) ?? text(result.link);
        return url && search ? [{ url, search, raw: result }] : [];
      });
    });
  }
}
