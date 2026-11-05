/** How the ingest worker consumes the `ingest` queue. */
export const ingestWorkerConfig = {
  /** Batches ingested at once; each item is its own transaction. */
  concurrency: 2,
} as const;
