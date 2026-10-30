# Hourly channel collection

Status: proposed design for review; no collection implementation or live actor execution yet.

Builder review: an independent backend reviewer found no important unanswered questions preventing implementation planning. Product defaults below remain proposed until approved.

## Intent and agreed constraints

Reuse the collection behavior in the sibling `career-hub` project inside xjobs. Run each of the four existing channels hourly. Keep channel configuration in `apps/xjobs/src/modules/channels/config/index.ts`. Give each channel its own Nest provider, and put every Apify operation and Chromium extraction operation in a separate provider file.

The user requested analysis and then asked to cover persistence, cursors, concurrency, Apify retries, budgets, extraction retries, and recovery windows. The decisions below are proposed engineering defaults, not additional user requirements.

## Existing code and approaches

- xjobs has BullMQ 5, a standalone worker, Redis connection management, and a ping processor. The worker currently validates Redis settings only.
- `QuerySearchBuilder` stores immutable workspace-scoped channel recipes. Its unique key is `(workspaceId, hash)`. A recipe can contain multiple keyword searches. There are no collected-job or collection-state models yet.
- career-hub's `src/collect/run.ts` coordinates collection, budgets, normalization, deduplication, persistence, and reporting. `src/collect/store.ts` derives a source cursor from successful, uncapped runs. Its current cursor does not exclude every truncated run; we will track completeness explicitly.
- career-hub's LinkedIn collectors use Apify actors. Ashby and Greenhouse use Google Search on Apify for discovery, then direct HTTP APIs for posting details. Existing Chromium code is for application forms and PDF rendering, not collection.
- Its scheduled shell workflow starts a headless Claude process. That process and the SQLite persistence are not portable orchestration for this service.

Approaches considered:

1. BullMQ hourly triggers plus PostgreSQL durable collection state: fits the existing stack and supports worker replicas and recovery. Recommended and developed here following the user's request to proceed.
2. Nest in-process cron: simpler timer registration, but still needs distributed locking, durable retries, and recovery. Adds another scheduling mechanism without replacing BullMQ.
3. Port the shell/Claude scheduler: preserves the desktop workflow but does not fit a workspace-scoped Nest service.

## Module and provider boundaries

```text
modules/channels/
  channels.module.ts
  config/index.ts
  providers/channels/
    linkedin-job-board.provider.ts
    linkedin-posts.provider.ts
    ashby.provider.ts
    greenhouse.provider.ts
  providers/apify/
    apify-client.provider.ts
    linkedin-jobs-search.provider.ts
    linkedin-posts-search.provider.ts
    google-search.provider.ts
  providers/extraction/
    ashby-posting.provider.ts
    greenhouse-posting.provider.ts
    chromium-job-extraction.provider.ts
  providers/browser/chromium.provider.ts
  services/
    channels-scheduler.service.ts
    channels-runner.service.ts
    collection-recovery.service.ts
    collection-budget.service.ts
  processors/channels.processor.ts
  repositories/
  normalizers/
  types/
```

Channel providers coordinate source-specific steps through a common typed contract. A registry maps every `Channel` enum value to exactly one provider and fails startup on missing/duplicate registrations. They do not own schedules, database transactions, or browser lifecycle.

Operation providers own actor inputs, response validation, URL parsing, and source-specific extraction. Shared Apify transport owns start/status/dataset access; shared Chromium transport owns browser lifecycle and bounded contexts. Splitting files means one coherent operation per provider, not one file per low-level HTTP method. Pure normalizers remain ordinary functions.

Retain Ashby GraphQL and Greenhouse Job Board API extraction. Chromium is a separately injected fallback for a supported posting page when an API cannot supply it, not the default for every source. A browser failure or challenge is recorded, never silently treated as an empty posting. Its initial supported domains are Ashby and Greenhouse; arbitrary external URLs from posts remain recorded links until another extractor is deliberately added. Do not browse application forms or submit anything.

The initial phase collects raw posts and job details. LLM role splitting, qualification, ranking, applications, and career-hub's Claude prompt pipeline are outside this collection design. Posts remain distinct records and may link to canonical postings; they are not automatically treated as one job per post.

## Configuration

`modules/channels/config/index.ts` exports a validated, typed configuration keyed exhaustively by `Channel`. Schedule, windows, actor IDs, limits, retries, and extraction policy live here. Secrets remain environment inputs; root environment validation only validates those inputs.

Proposed defaults:

- All four channel schedules: `0 * * * *`, timezone `UTC`, one trigger at the beginning of each hour.
- Channel enable flags: enabled in configuration; missing required credentials fail worker startup rather than silently skipping enabled channels.
- Initial lookback: 24 hours; overlap: 15 minutes; maximum automatic recovery age: 7 days. These are separate from cadence.
- Maximum window per discovery operation: 24 hours. Catch-up progresses through contiguous windows rather than jumping directly to now.
- At most 10 executable searches per actor operation, reduced further by actor input constraints. Deterministic batching groups only searches with compatible windows/options.
- One active discovery operation per `(workspace, channel)`, with a bounded global worker pool. Extraction concurrency and host rate limits are configured separately.
- Actor identities initially match career-hub: `bebity/linkedin-jobs-scraper`, `harvestapi/linkedin-post-search`, and `apify/google-search-scraper`. Actor contracts and installed SDK behavior must be verified during implementation before live use.
- Budget settings: global monthly, per-channel monthly, and per-operation maximum. Initial proposed caps preserve career-hub: $80 global; LinkedIn board $60/month and $1/operation; posts $30/month and $0.75/operation; Ashby and Greenhouse each $5/month and $0.50/operation. These are upper limits, not estimated prices. Hourly triggers may produce budget skips; they do not guarantee a paid run every hour. Global and channel caps apply across workspaces sharing the credential.
- Provider retries: up to 3 attempts with bounded exponential backoff and Retry-After support; Apify start requests with uncertain outcomes are excluded from blind retry.

## Durable data model

All domain records carry `workspaceId`. References must enforce workspace consistency through composite keys/FKs or equivalent constraints. Global credential-budget records are infrastructure records and do not contain job content. Persist timestamps in UTC and money as integer micro-USD, avoiding floating-point budget arithmetic.

| Model                | Purpose and essential constraints                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CollectionQueryState | One row per executable search derived from a recipe: workspace, recipe ID, adapter version, deterministic search key, enabled flag, coveredUntil, nextAttemptAt, last success/error. Unique `(workspaceId, recipeId, adapterVersion, searchKey)`. Multiple keyword searches cannot share a cursor until all are complete. |
| CollectionRun        | One workspace/channel batch and fixed input/window snapshot: id, channel, scheduled hour, status, started/finished times, counters, error code. Run membership references query states and records individual outcomes.                                                                                                   |
| CollectionOperation  | Durable external operation: run ID, operation key, actor/provider, input snapshot/hash, state, Apify run/dataset IDs, cost, reservation, lease owner/expiry/generation, retry time. Unique operation key prevents duplicate logical starts.                                                                               |
| CollectionRunQuery   | Per-run search membership, window bounds, completeness, truncation and counts; unique `(runId, queryStateId)`. Needed for independent cursor advancement and attribution.                                                                                                                                                 |
| CollectedItem        | Workspace-local source record: channel, external ID, kind (`job` or `post`), canonical URL, raw payload, normalized fields, first/last seen, status. Unique `(workspaceId, channel, externalId)`. Never discard posts because titles/company strings match.                                                               |
| CanonicalPosting     | Workspace-local ATS identity and shared posting details. Unique `(workspaceId, provider, externalKey)`; Greenhouse key includes board and job ID, Ashby key includes organization and posting ID. Multiple source items can refer to one posting.                                                                         |
| CollectionHit        | Observed source item/candidate, query state, run, source rank, and observed URL. Durable even before extraction completes; unique identity makes replay safe.                                                                                                                                                             |
| ExtractionTask       | Source candidate or canonical posting, extractor/version, input revision, pending/running/retry/succeeded/closed/exhausted state, attempt count, nextAttemptAt, lease generation, error. Unique task identity prevents duplicated extraction.                                                                             |
| BudgetBucket         | Credential scope, UTC month, scope (`global` or channel), limit, reserved and settled micro-USD. Unique scope/month key.                                                                                                                                                                                                  |
| BudgetReservation    | Operation, original month, reserved amount, settled amount, state. One per paid operation; updates are idempotent.                                                                                                                                                                                                        |
| CollectionLease      | Workspace/channel ownership with expiry and monotonically increasing fencing generation; unique `(workspaceId, channel)`.                                                                                                                                                                                                 |
| QueueOutbox          | Durable work intent created in the same transaction as runs/tasks; deduplication key, payload IDs, delivery state.                                                                                                                                                                                                        |
| CollectionGap        | Explicit skipped historical interval/reason when downtime exceeds configured automatic recovery age.                                                                                                                                                                                                                      |

Do not impose company/title deduplication as a unique constraint: different openings can have the same title. Use those keys for diagnostic similarity only. Preserve every source observation and attach exact ATS matches to one canonical posting within the workspace. No cross-workspace content sharing in this phase.

## Scheduling and queue delivery

Register four stable BullMQ hourly scheduler identities. Every worker replica may reconcile the same definitions idempotently. Disabled channels have their schedules removed and reject new dispatch work; an already accepted external run is reconciled and costed to completion.

Use dedicated channel-discovery and extraction queues so expensive page work does not block scheduling or the infrastructure ping queue. Queue payloads contain versioned IDs, not complete raw descriptions or secrets.

Each hourly tick scans enabled query states fairly in bounded pages, ordered by oldest coverage/next due time with workspace rotation. Existing saved recipes are eligible by default. New recipes get states on the next scan; immutable old recipes remain eligible until explicitly disabled. Adapter version changes create new search states rather than reusing incompatible cursors. There is no new profile-subscription model in this phase.

The dispatcher records a deterministic run/batch and outbox work in one PostgreSQL transaction. Concurrent dispatchers use uniqueness and row locking so only one logical batch wins. An outbox relay retries delivery after Redis outages. Delivery before marking the outbox sent can enqueue twice; stable queue IDs and idempotent database claims make this harmless.

Recovery scans run on startup and every minute, configured in the same config file. They deliver pending outbox rows, reclaim expired leases, reconcile external operations, and enqueue due extraction retries. This internal recovery interval does not change the hourly discovery cadence. Queue records are delivery mechanisms; deleting/losing Redis data must not lose PostgreSQL work state.

## Cursors and completeness

At dispatch, freeze `until` and the search input. A new state begins at `now - initialLookback`. Otherwise the next uncovered interval starts at `coveredUntil`; the request also includes the overlap before that point. Bound the interval to one configured maximum window, and retain the original `until` through retries.

Successful discovery means all relevant dataset pages were persisted, query attribution was validated, and durable extraction tasks exist. Advance that search's `coveredUntil` to the frozen `until` in the same transaction. An extraction failure then does not force another paid discovery run. Zero results from a complete, valid response is success; invalid output, actor failure, cap exhaustion, unknown attribution, and truncation are not.

Actor inputs must preserve attribution from emitted search URL/query to all originating recipe/search-state IDs. Identical rendered searches inside a compatible batch can be executed once and attributed to each owner. Only batch searches when the actor provides sufficient attribution/completeness evidence; otherwise use individual operations. Unknown attribution is a protocol error, not a zero-result search.

On truncation, keep partial observations and do not advance affected cursors. Retry with a smaller time interval when the provider can express it, or pagination/row-limit changes within budget. If minimum supported granularity still truncates, mark the search blocked with a visible reason instead of repeatedly charging each hour. Provider result contracts explicitly report supported date precision and completeness; do not claim exact historical coverage for relative-only filters. LinkedIn/Google historical catch-up may over-fetch because filters are relative; freeze logical coverage and deduplicate, and report any provider limitation that prevents a complete slice.

After downtime within seven days, process oldest uncovered windows first. Beyond seven days, record a CollectionGap, start automatic recovery at the configured boundary, and expose the gap for deliberate backfill. Never silently label the skipped interval covered. Manual backfill uses separate runs and does not move the normal cursor unless it proves contiguous coverage.

## Distributed overlap prevention

Queue job IDs alone are insufficient: retries, different hourly jobs, and replicas can overlap. Acquire the workspace/channel database lease before discovery dispatch/execution and renew while active. Claim query rows atomically. Persist and check the lease generation on state transitions so a stale worker cannot overwrite a replacement worker's results or cursor.

On lease loss, stop starting new external work. A replacement must reconcile any persisted `starting`/`running` operation before starting another. Do not hold a PostgreSQL transaction open during network calls. Extraction has its own per-task fenced lease, and host concurrency is enforced across replicas rather than only with an in-process semaphore.

## Apify operation state and retry safety

Transitions: `planned → reserved → starting → running → ingesting → succeeded/failed`, with explicit `start_unknown` and `reconcile_pending` states.

1. Persist operation/input and atomically reserve its maximum charge before a start request.
2. Persist `starting` before calling Apify. Disable blind transport retry on the paid start call unless verified provider idempotency guarantees support it.
3. As soon as an actor start response arrives, persist its external run ID. Subsequent attempts poll that run; they never launch a replacement just because polling or dataset ingestion failed.
4. Persist dataset identity and ingest every page with durable checkpoints and idempotent upserts. Replaying a page does not duplicate jobs or hits.
5. Reconcile terminal status and actual cost separately from data ingestion. A failed/timed-out actor can still have incurred charges and usable partial results.
6. If a start response is lost or a process dies between remote acceptance and local persistence, mark the operation `start_unknown`. Keep the reservation. Reconcile using provider evidence only where a unique match can be proven. Otherwise require operator resolution with the remote run ID or verified non-start; do not silently create another charged run or release its reservation.

Exactly-once external actor execution cannot be promised without a verified remote idempotency mechanism. This design prefers a visible uncertain operation over duplicate spend. An intentional replacement of a failed remote run is a new operation with a new reservation and explicit retry lineage.

## Atomic budget enforcement

Create/lock the global and channel bucket rows in a consistent order in one transaction. Authorize only if `settled + reserved + operationMaximum <= limit` in both buckets. Insert the unique operation reservation and increment both reserved totals atomically. Concurrent channels/workspaces cannot independently spend the same remaining balance.

When final billing is known, atomically subtract the reservation and add actual cost exactly once to both buckets. Charges belong to the operation's original UTC month, including reconciliation after month rollover. Late higher costs apply an idempotent delta and block future work if they exceed a limit; never hide actual overage. An absent/unsettled cost retains conservative reservation rather than assuming zero. Known zero-cost non-starts can release it.

Budget exhaustion records a skipped reason and next eligible time; it does not advance cursors or mark searches successful. Fair workspace rotation avoids one workspace consuming every permitted batch first, though configurable per-workspace budgets are outside this first phase.

## Extraction, retries, and Chromium

Discovery persists candidates and extraction tasks atomically. An outbox relay schedules extraction separately. Direct API extraction records open/closed/failed distinctly; timeouts, 429s, and 5xx are retryable, malformed input is terminal, and verified missing/closed postings are successful terminal outcomes. Retry-After and per-host cooldown apply across replicas. Exhausted tasks retain data and errors for deliberate replay without rerunning discovery.

Chromium receives a supported normalized target, uses an isolated context per task, bounds navigation/body/execution time and concurrency, and always closes contexts. Block local/private-network targets and validate redirects for extracted links. Return structured job facts and source evidence, not arbitrary full browser state. No cookies or credentials from application sessions are reused. Browser lifecycle cleanup is part of worker shutdown.

Upserts store extractor version and input revision; retries cannot overwrite newer extraction results. A new relevant source revision can create another task. Closed postings remain stored with history rather than being deleted.

## Worker integration and operational visibility

Extend worker environment validation with database and enabled-provider credentials. Import DatabaseModule and the channel execution module into WorkerModule without pulling in the HTTP AppModule or requiring API Basic Auth/storage credentials. Check database, Redis, and required browser availability before advertising worker readiness. Drain workers before closing browser/database connections.

Expose structured logs and durable run summaries for queued/running/succeeded/partial/failed/skipped/blocked outcomes, query counts, cursors, recovery gaps, extraction backlog, truncation, actor IDs, cost/reservations, and uncertain starts. IDs and error codes belong in logs; tokens and raw descriptions do not. Initial operational inspection can use database-backed tooling; a new dashboard is not required.

## Verification required for implementation

- Registry/config coverage for all four channels and hourly schedule definitions.
- Two replicas dispatching the same tick create one logical run; expired lease holders cannot commit.
- PostgreSQL concurrent reservation tests prove global and channel budgets cannot be oversubscribed.
- Recovery at every durable boundary: before queue delivery, after delivery, after remote start, during dataset pages, and after persistence before acknowledgement.
- Known Apify run resumes without another start; unknown starts keep their reservation and do not auto-restart.
- Per-search zero-result, partial, capped, malformed, and truncated outcomes advance only eligible cursors.
- New queries, multi-keyword recipes, adapter-version changes, overlap, downtime, and explicit recovery gaps.
- Extraction failures retry independently; closed jobs and exhausted retries remain distinct.
- Workspace constraints, idempotent source/ATS upserts, and preserving all query attribution.
- Browser extraction fixture checks for cleanup, unsupported targets, redirects, and timeout handling.
- Worker startup/shutdown and Redis outage smoke tests. Use local fakes/fixtures for normal tests; paid actor runs are separate operational validation.

## Implementation sequence and remaining review

1. Add durable models/migrations, configuration, and provider contracts.
2. Implement atomic claims, budget reservations, outbox delivery, and recovery.
3. Add Apify operation providers and dataset normalization using career-hub fixtures.
4. Add the four channel providers, direct posting extraction, and bounded Chromium fallback.
5. Wire hourly schedules, worker dependencies, visibility, and failure-path integration tests.

The builder may choose exact field names, helper boundaries, queue names, and SQL details while preserving these invariants. Verify actual BullMQ/Apify APIs against installed types and official documentation during implementation. Main product defaults to review are 24-hour initial lookback, seven-day automatic recovery, inherited spending caps, saved-query eligibility until explicitly disabled, and Chromium as a supported-domain fallback.
