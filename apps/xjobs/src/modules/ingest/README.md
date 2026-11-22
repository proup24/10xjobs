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

Each raw item's **latest** version is mapped (`normalize/`) to one unified record shaped like the LinkedIn job board: title, company, location, contract type, experience level, sector, salary, published date, posted time (`postedAt`), descriptions, apply and posting URLs, poster, `closed`. LinkedIn job board items come from the Apify actor `harvestapi/linkedin-job-search` (`docs/actors/harvestapi-linkedin-job-search.md`), which also gives `workplaceType`, `remoteAllowed`, `employmentType`, `countryCode`, `regionCode`, `applicantTrackingSystem`, `applicantCount`, `expiresAt` and `listingState`; each is stored as LinkedIn's value. Facts a source does not state stay null (an Ashby company is never guessed). A LinkedIn post is mapped to its cleaned text, its author (never the employer: a post may hold several jobs or none) and the original it shares or reposts, and gets a post job key (below).

- `normalized_versions`: one row per raw version and `NORMALIZER_VERSION`, `valid` with its record and job key, or `invalid` with a reason (the raw rows are kept either way).
- `normalized_jobs`: one row per job key, with one typed column per field, `fieldSources` (which raw item each value came from), seen times, and the processing status Process reads. A job whose last source moved to another job is `merged` into it, never deleted.
- `companies`: one row per LinkedIn company id, written from LinkedIn job items; `normalized_jobs.companyId` points at it.
- `normalized_job_sources`: which job each raw item belongs to (exactly one).

**Job key** (`normalize/job-key.ts`): an Ashby or Greenhouse posting is `ats:<provider>/<tenant>/<id>`, also when a LinkedIn job applies to it. Another external apply URL is `url:<canonical>` (no fragment, no `utm_*`/`trk*`/`gh_src`/`refId`/`ref`/`src`/`source`, other parameters kept and sorted) if it carries an identifier; copies of one ad posted under different titles are one job. Otherwise the item's own id: `linkedin-job:<id>`. A post is `linkedin-post:text:<fingerprint>` when the original's comparable text is at least 100 characters, its author key is known and the actor did not cut that text at "see more" (`truncated`), otherwise `linkedin-post:<original id, else the post's own id>`. The fingerprint is the first 32 hex characters of SHA-256 over `<original author key>\n<original comparable text>`, followed, when the original has links attached outside its text (`attachedUrls`: the article link and an attached LinkedIn job's `/jobs/view/<id>/` link, read from that post object's own payload, so a share's original keeps the attachments nested with it in `repost`), by `\n` and those links sorted, once each, joined by `\n`. The original here is the shared post when there is one, else the post itself: a share's own text, truncation and attachments never change its key. A record stored before `truncated` and `attachedUrls` existed reads them as false and `[]`. Author keys are `profile:<publicIdentifier, lowercased>` or `company:<universalName, lowercased>`. A raw item never falls back from an `ats:`/`url:` key to its own id: if a rescrape drops the apply URL, its most recent version with a posting key decides.

**Merging:** per field, the first non-null value from the employer's ATS posting, then the LinkedIn job, then a post; the most recently seen source wins within a rank. The job is `closed` when every ATS posting behind it is. `postedAt` is the exception: the earliest non-null value among open sources.

**Posted time (`postedAt`):** exact from the source when it states a time (Greenhouse `first_published`, Ashby `publishedDate` with a time, a LinkedIn post's `postedAt.date`); otherwise estimated from LinkedIn's relative text ("8 hours ago") against the first scrape of that raw version (`normalize/posted-at.ts`), clamped to the published day; null when unknown.

**Processing status:** ingest sets `processingStatus = 'pending'` only when an observation creates a job (`new`) or finds it after 21 days unseen (`reopened`, `config/normalize.ts`). A new source or a content change updates the columns and leaves the status alone. `processing`, `processed` and `failed` belong to Process. After a batch is marked `ingested`, `ingestBatch` reports the jobs it left `pending` to its `onPending` hook; the ingest worker uses it to enqueue them on the processor's `process` queue (LinkedIn job board batches only). That is a nudge: a failure is logged, the batch stays `ingested`, and Process's sweeper finds the jobs anyway.

**Re-key:** when an item's key changes (for example an outside apply URL with a posting id arrives) and no job has the new key yet, its old job is renamed in place, provided every source of that job now has the new key: it keeps its id, extraction, processing state, matches and every user's decisions and viewed marks, and isn't sent to Process. Otherwise the item moves: into the job that has the key, or into a new job when another source of the old job keys elsewhere. A job left with no sources is `merged` into the job its last source moved to, and its decisions and viewed marks move with it.

**Post jobs:** a LinkedIn post is mapped (`normalize/mappers/linkedin-post.mapper.ts`, `normalize/posts/`) and linked to a `kind = 'post'` job like any item, and `normalized_jobs.postSources` holds every post source's details (`{ sources: PostDetail[] }`, null on other jobs). Ingest never sends a post job to Process: its processing status stays null. A drop is an invalid normalized version with the reason `prepare: no-text` (no text of its own or from the original) or `prepare: <rule>: "<match>"`. Two rules ship (`normalize/posts/rules.ts`), each judged on the original post and gated by the labelled sample in `normalize/posts/sample/` (a rule may drop no post labelled hiring or unsure): `open-to-work` (the open-to-work card, "open to work" in the first 200 characters of a text that does not also say "hiring", or in the author headline) and `bench-sales-hotlist` (a line that is only "Available consultants:" or "Available IT consultants:"). A post whose latest version becomes a drop leaves its job: the job re-merges from its other sources, or, with none left, keeps `status = 'active'` and its other fields, with `processingStatus = 'archived'` and `postSources = null`, so `archived` is authoritative for readers. The renormalize `jobs` count (active jobs) includes such archived post jobs. Un-dropped, the post links again under its key, and the job's status is null again. A job-board item that turns invalid keeps its link.

**Normalizer version:** `NORMALIZER_VERSION` is 10: Prepare's drop rules ship (`open-to-work`, `bench-sales-hotlist`), so posts they match become drops; run `db:renormalize` once after it deploys. Version 9 reads a share's nested original, so a share or repost keys exactly like its original scraped alone and joins its job, and a post's attached LinkedIn job counts as an attached link (version 8 mapped posts and keyed them by their original's text; version 6 keyed a LinkedIn job by its apply URL alone, the title left the `url:` key). Each of these needs `db:renormalize` once, so copies of one apply link or one post become one job; jobs that are only re-keyed keep their id.

**Rebuild:** after a `NORMALIZER_VERSION` bump, `pnpm --filter @xjobs/xjobs db:renormalize` re-normalizes every raw item and rebuilds links and merges. It changes processing status only to archive a post job whose last post became a drop; jobs it creates have none until Process decides. It needs only the database variables and is safe to run while ingest runs.

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

The PostgreSQL tests need `INGEST_TEST_DATABASE_URL`, pointing at a disposable database named `ingest_test` on `127.0.0.1` that holds a migrated Supabase Postgres: the migrations need the `auth` schema (`auth.users`, `auth.uid()`) and the `authenticated` role, so a plain `postgres` image does not work. They **truncate** their tables, skip when the variable is absent, and refuse any other host or database name. Tests never call paid collectors.
