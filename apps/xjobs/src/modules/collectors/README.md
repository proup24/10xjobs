# Collection

Collection fetches source results and saves a batch for ingestion.

## Follow the flow

1. `WorkerService` receives `collect` on the channel queue. Queue names, schedules, windows, and source limits live in `infrastructure/jobs/steps/collect/config.ts`.
2. `CollectionService.collect(channel)` loads active searches and groups them into segments. A segment is a small group of searches fetched together.
3. The coordinator selects the channel collector with a switch. LinkedIn collectors call Apify directly. Ashby and Greenhouse share Google discovery, then fetch postings from their public APIs.
4. `saveBatch()` writes the result file, then records the run, pending batch, and search cursors in one database transaction.
5. The coordinator enqueues the batch for ingestion.

Start reading at `infrastructure/jobs/steps/collect/collection.service.ts`. Each channel's source-specific logic lives in `providers/<channel>.collector.ts`. The Apify client, Google discovery, and posting fetchers are shared helpers; there are no collector base classes or per-channel job subclasses.

The segment workflow uses local `buildSearch`, `buildRun`, and `buildBatch` functions to keep data construction out of the main flow. Each segment returns `{ stored, collected, costUsd }`; only `collect()` updates the overall summary. A failed save contributes its known collection cost but contributes zero stored items and batches.

## Failure behavior

- A failed segment is recorded; other segments continue. The collection job fails if every segment failed.
- Storage or database failures leave cursors unchanged. A charge-capped run also leaves cursors unchanged so searches can run again.
- Failed posting fetches remain in the collected results with their error.
- If enqueueing fails after storage succeeds, the batch remains pending for the ingest sweeper.

## Local verification

```sh
pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/modules/collectors src/infrastructure/jobs/tests/collection.service.spec.ts src/infrastructure/worker/tests
```

These tests use local fakes for external services; they do not run paid collection jobs.
