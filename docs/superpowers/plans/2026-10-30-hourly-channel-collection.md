# Hourly Channel Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build durable, workspace-scoped hourly collection for LinkedIn jobs, LinkedIn posts, Ashby, and Greenhouse in xjobs.

**Architecture:** BullMQ schedules hourly dispatch, while PostgreSQL owns run state, per-search cursors, leases, budget reservations, outbox delivery, source observations, and extraction retries. Each channel is its own Nest provider; each Apify or Chromium operation is a separate provider. Existing ATS APIs remain the primary posting extractors, with bounded Chromium fallback.

**Tech Stack:** NestJS 11, BullMQ 5, Redis, PostgreSQL, Prisma contract models/migrations, Zod, Apify SDK, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-channels-collection-design.md`

## Global Constraints

- Hourly schedules use `0 * * * *` in UTC; recovery polling is every minute.
- Configuration belongs in `apps/xjobs/src/modules/channels/config/index.ts`; credentials remain validated environment inputs.
- All collected domain records are workspace-scoped; budget buckets are credential-scoped and use integer micro-USD.
- Initial lookback is 24 hours, overlap is 15 minutes, automatic recovery is bounded to 7 days, maximum collection window is 24 hours.
- Exactly-once remote actor starts are not promised; uncertain starts retain budget reservations and are not automatically restarted.
- Discovery and extraction retry independently; no cursor advances for incomplete/truncated discovery.
- Channel, Apify operation, and Chromium operation responsibilities remain separate providers/files.

## Review Focus

- Two replicas dispatch the same schedule: unique run/outbox keys and leases must prevent overlapping execution.
- Apify accepts a start but its response is lost: preserve `start_unknown`, reservation, and operator visibility.
- Truncated or unattributed actor results: keep observations, do not advance affected cursor.
- Redis loses queue data: PostgreSQL outbox/recovery must recreate delivery.
- Extraction is retried after a newer source revision: fencing/version checks must prevent stale overwrite.

---

### Task 1: Durable collection schema and migration

**Files:** Modify `apps/xjobs/src/database/contract.prisma`, generated contract artifacts and migrations under `apps/xjobs/src/database/`; add database migration tests.

**Interfaces:** Provide models for query state, runs, run-query membership, operations, collected items, canonical postings, hits, extraction tasks, budget buckets/reservations, leases, outbox, and collection gaps as specified in the design. All workspace references must be constrained.

- [ ] Add schema constraints and indexes, including idempotency unique keys, lease lookup, due task scans, operation reconciliation, and workspace ownership.
- [ ] Generate migration artifacts using repository scripts and add migration verification for workspace constraints and uniqueness.
- [ ] Verify migration status and database contract checks.

### Task 2: Channel config and provider contracts

**Files:** Create `apps/xjobs/src/modules/channels/config/index.ts`, `types/`, `providers/channels/` contracts, `channels.module.ts`, and config/provider registry specs.

**Interfaces:** Export exhaustive per-`Channel` configuration and `ChannelProvider.collect(input): Promise<ChannelResult>` contracts. Define typed outcomes for complete, partial, truncated, failed, and budget-skipped results.

- [ ] Pin schedules, limits, actor names, retries, recovery bounds, concurrency, and spending caps from the design.
- [ ] Validate config and assert exactly one registered provider for each `Channel` enum value.
- [ ] Test all four schedules and reject missing/duplicate providers and invalid limits.

### Task 3: Atomic leases, query state, and cursors

**Files:** Create channel repositories and `services/collection-lease.service.ts`, `services/collection-query-state.service.ts`; add specs.

**Interfaces:** Implement fenced lease acquisition/renewal/release and query-state claims; expose cursor computation over frozen windows with overlap and maximum window.

- [ ] Test concurrent claims, expiry/reacquisition generation, and stale-holder rejection.
- [ ] Test first-run lookback, contiguous catch-up, overlap, query additions, adapter versions, and gaps beyond seven days.

### Task 4: Atomic budget reservation and settlement

**Files:** Create `services/collection-budget.service.ts`, budget repository, and PostgreSQL integration specs.

**Interfaces:** `reserve(operationId, channel, month, maximumMicroUsd)` atomically checks global and channel buckets; `settle(operationId, actualMicroUsd)` is idempotent and adjusts original-month balances.

- [ ] Test competing reservations cannot exceed either cap.
- [ ] Test settlement replay, late cost deltas, month rollover, unknown-cost retention, and known non-start release.

### Task 5: Durable outbox, hourly dispatch, and recovery

**Files:** Create `services/channels-scheduler.service.ts`, `services/channels-dispatcher.service.ts`, `services/collection-recovery.service.ts`, `processors/channels.processor.ts`, and specs.

**Interfaces:** Register four stable hourly BullMQ schedulers. Dispatcher creates deterministic bounded batches and outbox rows transactionally. Recovery publishes pending outbox rows, reclaims expired work, reconciles operations, and enqueues due extraction tasks.

- [ ] Test duplicate schedule reconciliation and concurrent dispatch idempotency.
- [ ] Test queue loss/republication, duplicate delivery, startup recovery, and fair bounded query selection.

### Task 6: Apify operation lifecycle and ingestion

**Files:** Create separate `providers/apify/apify-client.provider.ts`, `linkedin-jobs-search.provider.ts`, `linkedin-posts-search.provider.ts`, `google-search.provider.ts`; operation repository and specs.

**Interfaces:** Persist operation inputs/state before start, save run/dataset IDs, resume polling/ingestion, checkpoint pages, and report actual cost and completeness. Start ambiguity yields `start_unknown`.

- [ ] Test start, polling resume, page replay idempotency, failed actors with cost, and uncertain starts with retained reservation.
- [ ] Use career-hub fixtures to validate result normalization/attribution; do not invoke paid actors in tests.

### Task 7: Four channel providers and ATS extraction

**Files:** Create one file per channel provider; separate Ashby and Greenhouse posting operation providers; normalizers and fixture specs.

**Interfaces:** Each provider maps saved query states to source-specific searches, validates attribution/completeness, persists source observations and hits, schedules extraction tasks, and returns per-search outcomes.

- [ ] Implement LinkedIn jobs/posts Apify flows and Google discovery for Ashby/Greenhouse.
- [ ] Implement direct Ashby GraphQL and Greenhouse Job Board API extraction with host throttling.
- [ ] Test zero results, duplicates, invalid items, closed postings, truncation, and cursor movement per search.

### Task 8: Extraction queue and bounded Chromium fallback

**Files:** Create `providers/browser/chromium.provider.ts`, `providers/extraction/chromium-job-extraction.provider.ts`, extraction worker/repository and specs.

**Interfaces:** Claim extraction tasks with fencing; retry retryable failures independently. Browser provider accepts only supported normalized targets and returns structured evidence-backed fields.

- [ ] Test Retry-After, host concurrency, terminal malformed input, closed records, exhausted retries, and stale result protection.
- [ ] Test browser timeout, redirect/private-network blocking, unsupported hosts, and context cleanup.

### Task 9: Worker wiring, environment, and operational status

**Files:** Modify worker environment validation and `apps/xjobs/src/infrastructure/jobs/worker.module.ts`; add structured run status reporting and smoke specs.

**Interfaces:** Worker imports database and channel module without HTTP AppModule dependencies. Startup checks required providers and dependencies; shutdown drains queues and closes browser/database clients.

- [ ] Test startup failure on missing enabled-channel credentials and Redis/database readiness.
- [ ] Test graceful shutdown and verify logs omit credentials/raw descriptions while reporting operation/run IDs and status.
- [ ] Run targeted unit, migration, worker, and build checks; report any unavailable live credentials separately.

## Execution note

Implement in this order because each task establishes interfaces used by the next. Keep external actor calls disabled in automated tests. The approved design contains several substantial subsystems, so deliver each task as a separately reviewable change.
