import { Channel } from 'src/common/enums';

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

/** What one segment run collected, per member builder. */
export interface SegmentResult {
  /** Every member id is a key, with an empty list when nothing matched it. */
  jobsByQuery: Map<string, CollectedJob[]>;
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

/** Wire name of the source a collected job came from. */
export type JobSource =
  | 'linkedin-jobs'
  | 'linkedin-posts'
  | 'ashby'
  | 'greenhouse';

export const channelSource = {
  [Channel.LINKEDIN_JOB_BOARD]: 'linkedin-jobs',
  [Channel.LINKEDIN_POSTS]: 'linkedin-posts',
  [Channel.ASHBY]: 'ashby',
  [Channel.GREEN_HOUSE]: 'greenhouse',
} as const satisfies Record<Channel, JobSource>;

/** The record every channel provider emits, and the item shape ingest accepts. */
export interface CollectedJob {
  source: JobSource;
  sourceJobId: string;
  /** Canonical posting URL. */
  url: string;
  applyUrl: string | null;
  title: string;
  company: string;
  location: string | null;
  /** ISO 8601 UTC. */
  postedAt: string | null;
  postedAtPrecision: 'hour' | 'day';
  /** Plain text. */
  description: string;
  contact: { name: string; url: string } | null;
  /** Query that found it. */
  search: string;
  raw: unknown;
}

export abstract class Collector<C extends ActorRunConfig = ActorRunConfig> {
  abstract readonly channel: Channel;
  abstract collect(segment: SegmentSearch, config: C): Promise<SegmentResult>;
}
