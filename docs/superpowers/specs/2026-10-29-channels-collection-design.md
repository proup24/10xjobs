# Hourly channel collection

Status: revised 2026-10-30 for review. The searches now come from workspace query recipes, not hardcoded configuration. No collection implementation or live actor execution yet.

## Revision 2026-10-30: dynamic searches

The first draft carried career-hub's personal search content into `channels/config/index.ts`: keywords, locations, posts queries, Google terms and suffixes, and `titleExcludes`. That made every workspace search for one person's profile. The user profile and the queries module already exist to make searches dynamic, so this revision moves all search content into the query builders.

User decisions in this revision:

- Search content, including exclusions, comes from the query builders. Channel configuration keeps only operational settings.
- Ashby and Greenhouse discover jobs the way career-hub does: Google `site:` search on Apify, then the posting from the Ashby or Greenhouse API.
- There are no post-fetch filters. Collection fetches through the provider collectors, ported from career-hub, using Apify actors, and stores everything it gets. A later matching algorithm decides which stored jobs fit the user.

## Intent and agreed constraints

Reuse the collection behavior in the sibling `career-hub` project inside xjobs. Port each channel's collector from `../career-hub/src/collect/{linkedin-jobs,linkedin-posts,google,ashby,greenhouse}` and its Apify runner (`apify.ts`). Run each of the four existing channels hourly. Every search a provider runs comes from the workspace's stored query recipes (`QuerySearchBuilder` rows, passed to the provider as `ChannelSearch`). Configuration in `apps/xjobs/src/modules/channels/config/index.ts` holds operational settings only. Give each channel its own Nest provider, and put every Apify operation and Chromium extraction operation in a separate provider file.

Collection narrows results only at search time, through the inputs the recipe puts into the actor. It never drops a fetched item because of its title, company, location, or content. Matching, qualification, and ranking are a separate later design (my call: out of scope here, because the user asked to proceed without designing it).

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

## Searches come from query recipes

The queries module turns a user profile into combinations, and one builder per channel (`modules/queries/channels/*.builder.ts`) turns each combination into `{ keywords, params }`. These are stored as immutable, workspace-scoped `QuerySearchBuilder` rows. A channel provider receives one row as a `ChannelSearch` and renders it into actor input. It adds only the time window and the operational limits from config. The provider never invents keywords, locations, or exclusions.

Builder changes required. The recipe version becomes per channel (`QUERY_SEARCH_RECIPE_VERSIONS: Record<Channel, number>`, my call), so this change bumps only Ashby and Greenhouse and LinkedIn recipes keep their hashes and cursors:

| Channel            | Builder output after this change                                                                                                                                                                                                                                                                                                                                                  | Provider renders it as (ported from career-hub)                                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LinkedIn job board | Unchanged: `keywords`, `params.location`, optional `experienceLevel` (`f_E`) and `workType` (`f_WT`).                                                                                                                                                                                                                                                                             | One search URL per keyword (`linkedin-jobs/urls.ts`): `keywords`, `location`, filter codes, `sortBy=DD`, `f_TPR=r<seconds>` from the window. Actor `bebity/linkedin-jobs-scraper` with `maxRowsPerUrl` from config.                                 |
| LinkedIn posts     | Unchanged: `hiring …` keywords and `params.location`.                                                                                                                                                                                                                                                                                                                             | `searchQueries` for `harvestapi/linkedin-post-search`, `maxPostsPerQuery` and the window from config.                                                                                                                                               |
| Ashby              | Replaces `{ locationTerms, remote }` with the Google query parts (see "Ashby and Greenhouse search terms" below): short `keywords`, `params.site = 'jobs.ashbyhq.com'`, and `params.suffix` holding the title operators, exclusions, and location term. | `site:<site> "<keyword>" <suffix>` per keyword (`google/discover.ts` `googleQueries`), one `apify/google-search-scraper` run with `quickDateRange` from the window and `maxPagesPerQuery` from config. Each hit's posting comes from the Ashby API. |
| Greenhouse         | The same shape as Ashby with `params.site = 'greenhouse.io'`.                                                                                                                                                                                                                                                                                                                     | The same Google discovery, then the Greenhouse Job Board API.                                                                                                                                                                                       |

### Ashby and Greenhouse search terms

Google quotes each keyword as an exact phrase, so the long LinkedIn-style phrases (`senior fullstack engineer typescript react`) would match almost nothing. These two builders emit short terms instead, the way career-hub did (`"full stack"`, `"typescript"`):

- `keywords`: each title phrase of the position (`POSITION_TITLES`) and each technology term (`TECHNOLOGY_TERMS`) as separate entries, deduplicated. Seniority is not a keyword.
- `suffix` include operators: title words that fit the position, OR-ed (`(intitle:engineer OR intitle:developer)` for engineering roles; the position's own words such as `devops`, `sre`, `architect`, or `manager` where those are the role). A position is never excluded by its own include list.
- `suffix` exclusions: `-intitle:` words that contradict the combination. `intern` and `junior` are excluded for senior and above; `manager` and `director` are excluded only when the position is not a management role. Nothing is excluded for `unstated` seniority.
- `suffix` location term: `"remote"` for remote work. For onsite or hybrid, the quoted city, else the English country name (the stored country is an ISO code; convert with `Intl.DisplayNames`). Nothing for unstated arrangement.

The exact word tables per position and seniority are left to the builder. They must be unit-tested so every `Position` has a non-empty include list and is not matched by its own exclusions.

`jobBoardFilterQuery` and its "filtered after fetching" contract are removed. Nothing consumes `locationTerms` or `remote`.

Exclusions live in the builders only where the source can express them in the search itself (Google `-intitle:` operators). career-hub's LinkedIn `extraTitleExclude` was a post-fetch criteria filter (`criteria/compile.ts`), and LinkedIn's search URL has no title-exclude parameter, so it is dropped (my call). The builder may add a LinkedIn `NOT` keyword term later, but that is not part of this change.

Which recipes run (user decision): only the workspace's **active** recipes. A recipe is active when it was produced by the workspace's currently published profile(s).

- `QuerySearchBuilder` gains `retiredAt` (nullable). Active means `retiredAt IS NULL` and `version` equals the channel's current version.
- On publish, the queries service regenerates the workspace's set from every published profile in the workspace. Rows in the new set are inserted or un-retired; every other active row in the workspace gets `retiredAt = now`. It runs in one transaction.
- On unpublish, the same regeneration runs without that profile. If no published profile remains, every row is retired.
- Retired rows are never deleted, so collected items stay traceable to the search that found them. Their collection states stop being scanned. If a recipe becomes active again, it resumes from its old cursor.
- On deploy, a one-off backfill regenerates the active set for every workspace with a published profile, so a version bump never requires users to republish (my call).
- A workspace with no active recipes for a channel records a skipped outcome with reason `no_recipes`, not an error.

### Spending stays inside the caps

A modest profile can produce about 60 searches per channel per tick, far more than career-hub's 4–24 fixed searches. Running all of them every hour would exhaust the monthly caps within days. Decision: ticks stay hourly, and each channel config gains `maximumSearchesPerTick` (per workspace). A tick selects due searches in order: oldest `coveredUntil` first, then broader recipes first (fewer technologies), then by recipe ID. Unselected searches keep their cursor and are picked up by later ticks through normal window catch-up. Initial values are proposed from the caps so that a full month of ticks fits the per-channel monthly budget at the per-operation maximum. The builder computes and records them in config with the arithmetic in a comment.

## Configuration

`modules/channels/config/index.ts` exports a validated, typed configuration keyed exhaustively by `Channel`. It holds only how to run: enable flag, schedule, windows, actor IDs, page and row caps (`maxRowsPerUrl`, `maxPostsPerQuery`, `maxPagesPerQuery`), link and posting fetch policy, retries, and budgets. It holds no search content. `discovery.keywords`, `locations`, `queries`, `terms`, `site`, `suffix`, and `titleExcludes` are removed. Secrets remain environment inputs; root environment validation only validates those inputs.

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
| CollectionQueryState | One row per executable search derived from a recipe: workspace, recipe ID, adapter version, deterministic search key, coveredUntil, nextAttemptAt, last success/error. Unique `(workspaceId, recipeId, adapterVersion, searchKey)`. Multiple keyword searches cannot share a cursor until all are complete. |
| CollectionRun        | One workspace/channel batch and fixed input/window snapshot: id, channel, scheduled hour, status, started/finished times, counters, error code. Run membership references query states and records individual outcomes.                                                                                                   |
| CollectionOperation  | Durable external operation: run ID, operation key, actor/provider, input snapshot/hash, state, Apify run/dataset IDs, cost, reservation, lease owner/expiry/generation, retry time. Unique operation key prevents duplicate logical starts.                                                                               |
| CollectionRunQuery   | Per-run search membership, window bounds, completeness, truncation and counts; unique `(runId, queryStateId)`. Needed for independent cursor advancement and attribution.                                                                                                                                                 |
| CollectedItem        | Workspace-local source record: channel, external ID, kind (`job` or `post`), canonical URL, raw payload, normalized fields, first/last seen, status. Unique `(workspaceId, channel, externalId)`. Never discard any fetched item because of its title, company, or content.                                                               |
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

Each hourly tick scans enabled query states fairly in bounded pages, ordered by oldest coverage/next due time with workspace rotation. Only active recipes are eligible (see "Searches come from query recipes"), and at most `maximumSearchesPerTick` searches per workspace and channel are selected. New recipes get states on the next scan. States of retired recipes stay stored but are not scanned. Adapter version changes create new search states rather than reusing incompatible cursors. There is no new profile-subscription model in this phase.

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

- Registry/config coverage for all four channels and hourly schedule definitions; config contains no search content.
- Each provider renders actor input only from its `ChannelSearch` plus window and config limits, matching career-hub's rendering for the same keywords and params (fixture tests per channel).
- Updated builders: Ashby and Greenhouse emit short keywords plus `site` and `suffix`; every position has includes it does not exclude; only Ashby and Greenhouse versions bump.
- Active recipes: publish replaces the active set, unpublish retires it, re-activation resumes the old cursor, the deploy backfill regenerates without a republish, and a workspace without active recipes records `no_recipes`.
- Per-tick selection respects `maximumSearchesPerTick` and ordering, and unselected searches keep their cursors.
- No item is dropped after fetching: every valid normalized item from a complete response is stored.
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

1. Make recipe versions per channel, add `retiredAt` and publish/unpublish active-set replacement plus the deploy backfill, update the Ashby and Greenhouse builders, and remove `jobBoardFilterQuery`. Strip search content from channel config and add `maximumSearchesPerTick`.
2. Add durable models/migrations, configuration, and provider contracts.
3. Implement atomic claims, budget reservations, outbox delivery, and recovery.
4. Add Apify operation providers and dataset normalization using career-hub fixtures.
5. Add the four channel providers, direct posting extraction, and bounded Chromium fallback.
6. Wire hourly schedules, worker dependencies, visibility, and failure-path integration tests.

The builder may choose exact field names, helper boundaries, queue names, and SQL details while preserving these invariants. Verify actual BullMQ/Apify APIs against installed types and official documentation during implementation. Main product defaults to review are 24-hour initial lookback, seven-day automatic recovery, inherited spending caps, only active recipes running, `maximumSearchesPerTick` values, and Chromium as a supported-domain fallback.
