import type { Logger } from '@nestjs/common';
import type { RawCollectedItem, SegmentResult } from '../types/collector';
import { settledByKey } from '../utils/collected-job';
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
 * `{ hit, posting, fetchError }`. A hit whose fetch failed is kept with a null
 * posting and the error: the result was paid for, and ingest keys it by its URL.
 */
export async function withPostings(
  found: SegmentDiscovery,
  fetch: (url: string) => Promise<unknown>,
  logger: Logger,
): Promise<SegmentResult> {
  const hits = [...[...found.hitsByQuery.values()].flat(), ...found.unattributed];
  const { values, failed } = await settledByKey(
    hits.map((hit) => hit.url),
    POSTING_CONCURRENCY,
    fetch,
  );
  if (failed.size)
    logger.warn(`Kept ${failed.size} postings that could not be fetched`);

  const raw = (hit: DiscoveryHit): RawCollectedItem => ({
    rank: hit.rank,
    payload: {
      hit: hit.raw,
      posting: values.get(hit.url) ?? null,
      fetchError: failed.has(hit.url) ? message(failed.get(hit.url)) : null,
    },
  });
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
