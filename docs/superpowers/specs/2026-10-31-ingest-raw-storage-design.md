# Ingest as raw storage

Date: 2026-10-31. Supersedes `2026-10-30-ingest-design.md` (normalized `raw_jobs`, identity aliases, query hits, ATS association) and changes how `2026-10-31-channel-collection-jobs-design.md` hands results to ingest.

## Intent

The pipeline has four stages:

| Stage   | Responsibility                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Collect | Retrieve raw data from external sources (Apify actors, ATS APIs).                                     |
| Ingest  | Validate incoming payloads, deduplicate records, persist raw data, and leave it ready for processing. |
| Process | Normalize, clean, transform, enrich and extract structured information (LLM, `llm_outputs`).          |
| Match   | Compare processed entities with existing records, score similarity or relevance, decide matches.      |

**This design covers only Ingest and its relation with Collect.** Process and Match are later, separate designs.

Ingest prioritizes reliable data acceptance and traceability. Processing does the expensive work. Ingest therefore stores what the sources returned, untouched, and does not interpret it (no company, title, hiring manager, requirements, seniority, eligibility; no fuzzy or cross-channel deduplication). Every stored item can be traced to the batch, segment run, query builder, channel and Apify run that produced it.

Why the change: the current ingest normalizes into typed columns at write time, overwrites earlier snapshots, and resolves identity early. That is lossy (a LinkedIn post author is often not the employer), cannot be re-run when extraction improves, and does Process's and Match's work in the wrong place.

## Goals

- Collect persists every fetched result as a raw batch before anything interprets it, and the batch has a status: `pending`, `ingested` or `failed`.
- Ingest consumes pending batches, validates them, removes exact repeats, and persists raw items.
- Nothing paid for is lost: a failed or buggy ingest can be replayed from the stored batch without calling Apify again.
- Full traceability from any raw item back to its batches, segment runs, query builders and Apify runs.
- Process can find every new or changed raw item without re-reading batches.

## Non-goals

- Process (normalization, LLM extraction, `llm_outputs`) and Match (cross-channel duplicates, reposts, relevance).
- Company/title deduplication, fuzzy matching, ATS cross-linking. These move to Process/Match.
- A public read API or UI for batches or raw items.
- Retention or deletion of old batches (a later decision).

## Anti-goals

- Losing a fetched result because ingest failed, was down, or rejected it.
- Ingest calling an LLM or any paid or network service other than the database and object storage.
- Silently dropping an item: every rejected item is counted with its reason in the batch report.
- Advancing a segment's cursor past results that were never persisted.

## Flow

```
channel worker (Collect)                     ingest worker (Ingest)
------------------------                     ----------------------
collector.collect(segment)
  -> raw file to storage
  -> one transaction: segment run, collection_batches row (pending), cursors
  -> enqueue { batchId } on `ingest` -----> load batch, validate, dedupe
                                            write raw_items / versions / sightings
                                            batch -> ingested | failed
```

### Collect side (changes to the jobs and collectors modules)

1. **Collectors return raw items, not `CollectedJob`.** `SegmentResult.jobsByQuery` becomes `itemsByQuery: Map<queryId, RawCollectedItem[]>` plus `unattributed: RawCollectedItem[]` (items the actor returned that no member query claims), where
   `RawCollectedItem = { rank: number | null; payload: unknown }`.
   The payload is exactly what the source returned: the Apify dataset item for LinkedIn job board and LinkedIn posts; `{ hit, posting }` (Google result plus the posting JSON fetched from the ATS API) for Ashby and Greenhouse, as today's `raw` already is. A Google hit whose posting fetch failed is **kept** as `{ hit, posting: null, fetchError }` instead of being dropped as today, so a paid-for result is never lost and the next run (or Process) can fetch it again. `fetched`, `costUsd`, `capped` and `truncatedQueryIds` stay. Attribution (which query found the item, its rank) stays in the collector, which is the only place that knows it.
2. **The collection job persists the batch** for each segment run, in this order:
   1. write the batch file to object storage through `StorageService` (bucket `collection-batches`, key `<channel>/<yyyy-mm-dd>/<segmentRunId>.json`);
   2. in **one database transaction**: insert the segment run, insert the `collection_batches` row (status `pending`, FK to that run) and advance cursors. Either all commit or none do;
   3. enqueue `{ batchId }` on the `ingest` queue (a failed enqueue is logged; the sweeper picks the batch up).

   A collector failure still records a `failed` segment run with no batch, as today.
3. **Cursors move when the batch is persisted**, not when it is ingested, because ingest can always be replayed from the stored file. A capped run still does not move cursors (unchanged). If storing the file or the transaction fails, the segment run is recorded `failed` (best effort, outside the transaction), cursors do not move, an orphan file may remain (harmless; nothing points at it) and the segment is searched again next tick.
4. **Segment runs keep collection facts only.** `search_segment_runs.perQuery` holds per-query `returned` counts; insert/update/duplicate/invalid move to the batch report. Status `succeeded | failed` reflects collection and persistence; `partial` is no longer produced by the collection job. The run's id is generated before the file is written so both the file key and the batch can reference it. The segments repository gains a transactional method for step 2.
5. The collection job no longer depends on `IngestService`. The summary line drops insert/update/duplicate/invalid and adds `batches`.

### Batch file format

One JSON document per segment run:

```json
{
  "formatVersion": 1,
  "batchId": "...",
  "channel": "LINKEDIN_JOB_BOARD",
  "segmentRunId": "...",
  "observedAt": "ISO 8601 UTC",
  "source": { "actor": "bebity/linkedin-jobs-scraper", "apifyRunId": "... or null" },
  "queries": [{ "id": "...", "keyword": "...", "params": {} }],
  "itemsByQuery": { "<queryId>": [{ "rank": 1, "payload": {} }] },
  "unattributed": [{ "rank": null, "payload": {} }]
}
```

The file is immutable once written (`StorageService.put` refuses overwrites). `observedAt` is the segment's `until`, the same for every member.

### `collection_batches` table

- `id` (uuid v7), `channel`, `segmentRunId` (FK `search_segment_runs`), `storageKey`, `formatVersion`.
- `observedAt`, `itemCount`, `apifyRunId` (nullable), `createdAt`.
- `status`: `pending | ingested | failed`. `attempts`, `lastError` (nullable), `ingestedAt` (nullable).
- `report` (jsonb, nullable until ingested): `{ received, newItems, newVersions, repeats, invalid, errors: [{ queryId, index, reason }] }`, where `errors` is capped (builder picks the cap) and `invalid` is always the full count.
- Index on `(status, createdAt)` for the sweeper.

The row is the source of truth for status. The queue message is only a nudge.

### Ingest side (the ingest module, rewritten)

**Worker.** A dedicated ingest worker process, selected like the channel workers (`WORKER_CHANNEL=INGEST`, or a separate `WORKER_ROLE`; builder's choice), consuming the `ingest` queue with its own config in `infrastructure/jobs/steps/ingest/config.ts` (concurrency, attempts, backoff). It validates the database, Redis and storage environment variables; it does not need `APIFY_TOKEN`.

**Per batch:**

1. Load the row. If it is not `pending` (already ingested, or failed past its attempts), acknowledge and stop.
2. Read the file. A missing or unparseable file, or a `formatVersion` it does not know, marks the batch `failed` with the reason; no items are written.
3. For each item (attributed and unattributed), validate:
   - the payload is a JSON object;
   - it yields a **source key**, from fields that are present whether or not anything was fetched successfully, so one posting always gets one key:
     - LinkedIn job board and posts: the item's own job/post id field; else its canonical URL (lowercase host, no fragment, known tracking parameters removed);
     - Ashby and Greenhouse: `<tenant>/<postingId>` parsed from the hit URL (`jobs.ashbyhq.com/<org>/<id>`, `boards.greenhouse.io/<board>/jobs/<id>` and the EU host), never from the fetched posting, so a failed fetch and a good fetch share the key. A hit that is not a posting page (a board root, for example) is invalid with reason `not a posting URL`.

     Field paths and URL patterns are per channel and listed in one place in the module. An item with no key is invalid.
     Invalid items are counted with their reason; they never stop siblings.
4. Deduplicate exactly, never fuzzily:
   - **raw item** = one row per `(channel, sourceKey)`;
   - **raw item version** = one row per distinct `contentHash` of a raw item, where the hash is SHA-256 of the canonical JSON of the payload with the channel's volatile fields removed (for example the LinkedIn actor's `scrapingInfo`; the per-channel list sits next to the source key paths). A repeat with the same hash creates no version;
   - **sighting** = one row per `(batchId, rawItemId, queryId)`: which query saw it in which batch, with its rank and the version it matched. Unattributed items have a null `queryId`.
5. Write each item's item, version and sighting in one transaction, idempotent under retry and concurrency (unique constraints plus `ON CONFLICT DO NOTHING` or equivalent), so replaying a batch never duplicates rows.
6. Set the batch `ingested` with its report and `ingestedAt`. An infrastructure error (database or storage unavailable) leaves it `pending`, increments `attempts`, records `lastError` and lets BullMQ retry; after the last attempt it becomes `failed`.

**Sweeper.** The ingest worker schedules a repeating job (every few minutes) that re-enqueues `pending` batches older than a threshold, so a lost enqueue or a crash between steps never strands a batch. BullMQ job id = batch id, so a batch is never queued twice at once.

**Replay.** `IngestService.replay(batchId)` sets a `failed` batch back to `pending` with attempts reset and enqueues it. It is called from code or a script; no HTTP endpoint.

### Raw storage tables

- `raw_items`: `id`, `channel`, `sourceKey`, `kind` (`job` | `post`, from the channel), `firstSeenAt`, `lastSeenAt`, `latestVersionId`. Unique `(channel, sourceKey)`.
- `raw_item_versions`: `id`, `rawItemId`, `contentHash`, `payload` (jsonb, untouched), `firstBatchId`, `firstSeenAt`, `lastSeenAt`, `createdAt`. Unique `(rawItemId, contentHash)`.
- `raw_item_sightings`: `id`, `batchId`, `rawItemId`, `versionId`, `queryId` (nullable for unattributed items, FK to builders with `RESTRICT`: builders are only soft-deleted, so a sighting never loses its query), `rank` (nullable), `observedAt`. Unique `(batchId, rawItemId, queryId)` with nulls treated as equal.

On items and versions, `firstSeenAt`/`lastSeenAt` take the min/max of `observedAt`, so out-of-order replays are safe. `latestVersionId` is the version with the greatest `lastSeenAt` (ties: the most recently created), so content that changes back (A → B → A) points at A again. A version is created only for a new hash, so `createdAt` order is the order Process sees new content in.

These tables are shared, not workspace-scoped, as the current `raw_jobs` already is: collection is attributed to shared query builders, not to workspaces. Workspace scoping starts at Match.

### Hand-off to Process

Each new `raw_item_versions` row is the unit Process will consume. This design does not build Process or its queue; it guarantees that versions are append-only and carry `createdAt`, so Process can either be notified (an event published by ingest after commit, added when Process is designed) or pick up versions it has not processed. Process will keep its own per-version state (status, attempts, prompt/model version) and its `llm_outputs` referencing `raw_item_versions.id`.

## What happens to the current ingest code

- Removed from ingest: `raw_jobs`, `raw_job_identities`, `raw_job_query_hits`, `ats_posting_identities`, the normalizers, identity aliasing and ATS parsing, and the `CollectedJob` contract as ingest input. The migration drops those four tables (they hold only development data) and adds the new ones.
- The normalizer, URL canonicalization and ATS parsing code are useful to Process and Match. They are not deleted blindly: canonicalization needed for source keys stays in ingest; the rest is kept out of the ingest module (moved to where the builder judges sensible, or removed with a note in the Process design backlog).
- Collectors' field mapping into `CollectedJob` (title, company, location, description…) is no longer used by collection. It is removed from the collectors; Process will own extraction.

### Deployment

The ingest worker ships in this change: its package script and Nx target, its service in `docker-compose.worker.yaml`, and `ensureBucket('collection-batches')` at startup of both the ingest worker and the channel workers. Otherwise batches would pile up as `pending`.

## Testing

No test calls Apify, an LLM or a real storage bucket (use the in-memory `StorageService`).

- **Collect:** each collector returns untouched payloads with rank and attribution; unattributed items and failed ATS fetches are kept. The collection job writes the file, then segment run + batch + cursors in one transaction, then enqueues; a storage or transaction failure fails the segment and keeps cursors; a capped run keeps cursors.
- **Ingest unit:** source key extraction and canonicalization per channel with local fixtures; content hash ignores volatile fields and key order; invalid items are isolated and reported; unknown `formatVersion` and missing file fail the batch.
- **Ingest with PostgreSQL** (isolated database, as the current ingest Postgres tests do): first sighting creates item, version and sighting; the same payload again adds only a sighting; changed content adds a version; A → B → A points `latestVersionId` back at A; an Ashby/Greenhouse item with a failed fetch and the same posting fetched later share one raw item; replaying a batch writes nothing new; two concurrent ingests of overlapping batches produce no duplicates; out-of-order observation times keep first/last seen correct; an infrastructure error leaves the batch `pending` and retries.
- **Status:** `pending → ingested`, `pending → failed` after attempts, `replay` resets a failed batch; the sweeper re-enqueues stale pending batches and skips fresh ones.

## Left to the builder

File names and folder layout inside `modules/ingest` and `infrastructure/jobs`; how the ingest worker is selected at startup; queue retry/backoff values, sweeper interval and stale threshold; the report's error cap; the exact per-channel source-key paths and volatile-field lists (from real fixtures); where non-ingest normalizer code goes.
