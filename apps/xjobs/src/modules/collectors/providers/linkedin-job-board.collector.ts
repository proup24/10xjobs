import { Injectable } from '@nestjs/common';
import { Channel } from 'src/common/enums';
import type {
  LinkedinJobBoardRunConfig,
  RawCollectedItem,
  SegmentResult,
  SegmentSearch,
} from '../types/collector';
import {
  attribute,
  rankOf,
  reachedChargeCap,
  record,
  text,
} from '../utils/collected-job';
import { ApifyActorProvider } from './apify/apify.provider';

/** LinkedIn has no `GLOBAL` location; its worldwide search is `Worldwide`. */
function linkedinLocation(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value === 'GLOBAL' ? 'Worldwide' : value;
}

/**
 * The job search URL of one builder: its keyword, location (pinned by `geoId`
 * when the builder has one), `f_E` (experience)
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
  if (typeof params.geoId === 'string') query.set('geoId', params.geoId);
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

/** Each URL once, by meaning, keeping the first spelling and order. */
function distinctUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((url) => {
    const key = canonicalUrl(url) ?? url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
export class LinkedinJobBoardCollector {
  readonly channel = Channel.LINKEDIN_JOB_BOARD;
  constructor(private readonly actor: ApifyActorProvider) { }

  async collect(
    segment: SegmentSearch,
    config: LinkedinJobBoardRunConfig,
  ): Promise<SegmentResult> {
    const seconds = Math.max(
      1,
      Math.round((segment.until.getTime() - segment.since.getTime()) / 1000),
    );
    const searches = segment.queries.map((query) => ({
      id: query.id,
      search: linkedinJobSearchUrl(query.keyword, query.params, seconds),
    }));
    const { items, costUsd, runId, keyValueStoreId } = await this.actor.run(
      config.actor,
      {
        // Members with identical searches share one start URL; attribution
        // gives every one of them the URL's items.
        startUrls: distinctUrls(searches.map(({ search }) => search)).map(
          (url) => ({ url }),
        ),
        maxRowsPerUrl: config.maxRowsPerUrl,
        companyProfile: false,
        enrichCompany: false,
      },
      { maxChargeUsd: config.maxRunChargeUsd },
    );

    const { byQuery, unattributed } = attribute(
      items,
      (item) => canonicalUrl(scrapingInfo(item).inputUrl),
      searches.map(({ id, search }) => ({
        id,
        search: canonicalUrl(search) ?? search,
      })),
    );
    const raw = (item: unknown): RawCollectedItem => ({
      rank: rankOf(record(record(item).scrapingInfo).index),
      payload: item,
    });
    const itemsByQuery = new Map<string, RawCollectedItem[]>();
    const truncatedQueryIds: string[] = [];
    for (const { id } of searches) {
      const found = byQuery.get(id) ?? [];
      itemsByQuery.set(id, found.map(raw));
      // Scanned positions: what it returned, or the deepest index it reached.
      const scanned = Math.max(
        found.length,
        ...found.map((item) => scrapingInfo(item).index),
      );
      if (scanned >= config.maxRowsPerUrl) truncatedQueryIds.push(id);
    }
    return {
      itemsByQuery,
      searchTotals: await this.searchTotals(keyValueStoreId),
      unattributed: unattributed.map(raw),
      fetched: items.length,
      costUsd,
      capped: reachedChargeCap(costUsd, config.maxRunChargeUsd),
      truncatedQueryIds,
      source: { actor: config.actor, apifyRunId: runId },
    };
  }

  /**
   * What LinkedIn said matched each start URL, as the actor stored it. A
   * missing or unreadable record is null: the paid results never depend on it.
   */
  private async searchTotals(storeId: string | null): Promise<unknown> {
    if (!storeId) return null;
    try {
      return (await this.actor.record(storeId, 'SEARCH_TOTALS')) ?? null;
    } catch {
      return null;
    }
  }
}
