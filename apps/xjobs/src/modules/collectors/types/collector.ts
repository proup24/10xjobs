import { Channel } from 'src/common/enums';

export interface CollectorSearch {
  id: string;
  userId: string;
  profileId: string;
  channel: Channel;
  keywords: string[];
  params: Record<string, unknown>;
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

export interface CollectionResult {
  jobs: CollectedJob[];
  complete: boolean;
  truncated: boolean;
}

export abstract class Collector {
  abstract readonly channel: Channel;
  abstract collect(search: CollectorSearch): Promise<CollectionResult>;
}
