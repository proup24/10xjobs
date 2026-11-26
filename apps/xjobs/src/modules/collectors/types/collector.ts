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
  /** The segment's key, for log lines only. */
  segmentKey?: string;
  /** The run's charge limit in USD; the posts collector refuses to start without it. */
  maxChargeUsd?: number;
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
  /**
   * Why the results may be missing some posts (a failure the actor logged but
   * did not report); set, the run is stored but no cursor moves.
   */
  incomplete?: string | null;
}

/** How a channel's actor runs; the values live in the channel's job config. */
export interface ActorRunConfig {
  actor: string;
  /** Spend cap of one segment run, in USD. */
  maxRunChargeUsd: number;
  /** The run's memory in MB; absent means the actor's default. Apify charges some actors' start fee per GB of memory. */
  memoryMbytes?: number;
}

export interface LinkedinPostsRunConfig extends ActorRunConfig {
  /** How long to wait for the run before aborting it, in seconds. */
  waitSecs: number;
}

export interface IndeedRunConfig extends ActorRunConfig {
  /** Rows every search asks for; a search that returns this many is full. */
  maxRowsPerSearch: number;
  /** How long to wait for the run before aborting it, in seconds. */
  waitSecs: number;
}

export interface LinkedinJobBoardRunConfig extends ActorRunConfig {
  /**
   * Rows every search asks for, sent as the run's row limit (a run carries
   * one search); a search that returns this many is full. `maxRunChargeUsd`
   * covers a run of this many rows.
   */
  maxRowsPerSearch: number;
}

/** Greenhouse and Ashby postings are discovered through Google. */
export interface BoardSearchRunConfig extends ActorRunConfig {
  site: string;
  suffix: string;
  maxPagesPerQuery: number;
}
