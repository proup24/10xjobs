# Collection query claims: only the first successful run collects an interval

Date: 2026-11-02. Builds on `2026-10-31-search-segments-design.md`.

## Intent

Today, a collect run reads each builder's `coveredUntil` cursor, computes a segment window, pays for an Apify run, and only then moves the cursors in `recordCollectedRun`. Nothing marks a query as being worked on while it is in flight. If two runs reach the same query at the same time, both read the same stale cursors and both pay for the same window. That happens when two processes consume the same channel queue (`worker-all` next to `worker-<channel>`, overlapping deploys), or when a run outlasts its tick and another process picks up the next one. `concurrency: 1` limits jobs only within one process, so it doesn't prevent this.

The rule the user wants is: **for a given query on its channel, only the first worker collects an interval, and only a successful run counts as having used it.**

## Goals

- The guard is keyed on the **query** (one `QuerySearchBuilder`, which is already one channel and one recipe hash, shared across workspaces), not on the segment. Segments are rebuilt on every run, and their membership changes as builders are activated or retired. A segment-level guard would let the same query through twice under two segment hashes.
- **In flight:** the first run to claim a query for an interval does the work. A concurrent run whose interval overlaps a live claim on that query skips the query. It does not wait.
- **Already succeeded:** a run whose interval for a query is fully covered by an earlier successful run (`until <= coveredUntil`) skips that query.
- **Partial overlap still runs** (decided by the user). The deliberate `overlapMinutes` re-search and the `minimumHours` window of the daily board channels are how late-indexed postings are caught. They must keep working.
- **Only success counts.** A failed run releases its claims right away. A crashed run's claims expire with their lease. A capped run releases its claims without moving the cursors, which is the behaviour today. In all three cases the next tick can collect the interval again.
- **Mixed segments:** the run drops skipped queries from the segment and still searches the rest. When every member is skipped, Apify is not called.
- Skips are visible: each skip is logged with its reason, and the run summary counts them.

## Non-goals

- Waiting for, or queueing behind, an in-flight claim.
- Changing the window maths (`segmentWindow`), the overlap, or the minimum and maximum hours.
- Deduplicating the results of runs that legitimately overlap. Ingest already drops duplicates.
- A recency skip (decided by the user). A run that starts after another run and reaches a query just after that run succeeded still re-searches its partial overlap. On the daily board channels, that means close to the whole 72-hour minimum window. Only a live claim or full coverage skips a query.
- A guard at the BullMQ level (scheduler ids, job ids). The guard lives in Postgres so that it holds across processes and machines.

## Anti-goals

- Missing jobs. A crashed or failed worker must never leave a query blocked beyond its lease, and the guard must never move a cursor.
- Blocking the intended overlap, so that late-indexed postings stop being caught.
- Paying twice for the same query and interval when two runs race.

## Decisions

Decided by the user:

1. The guard applies per query on its channel, over an interval.
2. Only the first worker passes. Concurrent runs skip and do not wait.
3. Only a successful run's interval counts as used.
4. A run whose interval only partly overlaps a successful one still goes ahead.

Builder's calls (Claude's choices; open to change):

5. **The claim lives on the builder row.** `QuerySearchBuilder` gains these nullable columns:
   - `claimRunId Uuid?`: the segment run that holds the claim.
   - `claimWindowStart TimestamptzJsDate(3)?` and `claimWindowEnd TimestamptzJsDate(3)?`: the interval claimed.
   - `claimExpiresAt TimestamptzJsDate(3)?`: the lease.

   Add a check constraint: either all four are null, or none are. There is at most one live claim per query, and that is enough. Concurrent runs all end their window at roughly "now", so their intervals for the same query always overlap.

6. **Claiming is one atomic statement per segment, taken just before that segment is fetched** (not for every segment at the start of the run, where leases could expire during long runs). In outline:

   ```sql
   UPDATE query_search_builder
      SET "claimRunId" = $runId, "claimWindowStart" = $since,
          "claimWindowEnd" = $until, "claimExpiresAt" = now() + $lease
    WHERE id = ANY($memberIds)
      AND "isActive" AND NOT "isDeleted"
      AND ("coveredUntil" IS NULL OR "coveredUntil" < $until)          -- not already covered
      AND ("claimExpiresAt" IS NULL OR "claimExpiresAt" <= now()        -- no live claim...
           OR "claimWindowEnd" <= $since OR "claimWindowStart" >= $until) -- ...or no overlap
   RETURNING id, "coveredUntil";
   ```

   The members that come back are the ones this run owns. Every other member is skipped. The skip reason is `already-covered` when `coveredUntil >= until`, and `in-flight` otherwise. The reason is computed from a follow-up read and is for logs only.

7. **The window is recomputed after the claim** from the `coveredUntil` values that were just returned, over the claimed members only. This prevents a run that read its cursors before a concurrent success from searching an interval it no longer needs. The claimed interval for step 6 comes from a first `segmentWindow` over the cursors as they were read. If the recomputed window is narrower, the claim row is updated to match it in the same transaction as the claim, or the claim is simply left wider (harmless, because it is released soon after). That choice is left to the plan.
8. **Release.**
   - Success: `recordCollectedRun` clears the claim columns for `claimRunId = run.id` in its existing transaction, at the same time as it moves the cursors.
   - Failure: `recordRun` clears them the same way.
   - Crash: the lease expires.

   Releases are always filtered by `claimRunId`, so a run can never clear another run's claim.

9. **Lease length** is a new per-channel setting, `claimLeaseMinutes`, in `channelJobsConfig`. It must be longer than the slowest segment run (Apify fetch plus storage). Default: 30 minutes for every channel, to be revisited against observed run times in `search_segment_runs`.
10. **Segment identity after skips.** If members are dropped, the run record's `queryIds` and `segmentHash` describe the members that were actually searched. The hash is recomputed with the same formula as `buildSegments`: sha256 of the key plus the ordered member ids. `segmentKey` is unchanged.
11. **Skipped segments are not recorded** in `search_segment_runs`. They are logged at `log` level as `Segment <key> skipped: <n> in-flight, <m> already-covered`. `CollectionSummary` gains `queriesSkipped` and `segmentsSkipped`. A run where every segment was skipped is not a failure. The rule "throw when all segments failed" counts only segments that were attempted.
12. **Code placement.** `SearchSegmentsRepository` gains `claim(runId, memberIds, window, leaseMs)` and `releaseClaims(runId)`, and the two existing record methods release in their own transactions. The fake in `modules/segments/testing/fakes.ts` mirrors the SQL semantics. `CollectionService.runSegment` calls `claim` before `segmentWindow` / `buildSearch`. The schema change goes through `contract.prisma` and a new migration under `apps/xjobs/src/database/migrations/app/`.
13. **Workspace scope.** Builders are shared recipes across workspaces by design, so the claim is global. Two workspaces that use the same query therefore pay for it once. This does not break workspace isolation, because no workspace data is read or written.

14. **Run id first.** `buildRun`'s id is created before the claim, since the claim stores it.
15. **Release is robust.** Everything between the claim and the existing `try` (the window recompute and `buildSearch`) moves inside the failure handling. If `recordRun` fails on a failed segment, a best-effort `releaseClaims(runId)` still runs, so a query is not blocked for a whole lease.
16. **The API does not expose claims.** `QuerySearchBuilderResponseDto` omits the four claim columns.
17. **Lease safety.** Apify runs abort after `waitSecs` (300 s by default in `apify.provider.ts`), so a 30-minute lease outlasts any segment run.

## Testing

- **Postgres repository spec** `modules/segments/repositories/segments.postgres.spec.ts`, following `raw.postgres.spec.ts` and `processor.postgres.spec.ts`. It covers these cases:
  - While a claim is live, a second claim on the same members gets nothing back.
  - After the lease expires, the second claim succeeds.
  - A claim with `until <= coveredUntil` gets nothing back.
  - An interval that does not overlap the live claim can be claimed.
  - A release clears only the releasing run's claims.
  - The fake in `testing/fakes.ts` mirrors the same cases.
- **`CollectionService`** (unit, against the fakes). It covers these cases:
  - A mixed segment searches only its claimed members, and the run record's hash and `queryIds` reflect that.
  - A fully skipped segment does not call the collector and is not recorded.
  - A failure releases the claims, including when `recordRun` itself throws.
  - Success releases the claims and moves the cursors.
  - A capped run releases the claims without moving the cursors.
  - When all segments are skipped, the run does not throw.

## Left to the plan

- The exact ORM form of the atomic claim, whether the ORM's `updateAll` with a returning clause or raw SQL through `DatabaseService`.
- Whether the claim interval is narrowed after the window is recomputed (decision 7).
- The migration name and ordering.
