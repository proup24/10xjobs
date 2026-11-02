# Processor

The processor is the third stage of the pipeline (Collect → Ingest → **Process** → Match). It reads each in-scope normalized job, asks models for the facts the posting establishes, checks them against the text and the list tables, and stores one validated extraction document per run. It never guesses: a fact the posting does not state is `null` or `unstated`.

Design: `docs/superpowers/specs/2026-11-01-processor-design.md`.

## Scope

A normalized job is in scope when it is `status='active'`, `kind='job'`, and at least one of its sources (`normalized_job_sources` → `raw_items`) has `channel='LINKEDIN_JOB_BOARD'`. A LinkedIn job merged with its Ashby or Greenhouse posting is in scope. Only in-scope jobs are listed, claimed or reprocessed; every other job is invisible to the processor. A closed in-scope job is claimed and marked `processed` with no model call and no extraction.

## Statuses

`normalized_jobs.processingStatus` is the source of truth; the queue is only a nudge.

| Status       | Meaning                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `null`       | Never requested (jobs ingest's backfill left alone). `db:reprocess -- --null-status` sends them to `pending`.                                                           |
| `pending`    | Waiting, in `processingRequestedAt` order. Ingest sets it for new and reopened jobs; a transient failure with attempts left comes back here with `processingError` set. |
| `processing` | Claimed: `processingAttempts` was incremented and `processingStartedAt` set. A claim older than `PROCESSOR_CLAIM_TIMEOUT_MS` is returned to `pending` by the sweep.     |
| `processed`  | Done. `currentExtractionId` points at the extraction qualify reads (null for a closed job), `processedAt` is set.                                                       |
| `failed`     | The last attempt failed, or the model output stayed invalid after its one retry. `processingError` says why. `db:reprocess -- --failed` sends them back.                |

A run finishes only while the row still holds its claim: `processing`, the same `processingRequestedAt` and the same `processingAttempts`. If ingest reopened the job meanwhile (new `processingRequestedAt`), or the claim went stale and was taken again, the finish is `superseded` and leaves the row alone. Its extraction is still saved, and a processed outcome still points `currentExtractionId` at it unless a newer run already finished the job.

On `normalized_jobs` the processor writes only `processingStatus`, `processingAttempts`, `processingError`, `processedAt`, `processingStartedAt` and `currentExtractionId`; reprocessing also resets `processingReason` and `processingRequestedAt`.

## Tables

All of these are shared across workspaces: they describe public postings and carry nothing about any person. Workspace scoping starts at qualify.

- `job_extractions`: one row per completed run, append-only. `data` holds the validated document; the typed columns (`arrangement`, `seniority`, `roleKind`, `contractType`, `engagement`, `isSoftwareEngineeringRole`, `worldwide`, `regionCodes`, `countryCodes`, `cityIds`, `techTags`, `mainStackTags`, salary) are copies for filtering. `(inputHash, schemaVersion, promptHash, decisionModel, extractionModel)` is the reuse key: a run with the same key reuses the row (or copies it, at no cost, for another job) instead of calling a model.
- `processing_attempts`: one row per model call (`decision`, `extraction`, `extraction_retry`), with tokens, `costUsd`, latency, outcome and error. Eval runs are tagged `eval = true` with a null `jobId`; the daily budget sums `costUsd` of non-eval rows only.
- List tables `tech_tags`, `regions`, `countries`, `role_kinds`, `seniorities`, `arrangements`, `contract_types`, `engagements`, `junk_flags`: `code`, `label`, `aliases`, `status` (`approved` | `proposed`), `occurrences`. Only approved rows are offered to the models or matched. An unknown term is upserted as `proposed` under the slug of its text; an approved row with that code is never touched. `tech_tags` adds `family` and `implies`; `region_countries` lists each region's countries.
- `cities`: created as postings name them, `proposed`, unique per `(nameKey, countryCode)` where `nameKey` is the lower-cased name.

## Verification

```sh
npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor
```

The PostgreSQL tests (`repositories/processor.postgres.spec.ts`) need `PROCESSOR_TEST_DATABASE_URL`, pointing at a disposable database named `processor_test` on `127.0.0.1` and migrated to the current contract. They **truncate** their tables, seed the list tables, skip when the variable is absent, and refuse any other host or database name. One way to get such a database:

```sh
docker run --rm -d --name xjobs-processor-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=processor_test -p 127.0.0.1:55433:5432 postgres:17
cd apps/xjobs && XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:test@127.0.0.1:55433/processor_test npx prisma db migrate --yes
cd ../.. && PROCESSOR_TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55433/processor_test npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor/repositories
```
