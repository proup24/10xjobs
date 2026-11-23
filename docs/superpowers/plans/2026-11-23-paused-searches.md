# Paused Searches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search builder is collected only while at least one of its owners is active. A paused builder comes back on the next tick after its owner's activity, starting fresh, and a paused user sees a notice with a Resume button on Matches.

**Architecture:** One SQL definition in the engine (`activity.sql.ts`) decides which users are paused at a time `t`. A user is paused when they have a qualified match left undecided for more than `SEARCH_PAUSE_AFTER_HOURS` and no activity signal in that span. The collection step asks for the paused builders of its channel at the start of every tick (no owner active), marks them `pausedAt`, and leaves them out of planning. Builders that come back are moved to a fresh cursor first. The engine API exposes the user's state and a resume action, and the Matches page shows the notice.

**Tech Stack:** Prisma Next contract and migrations, Supabase Postgres, NestJS engine (Vitest, `*.postgres.spec.ts`), `@xjobs/engine-client`, Next.js App Router, `components/ui`.

**Spec:** `docs/superpowers/specs/2026-11-23-paused-searches-design.md`

**Linear ticket:** none (this project uses no ticket tracker).

## Global Constraints

- `SEARCH_PAUSE_AFTER_HOURS`: an integer from 1 to 168, default `24`, read by the engine API and the workers (`apps/xjobs/src/config/environment.validation.ts`, and `.env.example`).
- **Activity signals**, each counted when it falls in `(t − H, t]`, where `H` is the setting:
  - `job_decisions."decidedAt"`, any status (`applied`, `dismissed`, `expired`)
  - `webhook_deliveries."deliveredAt"` where `kind = 'match' AND status = 'delivered'`
  - `users."searchesResumedAt"`
  - `profiles."publishedAt"` of a published profile
- **Waiting match.** A `job_matches` row of the user with all of these:
  - `outcome = 'qualified'`
  - its profile has `state = 'published'`
  - its job has `normalized_jobs.status = 'active'` and `"lastSeenAt" >= t − 7 days`
  - it is not closed, by the same rule as `match_details`: the job's `closed` flag, `job_facts.closed`, or an `expiresAt` at or before `t` (added after the PR A review: the Matches list hides closed rows)
  - there is no `job_decisions` row for `(userId, jobId)`
  - `m."decidedAt" <= t − H`

  These mirror `match_details` (`20261121T1131_profile_edits`) plus the page's 7-day, published-only filter (`apps/web/src/app/(app)/page.tsx`, `WEEK_MS`). Review rows never count, even after the user moves them to Matches (spec: review doesn't count). A rematch that rewrites `decidedAt` restarts the wait. That's accepted, because it only delays a pause.

- **Paused user:** has at least one published profile, at least one waiting match, and no signal in the span. **Paused builder:** `isActive AND NOT isDeleted`, and every user owning a published profile linked to it (`profile_query_search_builders`) is paused.
- **Fresh cursor on return:** `coveredUntil := until − resumeHours`, where `resumeHours` is a new per-channel config field. It's `1` for the hourly configs (LinkedIn job board, trials and posts) and `24` for the daily ones (Greenhouse, Ashby). The existing `minimumHours` and `maximumHours` still clamp the window.
- Only the engine writes `users.searchesResumedAt` and `query_search_builder.pausedAt`. Do not grant `searchesResumedAt` to `authenticated` (the `users-update-columns` invariant lists the user-writable columns).
- Notice copy (exact): title **Searches only you need are paused**. Description "No activity since {date}. Mark a job, or resume now.", where {date} is `lastActiveAt` formatted like the page's other dates. Button **Resume searches**. On a failed resume: "Couldn't resume your searches. Try again."
- Migrations: after `pnpm --filter @xjobs/database db:migration:plan`, set `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the new migration's `to`. Keep every existing invariant and add each new rawSql `invariantId`. Then `pnpm db:reset` and `pnpm db:types` (CI diffs `database.types.ts`). Functions use `SECURITY DEFINER` and `SET search_path = ''`, with fully qualified names.
- UI only from `components/ui` and theme tokens (`apps/web/DESIGN.md`). No service role in the web app. Log lines carry ids and counts only.
- Work in a worktree. There are **two PRs to `main`, merged in order**:
  - **PR A** (Tasks 1–4): schema, activity, API, notice. It pauses nothing, so Resume is live before anyone can pause.
  - **PR B** (Tasks 5–6): collection pauses and wakes.

  Branch PR B from `main` only after PR A has merged (stacked-PR trap). Push only with `git push -u origin <branch>`, and open with `gh pr create --base main`.

- Engine Postgres specs use the disposable `processor_test` DB, the same as the existing `*.postgres.spec.ts`. DB tests run with `pnpm db:test` against the local stack.

## Review Focus

1. **A builder shared by an active user and a paused user.** Expected: it runs, and no `pausedAt` is set. Test in Task 2 (`keeps a shared builder runnable while one owner is active`).
2. **A user with two published profiles, one with a waiting match and one with none.** Expected: activity is per user, so the user is paused and both profiles' unshared builders pause. Test in Task 2 (`pauses per user across profiles`).
3. **A builder published (linked) during a tick, after the paused set was read.** Expected: it runs, because the collection step excludes only known-paused ids and never filters on a runnable set. Test in Task 6 (`runs a builder missing from the paused set`).
4. **A paused builder that was never collected** (`coveredUntil` null). Expected: on return it gets the fresh cursor, not the 24-hour initial look-back. Test in Task 5 (`wakes a never-collected builder to a fresh cursor`).
5. **Resume pressed twice, or with the engine down.** Expected: the second press is a no-op success; with the engine down the notice stays and shows the failure copy. Tests in Task 3 (`resume is idempotent`) and Task 4 (`shows the failure copy when resume fails`).

---

## PR A: schema, activity, API and notice

### Task 1: Migration: resume time, pause mark, indexes, trigger, backfill

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (models `User`, `QuerySearchBuilder`, `JobDecision`, `WebhookDelivery`)
- Create: `libs/database/src/migrations/app/<timestamp>_paused_searches/migration.ts` (planned, then edited)
- Modify: `libs/database/src/migrations/app/refs/db.json`, `libs/database/src/supabase/database.types.ts` (regenerated)
- Test: `libs/database` db-tests (next to the existing profile-edit trigger tests; grep `matchVersion` under the db-test folder)

**Interfaces:**

- Produces columns:
  - `users."searchesResumedAt" timestamptz(3) NULL`, with a comment: "Engine-written: the last Resume, or an edit to a published profile the matcher reads."
  - `query_search_builder."pausedAt" timestamptz(3) NULL`, with a comment: "Set on the first tick that leaves the builder out as paused; null while it runs."
- Produces indexes: `job_decisions ("userId", "decidedAt")` and `webhook_deliveries ("userId", "deliveredAt")`.
- Produces: `public.bump_profile_match_version()` redefined. Whenever it bumps `matchVersion` for a profile whose state is `'published'`, it also runs `UPDATE public.users SET "searchesResumedAt" = now() WHERE id = <that profile's userId>`. This applies in both branches: the profiles BEFORE UPDATE branch, when `OLD.state = 'published' AND NEW.state = 'published'`, and the `profile_skills` branch. Draft edits don't write it.
- Produces a backfill: `UPDATE public.users u SET "searchesResumedAt" = now() WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p."userId" = u.id AND p.state = 'published')`.

- [ ] **Step 1: Write the failing db-tests.**
  - `edit of a published profile sets searchesResumedAt`: update `yearsOfExperience` on a published profile as its owner, then expect `users.searchesResumedAt` to be within 5 s of now.
  - `draft edit and resume-only save leave it null`.
  - `replacing skills of a published profile sets it`, through `replace_profile_skills`.
  - `owner cannot write searchesResumedAt`: an authenticated update of that column fails with a permission error.
- [ ] **Step 2: Run them and expect FAIL:** `pnpm db:test`.
- [ ] **Step 3: Edit the contract, plan the migration, and add rawSql ops** (the trigger redefinition and the backfill, each with its own `invariantId`). Copy the latest `bump_profile_match_version` (`20261121T1131_profile_edits`) whole before changing it, and grep later migrations in case a newer one redefined it. Advance the ref hash, then run `pnpm db:reset` and `pnpm db:types`.
- [ ] **Step 4: Run them and expect PASS:** `pnpm db:test`. Also check the columns directly, e.g. `select "pausedAt" from query_search_builder limit 1`.
- [ ] **Step 5: Commit:** `feat(database): paused searches columns, resume on published edits`.

### Task 2: Activity: who is paused, which builders are paused

**Files:**

- Create: `apps/xjobs/src/modules/activity/activity.sql.ts`, `activity.repository.ts`, `activity.module.ts`, `index.ts`, `testing/fakes.ts`
- Test: `apps/xjobs/src/modules/activity/activity.postgres.spec.ts`
- Modify: `apps/xjobs/src/module-graph.wiring.spec.ts` if the graph lists modules

**Interfaces:**

- Produces `pausedUsersCte(at: Date, hours: number)`: a raw SQL fragment, `paused_users AS (SELECT id AS "userId" FROM public.users …)`, implementing the Global Constraints definition. Both repository methods use it. It's the only definition.
- Produces `abstract class ActivityRepository`, plus `PrismaActivityRepository` (same pattern as `QuerySearchRepository`):
  - `pausedBuilderIds(channel: Channel, at: Date, hours: number): Promise<Set<string>>`: active, non-deleted builders of the channel where every user owning a published profile linked to the builder is in `paused_users`, and at least one such user exists.
  - `userState(userId: string, at: Date, hours: number): Promise<SearchesState>`.
  - `resume(userId: string, at: Date): Promise<void>`: `UPDATE users SET "searchesResumedAt" = GREATEST("searchesResumedAt", at)`.
- Produces `interface SearchesState { paused: boolean; lastActiveAt: Date | null }`.
  - `paused` is true when the user is in `paused_users` **and** owns at least one builder in the paused set (any channel).
  - `lastActiveAt` is the latest of the four signals over all time, or null.
- Produces `FakeActivityRepository` (in-memory sets) for unit tests.

- [ ] **Step 1: Write the failing Postgres specs** (seed users, published profiles, builders, links, matches, decisions and deliveries; `at` fixed):
  - `pauses a user whose match waited 25h with no signal`
  - `does not pause a match that waited 23h`
  - `does not pause an empty or fully decided list`
  - `each signal keeps the user active`: one case per signal, including an `expired` decision
  - `a failed or test delivery is not a signal`
  - `ignores review rows, archived jobs, jobs last seen over 7 days ago, and draft profiles`
  - `keeps a shared builder runnable while one owner is active`
  - `pauses per user across profiles`
  - `userState: paused only when a builder of theirs is paused`: a paused user whose builders are all shared with an active user gets `paused: false`
  - `userState: lastActiveAt is the latest signal`
  - `resume never moves searchesResumedAt back`
- [ ] **Step 2: Run them and expect FAIL:** `npx nx test xjobs -- activity.postgres`.
- [ ] **Step 3: Implement** `activity.sql.ts` and `PrismaActivityRepository`. Pass times as ISO text, ids as array literals, as `segments.repository.ts` does.
- [ ] **Step 4: Run them and expect PASS.**
- [ ] **Step 5: Commit:** `feat(activity): paused users and paused builders`.

### Task 3: Engine API and client: searches state and resume

**Files:**

- Modify: `apps/xjobs/src/config/environment.validation.ts` (+ its spec), `.env.example`
- Create: `apps/xjobs/src/modules/activity/searches.controller.ts`, `dto/searches-state.response.dto.ts`
- Modify: `libs/engine-client/src/client.ts` (+ `client.spec.ts`), `apps/xjobs/src/swagger.spec.ts` if it snapshots routes
- Test: `apps/xjobs/src/modules/activity/searches.controller.spec.ts`

**Interfaces:**

- Consumes `ActivityRepository.userState` and `resume` (Task 2).
- Produces routes, guarded by `UserGuard`, with `@CurrentUser() userId`:
  - `GET /api/me/searches` returns `{ paused: boolean; lastActiveAt: string | null }`
  - `POST /api/me/searches/resume` (`HttpCode(200)`) returns the same shape, read after the resume (so `paused: false`).
- Produces engine-client methods, with the same auth, logging and failure shape as `publishProfile`:
  - `searchesState(): Promise<EngineResult<SearchesStateView>>`
  - `resumeSearches(): Promise<EngineResult<SearchesStateView>>`
  - `type SearchesStateView = { paused: boolean; lastActiveAt: string | null }`

- [ ] **Step 1: Write the failing tests.**
  - Controller with `FakeActivityRepository`: `returns the user's state`, `resume returns paused false`, `resume is idempotent`.
  - Validation: `SEARCH_PAUSE_AFTER_HOURS defaults to 24 and rejects 0 and 169`.
  - Client: `searchesState maps 200`, `resumeSearches maps 503 to an error result`.
- [ ] **Step 2: Run them and expect FAIL:** `npx nx test xjobs` and `npx nx test engine-client`.
- [ ] **Step 3: Implement** the setting, controller, DTO (Swagger decorators as in `profiles.controller.ts`), module wiring and client methods.
- [ ] **Step 4: Run them and expect PASS.**
- [ ] **Step 5: Commit:** `feat(engine): searches state and resume`.

### Task 4: Web: paused notice on Matches

**Files:**

- Create: `apps/web/src/components/matches/paused-notice.tsx` (+ `.spec.tsx`), `apps/web/src/app/(app)/searches-actions.ts`
- Modify: `apps/web/src/app/(app)/page.tsx`, `apps/web/src/components/matches/matches-view.tsx`

**Interfaces:**

- Consumes `searchesState()` and `resumeSearches()` (Task 3) through `engineClient()` (`apps/web/src/lib/engine/server.ts`).
- Produces the server action `resumeSearchesAction(): Promise<{ ok: boolean }>`, which calls `resumeSearches()` and `revalidatePath('/')`.
- Produces `<PausedNotice lastActiveAt={Date | null} />`, a client component that renders the copy from Global Constraints and calls the action.
- The page reads `searchesState()` alongside its other reads. If that read fails, it renders no notice (the notice is advisory; Matches must still load). It passes the state to `MatchesView`, which renders the notice above the list only when `paused`.

- [ ] **Step 1: Write the failing specs:**
  - `renders title, date and button when paused`
  - `renders nothing when not paused`
  - `hides after a successful resume`
  - `shows the failure copy when resume fails`
  - for the page: `Matches loads when the state read fails`
- [ ] **Step 2: Run them and expect FAIL:** `npx nx test web`.
- [ ] **Step 3: Implement**, using only `components/ui` (an alert or callout primitive plus a button; check `apps/web/DESIGN.md` for which one).
- [ ] **Step 4: Run them and expect PASS**, then run `npx nx run-many -t lint test build typecheck`.
- [ ] **Step 5: Commit and open PR A:** `feat(web): paused searches notice with resume`. The PR body says it pauses nothing yet, and that PR B turns pausing on.

---

## PR B: collection pauses and wakes

### Task 5: Segments repository: mark paused, wake fresh

**Files:**

- Modify: `apps/xjobs/src/modules/segments/repositories/segments.repository.ts`, `apps/xjobs/src/modules/segments/testing/fakes.ts`
- Test: `apps/xjobs/src/modules/segments/repositories/segments.postgres.spec.ts`

**Interfaces:**

- Produces `markPaused(queryIds: string[], at: Date): Promise<number>`: sets `"pausedAt" = at` where it's null. Returns the rows changed.
- Produces `wake(channel: Channel, pausedIds: ReadonlySet<string>, cursor: Date): Promise<string[]>`. For the channel's builders with `"pausedAt" IS NOT NULL` whose id is not in `pausedIds`, in one statement:
  - `"coveredUntil" = GREATEST(COALESCE("coveredUntil", cursor), cursor)`
  - `"pausedAt" = NULL`

  It returns the woken ids. It doesn't touch claims.

- [ ] **Step 1: Write the failing Postgres specs:**
  - `markPaused keeps the first pausedAt`
  - `wake moves an old cursor to the fresh cursor`
  - `wakes a never-collected builder to a fresh cursor`
  - `wake never moves a cursor back`
  - `wake leaves still-paused and never-paused builders alone`
- [ ] **Step 2: Run them and expect FAIL:** `npx nx test xjobs -- segments.postgres`.
- [ ] **Step 3: Implement both methods and the fakes.**
- [ ] **Step 4: Run them and expect PASS.**
- [ ] **Step 5: Commit:** `feat(segments): mark paused builders, wake them fresh`.

### Task 6: Collection: leave paused builders out

**Files:**

- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/config.ts` (`resumeHours` on the channel config type: `1` on `hourly`, so job board, trials and posts inherit it; `24` on `daily`)
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts` (`collect`)
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/types.ts` (`CollectionSummary.buildersPaused: number`, `buildersWoken: number`)
- Modify: the collect module wiring (inject `ActivityRepository`), and every place a `CollectionSummary` is built or asserted
- Test: `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.spec.ts` (fakes)

**Interfaces:**

- Consumes `ActivityRepository.pausedBuilderIds` (Task 2), `markPaused` and `wake` (Task 5), and `SEARCH_PAUSE_AFTER_HOURS` (Task 3).
- At the start of `collect(channel)`, before `listActive`:
  1. `paused = pausedBuilderIds(channel, until, hours)`.
  2. `markPaused([...paused], until)`.
  3. `woken = wake(channel, paused, until − resumeHours)`.
  4. `builders = (await listActive(channel)).filter(b => !paused.has(b.id))`.
  5. Log one line: `{channel}: {builders.length} builders runnable, {paused.size} paused, {woken.length} woken`.
  6. The summary's `builders` stays the runnable count.

- [ ] **Step 1: Write the failing specs (fakes):**
  - `the A/B example`: A (TypeScript, React) is active and B (TypeScript, Python) is paused, so the planned job board keyword holds TypeScript and React, not Python. Then B gets a signal, and the next tick's keyword holds all three, with B's builder window starting at `until − 1h`.
  - `runs a builder missing from the paused set`
  - `a paused-only place drops out of the plan`
  - `posts: a woken builder doesn't widen a merged post search past one hour`
  - `summary counts paused and woken`
- [ ] **Step 2: Run them and expect FAIL:** `npx nx test xjobs -- collection.service`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and expect PASS**, then run `npx nx run-many -t lint test build typecheck`.
- [ ] **Step 5: Commit and open PR B:** `feat(collect): pause searches of inactive users`. The PR body carries the rollout:
  - after the deploy, nobody pauses for `H` hours (backfill);
  - on the first day, read the collection log lines on the hosted engine and compare that day's spend with the week before (`search_segment_runs.costMicroUsd`);
  - check that the paused notice appears for a dev user who is paused, and that Resume wakes their builders on the next tick.
