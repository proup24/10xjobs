export { channelIngestConfig, type ChannelIngestConfig } from './channels';

export const ingestConfig = {
  /** Bucket holding one file per collection batch. */
  bucket: 'collection-batches',
  /** Item errors kept in a batch report; `invalid` always has the full count. */
  maxReportErrors: 100,
  /** How often the ingest worker re-enqueues stranded pending batches. */
  sweepEveryMs: 300_000,
  /** A pending batch older than this is considered stranded. */
  staleAfterMs: 600_000,
  /** Upper bound on items accepted in one ingest batch. */
  maxBatchItems: 1000,
  /** Deepest raw payload nesting accepted before an item is rejected. */
  maxRawDepth: 100,
  /** Bump when normalization output changes, so stored rows can be re-normalized. */
  normalizationVersion: 1,
  greenhouseHosts: [
    'boards.greenhouse.io',
    'job-boards.greenhouse.io',
    'boards.eu.greenhouse.io',
    'job-boards.eu.greenhouse.io',
  ],
} as const;
