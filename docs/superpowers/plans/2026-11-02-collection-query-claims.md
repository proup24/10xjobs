# Collection Query Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only the first worker collects a given query on its channel for an interval, and only a successful run counts as having used that interval.

**Architecture:** Four claim columns are added to `query_search_builder`. `SearchSegmentsRepository.claim` takes a lease on a segment's members in one atomic `UPDATE … RETURNING`. Before each fetch, `CollectionService.runSegment` claims, drops the queries it could not claim, and recomputes the window from the fresh cursors. Success, failure and capped runs release the claims, always scoped by `claimRunId`. A crashed run's claims expire with the lease.

**Tech Stack:** NestJS, TypeScript (strict, nodenext), Prisma Next (`@prisma/orm-postgres`) contract and migrations, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-collection-query-claims-design.md`

## Global Constraints

- The guard is per query (one `QuerySearchBuilder` row), never per segment.
- A run skips a query only when there is a live, overlapping claim, or when `until <= coveredUntil`. A partial overlap with a past success still runs.
- Concurrent runs skip and never wait.
- Only success moves cursors. Failure and capped runs release claims without moving cursors. Crash: the lease expires.
- Every release is filtered by `claimRunId = <this run's id>`.
- `claimLeaseMinutes: 30` for every channel.
- Skipped segments are not written to `search_segment_runs`.
- The claim columns never appear in API responses.
- Run `npx nx run-many -t lint test build typecheck` green before the PR.

## Review Focus

1. **A claim taken but never released because code between the claim and the `try` throws** (window recompute, `buildSearch`). Expected: the claim is released. The test is in Task 4 (`releases claims when narrowing the segment throws`).
2. **`recordRun` itself throws on a failed segment.** Expected: a best-effort `releaseClaims` still runs, and the query is not blocked for 30 minutes. The test is in Task 4.
3. **A run that read its cursors before a concurrent success, then claims after it.** Expected: if `until <= coveredUntil`, the query is skipped as `already-covered`. Otherwise the window is recomputed from the fresh cursor and is not stale. The Postgres test is in Task 2, the service test in Task 4.
4. **A claim held by another run that has expired.** Expected: it can be claimed. A release by another run leaves a live claim untouched. The tests are in Task 2.
5. **A run where every segment is skipped.** Expected: no throw, `segmentsFailed = 0`, and no Apify call. The test is in Task 4.

---

### Task 1: Schema: claim columns and migration

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma` (model `QuerySearchBuilder`, around line 295)
- Generated: `apps/xjobs/src/database/contract.json`, `contract.d.ts`, `migrations/app/<timestamp>_query_search_builder_claims/*`, `migrations/snapshots/*`
- Modify: `apps/xjobs/src/modules/queries/dto/query-search-builder.response.dto.ts`
- Modify: `apps/xjobs/src/modules/queries/controllers/query-search.controller.ts`
- Modify: `apps/xjobs/src/modules/queries/testing/fakes.ts` (only if it builds full rows and fails to typecheck)

**Interfaces:**

- Produces: `QuerySearchBuilderRow` gains `claimRunId: string | null`, `claimWindowStart: Date | null`, `claimWindowEnd: Date | null`, `claimExpiresAt: Date | null`.
- Produces: `CLAIM_COLUMNS` (readonly tuple of those four names) and `withoutClaim(row: QuerySearchBuilderRow): QueryBuilderView`, where `type QueryBuilderView = Omit<QuerySearchBuilderRow, (typeof CLAIM_COLUMNS)[number]>`. Both are exported from `src/modules/queries/dto/query-search-builder.response.dto.ts`.

- [ ] **Step 1: Add the columns after `coveredUntil` in `contract.prisma`**

```prisma
  // Collection claim: the segment run collecting this query now, its interval and lease. All null when unclaimed.
  claimRunId         Uuid?
  claimWindowStart   TimestamptzJsDate(3)?
  claimWindowEnd     TimestamptzJsDate(3)?
  claimExpiresAt     TimestamptzJsDate(3)?
```

and this check:

```prisma
  @@check(expression: sql`("claimRunId" IS NULL) = ("claimWindowStart" IS NULL) AND ("claimRunId" IS NULL) = ("claimWindowEnd" IS NULL) AND ("claimRunId" IS NULL) = ("claimExpiresAt" IS NULL)`, name: "query_search_builder_claim_complete")
```

- [ ] **Step 2: Plan the migration**

Run: `pnpm --filter @xjobs/xjobs db:migration:plan`
Expected: a new `migrations/app/<timestamp>_*` folder that adds 4 columns and 1 check. Rename the folder suffix to `query_search_builder_claims` if the tool lets you choose it. Read `migration.ts` and confirm it only adds columns and a check, and drops nothing.

- [ ] **Step 3: Hide the claim columns from the API**

The DTO implements `QueryBuilderView` instead of `QuerySearchBuilderRow`. `QuerySearchController.list` returns `QueryBuilderView[]` by mapping `withoutClaim` over the service result. `withoutClaim` destructures the four columns away.

- [ ] **Step 4: Typecheck and run the existing tests**

Run: `npx nx run-many -t typecheck test -p xjobs`
Expected: PASS. In particular, `src/swagger/contract.spec.ts` still passes and shows no claim fields.

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/database apps/xjobs/src/modules/queries
git commit -m "feat: add collection claim columns to query search builders"
```

---

### Task 2: Repository: `claim` and `releaseClaims` (Prisma, Postgres-tested)

**Files:**

- Modify: `apps/xjobs/src/modules/segments/repositories/segments.repository.ts`
- Modify: `apps/xjobs/src/modules/segments/index.ts` (export the new types)
- Create: `apps/xjobs/src/modules/segments/repositories/segments.postgres.spec.ts`

**Interfaces:**

- Consumes: the Task 1 columns.
- Produces, in `segments.repository.ts`:

```ts
export type ClaimSkipReason = 'in-flight' | 'already-covered';
export interface ClaimResult {
  /** Members this run now owns, with their cursor as of the claim. */
  claimed: { id: string; coveredUntil: Date | null }[];
  skipped: { id: string; reason: ClaimSkipReason }[];
}
// on SearchSegmentsRepository:
abstract claim(runId: string, queryIds: string[], window: { since: Date; until: Date }, leaseMs: number): Promise<ClaimResult>;
abstract releaseClaims(runId: string): Promise<void>;
// changed signature: the run id is needed to release
abstract recordRun(run: NewSegmentRun & { id: string }): Promise<void>;
```

- `recordRun` and `recordCollectedRun` each release the claims of `run.id` in the same write. `recordCollectedRun` releases inside its existing transaction, after `moveCursors`. `recordRun` wraps the create and the release in one transaction.

- [ ] **Step 1: Write the failing Postgres spec**

Follow `modules/ingest/repositories/raw.postgres.spec.ts`. Use `describe.skipIf(!url)`, `url = process.env.SEGMENTS_TEST_DATABASE_URL`, `createDatabaseClient`, and truncate `query_search_builder` before each test. Insert builders with the same `builder()` helper shape (`isActive: true`). Fix times: `t0 = 2026-11-02T10:00Z`, `t1 = 11:00Z`, `t2 = 12:00Z`, `lease = 30 * 60_000`. Tests:

- `claims every free member and returns its cursor`: two builders, one with `coveredUntil = t0`. `claim('r1', [a, b], {since: t0, until: t2}, lease)` gives `claimed` ids `{a, b}`, the cursor of `a` equals `t0`, and `skipped` is `[]`. Each row has `claimRunId = 'r1'`, `claimWindowEnd = t2`, and `claimExpiresAt` about `now + 30 min`.
- `skips a member another run holds live, as in-flight`: `r1` claims `[a]`, then `claim('r2', [a, b], …)` claims `[b]`, and `skipped` is `[{ id: a, reason: 'in-flight' }]`.
- `takes over an expired claim`: set `a.claimExpiresAt = now - 1 s` directly with `claimRunId 'r1'`. `r2` then claims `a`.
- `allows a non-overlapping interval`: `r1` holds `[t0, t1]`. `r2` with `{since: t1, until: t2}` claims `a`.
- `skips a member whose cursor already reaches until, as already-covered`: `a.coveredUntil = t2`. `claim('r1', [a], {since: t0, until: t2})` gives `skipped: [{ id: a, reason: 'already-covered' }]`.
- `never claims inactive or deleted builders`: an inactive builder is not claimed. Its reason is not asserted.
- `releaseClaims clears only its own run`: `r1` holds `a` and `r2` holds `b`. After `releaseClaims('r1')`, the four claim columns on `a` are null and `b` still has `claimRunId 'r2'`.
- `recordCollectedRun releases and advances in one transaction`: claim `a` as the run id, then call `recordCollectedRun(run, batch, [a])`. `a.coveredUntil = run.windowEnd` and `a.claimRunId` is null.
- `recordRun releases without advancing`: the claim is cleared and `coveredUntil` is unchanged.

The run ids must be uuids (the column is `Uuid`). Use `randomUUID()` and not `'r1'` in the real code; the labels above are for readability.

- [ ] **Step 2: Run it to make sure it fails**

Run: `SEGMENTS_TEST_DATABASE_URL=<disposable segments_test db, migrated> npx nx test xjobs -- segments.postgres`
Expected: FAIL (`claim` is not a function). Without the env var, the suite is skipped. Say so in the PR if you could not run it.

- [ ] **Step 3: Implement `claim` with raw SQL, following `ProcessorRepository.claim`**

`claim` uses one `UPDATE … RETURNING id, "coveredUntil"` with the WHERE clause from spec decision 6: `id = ANY(ids)`, active and not deleted, `"coveredUntil" IS NULL OR "coveredUntil" < until`, and either no live claim or a non-overlapping one. The lease is `now() + make_interval(secs => leaseMs / 1000.0)`. Copy the READ COMMITTED re-evaluation comment from the processor claim, because the same reasoning makes it race-safe. Then classify the unclaimed ids with one `SELECT id, "coveredUntil"` over them: `already-covered` when `coveredUntil >= until`, else `in-flight`. `releaseClaims` is an ORM `updateAll` that sets the four columns to null `where claimRunId = runId`. Factor it into a `clearClaims(orm, runId)` helper, the same way as `moveCursors`, so both record methods call it on `tx.orm`.

- [ ] **Step 4: Run it to make sure it passes**

Run: the same command as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/modules/segments
git commit -m "feat: claim and release query search builders per segment run"
```

---

### Task 3: Fake repository, segment hash helper and lease config

**Files:**

- Modify: `apps/xjobs/src/modules/segments/testing/fakes.ts`
- Modify: `apps/xjobs/src/modules/segments/services/segments.ts`, `services/segments.spec.ts`, `index.ts`
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/config.ts`

**Interfaces:**

- Consumes: `ClaimResult` and the `claim`/`releaseClaims` contract from Task 2.
- Produces:
  - `segmentHash(key: string, memberIds: readonly string[]): string`, exported from `modules/segments`. `buildSegments` uses it, so existing hashes don't change.
  - `FakeSearchSegmentsRepository` gains these members:
    - `claims: Map<string, { runId: string; since: Date; until: Date; expiresAt: Date }>`
    - `now: () => Date` (default `() => new Date()`)
    - `failRecordRun = false`: when true, `recordRun` throws `new Error('record failed')`.
    - `released: string[]`: the run ids passed to `releaseClaims` or released by the record methods.
  - It implements the same rules as the SQL: active state is not modelled, and `coveredUntil` comes from `cursors`.
  - `ChannelJobConfig.claimLeaseMinutes: number`, set to `30` in `hourly`, `tenMinutes` and `twoMinutes`. `daily` inherits it from `hourly`.

- [ ] **Step 1: Write the failing test in `segments.spec.ts`**

`segmentHash matches the hash buildSegments assigns`: for any segment from `buildSegments`, `segmentHash(segment.key, segment.members.map(m => m.id)) === segment.hash`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx nx test xjobs -- segments.spec`
Expected: FAIL (`segmentHash` is not exported).

- [ ] **Step 3: Extract `segmentHash`, add the fake's claim logic, and add `claimLeaseMinutes`**

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx nx run-many -t test typecheck -p xjobs`
Expected: PASS. Existing callers of `recordRun` fail to typecheck until Task 4 passes an id. If that happens, do this task and Task 4 in one commit.

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/modules/segments apps/xjobs/src/infrastructure/jobs/steps/collect/config.ts
git commit -m "feat: add claim-aware segments fake, segment hash helper and lease config"
```

---

### Task 4: `CollectionService` claims before fetching

**Files:**

- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts`
- Test: `apps/xjobs/src/infrastructure/jobs/tests/collection.service.spec.ts`

**Interfaces:**

- Consumes: `claim`, `releaseClaims` and `recordRun(run & { id })` (Task 2), `segmentHash` and the fake (Task 3), `channelJobsConfig[channel].claimLeaseMinutes` (Task 3), and the existing `segmentWindow` and `buildSearch`.
- Produces: `CollectionSummary` gains `queriesSkipped: number` and `segmentsSkipped: number`.

`runSegment` works in this order:

1. `runId = randomUUID()` and `startedAt`.
2. `first = segmentWindow(segment.members, until, config.window)`.
3. `claim(runId, memberIds, first, leaseMinutes * 60_000)`.
4. If nothing was claimed, log `Segment <key> skipped: <n> in-flight, <m> already-covered` and return `{ skipped: true, … }`.
5. Otherwise, in a `try` that now begins here:
   - Narrow the segment to the claimed members, with their fresh `coveredUntil`.
   - Recompute the window over them with the same `until`. The claim stays at `first`; it is not narrowed (spec decision 7, settled here).
   - Build the search and the run with `id: runId` and `segmentHash: segmentHash(segment.key, claimedIds)`.
   - Fetch and save, as today.
   - If some members were skipped, log the skip line as well.
6. On failure:
   - `recordRun({ …run, status: 'failed' })`.
   - If that throws, log it and then `await segments.releaseClaims(runId).catch(log)`.
7. The rule that throws when every segment failed compares `segmentsFailed` with `segments - segmentsSkipped`, and fires only when that count is greater than 0.

- [ ] **Step 1: Write the failing tests**

Add these to `collection.service.spec.ts`, using `setup()` with `segments.claims` and `segments.cursors` set up front:

- `skips a query another run holds and searches the rest`: 3 builders, with the first claimed live by `'other'`. The collector is called once, with `queries.map(q => q.id)` equal to the other two. The recorded run has `queryIds` equal to those two and `segmentHash === segmentHash(key, [those two])`. `summary.queriesSkipped === 1` and `summary.segmentsSkipped === 0`.
- `skips a segment whose queries are all held, without calling the collector or recording a run`: every member is claimed live by `'other'`. `collector.collect` is not called. `segments.runs` and `segments.collected` are empty. `summary.segmentsSkipped === 1`, and `collect()` resolves (does not throw).
- `skips a query already covered up to until`: a member's cursor is set in the future (`until + 1 min`). That member is not searched.
- `recomputes the window from the cursor returned by the claim`: `rows` carry `coveredUntil: null`, but the fake cursor for every member is `until - 1 h`. Then `search.since === until - 1 h - overlap` (ASHBY daily: `minimumHours` 72 applies, so use `Channel.LINKEDIN_POSTS` with 15-minute overlap: `since = until - 75 min`).
- `releases claims and moves cursors on success`: after `collect`, `segments.claims` is empty and every member's cursor is `windowEnd`.
- `releases claims without moving cursors on a capped run`: the result has `capped: true`. Claims are empty and the cursors are unchanged.
- `releases claims on a failed fetch`: the collector rejects. Claims are empty, a `failed` run is recorded with `id` equal to the claim's run id, and the cursors are unchanged.
- `releases claims even when recording the failure throws`: the collector rejects and `segments.failRecordRun = true`. Claims are empty, `segments.released` contains the run id, and `collect()` throws only because every attempted segment failed.
- `releases claims when narrowing the segment throws`: `vi.spyOn(segments, 'claim')` resolves with `claimed: [{ id: 'not-a-member', coveredUntil: null }]`. `runSegment` must throw on a claimed id that is not a member, as an invariant guard inside the `try`. The claims of the run id are released (`segments.released` contains it) and a `failed` run is recorded.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx nx test xjobs -- collection.service`
Expected: the new tests FAIL. The existing tests still pass, or fail only on the new summary fields. Update `toEqual` summaries to include `queriesSkipped: 0, segmentsSkipped: 0`.

- [ ] **Step 3: Implement the `runSegment` order above**

- [ ] **Step 4: Run the full engine suite**

Run: `npx nx test xjobs`
Expected: PASS. This includes `infrastructure/worker/tests/collection-worker.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/infrastructure/jobs
git commit -m "feat: claim queries before collecting a segment and skip held or covered ones"
```

---

### Task 5: Docs and CI

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/README.md` or the collection section that describes cursors (whichever describes the run flow), with one short paragraph on claims and skips.
- Modify: `apps/xjobs/src/modules/segments/segments.module.ts` doc comment: "run records, builder collection cursors and claims".

- [ ] **Step 1: Update the docs**

- [ ] **Step 2: Run CI locally**

Run: `npx nx run-many -t lint test build typecheck`
Expected: all targets succeed.

- [ ] **Step 3: Commit**

```bash
git add -A apps/xjobs/src
git commit -m "docs: describe collection query claims"
```
