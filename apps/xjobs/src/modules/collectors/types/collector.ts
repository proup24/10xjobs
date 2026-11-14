import { Channel } from 'src/common/enums';

/** One item exactly as the source returned it, with where its query ranked it. */
export interface RawCollectedItem {
  /** 1-based position the source reported; null when it reports none. */
  rank: number | null;
  /** Untouched source payload. */
  payload: unknown;
}

/** Where an actor says one of its items came from, read by a channel mapper. */
export interface ItemOrigin {
  /** The search the item echoes, comparable to a member's search; null when none. */
  search: string | null;
  /** 1-based position in that search; null when the actor reports none. */
  rank: number | null;
}

/** One member builder of a search segment, as a collector searches it. */
export interface SegmentQuery {
  /** The builder id; results are attributed and ingested against it. */
  id: string;
  keyword: string;
  params: Record<string, unknown>;
}

/** Up to ten builders searched together in one Apify run, over one window. */
export interface SegmentSearch {
  channel: Channel;
  since: Date;
  until: Date;
  queries: SegmentQuery[];
  /** Rows this search may return; the LinkedIn collector uses it in place of `maxRowsPerSearch`. */
  maxItems?: number;
}

/** What one segment run collected, per member builder, untouched. */
export interface SegmentResult {
  /** Every member id is a key, with an empty list when nothing matched it. */
  itemsByQuery: Map<string, RawCollectedItem[]>;
  /** Items the run returned that no member query claims; kept, never dropped. */
  unattributed: RawCollectedItem[];
  /** The actor that ran and its Apify run, for tracing a batch back to its source. */
  source: { actor: string; apifyRunId: string | null };
  /** Items the actor returned, attributed or not. */
  fetched: number;
  /**
   * What the source says matched each search (the LinkedIn actor's
   * `_meta.pagination`), untouched; null or absent when not reported.
   */
  searchTotals?: unknown;
  /** What Apify charged, or null when it did not report it. */
  costUsd: number | null;
  /** The run stopped at its charge cap, so results may be missing. */
  capped: boolean;
  /** Members whose search reached its row limit. */
  truncatedQueryIds: string[];
}

/** How a channel's actor runs; the values live in the channel's job config. */
export interface ActorRunConfig {
  actor: string;
  /** Spend cap of one segment run, in USD. */
  maxRunChargeUsd: number;
}

export interface LinkedinJobBoardRunConfig extends ActorRunConfig {
  /**
   * Rows one search may return, sent as the run's `maxItems` (a run carries
   * one search); a search that returns this many counts as truncated.
   */
  maxRowsPerSearch: number;
  /** The most rows a segment's `maxItems` may ask for. */
  maxRowsCeiling: number;
}

export interface LinkedinPostsRunConfig extends ActorRunConfig {
  maxPostsPerQuery: number;
}

/** Greenhouse and Ashby postings are discovered through Google. */
export interface BoardSearchRunConfig extends ActorRunConfig {
  site: string;
  suffix: string;
  maxPagesPerQuery: number;
}
