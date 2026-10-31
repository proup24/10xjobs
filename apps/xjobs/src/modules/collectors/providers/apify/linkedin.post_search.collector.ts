import { Injectable } from '@nestjs/common';
import type {
  CollectedJob,
  LinkedinPostsRunConfig,
  SegmentResult,
  SegmentSearch,
} from '../../types/collector';
import {
  attribute,
  contact,
  plainText,
  precisionOf,
  reachedChargeCap,
  record,
  text,
} from '../../utils/collected-job';
import { ApifyActorProvider } from './apify.provider';

/** The query a post was found by, as the actor echoes it. */
function querySearch(item: unknown): string | null {
  return text(record(record(item).query).search);
}

/** Apify trigger for LinkedIn posts: one actor run per search segment. */
@Injectable()
export class LinkedinPostSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}

  async search(
    segment: SegmentSearch,
    config: LinkedinPostsRunConfig,
  ): Promise<SegmentResult> {
    const searches = segment.queries.map((query) => ({
      id: query.id,
      search: query.keyword,
    }));
    // The actor has no location filter, so `params.location` is not applied.
    const { items, costUsd } = await this.actor.run(
      config.actor,
      {
        searchQueries: [...new Set(searches.map(({ search }) => search))],
        maxPosts: config.maxPostsPerQuery,
        postedLimitDate: segment.since.toISOString(),
        sortBy: 'date',
        profileScraperMode: 'short',
      },
      { maxChargeUsd: config.maxRunChargeUsd },
    );

    const byQuery = attribute(items, querySearch, searches);
    const jobsByQuery = new Map<string, CollectedJob[]>();
    const truncatedQueryIds: string[] = [];
    for (const { id, search } of searches) {
      const found = byQuery.get(id) ?? [];
      jobsByQuery.set(
        id,
        found.map((item) => toJob(record(item), search)),
      );
      // The actor reports no positions, so scanned is what it returned.
      if (found.length >= config.maxPostsPerQuery) truncatedQueryIds.push(id);
    }
    return {
      jobsByQuery,
      fetched: items.length,
      costUsd,
      capped: reachedChargeCap(costUsd, config.maxRunChargeUsd),
      truncatedQueryIds,
    };
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
