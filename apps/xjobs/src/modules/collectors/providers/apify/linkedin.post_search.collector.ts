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
    // The actor has no location filter, so `params.location` is not applied.
    const query = search.keyword;
    const items = await this.actor.run(
      cfg.actor,
      {
        searchQueries: [query],
        maxPosts: cfg.discovery.maxPostsPerQuery,
        sortBy: 'date',
      },
      { maxChargeUsd: cfg.maximumOperationBudgetMicroUsd / 1_000_000 },
    );
    return items.map((item) => toJob(record(item), query));
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
