export { channelIngestConfig, type ChannelIngestConfig } from './channels';

export const ingestConfig = {
  /** Bucket holding one file per collection batch. */
  bucket: 'collection-batches',
  /** Item errors kept in a batch report; `invalid` always has the full count. */
  maxReportErrors: 100,
  /** How often the ingest worker re-enqueues stranded pending batches. */
  sweepEveryMs: 300,
  /** A pending batch older than this is considered stranded. */
  staleAfterMs: 600_000,
  /** Greenhouse hosts whose posting URLs name a board and job id. */
  greenhouseHosts: [
    'boards.greenhouse.io',
    'job-boards.greenhouse.io',
    'boards.eu.greenhouse.io',
    'job-boards.eu.greenhouse.io',
  ],
} as const;
export { normalizeConfig } from './normalize';
