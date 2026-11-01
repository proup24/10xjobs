import type { Logger } from '@nestjs/common';
import type { RawCollectedItem, SegmentResult } from '../types/collector';
import { settledByKey } from '../utils/collected-job';
import {
  isGoogleRedirect,
  resolveGoogleRedirect,
} from '../utils/google-redirect';
import type {
  DiscoveryHit,
  SegmentDiscovery,
} from './apify/google_search.collector';

/** Postings fetched at once from the board's public API. */
const POSTING_CONCURRENCY = 4;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Fetches the posting behind every Google hit once, and returns each hit as
 * `{ hit, resolvedUrl, posting, fetchError }`. A Google redirect link is first
 * resolved to the posting URL (`resolvedUrl`; null for a direct link). A hit
 * whose lookup or fetch failed is kept with a null posting and the error: the
 * result was paid for, and ingest keys it by its URL.
 */
export async function withPostings(
  found: SegmentDiscovery,
  fetch: (url: string) => Promise<unknown>,
  logger: Logger,
): Promise<SegmentResult> {
  const hits = [
    ...[...found.hitsByQuery.values()].flat(),
    ...found.unattributed,
  ];
  const redirects = await settledByKey(
    hits.map((hit) => hit.url).filter(isGoogleRedirect),
    POSTING_CONCURRENCY,
    resolveGoogleRedirect,
  );
  if (redirects.failed.size)
    logger.warn(
      `Could not resolve ${redirects.failed.size} Google redirect links`,
    );
  const target = (hit: DiscoveryHit) =>
    isGoogleRedirect(hit.url)
      ? (redirects.values.get(hit.url) ?? null)
      : hit.url;

  const { values, failed } = await settledByKey(
    hits.map(target).filter((url): url is string => url !== null),
    POSTING_CONCURRENCY,
    fetch,
  );
  if (failed.size)
    logger.warn(`Kept ${failed.size} postings that could not be fetched`);

  const raw = (hit: DiscoveryHit): RawCollectedItem => {
    const url = target(hit);
    const error = url
      ? failed.get(url)
      : (redirects.failed.get(hit.url) ??
        new Error('Google redirect not resolved'));
    return {
      rank: hit.rank,
      payload: {
        hit: hit.raw,
        resolvedUrl: isGoogleRedirect(hit.url) ? url : null,
        posting: (url && values.get(url)) ?? null,
        fetchError: error === undefined ? null : message(error),
      },
    };
  };
  const itemsByQuery = new Map<string, RawCollectedItem[]>();
  for (const [id, queryHits] of found.hitsByQuery)
    itemsByQuery.set(id, queryHits.map(raw));
  return {
    itemsByQuery,
    unattributed: found.unattributed.map(raw),
    fetched: found.fetched,
    costUsd: found.costUsd,
    capped: found.capped,
    truncatedQueryIds: found.truncatedQueryIds,
    source: found.source,
  };
}
