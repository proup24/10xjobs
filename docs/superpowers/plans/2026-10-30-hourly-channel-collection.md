# User Profiles and Hourly Channel Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace workspace-scoped ownership with user/profile ownership, simplify query recipes to one keyword, remove skill preference, and implement durable hourly collection for four channels.

**Architecture:** A user owns many profiles; query recipes and collection state belong to one profile and are authorized through its user. PostgreSQL stores durable collection state and an outbox; BullMQ schedules and delivers work. Each channel, Apify operation, and Chromium extraction operation has a separate provider.

**Tech Stack:** NestJS 11, BullMQ 5, Redis, PostgreSQL, Prisma contract migrations, Vitest, Apify HTTP/SDK, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-channels-collection-design.md`

## Global Constraints

- One `QuerySearchBuilder.keyword: String` per row; no keyword array.
- Remove `ProfileSkill.preference` throughout schema, APIs, ranking, validation, seeds, and tests.
- `Profile.userId` is non-unique; multiple profiles per user are supported.
- Remove Workspace and all workspace columns, FKs, services, controllers, routes, DTO fields, parameters, and seed behavior.
- Preserve data during migration; split existing keyword arrays into phrase rows and map workspace children to user/profile before dropping old ownership.
- Profile ownership is validated through `(userId, profileId)` on every user-scoped operation.
- Hourly UTC schedules; initial lookback 24h; overlap 15m; max slice 24h; automatic recovery horizon 7d.
- Credential budgets use integer micro-USD. Never blindly restart an Apify call with uncertain start outcome.
- Tests use fixtures/fakes and do not call paid actors.

## Review Focus

- Workspace containing multiple users and profiles: preserve each user's ownership without cross-assignment (Task 1).
- Existing recipe with multiple keywords: split rows while preserving distinct phrases and recomputing hashes (Task 1).
- Profile access with a valid ID owned by another user: reject it (Task 2).
- Channel builders with title aliases: emit one deterministic phrase (Task 3).
- Worker lease expires during a network call: stale worker cannot advance cursor or overwrite results (Task 5).

---

### Task 1: Migrate ownership and query schema

**Files:** Modify `apps/xjobs/src/database/contract.prisma`, generated contract files and migration snapshots under `apps/xjobs/src/database/`; add migration specs.

**Interfaces:** Replace `keywords String[]` with `keyword String`; remove ProfileSkill.preference; make Profile.userId non-unique; replace workspace relations with direct user/profile ownership; remove Workspace model. Add QuerySearchBuilder.profileId and userId, unique `(profileId, hash)`.

- [ ] Write migration tests covering old multi-keyword rows, multiple users/profiles, orphan report, no data loss, and uniqueness.
- [ ] Run tests and verify expected failure against current contract.
- [ ] Implement an additive migration: add user/profile ownership and keyword column; split old arrays into rows with recomputed canonical hashes; map legacy workspace content deterministically; verify counts/ownership; then drop old columns, relations, table.
- [ ] Remove preference and user/profile uniqueness and add ownership constraints/indexes.
- [ ] Generate contract artifacts and migration plan; run schema verification and migration tests.

### Task 2: Remove workspace product APIs and support multiple profiles

**Files:** `modules/workspaces/**`; user repositories/services/controllers/DTOs/module; profile repository/service/controller/DTOs; seeds and fakes.

**Interfaces:** Profile operations accept `(userId, profileId)` and verify ownership. Users and contacts are keyed directly by user ID. Profile create/list/update/delete support multiple profiles per user.

- [ ] Add failing service/repository specs for multiple profiles and cross-user profile access.
- [ ] Remove workspace module and workspace route/service/dependency from application wiring.
- [ ] Remove workspace parameters and response fields from user/contact/profile flows; use user-scoped repository methods.
- [ ] Update seeds and test fakes; verify multiple profiles can coexist and deleting a user cascades correctly.
- [ ] Run user/profile focused specs and app typecheck.

### Task 3: Convert query generation to one keyword and remove preference

**Files:** Query builder types/builders/hash/service/repository/DTOs/specs; user skill DTOs/types/services/specs; profile skill seeds.

**Interfaces:** `ChannelQuery.keyword: string`; `QuerySearchRecipe` includes `keyword`; `toRecipe` returns one phrase and hashes it. `RankedSkill` contains technology, importance, mastery only. Query APIs are profile-scoped and verify profile ownership.

- [ ] Add failing tests that recipes have one keyword, aliases are not expanded, hash changes with keyword, and ranking ignores removed preference.
- [ ] Choose one canonical position title deterministically in `keywordPhrases` and update LinkedIn post/job-board builders.
- [ ] Remove technology combination expansion if it exists only to generate phrase arrays; retain the profile's technology set as recipe input.
- [ ] Remove preference from schema-facing skill types, DTO validation/response, service mapping, ordering, fakes, and seeds.
- [ ] Migrate and test query-builder persistence with profileId/userId; update API response from `keywords` to `keyword`.
- [ ] Run query/profile specs and app typecheck.

### Task 4: Channel config, provider contract, and durable collection schema

**Files:** `modules/channels/config/index.ts`, channel provider contracts/registry, channel module, collection models and migration.

**Interfaces:** Exhaustive config by `Channel`, operational settings only. All user-owned run/query/item/task models carry profile/user ownership. Four providers implement a common `collect(search, window)` contract.

- [ ] Test channel config completeness and provider registry uniqueness.
- [ ] Define channel settings: actor IDs, hourly UTC schedules, caps, windows, retry and concurrency limits.
- [ ] Add models for per-profile query state, runs, run-query outcomes, operations, source items, canonical postings, hits, extraction tasks, leases, budget reservations/buckets, outbox, and recovery gaps.
- [ ] Add unique/check/FK constraints ensuring each profile belongs to its user.
- [ ] Generate migration and verify schema.

### Task 5: Fenced leases, cursor state, budgets, outbox, and recovery

**Files:** Channel repositories and services for leases, query state, budgets, dispatch, outbox, and recovery; PostgreSQL integration specs.

**Interfaces:** Lease claims are profile/channel keyed and fenced. Cursor windows are frozen, overlapped, bounded, and per builder. Budget reservation/settlement are atomic/idempotent. Dispatch writes run and outbox in one transaction.

- [ ] Test concurrent claims, expiry, stale-generation rejection, contiguous recovery, and seven-day gaps.
- [ ] Test oversubscription prevention for global and channel budget reservations, replayed settlement, and uncertain spend retention.
- [ ] Test duplicate dispatch and durable re-enqueue after Redis loss.
- [ ] Register stable four hourly schedulers and one-minute recovery scan.
- [ ] Verify hourly skips and incomplete/truncated work never advance cursors.

### Task 6: Apify operations and channel provider implementations

**Files:** Separate Apify provider files for actor start/status/dataset, LinkedIn job search, LinkedIn post search, and Google search; four channel provider files; source normalizers and fixtures.

**Interfaces:** Persist input and reservation before paid start; resume known run IDs; uncertain start becomes `start_unknown`; report completeness, attribution, truncation, items, and cost.

- [ ] Test actor request shape and pagination with local fixtures/fakes.
- [ ] Port career-hub inputs and normalization for LinkedIn jobs/posts and Google Ashby/Greenhouse discovery.
- [ ] Ensure every query's results remain attributed to its profile/query state; fail unknown attribution.
- [ ] Persist all valid returned items without title/company/location filtering.
- [ ] Verify source-specific zero-result, partial, capped, malformed, and truncated outcomes.

### Task 7: Posting extraction and independent retry

**Files:** Separate Ashby API, Greenhouse API, Chromium runtime, and Chromium extraction providers; extraction queue processor and specs.

**Interfaces:** Extraction tasks retry independently of discovery, use fenced claims and source/input versions, and distinguish open/closed/retryable/terminal failures.

- [ ] Test ATS identity parsing, API success/closed/error, Retry-After, throttling, and idempotent result updates.
- [ ] Add bounded Chromium fallback for supported Ashby/Greenhouse pages only.
- [ ] Test redirect/private-network rejection, timeouts, browser context cleanup, unsupported URLs, and stale result rejection.

### Task 8: Worker integration and end-to-end recovery

**Files:** Worker env validation, `infrastructure/jobs/worker.module.ts`, channel queues/processors, integration/smoke specs, docs.

- [ ] Import database and Channels modules without HTTP-only auth/storage dependencies.
- [ ] Verify worker readiness requires Redis, database, and required credentials for enabled channels.
- [ ] Verify graceful drain and browser/database/Redis shutdown.
- [ ] Exercise restart recovery at outbox, actor start, dataset page, persistence, and extraction retry boundaries.
- [ ] Run focused suites, migration checks, build, and workspace-free reference scan; report any preexisting failures and unavailable credentials.

## Execution note

Implement one task at a time, test first, and keep migration data preservation ahead of dropping workspace ownership. Update this plan and the design if an implementation constraint changes a product decision.
