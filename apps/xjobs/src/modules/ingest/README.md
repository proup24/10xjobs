# Ingest

Ingest is the second stage of the pipeline (Collect → **Ingest** → Process → Match). It accepts what collection fetched, reliably and traceably, and stores it untouched. It interprets nothing beyond two exact facts per item: a **source key** (its identity within its channel) and a **content hash** (whether its content changed). Company, title, hiring manager, requirements and cross-channel duplicates belong to Process and Match.

Design: `docs/superpowers/specs/2026-10-31-ingest-raw-storage-design.md`.

## Flow

1. A channel's collection job runs one Apify run per search segment. It writes the untouched results to Supabase Storage as one batch file (`collection-batches/<channel>/<yyyy-mm-dd>/<segmentRunId>.json`, format version 1).
2. In one transaction it records the segment run, a `collection_batches` row with status `pending`, and the moved cursors. Then it enqueues `{ batchId }` on the `ingest` queue.
3. The ingest worker (`WORKER_ROLE=ingest`) runs `BatchIngestService.ingestBatch`:
   - it reads the file;
   - it validates each item (an object with a source key) and keeps going past invalid ones;
   - it stores each valid item;
   - it sets the batch to `ingested` with a report, or `failed` with the reason.

`BatchIngestService` coordinates status and retry decisions. `BatchFileReaderService` loads and validates stored files; `BatchItemWriterService` validates item identities, persists observations sequentially, and builds the report. These collaborators stay internal to `IngestModule`.

The batch row is the source of truth for status. The queue message is only a nudge: a sweeper re-enqueues `pending` batches older than 10 minutes every 5 minutes.

## Statuses

| Status     | Meaning                                                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`  | Stored, not ingested yet. Infrastructure errors (database or storage down) leave a batch here: `attempts` and `lastError` are updated and the queue retries it.                                                                                           |
| `ingested` | Done. `report` = `{ received, newItems, newVersions, repeats, invalid, errors }`. `errors` lists up to 100 items, and `invalid` is the full count. A batch whose items are all invalid is still `ingested`.                                               |
| `failed`   | The file is missing or unreadable (unknown format version, bad JSON, wrong channel), or the last attempt failed. `BatchIngestService.replay(batchId)` sets it back to `pending`; enqueue it with `IngestQueue.enqueue(batchId)`. No Apify call is needed. |

## Tables

- `collection_batches`: one row per stored segment-run result, with its status, attempts, last error and report.
- `raw_items`: one row per `(channel, sourceKey)`, with first and last seen times and `latestVersionId`, which points at the version with the greatest `lastSeenAt`.
- `raw_item_versions`: one row per distinct content hash of an item, holding the untouched payload. Append-only, so Process consumes these.
- `raw_item_sightings`: which query saw which item in which batch, with its rank and the version it matched. `attribution` is the query id, or `none` for items no member query claimed. It is unique per `(batchId, rawItemId, attribution)`.

These tables are shared, not workspace-scoped: collection is attributed to shared query builders.

## Source keys and hashes

- **LinkedIn job board and posts:** `id:<id>`. The id is taken from the item, else from a post urn, else from the posting URL. If none is found, the key is `url:<canonical URL>` (lowercase host, no fragment, no tracking parameters).
- **Ashby and Greenhouse:** `posting:<organization or board>/<posting id>`, parsed from the Google hit URL. A failed posting fetch and a successful one therefore share one item. A hit that is not a posting page is invalid.
- **Content hash:** SHA-256 of canonical JSON (keys sorted), with each channel's volatile top-level keys left out (`config/channels.ts`).

Each item's item, version and sighting rows are written in one transaction, which retries on uniqueness races. Replaying a batch writes nothing new.

## Running

```sh
pnpm worker:ingest:dev   # needs DATABASE_URL, REDIS_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

Channel workers need the same Supabase variables, because they write the batch files.

## Verification

```sh
npx vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest src/modules/segments
```

The PostgreSQL tests need `INGEST_TEST_DATABASE_URL`, pointing at a disposable database named `ingest_test` on `127.0.0.1` and migrated to the current contract. They **truncate** their tables, skip when the variable is absent, and refuse any other host or database name. One way to get such a database:

```sh
docker run --rm -d --name xjobs-ingest-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=ingest_test -p 127.0.0.1:55432:5432 postgres:17
cd apps/xjobs && XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/ingest_test npx prisma db migrate --yes
```
