# Ingest: deterministic normalization and job unification

Date: 2026-11-01. Extends `2026-10-31-ingest-raw-storage-design.md`. Raw storage is unchanged; this adds a deterministic layer on top of it, inside the ingest module.

## Intent

Raw storage keeps every source payload untouched, but Process would face four payload shapes and many copies of the same job. Ingest therefore adds a **fully deterministic** step: each raw version is mapped to one unified job format, and raw items that are the same posting are unified into one **normalized job**, keyed by its apply URL. Process starts from clean, unified normalized jobs and does its own (LLM, fuzzy) normalization and cross-channel dedup on top.

"Deterministic" means: no LLM, no network call, no guessing. The same raw version and the same normalizer version always produce the same output, so the whole layer can be rebuilt from `raw_item_versions` whenever the mapping improves.

This revises one line of the raw-storage design ("Ingest … does not interpret it"): ingest now interprets **exact facts only**. Everything that needs judgment stays in Process and Match.

## Goals

- Every raw version gets a normalized record in one unified, LinkedIn-job-board-shaped format, validated by a schema. A record that fails is stored as invalid with its reason, never dropped silently.
- Raw items that are the same posting are unified into one normalized job, using the canonical apply URL as the job's real id.
- One normalized job holds the merged facts of all its sources, with the employer's ATS posting winning, and records which source each field came from.
- Process is triggered when a normalized job is **new**, or **reopened**: seen again after 3 weeks or more without being seen.
- The layer can be rebuilt from raw versions after a normalizer change, without calling anything external.

## Non-goals

- LLM extraction, splitting digest posts into several jobs, seniority/eligibility/salary inference from prose: Process.
- Fuzzy or title/company dedup, ATS cross-linking from anything other than an exact apply URL: Process and Match.
- Building Process itself or its queue consumer.
- Workspace scoping (see Constraints).
- A read API or UI.

## Anti-goals

- **Merging two different jobs** (it leads to applying to the wrong job). When in doubt, do not unify: a missed merge costs a duplicate that Process can still catch; a wrong merge hides a job.
- Guessing a fact: a field the source does not state stays null (an Ashby company is never derived from the board slug or the Google title).
- Treating a LinkedIn post author as the employer.
- Triggering Process on noise (a content tweak, a new LinkedIn copy of a job we already have).

## What the data shows (2026-11-01, local DB)

317 raw items, 320 versions across 28 ingested batches. Facts that drive this design:

- **LinkedIn job board** is the most complete: `title`, `companyName`, `companyUrl`, `location` (free text), `contractType`, `experienceLevel`, `sector`, `salary` (text) plus `salaryMin/Max/Currency/Period` (14 of 204), `publishedAt` (date only), `description` and `descriptionHtml`, `applyUrl`, `applyType` (`EXTERNAL` | `EASY_APPLY`), `jobUrl`, `posterFullName`/`posterProfileUrl` (19 of 204). `jobFunction`, `workType` are always empty.
- **Ashby** `posting`: `title`, `locationName` (free text), `employmentType` (`FullTime`…), `publishedDate`, `descriptionHtml`. No company name.
- **Greenhouse** `posting`: `title`, `company_name`, `location.name`, `first_published`, `updated_at`, `absolute_url`, `content` (entity-encoded HTML), `departments`, `offices`.
- **Closed postings**: an Ashby/Greenhouse version can have `posting: null` with `fetchError: "… posting is closed or unavailable"`.
- **LinkedIn posts are not 1:1 jobs**: some are `#OpenToWork` candidates (8 of 33), some are digests of several jobs at different companies, many are agencies.
- **Same-posting copies exist**: Sii Poland published one ad (`sii.pl/en/job-ads/id/38247`) under 10 LinkedIn ids, one per city; Block Labs, Kraken, Voodoo reposts all apply to one Ashby posting each. 61 of 204 LinkedIn jobs apply on Ashby or Greenhouse.
- **Shared non-identifying URLs exist**: two different jobs share `app.greenhouse.io/embed/job_app` (the job id is in `?for=&token=`), two share `ibmglobal.avature.net/en_us/careers/jobdetail` (id in `?jobId=`).
- **A raw item's apply URL can change between versions**: LinkedIn `id:4483941772` had no `applyUrl`, then `sii.pl/…/38247`.
- 67 of 204 LinkedIn jobs have no external apply URL (Easy Apply, a linkedin.com URL, or empty).

## Design

### Flow

```
ingest worker, per batch item (existing)          new, same item transaction
--------------------------------------          --------------------------
validate, source key, content hash
write raw_item / version / sighting   ------->  normalize the item's latest version
                                                derive its job key
                                                link raw item -> normalized job (move if key changed)
                                                re-merge the normalized job
                                                set processingStatus = pending if new / reopened
```

Normalization runs in the same transaction as the item's raw writes (so a normalized job never lags its raw data) and is idempotent under replay, like the raw writes. _Builder may instead run it as a second pass per batch if the transaction gets too heavy; the idempotency and processing-status rules below must hold either way._

### 1. Normalized record (unified format)

A pure function `normalize(channel, payload) → NormalizedRecord | { invalid: reason }`, one mapper per channel, validated with a zod schema (zod is already a dependency). The format is LinkedIn-job-board-shaped:

| Field             | Type                                           | LinkedIn job board                                     | Ashby                                                                                                                                                           | Greenhouse                                 | LinkedIn post                                                                   |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `kind`            | `job` \| `post`                                | `job`                                                  | `job`                                                                                                                                                           | `job`                                      | `post`                                                                          |
| `title`           | string \| null                                 | `title`                                                | `posting.title`                                                                                                                                                 | `posting.title`                            | null                                                                            |
| `companyName`     | string \| null                                 | `companyName`                                          | null                                                                                                                                                            | `posting.company_name`                     | null                                                                            |
| `companyUrl`      | string \| null                                 | `companyUrl` (tracking stripped)                       | null                                                                                                                                                            | null                                       | null                                                                            |
| `location`        | string \| null                                 | `location`                                             | `posting.locationName`                                                                                                                                          | `posting.location.name`                    | null                                                                            |
| `contractType`    | string \| null                                 | `contractType`                                         | `employmentType` mapped (`FullTime`→`Full-time`, `PartTime`→`Part-time`, `Contract`→`Contract`, `Intern`→`Internship`, `Temporary`→`Temporary`; unknown → null) | null                                       | null                                                                            |
| `experienceLevel` | string \| null                                 | `experienceLevel`                                      | null                                                                                                                                                            | null                                       | null                                                                            |
| `sector`          | string \| null                                 | `sector`                                               | null                                                                                                                                                            | null                                       | null                                                                            |
| `salary`          | `{ text, min, max, currency, period }` \| null | from `salary*` when present                            | null                                                                                                                                                            | null                                       | null                                                                            |
| `publishedAt`     | `YYYY-MM-DD` \| null                           | `publishedAt`                                          | `posting.publishedDate` (date part)                                                                                                                             | `posting.first_published` (date part, UTC) | `postedAt.date` (date part)                                                     |
| `descriptionHtml` | string \| null                                 | `descriptionHtml`                                      | `posting.descriptionHtml`                                                                                                                                       | `posting.content` entity-decoded once      | null                                                                            |
| `descriptionText` | string \| null                                 | `description`                                          | HTML → text                                                                                                                                                     | HTML → text                                | `content`                                                                       |
| `applyUrl`        | string \| null                                 | `applyUrl` when `EXTERNAL` and not a LinkedIn host     | posting URL                                                                                                                                                     | `posting.absolute_url`                     | null                                                                            |
| `postingUrl`      | string                                         | `jobUrl` canonical (`www.linkedin.com/jobs/view/<id>`) | posting URL                                                                                                                                                     | `absolute_url`, else hit URL               | `linkedinUrl`                                                                   |
| `poster`          | `{ name, profileUrl }` \| null                 | `posterFullName`/`posterProfileUrl` when non-empty     | null                                                                                                                                                            | null                                       | `author.name`, `author.linkedinUrl`, plus `author.type` (`person` \| `company`) |
| `closed`          | boolean                                        | false                                                  | true when `posting` is null and `fetchError` says closed/unavailable                                                                                            | same                                       | false                                                                           |

Rules:

- Empty strings, whitespace and the sentinels `undefined`/`null` become null. Strings are trimmed; nothing else is rewritten (location stays free text).
- HTML → text uses one deterministic converter for all channels (builder's choice of library or the one Process will use; it must be pure).
- A `closed` record carries no content fields (all null except `kind`, `postingUrl`, `closed`).
- Schema validation requires `kind`, `postingUrl`, and, unless `closed`, at least one of `title` or `descriptionText`. Anything else failing the schema (wrong type, malformed URL, bad date) makes the record invalid with the zod path and message as reason.
- A post's author is only ever `poster`, never `companyName`.

Fix in the same change: add `document.manifest` to the LinkedIn posts volatile keys (`config/channels.ts`); the actor returns it as binary garbage on rescrape, which creates fake versions.

### 2. Job key (the job's real id)

`jobKey(channel, record, rawItem)`, deterministic, in this order:

1. **ATS posting** — the apply URL (or, for Ashby/Greenhouse items, the posting URL) is recognized by the existing `atsIdentity` (Ashby `jobs.ashbyhq.com/<org>/<uuid>[/application]`, Greenhouse boards, `/embed/job_app?for=&token=`, EU hosts): `ats:<provider>/<tenant>/<postingId>`. This is what unifies a LinkedIn job with the Ashby/Greenhouse posting we collected.
2. **Other external apply URL** — canonicalized: lowercase host, `www.` kept as is, fragment removed, trailing slash removed, known tracking parameters removed (`utm_*`, `trk*`, `gh_src`, `refId`, `ref`, `src`, `source`), remaining parameters sorted. **All other query parameters are kept**, because they often carry the job id. Used only if the URL identifies a posting: its path or remaining query contains an identifier-like token (a run of 4+ digits, or a UUID). Key: `url:<canonical>` (revised 2026-11-17, normalizer version 6: the title is dropped; copies of one ad under different titles are one job. No board on dev used one listing URL for several roles. See `2026-11-17-one-job-per-apply-link-design.md`.)
3. **Fallback** — the raw item's own identity: `linkedin-job:<id>`, `ats:…` for an Ashby/Greenhouse item, `linkedin-post:<id>`.

**LinkedIn posts always use their own key** (`linkedin-post:<id>`), even with an article link: a post can hold several jobs or none, so it must never absorb or be absorbed by another job.

Short links that need a network call to resolve (`grnh.se`, `lnkd.in`) are not resolved; they go through rule 2 as they are.

The tracking-parameter list and the identifier rule live in one config next to `volatileKeys`.

### 3. Normalized jobs and their sources

- A raw item belongs to **exactly one** normalized job at a time, decided by the job key of its **latest** version, with one exception (revised 2026-11-01, normalizer version 2): a raw item never falls back from a posting key (`ats:`, `url:`) to its own id. When the latest version yields only a fallback key (a LinkedIn rescrape that dropped the apply URL), the most recent earlier version with a posting key decides. It still moves when its apply URL changes to another posting key.
- When a raw item's key changes (the Sii case: no apply URL, then one), the link moves to the new normalized job. A normalized job left with no sources is marked `merged` with `mergedIntoId` pointing at the job its last source moved to; it is never deleted, so anything Process already wrote against it can follow the pointer.
- **Merge** (re-run whenever a source is linked, moved, or gets a new latest version): per field, take the first non-null value by source precedence:
  1. Ashby / Greenhouse posting (the employer's ATS wins),
  2. LinkedIn job board,
  3. LinkedIn post.

  Within the same precedence, the source whose latest version has the greatest `lastSeenAt` wins (ties: the most recently created version). `closed` records contribute nothing but the flag. `closed` on the normalized job is true only when every ATS source's latest record is closed. The merged record stores `fieldSources: { <field>: rawItemId }`.

- `kind` of a normalized job is `post` only if all its sources are posts (by rule 2 that means exactly one).

### 4. Processing status (how Process is triggered)

The normalized job row carries its own processing status. Ingest moves a job to `processingStatus = pending` when, while linking a raw item observed at `observedAt` (the batch's):

- **new** — the normalized job was created by this observation;
- **reopened** — the job existed and `observedAt − job.lastSeenAt ≥ reopenAfter` (config, default **21 days**), where `job.lastSeenAt` is the value before this observation. Nothing else counts as reopening (an ATS "closed" response followed by an open one inside 3 weeks does not).

With it, ingest sets `processingReason` (`new` | `reopened`), `processingRequestedAt = observedAt`, and resets `processingAttempts` and `processingError`.

Never a trigger: a new source joining an existing job, a content change, a key move, a merge. These update the job's columns but leave `processingStatus` as it is.

`job.lastSeenAt` is the max `observedAt` over all its sources' observations, so it uses observation time, not wall-clock time: replaying an old batch (observedAt ≤ lastSeenAt) can never reopen a job, and replaying the batch that created or reopened it changes nothing.

Statuses: `pending` (waiting for Process), `processing`, `processed`, `failed`. Ingest only ever writes `pending`; the other three belong to Process. If a job reopens while `processing`, ingest still sets it back to `pending` with the new reason, and Process must not overwrite a `pending` set after it started (it compares `processingRequestedAt`). A `merged` job is never `pending`: when a job becomes `merged`, its pending status, if any, moves to the job it merged into (unless that one is already `pending`).

Process does not exist yet, so nothing consumes `pending` jobs. The Process design adds the consumer and a sweeper over `(processingStatus, processingRequestedAt)`, the same pattern as `collection_batches` (row is truth, queue is a nudge). What Process does with a job (full rerun or a diff) is the Process design's call; ingest supplies the reason.

### 5. Tables

All shared, not workspace-scoped (see Constraints).

- `normalized_versions` (one per raw version, the per-source normalized record, kept for audit and rebuilds): `id`, `rawVersionId` (FK `raw_item_versions`, cascade), `normalizerVersion` (int), `status` (`valid` | `invalid`), `reason` (nullable), `record` (jsonb, null when invalid), `jobKey` (nullable when invalid), `createdAt`. Unique `(rawVersionId, normalizerVersion)`.
- `normalized_jobs` (the dedicated table for unified jobs; this is what Process reads):
  - identity: `id` (uuid v7), `jobKey` (unique), `kind` (`job` | `post`), `status` (`active` | `merged`), `mergedIntoId` (nullable, self FK);
  - one typed column per unified field: `title`, `companyName`, `companyUrl`, `location`, `contractType`, `experienceLevel`, `sector`, `salaryText`, `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod`, `publishedAt` (date), `descriptionHtml`, `descriptionText`, `applyUrl`, `postingUrl`, `posterName`, `posterProfileUrl`, `posterType`, `closed` (bool) — all nullable except `kind`, `postingUrl`, `closed`;
  - `fieldSources` (jsonb, `{ <field>: rawItemId }`);
  - seen: `firstSeenAt`, `lastSeenAt`;
  - processing: `processingStatus` (`pending` | `processing` | `processed` | `failed`; null only for jobs written by the backfill, until the Process design decides what to do with them), `processingReason` (`new` | `reopened`), `processingRequestedAt`, `processingAttempts` (default 0), `processingError` (nullable), `processedAt` (nullable);
  - `normalizerVersion`, `createdAt`, `updatedAt`;
  - index `(processingStatus, processingRequestedAt)`; check constraints for the enums.
- `normalized_job_sources`: `jobId` (FK `normalized_jobs`), `rawItemId` (**unique**: one job per raw item), `normalizedVersionId`, `linkedAt`.

The zod schema and the `normalized_jobs` columns describe the same format; the mapper output is validated before it is written.

### 6. Batch report

The report gains `normalized`, `normalizeInvalid` (full count; reasons go in the existing capped `errors` list with a `stage: 'normalize'` marker), `newJobs`, `reopened`. A normalize-invalid item still has its raw rows written: raw storage never depends on normalization.

### 7. Rebuild and backfill

`normalizerVersion` is a constant in the module, bumped on any mapping or job-key change. A script (`pnpm --filter @xjobs/xjobs db:renormalize`, same style as `db:regenerate`) re-normalizes every raw item's latest version at the current normalizer version and rebuilds links and merges. Rebuilds and the first backfill of existing data **do not change `processingStatus`** (the backfill leaves existing jobs at null; the Process design decides whether to enqueue them). This design ships with that backfill run on the existing 320 versions.

## Constraints

- Same rules as raw storage: no LLM, no network, only the database (and object storage via batches).
- Shared tables: collection is attributed to shared query builders, so raw data and the facts derived from it deterministically are shared; workspace scoping starts at Process/Match (qualification against a workspace's preferences). This follows the raw-storage design; the CLAUDE.md "workspace-scoped" rule applies from there on.
- Determinism is tested: the same payload always gives byte-identical `record` JSON (canonical key order).
- Existing patterns: Prisma contract + migrations in `apps/xjobs/src/database`, NestJS module under `modules/ingest`, Vitest, PostgreSQL tests against `ingest_test`.

## Related, not in this change

- `raw_item_sightings` is empty (0 rows) even though all 28 batches are `ingested` with items received. Traceability is broken; it should be fixed first, in its own change. This design reads `observedAt` from the item's observation inside the ingest flow, so it does not depend on sightings, but reopen detection and `lastSeenAt` must be checked against real sightings once they are written again.

## Testing

Fixtures come from real payloads (the existing `utils/fixtures/*.json`, extended with the cases above).

- **Normalize, per channel:** field mapping for every column of the table; empty/sentinel → null; Greenhouse entity decoding; Ashby `employmentType` map; closed Ashby/Greenhouse version → `closed` record; post author goes to `poster`, `companyName` stays null; schema failures produce invalid with a reason; same input → identical output.
- **Job key:** Ashby `/application` and plain posting URL give the same key, as do the LinkedIn apply URL and the Ashby item; Greenhouse embed URLs with different `for`/`token` give different keys; the two Avature `jobdetail?jobId=` URLs give different keys; Sii's `utm_*`/`#apply-contact-form` variants give one key; an Easy Apply job falls back to `linkedin-job:<id>`; a careers-root URL with no identifier falls back; a post with an article link keeps `linkedin-post:<id>`.
- **PostgreSQL:** 10 LinkedIn items with one Sii apply URL → one normalized job, 10 sources; a LinkedIn job plus its Ashby posting → one job, Ashby fields win, LinkedIn fills `companyName`, `fieldSources` correct; a raw item whose apply URL appears later moves to the new job and the old one becomes `merged` with `mergedIntoId`; new job → `pending`/`new`; a `processed` job seen again after 20 days stays `processed`, after 21 → `pending`/`reopened`; a new source on a `processed` job leaves it `processed` but updates its columns; reopen during `processing` → `pending`; merging a `pending` job moves `pending` to the target; replaying any batch writes nothing new; an older batch replayed after a newer one changes no status; concurrent ingests of overlapping batches produce one job; rebuild after a version bump updates columns and leaves `processingStatus` untouched.

## Decided by the user

- Ingest does a fully deterministic normalization and dedup; Process keeps its own normalization and cross-channel dedup on top.
- The unified format follows the LinkedIn job board shape.
- Jobs are unified by apply URL, the job's real id.
- Unified jobs are stored in a dedicated table with a processing status.
- Process is triggered on a new job and on a reopen; a reopen is a job seen again after 3 weeks or more unseen. A new source does not trigger.
- The employer's ATS posting wins when sources disagree.

## Calls made in this design (check these)

- Strip only known tracking parameters and keep all others; use a non-ATS apply URL only if it carries an identifier, else fall back to the source's own id.
- LinkedIn posts never unify with anything.
- No network resolution of short links.
- Ashby company stays null (no slug or Google-title guess).
- A raw item belongs to one job, decided by its latest version; orphaned jobs become `merged`, never deleted.
- Unified jobs live in a dedicated `normalized_jobs` table with typed columns and their processing status on the row (no separate trigger table, no queue until Process exists). A reopen during `processing` sets it back to `pending`.
- Normalization runs in the item's transaction; rebuilds and the backfill never touch `processingStatus`.
- `publishedAt` is date-only, matching LinkedIn.

## Left to the builder

File layout inside `modules/ingest`; the HTML → text converter; exact zod schema code; whether normalization is in the item transaction or a per-batch second pass (rules above must hold); report error-cap handling; the script name; adjusting table and column names.
