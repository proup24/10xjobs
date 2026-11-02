# Processor

The processor is the third stage of the pipeline (Collect → Ingest → **Process** → Match). It reads each in-scope normalized job, asks models for the facts the posting establishes, checks them against the text and the list tables, and stores one validated extraction document per run. It never guesses: a fact the posting does not state is `null` or `unstated`.

Design: `docs/superpowers/specs/2026-11-01-processor-design.md`.

## Flow

1. **Trigger.** Ingest sets a new or reopened job to `pending`. Once its batch is ingested, the ingest worker enqueues every job the batch left `pending` on the `process` queue (LinkedIn job board batches only, `PROCESSOR_CHANNEL`). The processor's sweeper (every 60 s) re-enqueues any pending job a nudge missed and returns stale claims to `pending`.
2. **One job.** The worker calls `ProcessorService.process(jobId)`, which reads top to bottom:

   | Step | Service                     | Does                                                                                                                                                                                                                                                                                  |
   | ---- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 1    | `ProcessorGuard`            | Refuses while today's spend reached the budget, or after the provider refused the key (10-minute pause).                                                                                                                                                                              |
   | 2    | `ProcessorRepository.claim` | `pending` → `processing`, atomically; nothing if another worker has it.                                                                                                                                                                                                               |
   | 3    | `ExtractionStore.reuse`     | A closed job needs no call; the same input, schema, prompt and models reuse a stored extraction.                                                                                                                                                                                      |
   | 4    | `ExtractionPipeline.run`    | `DecisionService` (Jev answers the closed questions) → `ExtractionService` (Opus extracts the rest and the low-confidence answers) → `FactAssembler` (merge, quote and consistency checks, list codes, final shape). Output a better answer could fix gets one retry. Writes nothing. |
   | 5    | `ExtractionStore.save`      | Cities, proposed terms, the extraction with its typed columns, its attempts, code usage.                                                                                                                                                                                              |
   | 6    | `decideFailure` + `finish`  | `processed`, or per the failure table: provider refused → `pending` with the attempt given back; request error or output invalid twice → `failed`; anything else → `pending` until `PROCESSOR_MAX_ATTEMPTS`, then `failed`.                                                           |

   Every model call goes into an `AttemptLog` and is written once, whatever the outcome.

## Code map

- `services/`: the execution path above. `processor.service.ts` is the entry point; `createProcessorService` builds the same graph without Nest (tests, scripts).
- `rules/`: pure functions the services call (input and hashes, Jev questions, fact resolution, evidence conflicts, validation, typed columns).
- `models/`: the two model interfaces and their OpenRouter adapters (`client.ts`, `decision.model.ts`, `extraction.model.ts`).
- `repositories/`: every database read and write. `schema/`, `vocab/`, `prompts/`: the document shape, the lists, the system prompt.
- `controllers/`: the testing endpoints below (served by the API app only).

## Running it

`WORKER_ROLE=processor` (`npx nx worker-processor xjobs`, the `processor-worker` container) always runs the processor and needs `OPENROUTER_API_KEY`. `WORKER_ROLE=all` (`worker-all`) runs it whenever `OPENROUTER_API_KEY` is set; without the key it warns `processor not started` and jobs wait in the queue. The daily budget (`PROCESSOR_DAILY_BUDGET_USD`) caps spend either way.

Jobs ingested before the processor existed have no processing status and are not processed automatically; send them once with `pnpm --filter @xjobs/xjobs db:reprocess -- --null-status`.

## Testing endpoints

Served by the API (`npx nx serve xjobs`), behind its basic auth, under `/processor`:

| Endpoint                          | Does                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /processor/preview`         | Runs the extraction on a posting you send (`title`, `companyName`, `description`, `location`, `contractType`, `experienceLevel`). Returns the document, its typed columns, `needsReview`, the cost and every model call. Saves no extraction and no vocabulary; the calls are recorded and count against the budget. |
| `POST /processor/jobs/:jobId/run` | Sends one in-scope job back to `pending` and processes it in the request, through the worker's path. Returns the outcome and the job state.                                                                                                                                                                          |
| `GET /processor/jobs/:jobId`      | The job's processing status, attempts, error and current extraction.                                                                                                                                                                                                                                                 |
| `GET /processor/status`           | In-scope jobs per status (`unset` = never sent), today's spend against the budget, the models, and whether this process is paused.                                                                                                                                                                                   |

Preview and run answer 503 when the app has no `OPENROUTER_API_KEY`, 429 once the budget is spent, 502 on a provider error, and 422 when the output was invalid twice.

## Models and cost

Both models are called through the official `@openrouter/sdk` (`models/client.ts`): Jev through `alpha.decisions.create` (the Decisions API), the extraction model through `chat.send` with a strict JSON-schema response format. The SDK's own retries are off; `toModelError` maps its errors to the processor's classes (401/402/403 provider unavailable; 408, 429 and 5xx transient; other 4xx request errors; an unreadable response an output error), and messages never carry a response body.

Before any worker starts, the processor checks that OpenRouter accepts the key (`apiKeys.getCurrentKeyMetadata`), and that the extraction model is listed, supports `structured_outputs`, and has a numeric prompt and completion price. The decision model is served by the Decisions API and need not be in the public model list; it is priced only when listed. Any failure stops startup; in `all` mode no other worker is left running. `pnpm --filter @xjobs/xjobs processor:smoke` runs the same checks plus one real call to each model.

**Cost.** Both APIs report `usage.cost` and token counts. When a successful response has no numeric cost, the cost is estimated as `inputTokens × prompt + outputTokens × completion` from the list prices loaded at startup, with one warning per model; a model with no loaded price (an unlisted decision model) is then counted as 0, with that warning.

**Provider unavailable.** A 401, 402 or 403 (also as a 200 error body) means the key, credit or account is the problem, not the job. The attempt is recorded, the job goes back to `pending` with its `processingAttempts` given back, and this process stops claiming (and the sweep stops enqueueing) for 10 minutes, logged once as an error.

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

## Approving terms

Proposed terms are never offered to a model or matched. Review them:

```sh
pnpm --filter @xjobs/xjobs db:vocab -- techTags list
pnpm --filter @xjobs/xjobs db:vocab -- techTags approve bun
pnpm --filter @xjobs/xjobs db:vocab -- techTags alias reactjs --to react
pnpm --filter @xjobs/xjobs db:vocab -- techTags reject some-noise
pnpm --filter @xjobs/xjobs db:vocab -- cities list
pnpm --filter @xjobs/xjobs db:vocab -- cities approve <city-id>
```

`list` shows the proposed rows, most sighted first. `approve` makes a proposed row approved. `alias` adds the proposed term's label (lower-case) to an approved target's aliases and deletes the proposed row; it fails if the source is not proposed or the target is not approved. `reject` deletes a proposed row. None of them changes an approved row other than the alias target, and approved rows are never deleted. Cities are reviewed by id with `list`, `approve` and `reject` only; `alias` is not supported for cities. `approve`, `reject` and the city commands report `not found or not proposed` and exit 1 when they changed nothing. Rejection is not sticky: the term is proposed again on its next sighting. `alias` adds only the source's label, not the other aliases it collected. A proposed city that an extraction's `cityIds` still names cannot be rejected. Extractions made before a term was approved keep the unresolved form until they are reprocessed.

## Reprocessing

After a prompt, schema or model change (a new reuse key), or to retry failures, send jobs back to `pending`:

```sh
pnpm --filter @xjobs/xjobs db:reprocess -- --null-status
pnpm --filter @xjobs/xjobs db:reprocess -- --failed
pnpm --filter @xjobs/xjobs db:reprocess -- --all-in-scope
pnpm --filter @xjobs/xjobs db:reprocess -- --job <id> --job <id>
```

At least one selector is required; selectors combine. Only in-scope jobs are touched. The script resets the status, attempts, error and `processingRequestedAt`; the worker then picks the jobs up. Rows whose reuse key still matches are reused without a model call.

## Eval

`pnpm --filter @xjobs/xjobs processor:eval` runs the decision and extraction models over the golden set in `golden/` (in memory, with the seed vocabulary, writing nothing to the database) and scores the results. The report is written to `golden/last-report.json`, which is git-ignored and regenerable. Run it after any prompt, schema or model change, before reprocessing.

## The shared-tables exception

Every other domain record is workspace-scoped. The processor tables (`job_extractions`, `processing_attempts`, the list tables, `cities`, `region_countries`) are shared across workspaces on purpose: they describe public postings and a public vocabulary and carry nothing about any person. A term approved once serves every workspace. Workspace scoping starts at qualify, where a workspace's profile is compared with these facts.
