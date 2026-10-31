export const ingestConfig = {
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
