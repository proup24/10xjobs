import { Channel } from 'src/common/enums';

/** One item exactly as the source returned it, with where its query ranked it. */
export interface RawCollectedItem {
  /** 1-based position the source reported; null when it reports none. */
  rank: number | null;
  /** Untouched source payload. */
  payload: unknown;
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
  maxRowsPerUrl: number;
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

export abstract class Collector<C extends ActorRunConfig = ActorRunConfig> {
  abstract readonly channel: Channel;
  abstract collect(segment: SegmentSearch, config: C): Promise<SegmentResult>;
}
