import { Injectable } from '@nestjs/common';
import type {
  CollectedJob,
  LinkedinJobBoardRunConfig,
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

/** LinkedIn has no `GLOBAL` location; its worldwide search is `Worldwide`. */
function linkedinLocation(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value === 'GLOBAL' ? 'Worldwide' : value;
}

/**
 * The job search URL of one builder: its keyword, location, `f_E` (experience)
 * and `f_WT` (work type) when it has them, newest first (`sortBy=DD`, so a
 * search that reaches its row limit loses its oldest jobs), posted within the
 * last `seconds` (`f_TPR`).
 */
export function linkedinJobSearchUrl(
  keyword: string,
  params: Record<string, unknown>,
  seconds: number,
): string {
  const query = new URLSearchParams({ keywords: keyword });
  const location = linkedinLocation(params.location);
  if (location) query.set('location', location);
  if (typeof params.experienceLevel === 'string')
    query.set('f_E', params.experienceLevel);
  if (typeof params.workType === 'string') query.set('f_WT', params.workType);
  query.set('sortBy', 'DD');
  query.set('f_TPR', `r${seconds}`);
  return `https://www.linkedin.com/jobs/search/?${query.toString()}`;
}

/**
 * A search URL compared by meaning, not spelling: path plus decoded parameters
 * in order, so an echo that re-encodes or reorders them still matches.
 */
function canonicalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const params = [...url.searchParams].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `${url.origin}${url.pathname}?${JSON.stringify(params)}`;
  } catch {
    return null;
  }
}

/** Where the actor found an item: the start URL it echoes, and its position there. */
function scrapingInfo(item: unknown): {
  inputUrl: string | null;
  index: number;
} {
  const info = record(record(item).scrapingInfo);
  return {
    inputUrl: text(info.inputUrl),
    index: typeof info.index === 'number' ? info.index : 0,
  };
}

/** Apify trigger for the LinkedIn job board: one actor run per search segment. */
@Injectable()
export class LinkedinJobSearchProvider {
  constructor(private readonly actor: ApifyActorProvider) {}

  async search(
    segment: SegmentSearch,
    config: LinkedinJobBoardRunConfig,
  ): Promise<SegmentResult> {
    const seconds = Math.max(
      1,
      Math.round((segment.until.getTime() - segment.since.getTime()) / 1000),
    );
    const searches = segment.queries.map((query) => {
      const location = linkedinLocation(query.params.location);
      return {
        id: query.id,
        search: linkedinJobSearchUrl(query.keyword, query.params, seconds),
        label: location ? `${query.keyword} in ${location}` : query.keyword,
      };
    });
    const { items, costUsd } = await this.actor.run(
      config.actor,
      {
        startUrls: searches.map(({ search }) => ({ url: search })),
        maxRowsPerUrl: config.maxRowsPerUrl,
        companyProfile: false,
        enrichCompany: false,
      },
      { maxChargeUsd: config.maxRunChargeUsd },
    );

    const byQuery = attribute(
      items,
      (item) => canonicalUrl(scrapingInfo(item).inputUrl),
      searches.map(({ id, search }) => ({
        id,
        search: canonicalUrl(search) ?? search,
      })),
    );
    const jobsByQuery = new Map<string, CollectedJob[]>();
    const truncatedQueryIds: string[] = [];
    for (const { id, label } of searches) {
      const found = byQuery.get(id) ?? [];
      jobsByQuery.set(
        id,
        found.map((item) => toJob(record(item), label)),
      );
      // Scanned positions: what it returned, or the deepest index it reached.
      const scanned = Math.max(
        found.length,
        ...found.map((item) => scrapingInfo(item).index),
      );
      if (scanned >= config.maxRowsPerUrl) truncatedQueryIds.push(id);
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
