# Collection

Collection fetches source results and saves a batch for ingestion.

## Follow the flow

1. `WorkerService` receives `collect` on the channel queue. Queue names, schedules, windows, and source limits live in `infrastructure/jobs/steps/collect/config.ts`.
2. `CollectionService.collect(channel)` loads active searches and groups them into segments. A segment is a small group of searches fetched together.
3. Before fetching a segment, the coordinator claims its searches (`SearchSegmentsRepository.claim`). Only the first run collects a search over an interval. A search that another run holds under a live, overlapping claim is dropped from the segment, and so is one already covered up to the run's end. The window is then recomputed from the cursors the claim read. A segment with nothing claimed is skipped, and Apify is not called.
4. The coordinator selects the channel collector with a switch. LinkedIn collectors call Apify directly. Ashby and Greenhouse share Google discovery, then fetch postings from their public APIs. The Indeed collector calls Apify (the valig actor) like LinkedIn, every 3 hours from 09:00 to 21:00 Morocco time on weekdays, under its own daily budget. Until Indeed ingest exists (Phase 5 slice 04), its batches are saved and wait unprocessed.
5. `saveBatch()` writes the result file, then in one database transaction records the run and pending batch, moves the search cursors, and releases the run's claims.
6. The coordinator enqueues the batch for ingestion.

Start reading at `infrastructure/jobs/steps/collect/collection.service.ts`. Each channel's source-specific logic lives in `providers/<channel>.collector.ts`.

An actor's formats live in `providers/mappers/<channel>.mapper.ts`: how a segment becomes the actor's input, and where each returned item came from (its search and rank). To change a channel's actor, rewrite its mapper and the actor id in its collector's `config`; `providers/segment-result.ts` attributes the items the same way for every Apify channel. What an item means as a job is ingest's mapper for the same actor (`ingest/normalize/mappers/`). The Apify client, Google discovery, and posting fetchers are shared helpers; there are no collector base classes or per-channel job subclasses.

The segment workflow uses local `buildSearch`, `buildRun`, and `buildBatch` functions to keep data construction out of the main flow. Each segment returns `{ skipped, queriesSkipped, stored, collected, costUsd }`; only `collect()` updates the overall summary. A failed save contributes its known collection cost but contributes zero stored items and batches.

## Failure behavior

- A failed segment is recorded; other segments continue. The collection job fails if every attempted (not skipped) segment failed.
- Only a successful run counts as having used an interval. A failed or capped run releases its claims at once. A crashed run's claims expire after `claimLeaseMinutes`, which is 30 by default. A partial overlap with an earlier success, such as the deliberate re-search overlap, still runs.
- Storage or database failures leave cursors unchanged. A charge-capped run also leaves cursors unchanged so searches can run again.
- Failed posting fetches remain in the collected results with their error.
- If enqueueing fails after storage succeeds, the batch remains pending for the ingest sweeper.

## Local verification

```sh
pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/modules/collectors src/infrastructure/jobs/tests/collection.service.spec.ts src/infrastructure/worker/tests
```

These tests use local fakes for external services; they do not run paid collection jobs.
