# Hourly Channel Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build durable, workspace-scoped hourly collection for LinkedIn jobs, LinkedIn posts, Ashby, and Greenhouse in xjobs, where every search comes from the workspace's active query recipes and every fetched item is stored.

**Architecture:** The queries module owns search content: per-channel builders turn the published profile into immutable recipes, and publish/unpublish maintain the workspace's active set. BullMQ schedules hourly dispatch, while PostgreSQL owns run state, per-search cursors, leases, budget reservations, outbox delivery, source observations, and extraction retries. Each channel is its own Nest provider that renders a `ChannelSearch` into actor input using logic ported from `../career-hub/src/collect`; each Apify or Chromium operation is a separate provider.

**Tech Stack:** NestJS 11, BullMQ 5, Redis, PostgreSQL, Prisma 8 contract models/migrations, Vitest, Apify SDK, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-channels-collection-design.md`

## Global Constraints

- Channel config (`apps/xjobs/src/modules/channels/config/index.ts`) holds operational settings only. It contains no keywords, locations, queries, terms, site, suffix, or title excludes.
- Providers build actor input only from a `ChannelSearch` plus the time window and config limits. They never invent keywords, locations, or exclusions.
- No post-fetch filtering: every valid normalized item from a response is stored. Matching is out of scope.
- Only active recipes run: `retiredAt IS NULL` and `version === QUERY_SEARCH_RECIPE_VERSIONS[channel]`.
- Recipe versions are per channel. This plan bumps only `ashby` and `greenhouse` (to 2); LinkedIn hashes stay unchanged.
- Hourly schedules use `0 * * * *` in UTC; recovery polling is every minute.
- Initial lookback is 24 hours, overlap is 15 minutes, automatic recovery is bounded to 7 days, maximum collection window is 24 hours.
- At most `maximumSearchesPerTick` searches per workspace and channel per tick, ordered by oldest `coveredUntil`, then fewer technologies, then recipe ID.
- All collected domain records are workspace-scoped; budget buckets are credential-scoped and use integer micro-USD.
- Exactly-once remote actor starts are not promised; uncertain starts retain budget reservations and are not automatically restarted.
- Discovery and extraction retry independently; no cursor advances for incomplete or truncated discovery.
- Automated tests never call paid actors; use career-hub fixtures.

## Review Focus

- A user republishes with one position removed: that position's recipes must be retired in the same transaction, and their searches must stop being scheduled on the next tick (Task 3, Task 8).
- A workspace with two users where one unpublishes: recipes from the other user's published profile must stay active (Task 3).
- A profile with an onsite country but no city: the Ashby/Greenhouse suffix must use the English country name, never the raw ISO code (Task 2).
- A position whose own title words appear in the exclusion list (engineering manager, tech lead): it must not exclude itself (Task 2).
- A recipe retired and later re-activated: its old collection state and cursor resume instead of a fresh 24-hour lookback (Task 3, Task 6).

---

### Task 1: Per-channel recipe versions

**Files:**
- Modify: `apps/xjobs/src/modules/queries/builders/recipe.ts`, `apps/xjobs/src/modules/queries/builders/index.ts`
- Test: `apps/xjobs/src/modules/queries/builders/recipe.spec.ts`

**Interfaces:**
- Produces: `export const QUERY_SEARCH_RECIPE_VERSIONS: Readonly<Record<Channel, number>>` (all `1` in this task). `QUERY_SEARCH_RECIPE_VERSION` is removed. `toRecipe` sets `version = QUERY_SEARCH_RECIPE_VERSIONS[combination.channel]`.

- [ ] **Step 1: Write failing tests** in `recipe.spec.ts`:
  - `it('uses the channel version')`: for each `Channel`, `toRecipe({...combination, channel}).version` equals `QUERY_SEARCH_RECIPE_VERSIONS[channel]`.
  - `it('keeps existing hashes at version 1')`: a LinkedIn board recipe hash equals the hash recorded before this change (capture it from `main` with the current fixture and paste the literal).
- [ ] **Step 2: Run** `npx nx test xjobs -- recipe.spec` and expect FAIL (`QUERY_SEARCH_RECIPE_VERSIONS` is not exported).
- [ ] **Step 3: Implement** the map and update `toRecipe` and the barrel export.
- [ ] **Step 4: Run** `npx nx test xjobs -- queries` and expect PASS.
- [ ] **Step 5: Commit** `refactor(queries): version recipes per channel`.

### Task 2: Ashby and Greenhouse Google query builders

**Files:**
- Create: `apps/xjobs/src/modules/queries/builders/google.ts`
- Modify: `apps/xjobs/src/modules/queries/builders/keywords.ts` (add tables), `builders/channel.builder.ts` (remove `jobBoardFilterQuery`), `channels/ashbyhq.builder.ts`, `channels/greenhouse.builder.ts`, `builders/recipe.ts` (set `ashby` and `greenhouse` to `2`)
- Test: `apps/xjobs/src/modules/queries/builders/google.spec.ts`, `apps/xjobs/src/modules/queries/channels/channels.spec.ts`

**Interfaces:**
- Produces: `googleJobBoardQuery(combination: QuerySearchCombination, site: string): ChannelQuery`, returning `{ keywords, params: { site, suffix } }`.
  - `keywords`: `POSITION_TITLES[position]` plus `TECHNOLOGY_TERMS[t]` for each technology, lowercase and deduplicated. No seniority word.
  - `suffix`: include group, then exclusions, then location term, joined by single spaces with empty parts skipped.
- Produces tables in `keywords.ts`:
  - `TITLE_INCLUDES: Record<Position, readonly string[]>`: non-empty for every position (for example `['engineer','developer']` for engineering roles, `['devops','engineer']`, `['sre','reliability']`, `['architect']`, `['manager']` for `engineering_manager`, `['lead']` for `tech_lead`).
  - `SENIORITY_EXCLUDES: Record<Seniority, readonly string[]>`: `['intern','junior']` for senior, staff, lead and principal; `['intern']` for mid; `[]` for junior and unstated.
  - `MANAGEMENT_EXCLUDES = ['manager','director']`, applied unless the position is `engineering_manager`.
- Include group rendering: `(intitle:a OR intitle:b)`, or `intitle:a` for a single word. Exclusion rendering: `-intitle:word`, skipping any word that is in the position's own includes.
- Location term: `"remote"` for remote; for onsite or hybrid, `"<city>"` if city, else `"<English country name>"` via `new Intl.DisplayNames(['en'], { type: 'region' }).of(country)`, falling back to the raw value if `of` returns undefined; nothing for unstated.
- `AshbyQueryBuilder.build` calls `googleJobBoardQuery(c, 'jobs.ashbyhq.com')`, and `GreenhouseQueryBuilder.build` calls `googleJobBoardQuery(c, 'greenhouse.io')`.

- [ ] **Step 1: Write failing tests** in `google.spec.ts`:
  - Senior remote fullstack with `[typescript, react]`: keywords equal `['fullstack engineer','full stack engineer','full stack developer','typescript','react']` (using the actual `TECHNOLOGY_TERMS` strings), and suffix equals `'(intitle:engineer OR intitle:developer) -intitle:intern -intitle:junior -intitle:manager -intitle:director "remote"'`.
  - `engineering_manager` senior: suffix contains `intitle:manager` and does not contain `-intitle:manager`.
  - For every `Position` and every `Seniority`: includes are non-empty, and no rendered exclusion word is in that position's includes.
  - Onsite with `country: 'MA', city: null`: suffix ends with `"Morocco"`. With `city: 'Casablanca'`: suffix ends with `"Casablanca"`.
  - Unstated arrangement and unstated seniority: suffix is only the include group.
- [ ] **Step 2: Update `channels.spec.ts`**: Ashby params are `{ site: 'jobs.ashbyhq.com', suffix }`, Greenhouse params are `{ site: 'greenhouse.io', suffix }`, and no params contain `locationTerms` or `remote`. Replace the test "registers Greenhouse and Ashby as their own classes with identical queries" with one asserting identical keywords and suffix but different sites.
- [ ] **Step 3: Run** `npx nx test xjobs -- queries` and expect FAIL.
- [ ] **Step 4: Implement** `google.ts`, add the tables, update both builders, delete `jobBoardFilterQuery`, and bump the two versions to `2`.
- [ ] **Step 5: Run** `npx nx test xjobs -- queries` and expect PASS. Then run `npx nx typecheck xjobs` and expect no references to `jobBoardFilterQuery`.
- [ ] **Step 6: Commit** `feat(queries): build Google site queries for Ashby and Greenhouse`.

### Task 3: Active recipe set, publish/unpublish replacement, and deploy backfill

**Files:**
- Modify: `apps/xjobs/src/database/contract.prisma` (add `retiredAt DateTime?` to `QuerySearchBuilder`, plus `@@index([workspaceId, channel, retiredAt])`), and generated `contract.json`, `contract.d.ts`, and a new migration under `apps/xjobs/src/database/migrations/app/`
- Modify: `apps/xjobs/src/modules/queries/repositories/queries.repository.ts`, `testing/fakes.ts`, `services/queries.service.ts`
- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts`, `repositories/profiles.repository.ts` (add `listPublished`)
- Create: `apps/xjobs/src/modules/queries/scripts/regenerate-active.ts` (deploy backfill entry point) and a `queries:regenerate` script in `apps/xjobs/package.json`
- Test: `services/queries.service.spec.ts`, `apps/xjobs/src/modules/users/services/profiles.service.spec.ts`

**Interfaces:**
- Repository additions:
  - `abstract replaceActive(workspaceId: string, recipes: QuerySearchRecipe[], now: Date): Promise<{ created: number; reactivated: number; retired: number; kept: number }>`. In one transaction: insert missing hashes, set `retiredAt = null` on matching retired rows, and set `retiredAt = now` on active rows whose hash is not in `recipes`.
  - `abstract listActive(workspaceId: string, channel?: Channel): Promise<QuerySearchBuilderRow[]>`: `retiredAt IS NULL` and version equals the channel's current version, oldest first.
- `ProfilesRepository.listPublished(workspaceId: string): Promise<Profile[]>` (with skills, as `findByUser` returns).
- `QuerySearchService.regenerate(workspaceId: string, inputs: QuerySearchProfileInput[], now?: Date)`: expands each input, unions by hash, then calls `replaceActive`. It returns the replace counts. It replaces `generate`.
- `ProfilesService.publish`: sets the state to published, then calls `regenerate` with every published profile in the workspace, all in one transaction (the existing ordering note "a failure leaves the profile a draft" must still hold). Unpublish does the same without that profile. The response field `querySearches` returns the replace counts.
- `QueryRecipesBackfill.run(): Promise<{ workspaces: number }>` regenerates every workspace that has at least one published profile.

- [ ] **Step 1: Write failing service tests** (with fakes):
  - `regenerate` with profile A, then with A minus one position: rows for the removed position have `retiredAt` set, the others are untouched, and the counts are correct.
  - Regenerate back to the original A: the same row IDs are reactivated (no new rows).
  - Two inputs (users A and B), then only B: rows produced only by A are retired, and shared hashes stay active.
  - Empty inputs: every active row is retired.
  - `listActive` excludes retired rows and rows whose version is not current (seed an Ashby version 1 row: excluded).
- [ ] **Step 2: Write failing profile tests**: publish with two published profiles in the workspace passes both inputs; unpublish of the last profile results in no active recipes; when regeneration throws, the profile stays a draft.
- [ ] **Step 3: Run** `npx nx test xjobs -- queries users` and expect FAIL.
- [ ] **Step 4: Edit the contract and generate the migration**: run `pnpm --filter @xjobs/xjobs db:format`, then `db:migration:plan`. Commit the generated files as produced.
- [ ] **Step 5: Implement** the repository (Prisma and fake), the service, the profiles wiring, and the backfill script (bootstraps a Nest application context, iterates workspaces with published profiles, and logs counts).
- [ ] **Step 6: Run** `npx nx test xjobs` and `pnpm --filter @xjobs/xjobs db:verify` against the local database, and expect PASS.
- [ ] **Step 7: Commit** `feat(queries): keep one active recipe set per workspace`.

### Task 4: Durable collection schema and migration

**Files:** Modify `apps/xjobs/src/database/contract.prisma`, generated contract artifacts and migrations under `apps/xjobs/src/database/`; add database migration tests.

**Interfaces:** Provide models for query state, runs, run-query membership, operations, collected items, canonical postings, hits, extraction tasks, budget buckets/reservations, leases, outbox, and collection gaps as specified in the design. `CollectionQueryState` has no enabled flag (eligibility comes from the recipe's active state) and references `QuerySearchBuilder.id`. All workspace references must be constrained.

- [ ] Add schema constraints and indexes, including idempotency unique keys, lease lookup, due-state scans joined to active recipes, operation reconciliation, and workspace ownership.
- [ ] Generate migration artifacts with `db:migration:plan` and add verification for workspace constraints and uniqueness.
- [ ] Run `db:migration:status` and `db:verify`.

### Task 5: Operational channel config and provider contracts

**Files:** Rewrite `apps/xjobs/src/modules/channels/config/index.ts`; modify `types/channel-provider.ts` and `channels.module.ts`; add a config/registry spec.

**Interfaces:**
- `ChannelConfig` drops `discovery`. It adds `maximumSearchesPerTick: number` and a typed per-channel `limits` object:
  - LinkedIn board: `{ maxRowsPerUrl: 100 }`
  - LinkedIn posts: `{ maxPostsPerQuery: 100, link: { timeoutMs: 10_000, delayMs: 1_000, maxAttempts: 3 } }`
  - Ashby and Greenhouse: `{ maxPagesPerQuery: 3, fetch: {...existing fetch values} }`
- `ChannelSearch` gains `recipeVersion: number` and `technologies: Technology[]`.
- `ChannelProvider.collect(search: ChannelSearch, window: { since: Date; until: Date }): Promise<ChannelCollectionResult>`. The result adds `costMicroUsd`, `status`, and per-search `outcome: 'complete' | 'partial' | 'truncated' | 'failed' | 'budget_skipped' | 'no_recipes'`.
- `maximumSearchesPerTick` values come from `floor(monthlyBudgetMicroUsd / maximumOperationBudgetMicroUsd / (24 * 31)) * maximumSearchesPerOperation`, with a minimum of 1. Record this arithmetic in a comment.

- [ ] Test: config has an entry for every `Channel`, and a recursive key scan finds none of `keywords`, `locations`, `queries`, `terms`, `site`, `suffix`, `titleExcludes`.
- [ ] Test: the four hourly schedules, `maximumSearchesPerTick >= 1` and equal to the formula, and registry rejection of missing/duplicate providers.
- [ ] Implement, run `npx nx test xjobs -- channels`, and commit.

### Task 6: Atomic leases, query state, and cursors

**Files:** Create channel repositories and `services/collection-lease.service.ts`, `services/collection-query-state.service.ts`; add specs.

**Interfaces:** Implement fenced lease acquisition/renewal/release and query-state claims. Expose cursor computation over frozen windows with overlap and maximum window. Query states are created lazily for active recipes and keyed by recipe ID, so a re-activated recipe reuses its state.

- [ ] Test concurrent claims, expiry/reacquisition generation, and stale-holder rejection.
- [ ] Test first-run lookback, contiguous catch-up, overlap, new recipes, retired-then-reactivated recipe resuming its `coveredUntil`, and gaps beyond seven days.

### Task 7: Atomic budget reservation and settlement

**Files:** Create `services/collection-budget.service.ts`, budget repository, and PostgreSQL integration specs.

**Interfaces:** `reserve(operationId, channel, month, maximumMicroUsd)` atomically checks the global and channel buckets. `settle(operationId, actualMicroUsd)` is idempotent and adjusts original-month balances.

- [ ] Test that competing reservations cannot exceed either cap.
- [ ] Test settlement replay, late cost deltas, month rollover, unknown-cost retention, and known non-start release.

### Task 8: Durable outbox, hourly dispatch with search selection, and recovery

**Files:** Create `services/channels-scheduler.service.ts`, `services/channels-dispatcher.service.ts`, `services/search-selection.ts`, `services/collection-recovery.service.ts`, `processors/channels.processor.ts`, and specs.

**Interfaces:**
- `selectSearches(states: DueSearch[], limit: number): DueSearch[]` (pure): sort by `coveredUntil` ascending (null first), then `technologies.length` ascending, then `recipeId`, and take `limit`.
- Register four stable hourly BullMQ schedulers. The dispatcher reads `listActive` per workspace and channel. With no active recipes, it records a `no_recipes` skip. Otherwise it selects at most `maximumSearchesPerTick` and creates deterministic batches and outbox rows in one transaction. Recovery publishes pending outbox rows, reclaims expired work, reconciles operations, and enqueues due extraction tasks.

- [ ] Test `selectSearches` ordering and limit, and that unselected states keep their cursors unchanged.
- [ ] Test that retired recipes are never dispatched, that `no_recipes` is recorded for an empty workspace, duplicate schedule reconciliation, and concurrent dispatch idempotency.
- [ ] Test queue loss/republication, duplicate delivery, startup recovery, and fair workspace rotation.

### Task 9: Apify operation lifecycle and ingestion

**Files:** Create separate `providers/apify/apify-client.provider.ts` (ported from career-hub `collect/apify.ts`), `linkedin-jobs-search.provider.ts`, `linkedin-posts-search.provider.ts`, `google-search.provider.ts`; operation repository and specs. Copy the needed fixtures from `../career-hub/src/collect/*/fixtures` into `apps/xjobs/src/modules/channels/testing/fixtures/`.

**Interfaces:** Persist operation inputs and state before start, save run/dataset IDs, resume polling and ingestion, checkpoint pages, and report actual cost and completeness. An ambiguous start yields `start_unknown`.

- [ ] Test start, polling resume, page replay idempotency, failed actors with cost, and uncertain starts with retained reservation.
- [ ] Validate result normalization and attribution with the copied fixtures; never invoke paid actors.

### Task 10: Four channel providers rendering from recipes

**Files:** Replace the stubs with one file per channel provider under `providers/channels/`; separate Ashby and Greenhouse posting providers under `providers/extraction/`; normalizers ported from career-hub `collect/*/normalize.ts`; fixture specs.

**Interfaces:** Each provider renders its `ChannelSearch` into actor input, ported from career-hub:
- LinkedIn board: `linkedin-jobs/urls.ts` `searchUrls`, adapted to take `keywords` and `params.location`, `experienceLevel` and `workType` from the search, with `f_TPR=r<seconds>` from the window.
- LinkedIn posts: `searchQueries = search.keywords`, plus `params.location` and the window.
- Ashby and Greenhouse: `google/discover.ts` `googleQueries(params.site, keywords, params.suffix)` and `quickDateRange(since, until)`, then the posting API fetch.

Each provider validates attribution and completeness, persists every observation and hit, schedules extraction tasks, and returns per-search outcomes.

- [ ] Test per channel: for a fixed `ChannelSearch` and window, the actor input equals the expected literal (for example `site:jobs.ashbyhq.com "typescript" (intitle:engineer OR intitle:developer) -intitle:intern "remote"`). The input contains no value absent from the search or config.
- [ ] Test that every valid fixture item is stored, including ones whose title would have matched career-hub's excludes (for example a "Sales Engineer" item).
- [ ] Test zero results, duplicates, invalid items, closed postings, truncation, and cursor movement per search. Test direct Ashby GraphQL and Greenhouse Job Board API extraction with host throttling.

### Task 11: Extraction queue and bounded Chromium fallback

**Files:** Create `providers/browser/chromium.provider.ts`, `providers/extraction/chromium-job-extraction.provider.ts`, extraction worker/repository and specs.

**Interfaces:** Claim extraction tasks with fencing, and retry retryable failures independently. The browser provider accepts only supported normalized targets and returns structured, evidence-backed fields.

- [ ] Test Retry-After, host concurrency, terminal malformed input, closed records, exhausted retries, and stale-result protection.
- [ ] Test browser timeout, redirect/private-network blocking, unsupported hosts, and context cleanup.

### Task 12: Worker wiring, environment, and operational status

**Files:** Modify worker environment validation and `apps/xjobs/src/infrastructure/jobs/worker.module.ts`; add structured run status reporting and smoke specs.

**Interfaces:** The worker imports the database and channel modules without HTTP AppModule dependencies. Startup checks required providers and dependencies; shutdown drains queues and closes browser and database clients.

- [ ] Test startup failure on missing enabled-channel credentials and Redis/database readiness.
- [ ] Test graceful shutdown, and verify logs omit credentials and raw descriptions while reporting operation/run IDs, status, and `no_recipes` skips.
- [ ] Run `npx nx run-many -t lint test build typecheck`. Report unavailable live credentials separately.

## Execution note

Tasks 1–3 (queries) ship as their own reviewable change before any collection work, and the `queries:regenerate` backfill runs on deploy of Task 3. Tasks 4–12 follow in order because each establishes interfaces the next uses.
