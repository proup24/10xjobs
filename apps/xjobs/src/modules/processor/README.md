# Processor

The processor is the third stage of the pipeline (Collect → Ingest → **Process** → Match). It reads each in-scope normalized job (a LinkedIn job listing, or a LinkedIn post), asks Claude for the facts the posting establishes, checks them against the text and the list tables, and stores one validated extraction document per run. It never guesses: a fact the posting does not state is `null` or `unstated`.

Design: `docs/superpowers/specs/2026-11-01-processor-design.md`.

## Flow

1. **Trigger.** Ingest sets a new or reopened job to `pending`. Once its batch is ingested, the ingest worker enqueues every job the batch left `pending` on the `process` queue (LinkedIn job-board batches, harvestapi's `LINKEDIN_JOB_BOARD` and the trial channels: `isLinkedinJobBoard`, the same channels as `PROCESSOR_CHANNELS`; and LinkedIn posts batches, whose pending post jobs go to Extract). The processor's sweeper (every 60 s) re-enqueues any pending job a nudge missed and returns stale claims to `pending`. Each sweep enqueues up to 200 pending listings, then up to 200 pending posts (newest first). Post jobs, from the sweep and from a posts batch's nudge, are queued at BullMQ priority `POST_PRIORITY` (1) and listings with none; BullMQ takes every job with no priority before any prioritized one, so a listing queued after a post backlog (at 00:00 UTC after a cap, or after a `--null-status` reprocess) still goes first. A post already running is not interrupted. While today's post cap is reached (or is 0) the sweep lists no posts.
2. **One job.** The worker calls `ProcessorService.process(jobId)`, which reads top to bottom:

   | Step | Service                     | Does                                                                                                                                                                                                                                                                                                                                                                                                       |
   | ---- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 1    | `ProcessorGuard`            | Refuses while a pause is on (usage limit, weekly reserve, auth failure) or today's estimated spend reached the budget.                                                                                                                                                                                                                                                                                     |
   | 2    | `ProcessorRepository.claim` | `pending` → `processing`, atomically; nothing if another worker has it.                                                                                                                                                                                                                                                                                                                                    |
   | 3    | `ExtractionStore.reuse`     | A closed job needs no call; the same input, schema, prompt and model reuse a stored extraction.                                                                                                                                                                                                                                                                                                            |
   | 4    | `ExtractionPipeline.run`    | `GenerationService` (the generator writes the whole document through one `claude -p` call; `FactAssembler` checks quotes, consistency, list codes and shape; up to `PROCESSOR_GENERATION_TRIES` tries) → the consistency rules run again on the final document. No verifier and no regeneration rounds: the generator's facts are final. Writes nothing.                                                   |
   | 5    | `ExtractionStore.save`      | Cities, proposed terms, the extraction with its typed columns, its attempts, code usage.                                                                                                                                                                                                                                                                                                                   |
   | 6    | `decideFailure` + `finish`  | `processed`, or per the failure table: usage limit or auth failure → `pending` with the attempt given back and a pause; request error or a first generation invalid on every try → `failed`; anything else → `pending` until `PROCESSOR_MAX_ATTEMPTS`, then `failed`. A job that ends `processed` with a current extraction (including a reused one) is handed to the match queue (see `modules/matcher`). |

   Every model call goes into an `AttemptLog` and is written once, whatever the outcome.

### Posts

A post job (`kind = 'post'`, from LinkedIn posts search) takes the same path with a post prompt and schema (`PostPipeline`, `PostAssembler`, `PostStore`). Design: `docs/superpowers/specs/2026-11-22-posts-extract-design.md`.

- **One call per post.** The generator returns a verdict (`hiring`, `not_hiring` or `junk`, each with a reason and a confidence) and one entry per role the post offers. `unsure` confidence marks the extraction `needsReview`.
- **Role jobs.** Each role of a `hiring` post becomes its own `normalized_jobs` row with `kind = 'post_role'`, `parentJobId` set to the post job and a `roleKey` (the role's identity within the post), `processed` with the role's extraction as its current extraction. A role that disappears when the post is processed again is archived, and an archived role that comes back is reopened. Archiving a post job (a drop or `db:archive-actor`), or merging it into another, archives its role jobs. Role jobs are never claimed or counted as posts.
- **Contact checks.** The contact email and the links of a role are hard checks, because they are what slice 05 may email: each must appear in the post text (an address as a whole address, not inside a longer one) and in its quote, or the extraction fails; unsupported quotes elsewhere are cleared and counted. A role's employer name (the role job's `companyName`) is set to null, and counted, when its quote is cleared or the name is not in the post text: a guessed employer is worse than none.
- **Reuse.** A post reuses a stored extraction only on the exact key (`inputHash`, schema version, prompt hash, model) and never through joined reuse: a share that joins an original sends the processed post back as `joined`, and Claude reads it again. The post key's prompt hash is `postKeyPromptHash()`: the post prompt hash folded with the listing `EXTRACTION_SCHEMA_VERSION`, because a post document embeds listing documents, so a listing schema bump re-extracts posts too (role rows keep `postPromptHash()`; their schema version already is the listing one). A stored post row whose document no longer parses, or whose role rows are missing, is not reused: a warning is logged and Claude runs afresh. A failure on the final attempt while the role jobs are being written leaves the post job `failed` with its previous role jobs; `db:reprocess -- --failed` heals it through reuse (the post row is already saved, so the rerun syncs the role jobs without a call).
- **Cap.** `POST_EXTRACTION_DAILY_CAP` (default 250, UTC day) limits post calls per day, counted from non-eval `processing_attempts` with `docType = 'post'`; 0 pauses posts. At the cap the job goes back to `pending` with its attempt given back and the outcome is `post_cap` (run answers 429). Attempts are recorded at the end of a run, so posts already in flight when the cap is reached still finish: a day can overshoot the cap by about the worker's concurrency (`PROCESSOR_CONCURRENCY`). Posts also count toward the daily budget `PROCESSOR_DAILY_BUDGET_USD`, which covers listings and posts together.

- **Automatic silencing.** `AutoSilenceService` runs daily at 04:00 UTC on the processor worker (the `auto-silence` job of the `process` queue, scheduled only with `XJOBS_RUN_SCHEDULES=1`). `AutoSilenceRepository.candidates()` finds authors with at least 10 counted posts over at least 7 days (first to last post job `firstSeenAt`), every counted one ruled `not_hiring` or `junk`, no `qualified` match on any of their role jobs, and not already silenced. Only each active post job's current `post` extraction counts; `not_hiring` / `role_filled` posts neither count nor block. The author is the original post's (`originalAuthorOf` in `modules/admin/post-author.ts`; the SQL keys by the same rule), never a sharer's. Archived post jobs hold no sources, so they are never attributed. With `POST_AUTO_SILENCE` off (the default) it logs `would silence <authorKey> (<n> posts, <first>..<last>)` and silences nobody; on, it silences each with `origin = 'automatic'` and the evidence. The owner sees the same list at `GET /api/admin/extract/auto-silence-candidates`.

### Joined jobs

When harvestapi first sees a posting a trial actor already brought in, ingest sets the job `pending` with reason `joined` (`modules/ingest`). Step 3 then also accepts an extraction of that job, or of a job merged into it, under the same schema, prompt and model but another input (`findJoinedReusable`): the trial already extracted this posting, and harvestapi's text differs only a little. A copied joined extraction keeps the trial's `inputHash`, so when the job is later reopened (reason `reopened`, harvestapi's input) the exact reuse key usually misses and Claude may run once for it.

## Code map

- `services/`: the execution path above. `processor.service.ts` is the entry point; `createProcessorService` builds the same graph without Nest (tests, scripts).
- `rules/`: pure functions the services call (input and hashes, fact resolution, validation, typed columns).
- `models/`: the generator interface and its adapter on `claude -p` (`claude-extraction.model.ts`); `models/claude/` holds the child-process runner, the `stream-json` parser, the isolated environment, the pinned version and the startup checks.
- `repositories/`: every database read and write. `schema/`, `vocab/`, `prompts/`: the document shape, the lists, the system prompt.
- `controllers/`: the testing endpoints below (served by the API app only).

## Running it

`WORKER_ROLE=processor` (`npx nx worker-processor xjobs`, the `processor-worker` container) always runs the processor and needs a Claude credential: `CLAUDE_CODE_OAUTH_TOKEN` (the subscription; make it with `claude setup-token`) or `ANTHROPIC_API_KEY`. `WORKER_ROLE=all` (`worker-all`) runs it whenever one of them is set; without one it warns `processor not started` and jobs wait in the queue. The `claude` binary must be on `PATH` at the pinned version (`models/claude/version.ts`); a missing or different binary stops startup.

**Locally.** Install Claude Code at the pinned version, set `CLAUDE_CODE_OAUTH_TOKEN` in an untracked `.env*` file, and run `pnpm --filter @xjobs/xjobs processor:smoke` (startup checks plus one real call). The local run uses your own subscription, so it shares its limits with your Claude use. `processor:eval` stops on a usage limit instead of waiting (see Eval).

Jobs ingested before the processor existed have no processing status and are not processed automatically; send them once with `pnpm --filter @xjobs/xjobs db:reprocess -- --null-status`.

## Testing endpoints

Served by the API (`npx nx serve xjobs`), local only, with `XJOBS_OPERATOR_ENDPOINTS=1`, and the engine key, under `/processor`:

| Endpoint                          | Does                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /processor/preview`         | Runs the extraction on a posting you send (`title` optional, `description`). Returns the document, its typed columns, `needsReview`, the cost and every model call. Saves no extraction and no vocabulary; the calls are recorded and count against the budget.                                |
| `POST /processor/jobs/:jobId/run` | Sends one in-scope job back to `pending` and processes it in the request, through the worker's path. Returns the outcome and the job state.                                                                                                                                                    |
| `GET /processor/jobs/:jobId`      | The job's processing status, attempts, error and current extraction.                                                                                                                                                                                                                           |
| `GET /processor/status`           | In-scope jobs per status (`unset` = never sent) for `jobs.listings` and `jobs.posts` (posts also `outOfWindow` and `silenced`, pending ones only), today's spend against the budget, `posts` (calls today, the daily cap, today's post spend), the models, and whether this process is paused. |

Preview and run answer 503 when the app has no Claude credential, 429 once the budget is spent or today's post cap is reached, 503 while a pause is on, 502 on a Claude error, and 422 when the first generation was invalid on every try.

## Models and cost

The processor is generator-only: one model, `PROCESSOR_EXTRACTION_MODEL` (default `claude-sonnet-5-5`), writes every fact, and nothing verifies it. Each try is one `claude -p` call (Claude Code headless, `--max-turns 3`) that returns the document as structured output against the strict JSON schema; within the call the model may correct a text-only reply or a schema-rejected answer. The processor's own tries (`PROCESSOR_GENERATION_TRIES` per generation) are the only retries.

**The call is isolated.** The child runs in an empty working directory with an empty `HOME`, a stripped environment (only the credential and what Claude Code needs), and `--tools ""`. It has no tools, no files, no project `CLAUDE.md` or settings, and no session between jobs. A posting is untrusted text, so the model has nothing to act with. The exact flags are in `models/claude/fixtures/README.md` ("Final argv"). `PROCESSOR_EFFORT` (default `low`) sets the effort and `PROCESSOR_CALL_TIMEOUT_MS` (default 180000) kills a call that runs too long.

**Startup.** Before any worker starts, the processor checks that the `claude` binary exists at the pinned version and makes one small call with the credential. A missing or wrong binary stops startup (in `all` mode no other worker is left running). A failed credential call does not: the processor starts paused and rechecks every 10 minutes.

**Cost.** `costUsd` on each attempt is Claude Code's own estimate at API prices. On a subscription nothing is billed per call, so it is a measure of use, not a charge. It still feeds `processor:eval`, slice 03's comparisons and `PROCESSOR_DAILY_BUDGET_USD` (default 0, no cap). Set a cap only to bound use; it counts the estimate.

## Usage limits and pauses

The engine shares the subscription's 5-hour window and weekly limit with the owner's own Claude use. A pause stops claiming (and the sweep stops enqueueing) and loses no job:

| Event                                               | What happens                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usage limit hit                                     | The job goes back to `pending`, its attempt is given back, and the processor pauses until the reset time Claude reports (15 minutes if it reports none).                                       |
| Weekly use reaches 85% (`PROCESSOR_WEEKLY_STOP_AT`) | The processor pauses until the weekly reset, to leave the rest of the week to the owner. The all-models weekly figure is always seen; the Sonnet weekly one only when it is the binding limit. |
| Auth failure (expired token, bad key)               | The job goes back to `pending` with its attempt given back, and the processor pauses 10 minutes. The runbook says how to renew the token.                                                      |

A call already running when a pause starts finishes normally. Pauses are logged once by the worker; `GET /processor/status` shows whether this process is paused. See the runbook (`deploy/engine/README.md`) for reading them.

**Subscription gate.** The subscription is for the dogfooding period only. Before any other person gets an account, the engine moves to an Anthropic API key (runbook, "Switch to an API key").

## Scope

Two kinds of job are in scope, always `status='active'`:

- **Listings** (`kind='job'`): at least one source (`normalized_job_sources` → `raw_items`) has a channel in `PROCESSOR_CHANNELS` (`processor.config.ts`): harvestapi's `LINKEDIN_JOB_BOARD` and the trial channels (`TRIAL_CHANNELS`, today `LINKEDIN_JOB_BOARD_CHEAP`). A LinkedIn job merged with its Ashby or Greenhouse posting is in scope.
- **Posts** (`kind='post'`): first seen within the last 7 days, and not every author silenced. A post older than the window (`outOfWindow`) or whose authors are all silenced (`silenced`) is out of scope and stays as it is.

Only in-scope jobs are listed, claimed or reprocessed; every other job, `post_role` jobs included, is invisible to the processor. An `archived` job is never claimed. A closed in-scope job is claimed and marked `processed` with no model call and no extraction.

## Statuses

`normalized_jobs.processingStatus` is the source of truth; the queue is only a nudge. The same statuses apply to listings and posts (the status endpoint counts them apart); a role job is always `processed` or `archived`.

| Status       | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `null`       | Never requested (jobs ingest's backfill left alone). `db:reprocess -- --null-status` sends them to `pending`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pending`    | Waiting, in `processingRequestedAt` order. Ingest sets it for new and reopened jobs; a transient failure with attempts left comes back here with `processingError` set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `processing` | Claimed: `processingAttempts` was incremented and `processingStartedAt` set. A claim older than `PROCESSOR_CLAIM_TIMEOUT_MS` is returned to `pending` by the sweep.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `processed`  | Done. `currentExtractionId` points at the extraction qualify reads (null for a closed job), `processedAt` is set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `failed`     | The last attempt failed, or the model output stayed invalid after its one retry. `processingError` says why. `db:reprocess -- --failed` sends them back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `archived`   | Retired three ways: by `db:archive-actor` (every source came from one retired actor; an archived post job's role jobs go with it); by ingest, for a post job whose sources were all dropped, and for the role jobs of a post job merged into another (`archivePostRoleJobs` in `src/database/role-jobs.ts`, shared by ingest and `db:archive-actor`); by Process, for a `post_role` job its post no longer lists. No claim, list, reprocess or match touches it; its matches are deleted and `currentExtractionId` is kept. A listing or post comes back only through a new ingest observation (`reopened`); a role comes back when Process finds it in its post again (`upsertRoleJob`), not through ingest. |

A run finishes only while the row still holds its claim: `processing`, the same `processingRequestedAt` and the same `processingAttempts`. If ingest reopened the job meanwhile (new `processingRequestedAt`), or the claim went stale and was taken again, the finish is `superseded` and leaves the row alone. Its extraction is still saved, and a processed outcome still points `currentExtractionId` at it unless a newer run already finished the job.

On `normalized_jobs` the processor writes only `processingStatus`, `processingAttempts`, `processingError`, `processedAt`, `processingStartedAt` and `currentExtractionId`; reprocessing also resets `processingReason` and `processingRequestedAt`.

## Tables

All of these are shared across workspaces: they describe public postings and carry nothing about any person. Workspace scoping starts at qualify.

- `job_extractions`: one row per completed run, append-only. `data` holds the validated document; the typed columns (`arrangement`, `seniority`, `roleKind`, `contractType`, `engagement`, `isSoftwareEngineeringRole`, `worldwide`, `regionCodes`, `countryCodes`, `cityIds`, `techTags`, `mainStackTags`, `requiredTags`, `niceTags`, salary) are copies for filtering. The tech stack is one list of requirements (spec section 5a): `requiredTags` and `niceTags` hold the tags the posting requires and merely prefers, `techTags` is every tag it names. `requiredTags` also holds every member of an alternative group ("React or Vue" puts both in it), so it is not a list of tags a candidate must all have: matching must read the groups and their `min` from `data.techStack.value.groups`. A requirement whose technology has no code (`code` null) appears only in `data`, never in a tag column. Rows written before schema version 2 have `requiredTags` `'{}'`: filter on `schemaVersion >= 2`, which is also the schema that reads only the title and description (v3). `needsReview` is true when any of `arrangement`, an opening, `seniority`, `position`, `contractType`, `engagement` or `isSoftwareEngineeringRole` is `unsure`, when a `main` stack requirement is `unsure` (`rules/validate.ts`). `(inputHash, schemaVersion, promptHash, extractionModel)` is the reuse key: a run with the same key reuses the row (or copies it, at no cost, for another job) instead of calling a model.
- `processing_attempts`: one row per model call (`generation`, `generation_retry`; `verification`, `decision`, `extraction` and `extraction_retry` only on rows from before the processor became generator-only), with tokens, `costUsd`, latency, outcome and error. Eval runs are tagged `eval = true` with a null `jobId`; the daily budget sums `costUsd` of non-eval rows only, and the post cap counts the non-eval `post` rows.
- List tables `tech_tags`, `regions`, `countries`, `role_kinds`, `seniorities`, `arrangements`, `contract_types`, `engagements`, `junk_flags`: `code`, `label`, `aliases`, `status` (`approved` | `proposed`), `occurrences`. Only approved rows are offered to the models or matched. An unknown term is upserted as `proposed` under the slug of its text; an approved row with that code is never touched. `tech_tags` adds `family` and `implies`; `region_countries` lists each region's countries.
- `cities`: created as postings name them, `proposed`, unique per `(nameKey, countryCode)` where `nameKey` is the lower-cased name.

## Verification

```sh
npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor
```

The PostgreSQL tests (`repositories/processor.postgres.spec.ts`) need `PROCESSOR_TEST_DATABASE_URL`, pointing at a disposable database named `processor_test` on `127.0.0.1` and migrated to the current contract. The migrations need Supabase's `auth` schema and roles, so the database must come from a Supabase Postgres image, not a plain `postgres` one. They **truncate** their tables, seed the list tables, skip when the variable is absent, and refuse any other host or database name. Once you have one, run:

```sh
PROCESSOR_TEST_DATABASE_URL=postgresql://postgres:<password>@127.0.0.1:<port>/processor_test npx vitest run --config apps/xjobs/vitest.config.mts src/modules/processor/repositories
```

The ingest Postgres specs (`modules/ingest`) need their own database named `ingest_test` (`INGEST_TEST_DATABASE_URL`), with the same rules. Make it on the same container by restoring a dump of `processor_test` (`CREATE DATABASE ... TEMPLATE` fails while pg_cron holds a session):

```sh
docker exec <container> psql -U supabase_admin -d postgres -c 'CREATE DATABASE ingest_test'
docker exec <container> pg_dump -U supabase_admin processor_test | docker exec -i <container> psql -U supabase_admin -d ingest_test
```

Run `pnpm db:migrate` against each database after a contract change.

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

`list` shows the proposed rows, most sighted first. `approve` makes a proposed row approved. `alias` adds the proposed term's label (lower-case) to an approved target's aliases and deletes the proposed row; it fails if the source is not proposed or the target is not approved. `reject` deletes a proposed row. None of them changes an approved row other than the alias target, and approved rows are never deleted. Cities are reviewed by id with `list`, `approve` and `reject`, and `cities alias <id> --as "<spelling>"` appends a spelling to an approved city's aliases (a no-op when it already folds equal to the name or an alias; `not found or not approved` and exit 1 otherwise). `approve`, `reject` and the city commands report `not found or not proposed` and exit 1 when they changed nothing. Rejection is not sticky: the term is proposed again on its next sighting. `alias` adds only the source's label, not the other aliases it collected. A proposed city that an extraction's `cityIds` still names cannot be rejected. Extractions made before a term was approved keep the unresolved form until they are reprocessed.

## Reprocessing

After a prompt, schema or model change (a new reuse key), or to retry failures, send jobs back to `pending`:

```sh
pnpm --filter @xjobs/xjobs db:reprocess -- --null-status
pnpm --filter @xjobs/xjobs db:reprocess -- --failed
pnpm --filter @xjobs/xjobs db:reprocess -- --all-in-scope
pnpm --filter @xjobs/xjobs db:reprocess -- --job <id> --job <id>
```

At least one selector is required; selectors combine. Only in-scope jobs are touched, and `archived` jobs are skipped under every selector (the script says how many). The script resets the status, attempts, error and `processingRequestedAt`; the worker then picks the jobs up. Rows whose reuse key still matches are reused without a model call.

### Archiving a retired actor

```sh
pnpm --filter @xjobs/xjobs db:archive-actor -- --actor cheap_scraper/linkedin-job-scraper --dry-run
pnpm --filter @xjobs/xjobs db:archive-actor -- --actor cheap_scraper/linkedin-job-scraper
```

Archives every job all of whose sources were seen only in that actor's batches, deletes their `job_matches`, clears `processingError` and keeps the extractions. It prints counts before and after, refuses a remote database without `XJOBS_ALLOW_REMOTE_DB=1`, and is safe to run twice. A new ingest sighting sends an archived job back to `pending` (`reopened`).

## Eval

```sh
pnpm --filter @xjobs/xjobs processor:eval
```

Runs the generator over the golden set in `golden/` (in memory, with the seed vocabulary, writing nothing to the database; attempts are tagged `eval`) and scores the results. It uses `PROCESSOR_EXTRACTION_MODEL` and needs `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. It stops on a usage limit instead of waiting, and says where it stopped; run it again after the reset. It spends your subscription's use and never runs in CI. The report is written to `golden/last-report.<generator slug>.json` (git-ignored, regenerable) and holds:

- fact scores, and the requirement scores (recall, precision, kind, domain, years);
- the share of `sure` facts the golden value contradicts;
- generator calls and estimated cost per job.

Exit code 1 means a bar failed (`BARS` in `golden/score.ts`). Run it after any prompt, schema or model change, before reprocessing.

## The shared-tables exception

Every other domain record is workspace-scoped. The processor tables (`job_extractions`, `processing_attempts`, the list tables, `cities`, `region_countries`) are shared across workspaces on purpose: they describe public postings and a public vocabulary and carry nothing about any person. A term approved once serves every workspace. Workspace scoping starts at qualify, where a workspace's profile is compared with these facts.
