# Ingest Raw Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect saves each segment run's untouched results as a stored batch (`pending`). A dedicated ingest worker consumes it, validates it, removes exact repeats and persists raw items, versions and sightings, then marks the batch `ingested` or `failed`.

**Architecture:**

- Collectors return raw payloads with attribution instead of `CollectedJob`.
- `CollectionJob` writes the batch file through `StorageService`. In one transaction it records the segment run, the `collection_batches` row and the cursor move, then enqueues `{ batchId }` on the `ingest` queue.
- The rewritten `modules/ingest` owns the batch format, source keys, content hashes and the raw tables.
- A worker started with `WORKER_ROLE=ingest` consumes the queue and runs a sweeper.
- The old normalized `raw_jobs` storage is removed last.

**Tech Stack:** NestJS 11, Prisma 8 contract + migrations (`prisma contract emit`, `prisma migration plan`), BullMQ, Supabase Storage via `StorageService`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-ingest-raw-storage-design.md`

## Global Constraints

- Batch status: `pending | ingested | failed`. The DB row is the source of truth; the queue message is only a nudge.
- Bucket `collection-batches`. Key `<channel>/<yyyy-mm-dd of observedAt, UTC>/<segmentRunId>.json`. Content type `application/json`. Files are never overwritten.
- Batch file `formatVersion: 1`, with the fields exactly as the spec's JSON example. `observedAt` is the segment's `until`.
- Source keys (prefix included, so kinds never collide):
  - LinkedIn job board and posts: `id:<id>`, else `url:<canonical url>`.
  - Ashby and Greenhouse: `posting:<tenant>/<postingId>`, parsed from `hit.url` only.
  - A Greenhouse or Ashby hit that is not a posting URL is invalid, with reason `not a posting URL`.
- Content hash: SHA-256 hex of canonical JSON (object keys sorted recursively) of the payload with the channel's volatile top-level keys removed.
- Cursors move in the same transaction that inserts the batch row, never after ingest. A capped run never moves cursors.
- Ingest never calls Apify, an LLM or any HTTP API. Tests never call Apify or a real bucket.
- Raw tables are shared (not workspace-scoped). `raw_item_sightings.queryId` uses `ON DELETE RESTRICT`.
- No full payloads or descriptions in logs.

## Review Focus

1. **The same posting found by two member queries in one segment.** Expect one raw item and one version, with two sightings (one per query). Pinned in Task 3.
2. **A batch where every item is invalid.** The batch is still `ingested` (not `failed`): `invalid = received`, and the errors are listed. Pinned in Task 3.
3. **A redelivered or duplicate queue message for an already ingested batch** (the BullMQ retry after a crash). It's acknowledged with no writes, and the counts in the report are unchanged. Pinned in Task 3.
4. **A collector failure (Apify throws).** The segment run is recorded `failed`, no file and no batch are written, and cursors stay. Pinned in Task 4.
5. **The ingest worker started without Supabase vars.** Startup fails with the env message, not a later runtime crash. Pinned in Task 5.

---

### Task 1: Raw storage schema and migration

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma` (add four models; keep the old raw models until Task 6)
- Create: migration via `pnpm --filter @xjobs/xjobs db:migration:plan --name ingest_raw_storage` (generated folder under `database/migrations/app/`, and regenerated `contract.d.ts` / `contract.json`)
- Modify: `apps/xjobs/src/database/models.ts` (export row types `CollectionBatchRow`, `RawItemRow`, `RawItemVersionRow`, `RawItemSightingRow`, following the existing row exports)

**Interfaces:**

- Produces the tables below, which every later task uses through `database.db.orm.public.<Model>` or `db.sql`.

**`CollectionBatch`** (`@@map("collection_batches")`)

- Columns: `id Uuid @id`, `channel Channel`, `segmentRunId Uuid` (relation to `SearchSegmentRun`, unique), `storageKey String`, `formatVersion Int`, `observedAt`, `itemCount Int`, `actor String`, `apifyRunId String?`, `status String`, `attempts Int @default(0)`, `lastError String?`, `ingestedAt?`, `report Jsonb?`, `createdAt @default(now())`.
- Checks: `status IN ('pending','ingested','failed')` and `attempts >= 0`.
- `@@index([status, createdAt])`.

**`RawItem`** (`raw_items`)

- Columns: `id`, `channel`, `sourceKey String`, `kind String` (`job | post`, check), `firstSeenAt`, `lastSeenAt`, `latestVersionId Uuid?` (plain column, no FK, to avoid a cycle).
- `@@unique([channel, sourceKey])`, plus a check `firstSeenAt <= lastSeenAt`.

**`RawItemVersion`** (`raw_item_versions`)

- Columns: `id`, `rawItemId` (FK, cascade), `contentHash String`, `payload Jsonb`, `firstBatchId` (FK `collection_batches`, restrict), `firstSeenAt`, `lastSeenAt`, `createdAt @default(now())`.
- `@@unique([rawItemId, contentHash])` and `@@index([createdAt])`.

**`RawItemSighting`** (`raw_item_sightings`)

- Columns: `id`, `batchId` (FK, restrict), `rawItemId` (FK, cascade), `versionId` (FK, cascade), `queryId Uuid?` (FK `query_search_builders`, `onDelete: Restrict`), `rank Int?` (check `rank IS NULL OR rank > 0`), `observedAt`.
- Uniqueness with nulls treated as equal: add a raw SQL unique index `UNIQUE NULLS NOT DISTINCT ("batchId","rawItemId","queryId")` in the generated `migration.ts`, if the contract DSL can't express it.

Steps:

- [ ] **Step 1:** Add the four models to `contract.prisma`, and run `pnpm --filter @xjobs/xjobs db:format`.
- [ ] **Step 2:** Run `pnpm --filter @xjobs/xjobs db:migration:plan --name ingest_raw_storage`. Expected: a new folder whose `ops.json` creates the four tables, checks and indexes. Add the `NULLS NOT DISTINCT` unique index by hand if it's missing.
- [ ] **Step 3:** Export the row types in `models.ts`. Run `npx nx typecheck xjobs`. Expected: PASS.
- [ ] **Step 4:** If `INGEST_TEST_DATABASE_URL` is set, apply the migration to that disposable DB with `pnpm --filter @xjobs/xjobs db:migrate`. Expected: success. Otherwise record "migration not applied: no isolated database" in the commit body.
- [ ] **Step 5: Commit** `feat(database): collection batches and raw item tables`.

---

### Task 2: Ingest pure core (batch format, source keys, content hash)

**Files:**

- Create: `apps/xjobs/src/modules/ingest/types/batch.types.ts`, `modules/ingest/utils/source-key.ts`, `modules/ingest/utils/content-hash.ts`, `modules/ingest/utils/batch-file.ts`, `modules/ingest/config/channels.ts`
- Modify: `modules/ingest/utils/identity.ts` (keep `webUrl`, `atsIdentity` and the LinkedIn canonicalizers; the rest goes in Task 6), `modules/ingest/config/index.ts`
- Test: `modules/ingest/utils/source-key.spec.ts`, `content-hash.spec.ts`, `batch-file.spec.ts`, with fixtures in `modules/ingest/utils/fixtures/` (one real-shaped payload per channel, plus a failed ATS fetch)

**Interfaces:**

- Produces in `types/batch.types.ts`:
  ```ts
  export interface RawCollectedItem {
    rank: number | null;
    payload: unknown;
  }
  export interface BatchFile {
    formatVersion: 1;
    batchId: string;
    channel: Channel;
    segmentRunId: string;
    observedAt: string;
    source: { actor: string; apifyRunId: string | null };
    queries: { id: string; keyword: string; params: Record<string, unknown> }[];
    itemsByQuery: Record<string, RawCollectedItem[]>;
    unattributed: RawCollectedItem[];
  }
  export type BatchStatus = 'pending' | 'ingested' | 'failed';
  export interface BatchReport {
    received: number;
    newItems: number;
    newVersions: number;
    repeats: number;
    invalid: number;
    errors: { queryId: string | null; index: number; reason: string }[];
  }
  ```
- `sourceKey(channel: Channel, payload: unknown): { key: string } | { invalid: string }`
- `contentHash(channel: Channel, payload: unknown): string`
- `serializeBatchFile(file: BatchFile): Buffer`
- `parseBatchFile(data: Buffer): BatchFile`. It throws `BatchFileError` (exported) on bad JSON, an unknown `formatVersion` or a missing field.
- `batchStorageKey(channel: Channel, observedAt: Date, segmentRunId: string): string`
- `ingestConfig` gains `bucket: 'collection-batches'`, `maxReportErrors: 100`, `sweepEveryMs: 300_000` and `staleAfterMs: 600_000`. `channelIngestConfig: Record<Channel, { kind: 'job' | 'post'; volatileKeys: string[] }>`:
  - `LINKEDIN_JOB_BOARD`: job, `['scrapingInfo']`.
  - `LINKEDIN_POSTS`: post, plus the engagement-counter keys seen in the fixture.
  - `ASHBY` and `GREEN_HOUSE`: job, `['hit']` (the Google snippet varies by search; the posting is the content).

Steps:

- [ ] **Step 1: Write failing tests.**
  - `sourceKey`:
    - LinkedIn job `{ id: '123', url: … }` gives `id:123`.
    - Without `id`, `{ url: 'https://WWW.linkedin.com/jobs/view/123/?trk=x#a' }` gives `url:` plus the canonical form, the same as `canonicalSource` today.
    - LinkedIn posts take `id`, then `urn`, then `linkedinUrl`.
    - Ashby `{ hit: { url: 'https://jobs.ashbyhq.com/acme/0b1c…' }, posting: null, fetchError: 'timeout' }` gives `posting:acme/0b1c…`, the same key as the fetched fixture.
    - Greenhouse on `boards.greenhouse.io/acme/jobs/42` and on the EU host both give `posting:acme/42`.
    - `{ hit: { url: 'https://jobs.ashbyhq.com/acme' } }` gives `{ invalid: 'not a posting URL' }`.
    - A payload that isn't an object gives `{ invalid: 'payload is not a JSON object' }`.
    - The id values `'undefined'` and `'null'` and blank strings fall through to the URL.
  - `contentHash`:
    - The same payload with keys in a different order gives the same hash.
    - A LinkedIn job differing only in `scrapingInfo` gives the same hash.
    - A different `description` gives a different hash.
  - `batch-file`:
    - Round trip.
    - `formatVersion: 2` throws `BatchFileError`, as do bad JSON and a missing `itemsByQuery`.
    - `batchStorageKey(Channel.ASHBY, new Date('2026-10-31T23:30:00Z'), 'r1')` returns `'ASHBY/2026-10-31/r1.json'`.
- [ ] **Step 2:** Run `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest/utils`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the functions above. Reuse `atsIdentity` (which returns `tenantKey`/`postingId`) and the LinkedIn canonicalizers from `identity.ts`. Use `node:crypto` `createHash('sha256')`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ingest): batch file format, source keys and content hashes`.

---

### Task 3: Batch ingestion (repository, service, status, replay)

**Files:**

- Create: `modules/ingest/repositories/raw-storage.repository.ts`, `modules/ingest/services/batch-ingest.service.ts`
- Modify: `modules/ingest/ingest.module.ts` (import `StorageModule`, provide the new repository and service, and export `BatchIngestService`), `modules/ingest/index.ts`
- Test: `modules/ingest/services/batch-ingest.service.spec.ts` (in-memory repository fake and `MemoryStorageService` from `modules/storage/testing`), `modules/ingest/repositories/raw-storage.postgres.spec.ts` (same guard as the existing `ingest.postgres.spec.ts`: `INGEST_TEST_DATABASE_URL`, db `ingest_test` on `127.0.0.1`, otherwise skipped)

**Interfaces:**

- Consumes the Task 2 functions and types, and the Task 1 tables.
- Produces:
  ```ts
  export abstract class RawStorageRepository {
    findBatch(id: string): Promise<{ id; channel; storageKey; status: BatchStatus; attempts: number } | null>;
    /** One transaction per item; idempotent. Returns what the item added. */
    saveItem(input: { batchId; channel; kind; sourceKey; contentHash; payload; queryId: string | null; rank: number | null; observedAt: Date }): Promise<{ newItem: boolean; newVersion: boolean }>;
    markIngested(id: string, report: BatchReport): Promise<void>; // only from 'pending'
    recordAttemptFailure(id: string, error: string, final: boolean): Promise<void>; // attempts+1, lastError; final → 'failed'
    markFailed(id: string, reason: string): Promise<void>; // bad file: failed at once
    resetToPending(id: string): Promise<boolean>; // only from 'failed'; attempts=0
    listStalePending(olderThan: Date, limit: number): Promise<string[]>;
  }
  export class BatchIngestService {
    ingestBatch(batchId: string, attempt: { final: boolean }): Promise<BatchReport | null>; // null = not pending, no-op
    replay(batchId: string): Promise<boolean>; // resets a failed batch; the caller enqueues
  }
  ```
- `saveItem` semantics:
  - It upserts `raw_items` on `(channel, sourceKey)`, with `firstSeenAt`/`lastSeenAt` taking the min/max.
  - It upserts `raw_item_versions` on `(rawItemId, contentHash)`, with first/last seen taking the min/max and `firstBatchId` set only on insert.
  - It sets `latestVersionId` to the version with the greatest `lastSeenAt` (ties go to the latest `createdAt`).
  - It inserts the sighting with `ON CONFLICT DO NOTHING`.
  - It retries the whole transaction up to 3 times on `isRetryableTransactionError` (`src/database/errors.ts`).
- `ingestBatch`:
  1. Not `pending`: return `null`.
  2. Read the file with `StorageService.get(ingestConfig.bucket, storageKey)`. On `StorageObjectNotFoundError` or `BatchFileError`, call `markFailed` and return the report with `invalid = 0`. On any other error, call `recordAttemptFailure(id, msg, final)` and rethrow.
  3. Go through every item in `itemsByQuery` (with that `queryId`) and in `unattributed` (`queryId` null). An item with no key is counted invalid, its error kept up to `maxReportErrors`. Otherwise `saveItem`.
  4. Report counts:
     - `newItems`: items that created a raw item.
     - `newVersions`: versions created on an existing item.
     - `repeats`: neither.
     - `received`: every item seen.
  5. An infrastructure error: `recordAttemptFailure` and rethrow.
  6. Finish with `markIngested`.

Steps:

- [ ] **Step 1: Write failing unit tests** (service, fake repository):
  - A pending batch with 2 queries and 1 unattributed item gives `saveItem` called with the right `queryId`, or null for the unattributed item.
  - A non-pending batch returns `null`, with no storage read and no writes.
  - A missing file calls `markFailed(id, 'batch file missing')`.
  - `formatVersion: 2` calls `markFailed`.
  - An all-invalid batch is `ingested` with `invalid === received` (Review Focus 2).
  - Errors are capped at 100 while `invalid` keeps the full count.
  - A repository error on attempt 1 records the attempt and rethrows; with `final: true` it marks the batch failed.
  - `replay` on a failed batch returns `true`; on an ingested batch it returns `false`.
- [ ] **Step 2: Write failing Postgres tests:**
  - A first sighting creates an item, a version and a sighting.
  - The same payload in a second batch adds only a sighting.
  - A changed payload adds a version.
  - A → B → A puts `latestVersionId` back to A.
  - Re-running `saveItem` for the same batch, item and query writes nothing.
  - The same posting under two queries in one batch gives 1 item, 1 version and 2 sightings (Review Focus 1).
  - Two concurrent `ingestBatch` runs over overlapping batches leave no duplicate rows.
  - Observations out of order keep `firstSeenAt` and `lastSeenAt` correct.
  - A failed ATS fetch and a later fetched posting share one raw item.
  - Ingesting an already `ingested` batch again is a no-op (Review Focus 3).
- [ ] **Step 3:** Run `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest`. Expected: the new tests FAIL.
- [ ] **Step 4:** Implement the repository and the service as specified. Leave the old `IngestService` in place (it's removed in Task 6).
- [ ] **Step 5:** Run the same command (with `INGEST_TEST_DATABASE_URL` if available). Expected: PASS. Note in the commit body if the Postgres tests were skipped.
- [ ] **Step 6: Commit** `feat(ingest): ingest stored batches into raw items, versions and sightings`.

---

### Task 4: Collectors return raw items, and collection persists batches

**Files:**

- Modify: `modules/collectors/types/collector.ts` (the `SegmentResult` change; delete `CollectedJob`, `JobSource` and `channelSource` if nothing else uses them), `modules/collectors/utils/collected-job.ts` (`attribute` also returns unattributed items; drop the mapping helpers nothing uses any more), `providers/apify/apify.provider.ts` (return `runId`), `providers/apify/linkedin.job_search.collector.ts`, `providers/apify/linkedin.post_search.collector.ts`, `providers/apify/google_search.collector.ts`, `providers/ashby.service.ts`, `providers/greenhouse.service.ts`, `providers/linkedin.job_board.service.ts`, `providers/linkedin.posts.service.ts`
- Create: `infrastructure/jobs/ingest-queue.service.ts`
- Modify: `modules/segments/segments.repository.ts`, `infrastructure/jobs/collection/collection.job.ts` and the four `*.job.ts` files (replace the `IngestService` dependency with `StorageService` and `IngestQueue`), `infrastructure/jobs/jobs.module.ts` (import `StorageModule`, provide `IngestQueue`), `config/environment.validation.ts` + `config/validation.spec.ts` (the worker schema now requires the Supabase vars — `SUPABASE_URL`/`SUPABASE_PUBLIC_URL` and `SUPABASE_SERVICE_ROLE_KEY`/`SERVICE_ROLE_KEY`, same messages as the app schema — in **every** worker mode, because `JobsModule` now pulls in `StorageModule`), `docker-compose.worker.yaml` (pass those vars to `worker`)
- Test: `modules/collectors/providers/segment-collect.spec.ts`, `providers/apify/apify.provider.spec.ts`, `modules/segments/segments.repository.spec.ts`, `infrastructure/jobs/tests/collection.job.spec.ts`

**Interfaces:**

- Consumes `RawCollectedItem`, `BatchFile`, `serializeBatchFile`, `batchStorageKey` and `ingestConfig.bucket` (Task 2).
- Produces:
  ```ts
  // collectors
  export interface SegmentResult {
    itemsByQuery: Map<string, RawCollectedItem[]>; unattributed: RawCollectedItem[];
    fetched: number; costUsd: number | null; capped: boolean; truncatedQueryIds: string[];
    source: { actor: string; apifyRunId: string | null };
  }
  // segments
  export type SegmentRunStatus = 'succeeded' | 'failed';
  export interface SegmentQueryOutcome { returned: number }
  export interface NewCollectionBatch { id: string; storageKey: string; formatVersion: 1; observedAt: Date; itemCount: number; actor: string; apifyRunId: string | null }
  abstract recordCollectedRun(run: NewSegmentRun & { id: string }, batch: NewCollectionBatch, advance: string[]): Promise<void>; // one transaction
  abstract recordRun(run: NewSegmentRun): Promise<void>; // unchanged, used for failures
  // jobs
  export const INGEST_QUEUE = 'ingest'; export const INGEST_BATCH_JOB = 'ingest-batch'; export const SWEEP_JOB = 'sweep';
  export class IngestQueue { enqueue(batchId: string): Promise<void> } // jobId = batchId; attempts 5, exponential backoff 30s; removeOnComplete { age: 86400 }
  ```
- Payloads:
  - LinkedIn job board: the dataset item, rank `scrapingInfo.index` when it's a positive integer, else null.
  - LinkedIn posts: the dataset item, rank null.
  - Ashby and Greenhouse: `{ hit: hit.raw, posting, fetchError: null }` on success. When the fetch failed: `{ hit: hit.raw, posting: null, fetchError: <message> }`. Rank is the hit's Google `position` when present.
  - Hits are no longer dropped: a failed fetch stays in the batch.
- `CollectionJob.runSegment` order:
  1. Generate `runId` and `batchId` with `randomUUID()`.
  2. Run `collect`. On a throw, call `recordRun` with `failed` and stop.
  3. `storage.put(bucket, key, serializeBatchFile(file), 'application/json')`.
  4. `recordCollectedRun(run with status 'succeeded' and perQuery { [id]: { returned } }, batch, capped ? [] : memberIds)`.
  5. `ingestQueue.enqueue(batchId)`. On a throw, log a warning and keep going.

  If step 3 or 4 throws, call `recordRun` with `failed` and the error (best effort) and leave cursors alone. `CollectionSummary` drops inserted, updated, duplicate and invalid, and adds `batches`.

Steps:

- [ ] **Step 1: Write failing tests.**
  - Collectors:
    - Each returns untouched payloads keyed by member.
    - An item no member claims lands in `unattributed`.
    - A failed Ashby/Greenhouse posting fetch yields `{ posting: null, fetchError }` instead of disappearing.
    - `source.actor` and `apifyRunId` are filled.
  - Apify provider: `run` returns `runId` from the run object.
  - Segments repository: `recordCollectedRun` writes the run, the batch (`pending`) and the cursors together. A failing batch insert leaves no run and no cursor move (fake transaction, or Postgres when available).
  - Collection job:
    - It calls the storage put, then `recordCollectedRun`, then enqueue, in that order.
    - A capped run passes `advance = []`.
    - A storage failure gives `recordRun('failed')` and no `recordCollectedRun`.
    - A collector throw writes no file (Review Focus 4).
  - Env: the worker schema without Supabase vars fails with `Set SUPABASE_URL (or SUPABASE_PUBLIC_URL)`, also when no `WORKER_CHANNEL` is set.
    - An enqueue failure still counts the segment as succeeded.
    - The summary has `batches`.
    - All segments failed still throws.
- [ ] **Step 2:** Run `npx nx test xjobs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement as specified. Remove the `toJob` mappers.
- [ ] **Step 4:** Run `npx nx test xjobs` and `npx nx typecheck xjobs`. Expected: PASS. The old ingest tests still pass, since nothing calls the old service any more.
- [ ] **Step 5: Commit** `feat(jobs): collection stores raw batches and hands them to ingest`.

---

### Task 5: Ingest worker process, sweeper and deployment

**Files:**

- Modify: `config/environment.validation.ts`:
  - Add `WORKER_ROLE: z.enum(['ingest']).optional()`.
  - `WORKER_ROLE` and `WORKER_CHANNEL` are mutually exclusive.
  - The Supabase vars are already required in every worker mode (Task 4).
- Modify: `config/validation.spec.ts`, `infrastructure/worker/worker.service.ts` (third mode), `infrastructure/worker/worker.module.ts` (import `IngestModule`), `infrastructure/worker/scheduler.ts` (add `syncSweepScheduler`), `worker.ts` (error text mentions storage)
- Create: `infrastructure/jobs/ingest.processor.ts`
- Modify: root `package.json` and `apps/xjobs/package.json` (`worker:ingest` and `worker:ingest:dev`, like the channel scripts), `docker-compose.worker.yaml` (service `ingest-worker`, the same image with `WORKER_ROLE: ingest` and the Supabase and database env passed through), `modules/ingest/README.md` (rewritten for the new flow: tables, statuses, replay, sweeper, how to run the worker, the Postgres test guard)
- Test: `infrastructure/worker/tests/worker.module.spec.ts`, `infrastructure/worker/tests/scheduler.spec.ts`, `infrastructure/jobs/tests/ingest.processor.spec.ts`

**Interfaces:**

- Consumes `BatchIngestService` and `RawStorageRepository.listStalePending` (Task 3), and `IngestQueue` and the queue constants (Task 4).
- Produces `processIngestJob(job, deps: { ingest: BatchIngestService; repo: RawStorageRepository; queue: IngestQueue }): Promise<unknown>`. It handles:
  - `ingest-batch`: `ingestBatch(job.data.batchId, { final: job.attemptsMade + 1 >= job.opts.attempts })`.
  - `sweep`: re-enqueue `listStalePending(now - staleAfterMs, 100)`.
  - Any other name: `UnrecoverableError`.
- At startup, the ingest worker calls `storage.ensureBucket('collection-batches')` and upserts the `sweep` scheduler every `sweepEveryMs`. Channel workers also call `ensureBucket` at startup.

Steps:

- [ ] **Step 1: Write failing tests.**
  - Env:
    - `WORKER_ROLE=ingest` without Supabase vars fails with `Set SUPABASE_URL (or SUPABASE_PUBLIC_URL)` (Review Focus 5).
    - `WORKER_ROLE` together with `WORKER_CHANNEL` fails.
    - `WORKER_ROLE=other` fails.
    - The ingest role doesn't need `APIFY_TOKEN`.
  - Processor:
    - `ingest-batch` passes `final` correctly on the last attempt.
    - `sweep` enqueues only stale ids.
    - An unknown job name is unrecoverable.
  - Scheduler: the sweep is upserted with `every: 300000`.
  - Worker module: with `WORKER_ROLE=ingest` it builds a worker on queue `ingest` and calls `ensureBucket`.
- [ ] **Step 2:** Run `npx nx test xjobs`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement as specified, and update the scripts, compose and README.
- [ ] **Step 4:** Run `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): ingest worker with sweeper and deployment`.

---

### Task 6: Remove normalized ingest and drop old tables

**Files:**

- Delete: `modules/ingest/services/ingest.service.ts` (+spec), `repositories/ingest.repository.ts`, `repositories/ingest.postgres.spec.ts`, `utils/normalize.ts` (+spec), `types/ingest.types.ts` and `types/ingest.errors.ts` (the parts nothing references), and the unused functions in `utils/identity.ts` (`identityAliases`, `applicationUrl`, `canonicalSource` if only normalize used it)
- Modify: `contract.prisma` (remove `RawJob`, `RawJobIdentity`, `RawJobQueryHit` and `AtsPostingIdentity`, and their back-relations on `QuerySearchBuilder`), `ingest.module.ts`, `index.ts`, `ingest.module.spec.ts`
- Create: migration `db:migration:plan --name drop_normalized_raw_jobs`
- Modify: `docs/superpowers/specs/2026-10-30-ingest-design.md` and `2026-10-31-channel-collection-jobs-design.md`. Each gets one status line at the top pointing to the raw-storage design as superseding it, or as superseding its ingest hand-off.
- Create: `docs/roadmap/process-backlog.md` (or append to the roadmap's existing backlog file if there is one): one bullet each for LinkedIn job/post field mapping, ATS cross-linking, URL canonicalization rules and the removed normalizer behaviour, which Process and Match must re-cover. Link it to the git commit that removed them.

Steps:

- [ ] **Step 1:** Delete the files and models, then run `db:migration:plan --name drop_normalized_raw_jobs`. Expected: ops drop exactly the four old tables.
- [ ] **Step 2:** Run `grep -rn "RawJob\|CollectedJob\|normalizeItem\|IngestService\b" apps/xjobs/src`. Expected: no matches.
- [ ] **Step 3:** Run `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 4: Commit** `refactor(ingest): drop normalized raw_jobs storage`.
