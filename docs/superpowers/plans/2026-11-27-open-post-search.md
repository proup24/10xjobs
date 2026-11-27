# Open Post Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every user turn LinkedIn post search on from a profile's preferences, with the posts budget shared fairly (longest-waiting search first), a "paused until" state for users and a posts budget page for the owner.

**Architecture:** The posts run order is a pure sort applied in `CollectionService` for `LINKEDIN_POSTS` only. The day's posts budget read moves into the segments module (`PostsBudgetService`) so the API (switch view, admin page) and the worker share one rule. Two PRs: PR A (Tasks 1–7) changes nothing users see; PR B (Task 8) flips `available: true` and the $3 default, merged only after slices 04 and 04a are live on dev.

**Tech Stack:** NestJS engine (`apps/xjobs`), Next.js web (`apps/web`), `libs/engine-client`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-27-open-post-search-design.md`

## Global Constraints

- The posts budget env setting stays `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS`; its default moves from `1.5` to `3` only in PR B (Task 8).
- The Morocco day (`Africa/Casablanca`, from tz data) is the budget day everywhere.
- "Reached" means what `CollectionService` already skips on: `spent >= limit` or less than `$0.01` left (`POSTS_MIN_LEFT_USD`). A run with no recorded cost counts `250_000` micro-USD (`POSTS_NULL_COST_MICRO_USD`).
- Only `LINKEDIN_POSTS` gets the new run order; job boards and Indeed keep today's order.
- Users never see dollars or search keywords. Dollars appear only on `/admin/posts-budget`, gated by `ADMIN_USERS`.
- UI only from `apps/web/src/components/ui` and theme tokens (`apps/web/DESIGN.md`).
- Run Vitest with `CI=1 npx vitest run <path>` from the project's folder (`apps/xjobs`, `apps/web`, `libs/engine-client`); `nx test` without `CI=1` hangs in watch mode.
- Postgres specs follow the `rescues.repository.postgres.spec.ts` pattern: `describe.skipIf(!process.env.INGEST_TEST_DATABASE_URL)`.
- Branches: PR A `feat/open-post-search`, branched from `docs/phase-4-slice-04b-spec` (so it carries the spec and plan commits) on top of current `main`; PR B `feat/open-post-search-on` from `main` after PR A merges. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An old web app against a new engine, or the reverse.** The web deploys separately. The engine-client guard must accept a switch view with no `pausedUntil` (read as `null`), or an engine one deploy behind hides the whole switches section. Test in Task 3.
2. **The budget reached by the $0.01 floor, not by `spent >= limit`.** `$2.995` spent of `$3` is paused for users and "reached" on the admin page. Tests in Tasks 1 and 5.
3. **A switch that is on but whose budget read fails** (database error). `GET …/searches` must still answer, with `pausedUntil: null`, rather than 500 and hide the switch. Test in Task 3.
4. **A newly joined builder (`coveredUntil` null) in a segment with old cursors.** The segment sorts first, not by its other members' cursors. Test in Task 2.
5. **A day that crosses Morocco's Ramadan offset change** for "next midnight". `nextMoroccoDayStart` must use the tz data at the next midnight, not now + 24 h. Test in Task 1.

---

## PR A: `feat/open-post-search` (nothing visible to users)

### Task 1: Posts budget read in the segments module

**Files:**

- Move: `apps/xjobs/src/infrastructure/jobs/steps/collect/spend.ts` → `apps/xjobs/src/modules/segments/services/spend.ts` (and `spend.spec.ts` beside it)
- Create: `apps/xjobs/src/modules/segments/services/posts-budget.ts`, `posts-budget.spec.ts`
- Modify: `apps/xjobs/src/modules/segments/segments.module.ts`, `apps/xjobs/src/modules/segments/index.ts`, `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts` (imports; delete its own `POSTS_NULL_COST_MICRO_USD` and `POSTS_MIN_LEFT_USD`)

**Interfaces:**

- Produces (exported from `src/modules/segments`):
  - `DailyBudget`, `moroccoDayStart(now: Date): Date` (moved, unchanged)
  - `nextMoroccoDayStart(now: Date): Date`: the instant of the next 00:00 in Morocco after `now`
  - `POSTS_NULL_COST_MICRO_USD = 250_000`, `POSTS_MIN_LEFT_USD = 0.01`
  - `postsBudgetReached(budget: DailyBudget): boolean`, which is `budget.reached || budget.leftUsd < POSTS_MIN_LEFT_USD`
  - `interface PostsBudgetDay { dayStart: Date; nextDayStart: Date; limitUsd: number; spentMicroUsd: number; reached: boolean }`
  - `@Injectable() class PostsBudgetService { today(now: Date): Promise<PostsBudgetDay> }`, which reads `SearchSegmentsRepository.spentMicroUsd(LINKEDIN_POSTS, dayStart, POSTS_NULL_COST_MICRO_USD)` and `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS` via `ConfigService`. It is provided and exported by `SearchSegmentsModule`.

- [ ] **Step 1: Move `spend.ts` and its spec with `git mv`, fix imports, and run `CI=1 npx vitest run src/modules/segments/services/spend.spec.ts src/infrastructure/jobs/tests/collection.service.spec.ts`.** Expected: PASS, no behaviour change.
- [ ] **Step 2: Write failing tests**
  - In `spend.spec.ts`: `nextMoroccoDayStart` returns the next Morocco midnight in normal time (`2026-11-27T15:00Z` → `2026-11-27T23:00Z`, Morocco on UTC+1). On a date whose next midnight falls on the other side of an offset change in the tz data, it equals `moroccoDayStart` of an instant just after that midnight. Pick the date from tzdata the way the existing `moroccoDayStart` tests do.
  - In `posts-budget.spec.ts` (fake repository from `segments/testing/fakes.ts`): `today()` with limit 3 and spend `2_995_000` gives `reached: true` (the floor); with spend `2_000_000`, `reached: false`; with spend `3_000_000`, `reached: true`; it calls `spentMicroUsd` with `POSTS_NULL_COST_MICRO_USD`; `nextDayStart` equals `nextMoroccoDayStart(now)`.
- [ ] **Step 3: Run them.** Expected: FAIL (missing exports).
- [ ] **Step 4: Implement** `nextMoroccoDayStart` (start from `moroccoDayStart` of `now + 26h`, then step back to the first midnight after `now`, reusing the same two-pass offset read), `postsBudgetReached` and `PostsBudgetService`. Make `CollectionService.collectSegment` use `postsBudgetReached` for the posts check.
- [ ] **Step 5: Run** `CI=1 npx vitest run src/modules/segments src/infrastructure/jobs/tests/collection.service.spec.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `refactor(segments): share the posts budget read`.

### Task 2: Longest-waiting post search first

**Files:**

- Create: `apps/xjobs/src/modules/segments/services/run-order.ts`, `run-order.spec.ts`
- Modify: `apps/xjobs/src/modules/segments/index.ts`; `collection.service.ts` (after `planSegments`, before the summary); `apps/xjobs/src/infrastructure/jobs/tests/collection.service.spec.ts`; `deploy/engine/README.md` (the posts section, item 3)

**Interfaces:**

- Produces: `longestWaitingFirst(segments: readonly SearchSegment[]): SearchSegment[]`. It returns a new array: segments with any member whose `coveredUntil` is null come first, then segments by their oldest member's `coveredUntil` ascending. Ties keep input order (a stable sort).

- [ ] **Step 1: Write failing tests in `run-order.spec.ts`:**
  - Three segments `a` (oldest cursor 10:00), `b` (08:00) and `c` (09:00) sort as `b, c, a`.
  - A segment with members at 07:00 and `null` comes before one whose only member is at 06:00.
  - Two segments with equal oldest cursors keep their input order.
  - The input array is not mutated.
- [ ] **Step 2: Write a failing test in `collection.service.spec.ts`** (`describe('CollectionService posts budget and incomplete runs')`): two post builders for different positions (`fullstack` with `coveredUntil` one hour ago, `backend` with `coveredUntil` five hours ago), and a budget that allows one run (limit `1.5`, the first run costs `$1.50`). The single collected search is `backend`'s. Then a job board test: two harvestapi groups with cursors in the opposite order still run in key order.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement** `longestWaitingFirst`, and in `collect()` use `const segments = channel === Channel.LINKEDIN_POSTS ? longestWaitingFirst(plan.segments) : plan.segments;`. Add one sentence to `deploy/engine/README.md`'s posts item 3: post searches run longest-waiting first, so when the budget runs out, the skipped ones run first next time.
- [ ] **Step 5: Run** `CI=1 npx vitest run src/modules/segments/services/run-order.spec.ts src/infrastructure/jobs/tests/collection.service.spec.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(collect): run the longest-waiting post search first`.

### Task 3: `pausedUntil` on the switch view (engine and client)

**Files:**

- Modify: `apps/xjobs/src/modules/users/types/profile.types.ts` (`SearchSwitchView`), `apps/xjobs/src/modules/users/dto/search-switch.dto.ts` (`SearchSwitchResponseDto`), `apps/xjobs/src/modules/users/services/profiles.service.ts` (`searchSwitches`, `setSearchSwitch`, `switchView`, the constructor), `apps/xjobs/src/modules/users/users.module.ts` (import `SearchSegmentsModule`), `apps/xjobs/src/modules/users/services/profiles.service.spec.ts`, `libs/engine-client/src/client.ts` (`SearchSwitchView`, `isSearchSwitchView`), `libs/engine-client/src/client.spec.ts`

**Interfaces:**

- Consumes: `PostsBudgetService.today(now)` (Task 1).
- Produces: `SearchSwitchView = { key; enabled; searches; pausedUntil: string | null }`, the same shape in the engine and the client. It is the ISO instant of `nextDayStart` when `key === 'posts'`, `enabled` is true and the day is `reached`. Otherwise it is `null`.

- [ ] **Step 1: Write failing tests in `profiles.service.spec.ts`** (use a registry with posts `available: true`, as the existing tests at ~line 757 do, and a fake `PostsBudgetService`):
  - posts on and budget reached: `pausedUntil` equals the fake's `nextDayStart.toISOString()`;
  - posts on and not reached: `null`;
  - posts off and reached: `null`, and `today` is never called;
  - Indeed on and reached: `null`;
  - `setSearchSwitch` turning posts on while reached returns the `pausedUntil`;
  - `today` rejects: `searchSwitches` still resolves with `pausedUntil: null` (it logs a warning).
- [ ] **Step 2: Write failing tests in `libs/engine-client/src/client.spec.ts`:**
  - `searchSwitches` accepts an item with `pausedUntil: '2026-11-28T00:00:00.000Z'`;
  - an item without `pausedUntil` comes back with `pausedUntil: null`;
  - an item with `pausedUntil: 5` is rejected like other malformed data.
- [ ] **Step 3: Run them.** Expected: FAIL.
- [ ] **Step 4: Implement.** `ProfilesService` gets `private readonly postsBudget: PostsBudgetService` before the `@Inject(SEARCH_SWITCHES_TOKEN)` parameter. The budget is read at most once per call, and only when an available posts switch is on. `switchView` takes the `PostsBudgetDay | null`. In the DTO, `pausedUntil` is `@ApiProperty({ nullable: true, type: String, description: 'When paused for the day’s posts budget, the instant post searches resume' })`. The client guard normalises a missing `pausedUntil` to `null`.
- [ ] **Step 5: Run** `CI=1 npx vitest run src/modules/users` (in `apps/xjobs`) and `CI=1 npx vitest run` (in `libs/engine-client`). Expected: PASS. Also run `CI=1 npx vitest run src/swagger/contract.spec.ts` (in `apps/xjobs`); if it snapshots response shapes, update it for the new field.
- [ ] **Step 6: Commit** `feat(users): say when post searches are paused for the budget`.

### Task 4: The paused line on the switch (web)

**Files:**

- Modify: `apps/web/src/components/preferences/search-switch.tsx`, `search-switch.spec.tsx` (plus any fixture building a `SearchSwitchView`, such as `search-switches-section.spec.tsx`, which now needs `pausedUntil`)

**Interfaces:**

- Consumes: `SearchSwitchView.pausedUntil` (Task 3).

- [ ] **Step 1: Write failing tests in `search-switch.spec.tsx`:**
  - With `view({ enabled: true, pausedUntil: '2026-11-28T00:00:00.000Z' })`, the text matches `/Post searches are paused until .+ because today's search budget is used up\. They catch up on what they missed when they restart\./`.
  - With `pausedUntil: null`, nothing matches `/paused until/`.
  - With `key: 'indeed'` and a `pausedUntil`, nothing matches `/paused until/` either (the copy is posts-only for now).
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add a `<span className="mt-1 block">` after the no-searches line. The time is formatted in the viewer's time zone with `Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })`. Format it in a `useEffect` (state starts as `'tomorrow'`), because the server's zone differs from the viewer's and formatting during render would cause a hydration mismatch.
- [ ] **Step 4: Run** `CI=1 npx vitest run src/components/preferences` (in `apps/web`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): show when post searches are paused for the day`.

### Task 5: Admin posts budget endpoint (engine)

**Files:**

- Create: `apps/xjobs/src/modules/admin/posts-budget.service.ts`, `posts-budget.service.spec.ts`, `posts-budget.repository.ts`, `posts-budget.repository.postgres.spec.ts`, `posts-budget.controller.ts`, `posts-budget.controller.spec.ts`
- Modify: `apps/xjobs/src/modules/admin/admin.module.ts` (import `SearchSegmentsModule`, `QuerySearchModule`, `ActivityModule`; register the controller, service and repository)

**Interfaces:**

- Consumes: `PostsBudgetService`, `postsBudgetReached`, `DailyBudget`, `moroccoDayStart`, `POSTS_NULL_COST_MICRO_USD` (Task 1); `planSegments`, `longestWaitingFirst` (Task 2); `QuerySearchService.listActive(channel)`; `ActivityRepository.pausedBuilderIds(channel, at, hours)` with `SEARCH_PAUSE_AFTER_HOURS`.
- Produces: `GET /api/admin/posts-budget` (`UserGuard` and `AdminGuard`, like `RescuesController`). The response:

```ts
type PostsBudgetView = {
  limitUsd: number;
  today: PostsBudgetDayView;
  /** The 7 Morocco days before today, newest first. */
  days: PostsBudgetDayView[];
  /** Current post searches of runnable builders, most behind first. */
  searches: { key: string; profiles: number; oldestCoveredUntil: string | null; overDay: boolean }[];
  /** Active post builders left out because every owner is paused for inactivity. */
  pausedBuilders: number;
  /** Runs of the last 7 days whose result came back full, per segment key. */
  fullRuns: { key: string; runs: number; lastAt: string }[];
};
type PostsBudgetDayView = { dayStart: string; spentUsd: number; reachedAt: string | null };
```

- Repository (`PostsBudgetRepository`, abstract plus Prisma):
  - `runsSince(since: Date): Promise<{ segmentKey: string; startedAt: Date; finishedAt: Date; costMicroUsd: number | null; full: boolean }[]>` covers `LINKEDIN_POSTS` runs with `startedAt >= since`, ordered by `startedAt`; `full` is `truncatedQueryIds` not empty.
  - `profilesFor(builderIds: string[]): Promise<Map<string, string[]>>` reads `profile_query_search_builders`.

- [ ] **Step 1: Write failing tests in `posts-budget.service.spec.ts`** (fake repository, query service, activity and budget):
  - Days: runs costing 1.0, 1.5 and 0.6 on one Morocco day with a $3 limit give `reachedAt` = the third run's `finishedAt`. A day with 2.995 spent is reached at the run that left less than $0.01. A `null` cost counts $0.25. A day not reached has `reachedAt: null`. `days` holds 7 entries, empty days included at `spentUsd: 0`. Past days are judged against today's `limitUsd`; say so in a code comment.
  - Searches: builders paused for inactivity are left out and counted in `pausedBuilders`. `profiles` counts distinct profile ids across a segment's members. `overDay` is true only when the oldest cursor is more than 24 h old; a `null` cursor (never searched) is `overDay: false`. The order matches `longestWaitingFirst`.
  - Full runs: grouped per key, with counts and `lastAt`.
  - If `pausedBuilderIds` throws, every active builder is listed and `pausedBuilders` is `0` (the tick's fail-open rule).
- [ ] **Step 2: Write a failing `posts-budget.controller.spec.ts`**, copying `rescues.controller.spec.ts`: non-admins get 403, admins get the service's view.
- [ ] **Step 3: Write a failing `posts-budget.repository.postgres.spec.ts`** covering `runsSince` (channel filter, order, `full`) and `profilesFor`.
- [ ] **Step 4: Run them.** Expected: FAIL (the postgres spec is skipped without `INGEST_TEST_DATABASE_URL`).
- [ ] **Step 5: Implement** the repository, service and controller (with Swagger DTO classes, as in `rescues.controller.ts`).
- [ ] **Step 6: Run** `CI=1 npx vitest run src/modules/admin src/swagger` (in `apps/xjobs`), with `INGEST_TEST_DATABASE_URL` set if a test database is available (see the processor_test recipe). Expected: PASS.
- [ ] **Step 7: Commit** `feat(admin): posts budget report`.

### Task 6: Admin posts budget page (web)

**Files:**

- Create: `apps/web/src/app/(app)/admin/posts-budget/page.tsx`, `page.spec.tsx`; `apps/web/src/components/admin/posts-budget-report.tsx`, `posts-budget-report.spec.tsx`
- Modify: `libs/engine-client/src/client.ts`, `client.spec.ts`, `index.ts` (`PostsBudgetView` and `adminPostsBudget(): Promise<EngineResult<PostsBudgetView>>`, built the way `adminRescues` is); `apps/web/src/components/layout/user-menu.tsx` (an "Admin: Posts budget" item linking to `/admin/posts-budget`) and its spec, if one exists

**Interfaces:**

- Consumes: the `GET /api/admin/posts-budget` shape (Task 5).

- [ ] **Step 1: Write failing tests:**
  - `client.spec.ts`: `adminPostsBudget` sends `GET …/api/admin/posts-budget` and rejects malformed data.
  - `page.spec.tsx`: copy `admin/rescues/page.spec.tsx` (an unreachable engine shows a retry note; a non-admin gets `notFound`; an admin gets the report).
  - `posts-budget-report.spec.tsx`:
    - "Today" shows `$2.40 of $3.00` and "not reached", or "reached at {time}".
    - It shows seven day rows.
    - A search with `overDay: true` shows "over 24 hours behind".
    - A `null` cursor shows "never searched".
    - The paused-builders count shows.
    - The full-runs list shows each key's count, and the report says "none" when it is empty.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** with `Card`, `Table`, `Badge` and `Text` from `components/ui`.
- [ ] **Step 4: Run** `CI=1 npx vitest run src/app/\(app\)/admin src/components/admin src/components/layout` (in `apps/web`) and `CI=1 npx vitest run` (in `libs/engine-client`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): admin posts budget page`.

### Task 7: Delete the old `/post-search` routes, and open PR A

**Files:**

- Delete: `apps/xjobs/src/modules/users/dto/post-search.dto.ts`
- Modify:
  - `apps/xjobs/src/modules/users/controllers/profiles.controller.ts` (remove the `postSearch` and `setPostSearch` handlers) and its spec;
  - `apps/xjobs/src/modules/users/services/profiles.service.ts` (remove `postSearchStatus`, `setPostSearch`, `postsSwitch` and `toPostSearchView`) and its spec;
  - `apps/xjobs/src/modules/users/types/profile.types.ts` (remove `PostSearchView`);
  - `apps/xjobs/src/swagger/contract.spec.ts` (drop the two `post-search` routes);
  - `libs/engine-client/src/client.ts`, `index.ts`, `client.spec.ts` (remove `PostSearchView`, `postSearchStatus` and `setPostSearch`).

- [ ] **Step 1: Remove them.** Then check that `grep -rn "post-search\|postSearchStatus\|setPostSearch\|PostSearchView\|PostSearchResponseDto" apps/xjobs/src libs/engine-client/src apps/web/src` prints nothing except comments about post-search profiles in `apps/web/src/components/posts` and `apps/web/src/lib/posts`.
- [ ] **Step 2: Run** `npx nx run-many -t lint test build typecheck -p xjobs web engine-client` (with `CI=1`). Expected: all green.
- [ ] **Step 3: Commit** `refactor: remove the old post-search routes`.
- [ ] **Step 4: Push and open PR A.** Run `git push -u origin feat/open-post-search`, then `gh pr create --base main`. The body:
  - says nothing user-visible changes;
  - lists the dev checks: the next posts tick's log shows segments in oldest-cursor order, and `/admin/posts-budget` today matches `SELECT sum(coalesce("costMicroUsd",250000)) FROM search_segment_runs WHERE channel='LINKEDIN_POSTS' AND "startedAt" >= <Morocco midnight>`;
  - links the spec;
  - ends with the Claude Code line.

---

## PR B: `feat/open-post-search-on` (merge only after slices 04 and 04a are live on dev)

### Task 8: Turn post search on for everyone

**Files:**

- Modify:
  - `apps/xjobs/src/modules/queries/switches.ts` (posts `available: true`; update the `available` doc comment) and `switches.spec.ts`;
  - `apps/xjobs/src/config/environment.validation.ts` (`COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS` `.default(3)`) and its spec, if it asserts the default;
  - `.env.example` and `deploy/engine/.env.example` (`# COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS=3`);
  - `deploy/engine/README.md` (`default 3 dollars`);
  - `docs/roadmap/phase-4-social-posts/04b-open-post-search.md` (status built, link to the spec, answer the open questions with the spec's decisions);
  - `docs/roadmap/phase-4-social-posts/README.md` (table row 04b: Built, with a spec link).

- [ ] **Step 1: Write failing tests:**
  - `switches.spec.ts`: the `posts` switch is `available: true`, and `indeed` keeps whatever main has at the time.
  - `environment.validation` spec: an empty env gives `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS === 3`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the two value changes and the docs.
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck -p xjobs web engine-client` (with `CI=1`). Expected: green. Tests that assumed posts unavailable (`profiles.service.spec.ts` and controller specs that expect a 404 for `posts`) now fail; switch them to injecting a registry with posts unavailable, so they keep testing the 404.
- [ ] **Step 5: Commit, push and open PR B** (`feat(queries): open post search to every user`). The PR body:
  - **Merge gate:** slices 04 and 04a must be deployed on dev first.
  - **Owner's step:** set `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS=3` on the hosted engine once the Apify credit covers it.
  - **Dev checks after the deploy:** a second user's profile shows the switch; turning it on attaches post builders (`searches > 0` for a profile with a remote place); its post searches appear on `/admin/posts-budget`.
