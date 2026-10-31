import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import { channelConfig } from '../../config';
import type { CollectorSearch, CollectedJob } from '../../types/collector';
import {
  contact,
  plainText,
  precisionOf,
  record,
  text,
} from '../../utils/collected-job';
import { ApifyActorProvider } from './apify-actor.provider';

@Injectable()
export class LinkedinJobSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}

  async search(_search: CollectorSearch): Promise<CollectedJob[]> {
    const cfg = channelConfig[Channel.LINKEDIN_JOB_BOARD];
    const token = process.env.APIFY_TOKEN;
    if (!token)
      throw new Error('APIFY_TOKEN is required for LinkedIn collection');
    const searches = cfg.discovery.locations.flatMap((location) =>
      cfg.discovery.keywords.map((keyword) => ({
        search: `${keyword} in ${location}`,
        url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}`,
      })),
    );
    // One run per search URL so every job is attributed to the query that found it.
    const budgetUsd =
      cfg.maximumOperationBudgetMicroUsd / 1_000_000 / searches.length;
    const jobs: CollectedJob[] = [];
    for (const { search, url } of searches) {
      const items = await this.actor.run(
        cfg.actor,
        { startUrls: [{ url }], maxRowsPerUrl: cfg.discovery.maxRowsPerUrl },
        token,
        budgetUsd,
      );
      jobs.push(...items.map((item) => toJob(record(item), search)));
    }
    return jobs;
  }
}

function toJob(item: Record<string, unknown>, search: string): CollectedJob {
  const postedAt = text(item.publishedAt) ?? text(item.postedAt);
  return {
    source: 'linkedin-jobs',
    sourceJobId: text(item.id) ?? text(item.jobId) ?? '',
    url: text(item.url) ?? text(item.link) ?? text(item.jobUrl) ?? '',
    applyUrl: text(item.applyUrl),
    title: text(item.title) ?? '',
    company: text(item.companyName) ?? text(item.company) ?? '',
    location: text(item.location),
    postedAt,
    postedAtPrecision: precisionOf(postedAt),
    description: plainText(
      text(item.descriptionHtml) ?? text(item.description) ?? '',
    ),
    contact: contact(item.posterFullName, item.posterProfileUrl),
    search,
    raw: item,
  };
}
