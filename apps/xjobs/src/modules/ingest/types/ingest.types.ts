import type { Channel } from 'src/common/enums';
import type { ChannelJob } from '../../channels/types/channel-provider';

/** Existing collectors can pass ChannelJob directly; future adapters can supply the optional fields. */
export type FetchedItem = Omit<
  ChannelJob,
  'externalId' | 'title' | 'company'
> & {
  externalId?: string | null;
  title?: string | null;
  company?: string | null;
  applyUrl?: string | null;
  postedAt?: string | null;
  postedAtPrecision?: 'hour' | 'day' | null;
  authorName?: string | null;
  authorUrl?: string | null;
  contactName?: string | null;
  contactUrl?: string | null;
  rank?: number | null;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export interface AtsIdentity {
  provider: 'ashby' | 'greenhouse';
  tenantKey: string;
  postingId: string;
}

export interface NormalizedJob {
  channel: Channel;
  kind: 'job' | 'post';
  externalId: string | null;
  url: string;
  applyUrl: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  description: string;
  postedAt: Date | null;
  postedAtPrecision: 'hour' | 'day' | null;
  authorName: string | null;
  authorUrl: string | null;
  contactName: string | null;
  contactUrl: string | null;
  raw: JsonValue;
  normalizationVersion: number;
  ats: AtsIdentity | null;
  observedUrl: string;
  rank: number | null;
}

export type SaveOutcome = {
  id: string;
  outcome: 'inserted' | 'updated' | 'duplicate';
};
export interface IngestBatch {
  queryId: string;
  observedAt: Date;
  channel?: Channel;
  items: readonly unknown[];
}
export interface IngestReport {
  inserted: number;
  updated: number;
  duplicate: number;
  invalid: number;
  jobIds: string[];
  errors: { index: number; reason: string }[];
}
