# Models on Claude (Phase 3, interim slice 02b)

Date: 2026-11-13
Status: approved
Roadmap: [02b-claude-models](../../roadmap/phase-3-find-quality/02b-claude-models.md)
Builds on: [processor](2026-11-01-processor-design.md), [generate then verify](2026-11-07-generate-then-verify-design.md), [engine hosting](2026-11-10-engine-hosting-design.md), [listing facts](2026-11-12-listing-facts-design.md)
Followed by: [03 processor quality](../../roadmap/phase-3-find-quality/03-processor-quality.md)

Marks: _(user)_ is the user's decision. **(call)** is the author's call, open to the user's correction. Unmarked text describes what exists or follows directly from those.

## Intent

The processor has been down since about 2026-11-09. Its OpenRouter credit ran out, and every call since has failed with 402. Slice 03 can't start without a working processor.

This slice moves every model call the engine makes to **`claude -p`** (Claude Code, headless) and removes OpenRouter from the engine. It is the engine's permanent way of calling models, not a stopgap _(user)_. It also archives the jobs collected through the old actor, so the first Claude batch processes only fresh harvestapi jobs.

Who it serves: the user, dogfooding, now. A few invited friends may come later _(user)_. Expected volume is at most 5,000 jobs a day _(user)_; dev saw about 2,000 in-scope jobs a day while collection ran (2026-11-09 and 10). Each batch should go through in one pass, actor → ingest → process → match, as soon as it arrives _(user)_.

## Goals

- Every processor model call is one `claude -p` process, run as a bare model call (section 3).
- The processor is **one Claude Sonnet 5.5 generation per job**, with schema-fix tries. No verifier, no regeneration rounds _(user)_.
- When Claude's usage limit is reached, waiting jobs stay waiting and are retried after the reset, with their attempts given back _(user)_. Processing also stops at 85% of the weekly limit and resumes after the weekly reset _(user)_.
- It runs on the hosted engine on Hetzner, for every scheduled run, not on a machine started by hand _(user)_.
- All 4,048 jobs collected through cheap*scraper are archived before the switch and never processed *(user)\_.
- OpenRouter, Jev and both SDKs leave the engine.

## Non-goals

- Prompt or schema changes for quality. Those are slice 03. The system prompt and the extraction schema stay as they are, apart from removing what referred to the verifier.
- A model comparison. The generator is Sonnet 5.5, chosen without an eval _(user: "No need")_.
- Processing the old cheap*scraper backlog, now or later *(user: "its junk now")\_.
- Undoing the archive. Nothing un-archives a job by hand **(call)**, since the user called them junk.
- The Anthropic API key switch itself (section 7 only makes it a config change).
- Other model users outside the processor. There are none today: `@openrouter/*` is used only under `modules/processor`, the processor scripts and the worker wiring.

## Anti-goals

- **Serving friends from the user's subscription.** Anthropic's Claude Code legal page says it does not permit routing requests "through Free, Pro, Max, or Ultra plan credentials on behalf of their users", and that advertised limits "assume ordinary, individual usage". The subscription is for the dogfooding period only. **Before any other person gets an account, the engine must be moved to an Anthropic API key** _(user)_. This is a hard gate, recorded in the roadmap and in the runbook.
- **Locking the user out of their own Claude for the week.** The engine shares the 5-hour window and the weekly limit with the user's own Claude and Claude Code use. It must stop at 85% of the weekly limit _(user)_. Using a whole 5-hour window is accepted _(user)_.
- **Burning attempts on a limit.** A job that hit a usage limit is not failed and does not lose an attempt.
- **A call that is more than a model call.** No tools, no reading the engine's files, no project `CLAUDE.md` or settings, no session carried between jobs. A posting's text is untrusted input; the model must have nothing to act with.
- **Archived junk reaching a user.** An archived job is not processed, matched or shown.

## 1. What the processor becomes

Today: the generator (DeepSeek V4.1 Flash on OpenRouter, AI SDK) writes the document, `FactAssembler` checks it, Jev (OpenRouter Decisions API) verifies the closed fields, and rejected fields are regenerated up to `PROCESSOR_MAX_REGENERATIONS` times, then dropped.

After this slice, per job:

1. `ProcessorGuard` allows calls (section 4), `claim`, and `ExtractionStore.reuse` as today.
2. **Generation**: one `claude -p` call with Sonnet 5.5. The input is the title and the description only, as today (`PostingInput`). The system prompt is today's, minus anything that only described Jev's role.
3. `FactAssembler` checks quotes, consistency, list codes and shape, as today. On a failed check, the next try gets the validation errors, as today, up to `PROCESSOR_GENERATION_TRIES`. A first generation still invalid on every try fails the job, as today.
4. `ExtractionStore.save` and `finish`, and the hand-off to the match queue, as today.

Stays as it is: the description-only input and its hash, the strict extraction schema, the quote checks, the list tables and proposed terms, cities, typed columns, the reuse key, `processing_attempts`, the statuses (plus `archived`, section 6), the sweeper and claim timeout, the failure table (with the changes in section 4), the golden set and `processor:eval`, `db:reprocess`, `db:analyze`, the testing endpoints.

Removed:

- `DecisionModel`, `models/decision.model.ts`, `models/client.ts`, `VerificationService`, `rules/questions.ts`, `rules/verify.ts`, `config/thresholds.ts`, and the regeneration loop in `ExtractionPipeline`. Their specs go with them.
- `PROCESSOR_DECISION_MODEL`, `PROCESSOR_MAX_REGENERATIONS`, `OPENROUTER_API_KEY`.
- The dependencies `@openrouter/sdk`, `@openrouter/ai-sdk-provider`, and `ai` if nothing else imports it.
- The OpenRouter startup checks (key metadata, the model list, the parameter support check, list prices) and `models/pricing.ts`.

`needsReview` keeps its generator reasons: any of `arrangement`, an opening, `seniority`, `position`, `contractType`, `engagement` or `isSoftwareEngineeringRole` `unsure`, or a `main` stack requirement `unsure`. The verifier reasons (a rejected field dropped, a junk flag Jev saw that the generator missed) go. The document's `verification` blocks and per-fact `verification` go; per-fact `decidedBy` keeps `generator` and `ingest`.

Because the document shape and the prompt change, **`schemaVersion` is bumped** and the reuse key changes (`promptHash`, the model ID). Old extractions stay in `job_extractions` untouched. There is no extraction to keep reusing anyway: every processed job is archived (section 6).

`decisionModel` in the reuse key and in `job_extractions` is set to null for new rows, or the column is dropped **(call: leave the builder to choose whichever keeps the migration smallest; the reuse lookup must not match an old row on a null)**.

## 2. The `claude -p` call

One adapter behind the existing `ExtractionModel` interface (`models/extraction.model.ts` is replaced). It spawns `claude` as a child process per call, writes the user message on stdin, and reads one JSON result.

**Model.** `PROCESSOR_EXTRACTION_MODEL` stays the configuration point; its default becomes `claude-sonnet-5-5` _(user: Sonnet)_. It is passed as `--model`. The model ID recorded in attempts and extractions is the one `claude -p` reports it used.

**Structured output.** The extraction schema (built per job from the approved list rows, as today) is converted to JSON Schema and passed with `--json-schema`. The result's `structured_output` field holds the document. A missing `structured_output` (for example a refusal) or output that fails the Zod schema is a `ModelOutputError` listing the issues, handled by today's tries. The Zod schema stays the source of truth; `--json-schema` is a guide, so the engine always validates.

**Isolation, every call.** `--bare` would give this, but it reads only API-key auth, not the subscription token, so the flags do it instead:

- `--system-prompt-file <file>`: the processor's own system prompt replaces Claude Code's entirely.
- `--tools ""` and `--disallowedTools "*"`: no built-in tools; `--strict-mcp-config` with no MCP config: no MCP servers.
- `--setting-sources` set so no project or local settings load, and the process runs with a fresh, empty working directory and `HOME` pointing at an empty engine-owned directory, so no `CLAUDE.md`, memory, hooks, skills or settings are found.
- `--no-session-persistence`: nothing written to disk between jobs.
- `--max-turns` as low as `--json-schema` allows (the builder confirms by test).
- `--output-format stream-json` (needed for the limit events in section 4); the adapter reads the final `result` message and the `rate_limit_event`s.
- `--effort` **(call: `low`, the cheapest that holds quality on the golden set; the builder runs the eval at `low` first and raises it only if the bar fails)**.

Before the switch, the builder proves isolation with a test call whose posting asks the model to read a file or run a command, and confirms the call has no tool to do it with.

**Timeouts.** The adapter kills a call that runs longer than `PROCESSOR_CALL_TIMEOUT_MS` **(call: 180,000)** and reports it as transient.

**What each attempt records.** Input, output and cached tokens and latency, from the result's `usage`, as today. `costUsd` is the result's `total_cost_usd`. On the subscription it is Claude Code's estimate of what the call would cost on the API, not money spent; it stays useful for comparing prompts in slice 03 and becomes real spend after the API switch. `providerRequestId` is the session ID.

**Errors** map to the existing classes:

| `claude -p` result                                                                | Class                             |
| --------------------------------------------------------------------------------- | --------------------------------- |
| Usage limit reached (session, weekly, or model-family)                            | new `UsageLimitError` (section 4) |
| Auth failure: token missing, expired or revoked                                   | `ProviderUnavailableError`        |
| 429 not tied to a usage limit, 529 overloaded, 5xx, timeout, the process crashing | `TransientModelError`             |
| Other 4xx (a bad request)                                                         | `ModelRequestError`               |
| No `structured_output`, or output failing the schema                              | `ModelOutputError`                |

The adapter distinguishes them from the structured fields (`is_error`, `api_error_status`, `rate_limit_event`), never by parsing message text, except where the docs give no field; the builder confirms each case against the installed version and pins the tests to it.

## 3. Credentials

- **Now: the user's subscription.** The user runs `claude setup-token` once and puts the token in the server's `/home/deploy/engine/.env` as `CLAUDE_CODE_OAUTH_TOKEN`, the same way the other runtime secrets are set (engine hosting spec: runtime secrets live only on the server, CI never sees them). The token lasts one year.
- **Later: an API key.** Setting `ANTHROPIC_API_KEY` in the same `.env` (and removing the token) moves the engine to the API with no code change; `claude -p` uses the key when present. Max plans include some monthly API credits since October 2026, which may cover part of the cost.
- The worker passes only the credential variables the call needs to the child process, plus `PATH` and the empty `HOME`; the rest of the engine's environment (database URL, Supabase service key, Apify token) is not passed **(call)**.
- The API container does not run the processor in production and gets neither credential, as it does today with `OPENROUTER_API_KEY` (`deploy/engine/compose.yaml`).
- **When the token expires or is revoked**, calls fail with an auth error. That is `ProviderUnavailableError`: the job goes back to `pending` with its attempt given back, the processor pauses for 10 minutes, and logs one error naming the fix: run `claude setup-token`, replace the value in the server `.env`, and restart the worker. `GET /processor/status` shows the pause and its reason. The runbook gets this procedure and a calendar note for the expiry date.

**Startup check.** Replaces the OpenRouter checks. Before any worker starts, the processor checks that `claude` is on the path at the pinned version and that a credential is set, and makes one tiny `claude -p` call with the same flags. **A failed check never stops the worker** **(call)**: under `worker-all`, collection, ingest and match start as usual, and the processor starts paused with the reason logged at `error` and shown in `GET /processor/status`. It re-runs the check every 10 minutes and starts claiming once it passes. (Today a failed OpenRouter check stops the whole worker; with `restart: unless-stopped` an expired token would then crash-loop the container and stop collection.) A missing `claude` binary or a wrong pinned version is a build error, not a credential problem, and still stops startup. A usage limit at startup pauses until its reset (section 4). `processor:smoke` runs the same check plus one real extraction.

**When the processor runs.** Today `worker-all` runs the processor only when `OPENROUTER_API_KEY` is set. It now runs it when `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` is set; without either, it warns `processor not started` as today. `WORKER_ROLE=processor` needs one of them.

## 4. Usage limits and the guard

A subscription has a 5-hour session window and a weekly limit, shared with the user's own Claude use. Anthropic publishes no numbers for them. A 2,000-job batch will likely reach one of them.

**Reaching a limit.** When a call ends on a usage limit, the adapter throws `UsageLimitError` with the reset time (`resetsAt` from the `rate_limit_event`). Then:

- The job goes back to `pending`, its error set, with its attempt given back. It is not failed _(user)_.
- `ProcessorGuard` pauses processor-wide until the reset time: no claims, and the sweep stops enqueueing, as the provider pause does today. One log line at `warn`: which limit, and when it resets.
- Calls already in flight finish or hit the same limit; each such job is handled the same way.
- If the reset time is missing, the pause is 15 minutes, then the next call finds out again **(call)**.

**The 85% weekly reserve** _(user)_. The adapter reads every `rate_limit_event`. When one reports a weekly limit's utilization at or above `PROCESSOR_WEEKLY_STOP_AT` (default `0.85`), the guard pauses until that weekly limit's reset time, the same way. This applies to every weekly limit the engine's calls draw on, the all-models one and the Sonnet one, whichever reaches 85% first **(call)**; the guard keeps the latest pause end. The job that saw it is finished normally, since its call succeeded. The 5-hour window has no reserve: processing may use all of it, then waits for its reset _(user: "can go 100%")_. During a batch the user may be locked out of their own Claude until each 5-hour reset; that is accepted. On an API key there is no weekly limit and the reserve never triggers.

Risk for the builder: the docs show `rate_limit_event` with `status`, `resetsAt` and `utilization` but don't say clearly which limit (session or weekly) an event describes. The builder confirms on a real call. If the weekly utilization can't be told apart, the fallback is the `You've used N% of your weekly limit` warning the CLI also documents; if neither is readable, stop and ask the user before building something else.

**The pause lives in the process**, as today's does. A restart (a deploy) forgets it; the first call after the restart reaches the limit again and re-pauses, costing one call **(call)**.

**The dollar budget stays.** `PROCESSOR_DAILY_BUDGET_USD` keeps capping the summed `costUsd` per UTC day. On the subscription the cost is an estimate and the default is raised so it never blocks before the usage limits do **(call: default 0 meaning "no cap", and the runbook says to set a real cap before the API switch)**. After the switch it is the guard against a runaway bill: at about $0.06 per job on Sonnet 5.5 list prices, 2,000 jobs a day is about $125 a day.

**Concurrency.** `PROCESSOR_CONCURRENCY` keeps its default of 4 **(call)**. Each call is a Node process; the builder checks the worker's memory on the Hetzner box with 4 running and lowers the default if it doesn't fit. At 30–60 s per call, a 2,000-job batch takes roughly 4–8 hours when limits allow.

`GET /processor/status` reports: in-scope jobs per status (including `archived`), today's estimated cost, the model, whether the processor is paused, why (limit kind, weekly reserve, auth) and until when, and the last weekly utilization seen.

## 5. Hosting

- **Claude Code in the engine image.** `apps/xjobs/Dockerfile` installs Claude Code at an exact pinned version **(call: through npm, `@anthropic-ai/claude-code@<version>`)**. The image is `node:24-alpine`; the builder confirms that version runs on Alpine (musl) and switches the base image to a Debian slim one if not. Upgrading Claude Code is a deliberate version bump in the Dockerfile, never automatic; its auto-updater is disabled in the container.
- `deploy/engine/.env.example` replaces `OPENROUTER_API_KEY` with `CLAUDE_CODE_OAUTH_TOKEN` (and a commented `ANTHROPIC_API_KEY`), and adds `PROCESSOR_WEEKLY_STOP_AT`. The compose file's `unset OPENROUTER_API_KEY` on the API becomes `unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY`.
- The worker container needs a writable directory for the empty per-call `HOME` and working directories (a `tmpfs` or the container's own temp directory).
- The engine runbook (`deploy/engine/`) gets: setting the token, the expiry renewal, reading the pause in the logs and status, and the API-key switch with its gate (anti-goals).

The user does the server-side steps (writing the token into the server `.env`, restarting), because Claude has no SSH to the engine. The builder writes the changes and the runbook, and verifies everything that doesn't need the server.

## 6. Archiving the old jobs

All 4,048 normalized jobs on `10xjobs-dev` come only from `cheap_scraper/linkedin-job-scraper` batches (231 batches, 2026-11-09 to 10): 3,988 `pending` and 60 `processed`. No harvestapi batch has been ingested yet. All 4,048 are archived _(user)_.

- **A new processing status, `archived`.** The check constraint on `normalized_jobs.processingStatus` (`libs/database/src/contract/contract.prisma`) and the `ProcessingStatus` types in ingest and the processor gain it. Only the archive script sets it.
- **A one-off script**, `pnpm --filter @xjobs/xjobs db:archive-actor -- --actor cheap_scraper/linkedin-job-scraper` **(call: by actor, so it states what it archives and can't catch harvestapi jobs)**. It archives every normalized job all of whose sources were seen only in that actor's batches, whatever its current status, clears `processingError` and leaves `currentExtractionId` and the extractions as history. It prints counts before and after, has a `--dry-run`, and refuses a remote database unless `XJOBS_ALLOW_REMOTE_DB=1`, like the other `db:*` scripts. Running it twice changes nothing.
- **The processor never touches an archived job.** `claim`, the sweeper and the in-scope lists exclude it. `db:reprocess` skips it under every selector, `--all-in-scope` and `--job <id>` included, and says how many it skipped.
- **Matching.** The script deletes the archived jobs' `job_matches` rows (60 today, all the user's, with no `match_reviews`). The matcher skips archived jobs, so `db:rematch -- --all` can't bring them back. The matches view shows nothing for them because no match row exists **(call: deleting the derived rows is simpler than filtering them out of every read)**.
- **A new sighting un-archives.** cheap_scraper no longer runs, so any later sighting of an archived job comes from harvestapi, which is the data the user wants processed. Ingest sends an archived job to `pending` (reason `reopened`) on any new observation, not only after `reopenAfterMs` **(call; it guards the "missing the right jobs" anti-goal)**. Its old cheap_scraper sources stay attached and the merge runs as today **(call)**: within the LinkedIn job board channel the most recently seen source wins each field, so the new harvestapi values take over wherever harvestapi states them. Old values remain only for fields harvestapi leaves empty.

**Order of the switch:** merge, run the archive script on dev, then set the token and deploy. The processor must never start on Claude with those jobs pending _(user)_.

## 7. Tests and eval

- **Unit tests** keep the in-memory fakes at the `ExtractionModel` seam (`testing/fakes.ts`); the verifier fakes go. The `claude -p` adapter gets its own tests against a fake `claude` executable (a small script on `PATH` that replays recorded `stream-json` output), covering success, schema failure, a missing `structured_output`, each error row in section 2, a usage limit with `resetsAt`, a weekly-utilization event at 0.85, a timeout, and the exact flags and environment passed to the child.
- **The guard and failure policy** get tests for the usage-limit pause, the weekly reserve, attempts given back, and the in-flight case.
- **e2e** runs the worker with the fake executable; no e2e test calls the real `claude`.
- **The archive** gets Postgres tests (the `processor_test` recipe): who gets archived, idempotence, `db:reprocess` skipping, the matcher skipping, and a new sighting un-archiving.
- **`processor:eval`** loses its verifier options and scores the generator alone. Before the switch, it runs once on Sonnet 5.5 through `claude -p` against the golden set, as a sanity check **(call)**. No DeepSeek report is saved, and the old runs used the verifier, so there is no baseline to beat. The run is scored against `BARS` in `golden/score.ts` as they are. The scores and cost per job are written into the PR. A failed bar does not block the switch on its own: the builder reports which bars failed and by how much, and the user decides. This is a check, not a model choice. It never runs in CI.

## 8. Docs to update

- `CLAUDE.md`: the stack line ("LLMs are called from the engine through OpenRouter…") becomes `claude -p`; the `worker-all` and `worker-processor` lines name the new credential; add `db:archive-actor`.
- `apps/xjobs/src/modules/processor/README.md`: flow, models, cost, verification and Jev sections.
- `docs/roadmap/phase-3-find-quality/02b-claude-models.md` and slice 03's prerequisites: the reprocess of the 60 is replaced by the archive; the first Claude batch is harvestapi's, once Apify has credit again. The roadmap README records the API-key gate before inviting anyone.
- `.env.example` (root and `deploy/engine/`).

## Done when

- `claude -p` runs on the hosted engine and processes a harvestapi batch end to end, through to matching (needs Apify credit; until then, a hand-run `POST /processor/jobs/:jobId/run` locally on one job proves the call).
- OpenRouter, Jev and their SDKs are gone from the engine and its dependencies.
- A usage limit pauses the processor until its reset with no job failed and no attempt lost; reaching 85% of the weekly limit does the same.
- The isolation test call shows no tool, file or setting reachable.
- All 4,048 cheap_scraper jobs are `archived` on dev, their matches are gone, and no processor run, reprocess or rematch touches them.
- The Sonnet 5.5 golden-set run is recorded in the PR, with any failed bars reported to the user.
- CI is green.

## What's left to the builder

- The exact `claude -p` flag set that achieves the isolation in section 2 on the pinned version, and the lowest `--max-turns` that works with `--json-schema`.
- How the error and limit cases are detected from the structured output, confirmed against the installed version.
- Whether `decisionModel` is dropped or nulled (section 1).
- Alpine or Debian slim for the image.
- Splitting the work into PRs (for example: archive first, then the Claude adapter and removal of OpenRouter, then hosting and docs).
