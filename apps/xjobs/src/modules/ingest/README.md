# Ingest

Ingest is the second stage of the pipeline (Collect → **Ingest** → Process → Match). It accepts what collection fetched, reliably and traceably, and stores it untouched. On top of that raw storage it builds **normalized jobs**: a deterministic mapping of every item to one LinkedIn-shaped format, unified by apply URL. It interprets exact facts only: no LLM, no network, no guessing. Judgment (LLM extraction, fuzzy and cross-channel matching, qualification) belongs to Process and Match.

Designs: `docs/superpowers/specs/2026-10-31-ingest-raw-storage-design.md` (raw storage) and `docs/superpowers/specs/2026-11-01-ingest-normalized-jobs-design.md` (normalized jobs).

## Flow

1. A channel's collection job runs one Apify run per search segment. It writes the untouched results to Supabase Storage as one batch file (`collection-batches/<channel>/<yyyy-mm-dd>/<segmentRunId>.json`, format version 1).
2. In one transaction it records the segment run, a `collection_batches` row with status `pending`, and the moved cursors. Then it enqueues `{ batchId }` on the `ingest` queue.
3. The ingest worker (`WORKER_ROLE=ingest`) runs `BatchIngestService.ingestBatch`:
   - it reads the file;
   - it validates each item (an object with a source key) and keeps going past invalid ones;
   - it stores each valid item, then links it to its normalized job in a second transaction under the raw item's lock (a normalization failure marks the item `normalizeInvalid`; it never undoes or blocks the raw write);
   - it sets the batch to `ingested` with a report, or `failed` with the reason.

`BatchIngestService` coordinates status and retry decisions. `BatchFileReaderService` loads and validates stored files; `BatchItemWriterService` validates item identities, persists observations sequentially, and builds the report. These collaborators stay internal to `IngestModule`.

The batch row is the source of truth for status. The queue message is only a nudge: a sweeper re-enqueues `pending` batches older than 10 minutes every 5 minutes.

## Statuses

| Status     | Meaning                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending`  | Stored, not ingested yet. Infrastructure errors (database or storage down) leave a batch here: `attempts` and `lastError` are updated and the queue retries it.                                                                                                                                                                       |
| `ingested` | Done. `report` = `{ received, newItems, newVersions, repeats, invalid, normalized, normalizeInvalid, newJobs, reopened, errors }`. `errors` lists up to 100 items across both stages (`stage: 'validate' \| 'normalize'`); `invalid` and `normalizeInvalid` are full counts. A batch whose items are all invalid is still `ingested`. |
| `failed`   | The file is missing or unreadable (unknown format version, bad JSON, wrong channel), or the last attempt failed. `BatchIngestService.replay(batchId)` sets it back to `pending`; enqueue it with `IngestQueue.enqueue(batchId)`. No Apify call is needed.                                                                             |

## Tables

- `collection_batches`: one row per stored segment-run result, with its status, attempts, last error and report.
- `raw_items`: one row per `(channel, sourceKey)`, with first and last seen times and `latestVersionId`, which points at the version with the greatest `lastSeenAt`.
- `raw_item_versions`: one row per distinct content hash of an item, holding the untouched payload. Append-only, so Process consumes these.
- `raw_item_sightings`: which query saw which item in which batch, with its rank and the version it matched. `attribution` is the query id, or `none` for items no member query claimed. It is unique per `(batchId, rawItemId, attribution)`.

These tables are shared, not workspace-scoped: collection is attributed to shared query builders.

## Normalized jobs

Each raw item's **latest** version is mapped (`normalize/`) to one unified record shaped like the LinkedIn job board: title, company, location, contract type, experience level, sector, salary, published date, descriptions, apply and posting URLs, poster, `closed`. Facts a source does not state stay null (an Ashby company is never guessed). A LinkedIn post keeps only its body and author, never as the employer: a post may hold several jobs or none, so Process splits it.

- `normalized_versions`: one row per raw version and `NORMALIZER_VERSION`, `valid` with its record and job key, or `invalid` with a reason (the raw rows are kept either way).
- `normalized_jobs`: one row per job key, with one typed column per field, `fieldSources` (which raw item each value came from), seen times, and the processing status Process reads. A job whose last source moved to another job is `merged` into it, never deleted.
- `normalized_job_sources`: which job each raw item belongs to (exactly one).

**Job key** (`normalize/job-key.ts`): an Ashby or Greenhouse posting is `ats:<provider>/<tenant>/<id>`, also when a LinkedIn job applies to it. Another external apply URL is `url:<canonical>|<exact title>` (no fragment, no `utm_*`/`trk*`/`gh_src`/`refId`/`ref`/`src`/`source`, other parameters kept and sorted) if it carries an identifier; the title keeps different roles on one listing page apart. Otherwise the item's own id: `linkedin-job:<id>`. A post is always `linkedin-post:<id>`. A raw item never falls back from an `ats:`/`url:` key to its own id: if a rescrape drops the apply URL, its most recent version with a posting key decides.

**Merging:** per field, the first non-null value from the employer's ATS posting, then the LinkedIn job, then a post; the most recently seen source wins within a rank. The job is `closed` when every ATS posting behind it is.

**Processing status:** ingest sets `processingStatus = 'pending'` only when an observation creates a job (`new`) or finds it after 21 days unseen (`reopened`, `config/normalize.ts`). A new source or a content change updates the columns and leaves the status alone. `processing`, `processed` and `failed` belong to Process. After a batch is marked `ingested`, `ingestBatch` reports the jobs it left `pending` to its `onPending` hook; the ingest worker uses it to enqueue them on the processor's `process` queue (LinkedIn job board batches only). That is a nudge: a failure is logged, the batch stays `ingested`, and Process's sweeper finds the jobs anyway.

**Rebuild:** after a `NORMALIZER_VERSION` bump, `pnpm --filter @xjobs/xjobs db:renormalize` re-normalizes every raw item and rebuilds links and merges. It never changes processing status; jobs it creates have none until Process decides. It needs only the database variables and is safe to run while ingest runs.

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

PostgreSQL tests additionally require `INGEST_TEST_DATABASE_URL` pointing to a disposable database named `ingest_test` at `127.0.0.1` holding a migrated Supabase Postgres (the `auth` schema and every app migration, since users come from the sign-up trigger on `auth.users`). These tests **truncate test tables and users**. They skip when the variable is absent, and reject other host/database names. Tests never call paid collectors.
