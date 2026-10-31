# Hourly channel collection

Status: revised 2026-10-30. This design covers the user/profile query model and hourly collection foundation. No collection code in this design is production-ready until its implementation plan is complete.

## Intent and product decisions

Build hourly job collection for LinkedIn job board, LinkedIn posts, Ashby, and Greenhouse in xjobs, using the collectors in sibling `career-hub` as behavioral references.

The user has specified these binding data-model decisions:

- `QuerySearchBuilder.keywords String[]` becomes `QuerySearchBuilder.keyword String`; every row stores exactly one search phrase.
- `ProfileSkill.preference` is removed from persistence, validation, DTOs, APIs, ranking, query generation, tests, and documentation.
- A user may own multiple profiles. `Profile.userId` is a normal foreign key, not unique.
- Workspace is removed as a product concept. Remove its table, relations, module, controllers, services, routes, DTO fields, parameters, and seed behavior.
- Query builders and collection records belong to profiles and their owning users. A profile is the boundary between distinct searches, jobs, and collection history.
- Existing data must be preserved during migration. Move each existing workspace's users and related records to their user/profile ownership before dropping workspace references. Do not discard or merge distinct users' data.

Each query builder produces one phrase for one `(profile × channel × position × region × arrangement × technology set)` combination. Do not store multiple title aliases or phrases in one row. Query generation retains one technology set per recipe; it does not create a phrase array. Skill ranking is importance descending, mastery descending, then technology enum value ascending. There is no preference score.

## Career-hub behavior to port

| Channel | Discovery | Posting details |
| --- | --- | --- |
| LinkedIn job board | `bebity/linkedin-jobs-scraper` Apify actor | Returned by actor |
| LinkedIn posts | `harvestapi/linkedin-post-search` Apify actor | Post is the collected item; keep its linked URL as source evidence |
| Ashby | `apify/google-search-scraper` Apify actor, `site:jobs.ashbyhq.com` | Ashby public GraphQL API |
| Greenhouse | Google Search Apify actor, `site:greenhouse.io` | Greenhouse public Job Board API |

Career-hub uses separate normalization and URL validation for each source, windows with overlap, deduplication, actor spending caps, and retry/backoff for direct board requests. Its Chromium use is for applications and résumé rendering; browser-based job extraction is new and should be bounded to supported Ashby/Greenhouse pages as a fallback. Do not browse application forms or submit applications.

## Module boundaries

```text
modules/channels/
  channels.module.ts
  config/index.ts
  providers/channels/{linkedin-job-board,linkedin-posts,ashby,greenhouse}.provider.ts
  providers/apify/{apify-client,linkedin-jobs-search,linkedin-posts-search,google-search}.provider.ts
  providers/extraction/{ashby-posting,greenhouse-posting,chromium-job-extraction}.provider.ts
  providers/browser/chromium.provider.ts
  services/{scheduler,dispatcher,recovery,budget,lease}.service.ts
  processors/channels.processor.ts
  repositories/
  normalizers/
  types/
```

Each channel has exactly one registered Nest provider implementing the shared channel contract. The channel provider coordinates that channel's operation providers. Every Apify operation and each Chromium extraction operation has a separate provider file. Shared transport clients own lifecycle, not channel behavior. Pure normalizers remain functions.

The collection pipeline consumes active query-builder rows for each published profile, produces one query state per builder, and records every valid item returned. Do not post-filter by title/company/location; matching and qualification are separate. Never deduplicate posts solely by title/company. Exact source identity and ATS IDs can associate observations to a canonical posting within a profile.

## Configuration and cadence

`apps/xjobs/src/modules/channels/config/index.ts` owns operational settings only: channel enabled state, schedule, windows, actor IDs, request limits, retry policies, concurrency, host throttles, and credential-wide budget limits. Query phrases, location terms, and job criteria come from the profile's query-builder row. Credentials are environment variables and must be validated in worker configuration.

Defaults:

- Four hourly schedules at `0 * * * *`, timezone UTC; recovery scan every minute.
- Initial lookback 24 hours, overlap 15 minutes, maximum single window 24 hours, automatic recovery horizon seven days.
- Maximum ten query operations per actor call, subject to actor limits; only batch searches when actor output preserves attribution and completeness for every search.
- Per-profile/channel discovery lease, bounded worker-wide concurrency, separate extraction and per-host concurrency.
- Career-hub budgets carried over as starting caps: global Apify $80/month; LinkedIn jobs $60/month and $1/run; LinkedIn posts $30/month and $0.75/run; Ashby and Greenhouse $5/month and $0.50/run each. Budgets are upper limits; a scheduled hour may be skipped when exhausted. Keep actual spend and reservations in integer micro-USD.
- Actor IDs as listed in the channel table. Verify actor contracts and SDK behavior before live use.
- Three bounded retries with exponential backoff and Retry-After for retryable API requests. Never blindly retry an Apify start whose outcome is unknown.

## Persistence model

All profile-owned records carry both `userId` and `profileId` where needed. Foreign keys or equivalent constraints ensure the profile belongs to the same user. Profiles can be many per user. Global budget rows are credential-scoped infrastructure records and do not contain job content. All timestamps are UTC.

| Model | Required data and keys |
| --- | --- |
| QuerySearchBuilder | `userId`, `profileId`, channel, one `keyword`, search params, version, stable hash. Unique by `(profileId, hash)`; profile ownership must match `userId`. |
| CollectionQueryState | One active query cursor per builder and adapter version: user/profile/builder IDs, deterministic search key, `coveredUntil`, next attempt, status/error. Unique `(profileId, builderId, adapterVersion, searchKey)`. A builder has one keyword, so one cursor. |
| CollectionRun | Profile/channel run, fixed schedule time/window and counters/status. |
| CollectionRunQuery | Per-run query membership, frozen window, completeness, truncation and result counts. |
| CollectionOperation | Durable actor/API operation input snapshot, state, actor run/dataset IDs, cost/reservation, lease generation and retry state. Unique idempotency key. |
| CollectedItem | User/profile, source/channel, external ID, kind (`job` or `post`), URL, raw and normalized data, status and first/last seen. Unique `(profileId, channel, externalId)`. |
| CanonicalPosting | User/profile ATS posting identity and details. Unique `(profileId, provider, externalKey)`; Greenhouse key includes board and job ID; Ashby key includes organization and posting ID. |
| CollectionHit | Query/run attribution, source item, rank and observed URL. Durable before extraction; replay-safe unique identity. |
| ExtractionTask | Profile-owned target, extractor/input version, state, attempt count, retry time, fenced lease and error. |
| BudgetBucket / BudgetReservation | Credential/channel scope and UTC month, limits, reserved/settled micro-USD, operation, original month and idempotent settlement state. |
| CollectionLease | Profile/channel lease with expiry and fencing generation; unique `(profileId, channel)`. |
| QueueOutbox | Durable work intent committed with domain state and idempotency key. |
| CollectionGap | Explicit skipped time range and reason when recovery exceeds seven days. |

Avoid company/title uniqueness: different openings can share those values. Keep separate user/profile copies of collected data; no cross-user content sharing in this phase.

## Migration from workspaces

The migration must be additive and data-preserving before dropping old ownership:

1. Add the `keyword` column, initially nullable, and populate it from each old `keywords` array. Since arrays may contain multiple phrases, split each existing builder into one row per phrase, preserving all other recipe fields and recomputing hash/identity. Empty arrays are invalid and must be reported for repair rather than silently converted.
2. Remove `preference` after preserving remaining skill values. Remove `userId` uniqueness on profiles.
3. Establish profile ownership for existing query builders. If a workspace has a profile for the user, attach rows to that profile; if there are multiple profiles, assign rows using an explicit deterministic mapping when available, otherwise preserve them under the user's default/legacy profile and record the mapping. Create a legacy profile only where no profile exists, with required fields populated from existing user data or a documented migration default.
4. Add `userId` and `profileId` ownership to any collection records created by the collection feature; for preexisting users/contacts/profiles/skills/queries, copy `userId` from their current relations.
5. Verify counts, unique ownership, non-empty keywords, and that every profile and child row has a valid user. Only then remove workspace columns/FKs, Workspace model/table/module/routes/services/seeds, and workspace-specific API inputs/outputs.

Run the migration in a transaction where supported, and make it safely resumable if data volume requires phases. Produce a preflight report of rows needing manual mapping. Do not drop the old columns until checks pass.

## Query generation changes

Update `ChannelQuery` and `QuerySearchRecipe` to expose `keyword: string`, not `keywords: string[]`. Each channel builder returns exactly one phrase. Position aliases should be selected deterministically as one canonical title term in the recipe builder; do not expand aliases into additional rows. The keyword participates in the canonical hash. Bump recipe versions for all channels because the search identity and shape change.

Remove `preference` from ProfileSkill DTOs and response descriptions. `RankedSkill` retains technology, importance, mastery. Remove `preference` sorting from `topTechnologies`; keep importance filtering and stable ordering. Update profile types, validation, seeds, fakes, response serialization, and tests. Profile query generation takes an explicit `profileId` and verifies that it belongs to the authenticated user.

## Scheduling, cursors, and retries

All worker replicas idempotently reconcile four stable BullMQ hourly schedulers. A dispatcher scans published profiles and active query builders fairly, with bounded pages and rotation by user/profile. It writes runs, operation intents, and outbox rows transactionally; the outbox relay retries delivery after Redis outages. Queue payloads carry IDs, never descriptions or secrets.

Recovery scans on startup and every minute: deliver outbox rows, reclaim expired leases, reconcile known external operations, and enqueue due extraction retries. PostgreSQL is the durable source; Redis queue loss must not lose work.

Freeze search input and window end when dispatching. A new query starts at now minus 24 hours. Otherwise continue from `coveredUntil`, with 15-minute overlap and a maximum 24-hour slice. Catch up oldest uncovered windows first, preserving the original range through retries. If backlog exceeds seven days, record a `CollectionGap`; do not silently mark it covered.

Advance only a complete per-query discovery cursor, after all dataset pages, attribution, source items, and extraction intents are durably recorded. Complete zero-results are success. Actor failure, invalid output, cap exhaustion, missing attribution, and truncation do not advance that query. Partial observations remain stored. For sources whose date filters are relative or imprecise, document coverage limits and do not claim exactness.

Use database leases keyed by profile/channel and fenced generations, plus per-task extraction leases. Do not hold transactions across network calls. If a lease expires, the replacement reconciles any `starting` or `running` operation before starting work. A stale worker cannot commit cursor or task state.

Persist Apify operation input and reserve maximum spend before starting. Persist `starting` before the request; save run ID as soon as returned. Resume polling and dataset ingestion from that ID. Checkpoint dataset pages and use idempotent upserts. If the response is lost after a possible remote start, mark `start_unknown`, retain the reservation, and do not launch another paid start without proof the first did not happen or operator resolution. Exactly-once remote start is not promised absent verified provider idempotency.

Reserve global and channel budgets atomically under consistent row locks: settled + reserved + maximum must not exceed either cap. Settle exactly once against the operation's original UTC month; retain reservations while final cost is unknown. Late cost deltas are recorded and block further runs if limits are exceeded. Budget skips do not advance cursors.

Extraction uses its own durable task queue and retries; it does not rerun paid discovery. Retry timeouts, 429s, and 5xx with host-wide throttling; malformed inputs are terminal; verified closed jobs are terminal closed results. Preserve exhausted tasks and errors for replay. Chromium uses isolated bounded contexts for supported Ashby/Greenhouse URLs only; validate redirects, block local/private networks, never reuse application credentials, and always close contexts.

## Worker integration and observability

WorkerModule imports database and Channels modules without importing HTTP AppModule or requiring Basic Auth/storage credentials. Validate database, Redis, and credentials for enabled channels. Startup readiness follows successful dependency checks. Shutdown drains workers and closes browser, database, and Redis clients.

Persist and log run/operation IDs, statuses, profile/query IDs, cursors, gaps, truncation, extraction backlog, spend and reservations, and error codes. Do not log credentials or raw job descriptions. A dashboard is out of scope.

## Verification

- Migration preserves all users, profiles, skills, contacts, and query searches; split keyword arrays into phrase rows; supports multiple profiles per user; detects orphan/empty legacy data.
- Query builders produce one keyword per recipe, include keyword in hash, and produce deterministic canonical phrases.
- No preference field remains in schema, API, ranking, or query generation.
- No workspace model, workspace foreign key, workspace API/service, workspace parameter, or workspace seed remains.
- Profile ownership checks reject access to another user's profile.
- Two replicas dispatch one logical run; stale leases cannot commit.
- Concurrent budget reservations cannot exceed global/channel caps.
- Redis loss, uncertain Apify start, partial datasets, truncation, and extraction retries recover as specified.
- Channel operation contracts and normalizers use local fixtures; automated tests never call paid actors.
- Browser redirect/private network/timeout cases are rejected and contexts are closed.

## Implementation sequence

1. Update data model and migrate workspace ownership to user/profile ownership, including multi-profile support.
2. Convert recipe/query builder APIs from keyword arrays to one keyword and remove skill preference everywhere.
3. Add durable collection models, config, provider contracts, repositories, leases, budgets, and outbox/recovery.
4. Port Apify operations and four channel collectors, plus direct ATS extraction.
5. Add bounded Chromium fallback, worker wiring, operational status, and full recovery verification.
