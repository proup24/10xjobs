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
import { ApifyActorProvider } from './apify.provider';

@Injectable()
export class LinkedinPostSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}

  async search(search: CollectorSearch): Promise<CollectedJob[]> {
    const cfg = channelConfig[Channel.LINKEDIN_POSTS];
    const token = process.env.APIFY_TOKEN;
    if (!token)
      throw new Error('APIFY_TOKEN is required for LinkedIn collection');
    const queries = search.keywords.length
      ? search.keywords
      : cfg.discovery.queries;
    // One run per query so every post is attributed to the query that found it.
    const budgetUsd =
      cfg.maximumOperationBudgetMicroUsd / 1_000_000 / queries.length;
    const jobs: CollectedJob[] = [];
    for (const query of queries) {
      const items = await this.actor.run(
        cfg.actor,
        {
          searchQueries: [query],
          maxPosts: cfg.discovery.maxPostsPerQuery,
          sortBy: 'date',
        },
        token,
        budgetUsd,
      );
      jobs.push(...items.map((item) => toJob(record(item), query)));
    }
    return jobs;
  }
}

function toJob(item: Record<string, unknown>, search: string): CollectedJob {
  const author = record(item.author);
  const postedAt = text(record(item.postedAt).date);
  const body = plainText(
    text(item.content) ?? text(item.text) ?? text(item.description) ?? '',
  );
  const isProfile = author.type === 'profile';
  return {
    source: 'linkedin-posts',
    sourceJobId: text(item.id) ?? text(item.urn) ?? '',
    url: text(item.linkedinUrl) ?? text(item.url) ?? text(item.postUrl) ?? '',
    applyUrl: text(record(item.article).link),
    title:
      body
        .split('\n')
        .find((line) => line.trim())
        ?.trim() ?? '',
    // Posts name an author, not an employer.
    company: '',
    location: null,
    postedAt,
    postedAtPrecision: precisionOf(postedAt),
    description: body,
    contact: isProfile ? contact(author.name, author.linkedinUrl) : null,
    search,
    raw: item,
  };
}
