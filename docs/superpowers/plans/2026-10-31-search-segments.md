# Search Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Channel jobs run Apify once per search segment, with up to 10 builders per channel × domain × type × place. Each builder has a look-back cursor, every segment run is recorded, and the static `channelConfig` is gone.

**Architecture:**

- A pure `buildSegments` and `segmentWindow`, plus a repository, live in a new `modules/segments`.
- Collectors take a whole segment and return its results grouped by builder.
- `CollectionJob.run` puts these together.
- Operational settings move into `channelJobsConfig`.

**Tech Stack:** NestJS 11, Prisma 8 contract + migrations, BullMQ, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-search-segments-design.md`

## Global Constraints

- Segment size is 10. The key is `channel|domain|type|country|city` for on-site and hybrid, and `channel|domain|type|locationRegion` for remote. Members are sorted by builder `hash`. The segment hash is the sha256 of the key plus the ordered member ids, joined by `\n`.
- Window: `until` is the run start. `since` is the oldest member `coveredUntil` (or `until − 24h` when there is none), minus 15 minutes, and never earlier than `until − 24h`.
- `capped` means `costUsd >= 0.95 × maxRunChargeUsd`.
- Run status: `succeeded` | `partial` | `failed`.
- Cursors only advance for members whose results were fully ingested.
- No profile or user fields in the Apify input.

## Review Focus

1. **A result that matches no member, for example a redirected URL in `inputUrl`.** It must be counted and dropped, never attributed to the wrong builder. Test it in Task 4.
2. **A builder whose `coveredUntil` is in the future (clock skew).** The window must still be valid (`since < until`). Test it in Task 2.
3. **A segment where every member's ingest fails.** The status must be `failed`, not `partial`. Test it in Task 5.
4. **Apify not reporting cost.** `costMicroUsd` is null and `capped` is false. Test it in Task 4.
5. **Remote builders with a null region.** They group under a `GLOBAL` key, not `null`. Test it in Task 2.

---

### Task 1: Contract — builder cursor and segment run records

**Files:** `apps/xjobs/src/database/contract.prisma`, the emitted contract files, a new migration under `migrations/app/`, `src/database/models.ts`

- [ ] Add `coveredUntil TimestamptzJsDate(3)?` to `QuerySearchBuilder`.
- [ ] Add the `SearchSegmentRun` model (`@@map("search_segment_runs")`) with the spec's fields:
  - `queryIds Uuid[]`
  - `truncatedQueryIds Uuid[]`
  - `perQuery Jsonb`
  - `costMicroUsd Int?`
  - a check that `status IN ('succeeded','partial','failed')`
  - `@@index([channel, startedAt])`
- [ ] Run `pnpm --filter @xjobs/xjobs db:emit` and `db:migration:plan --name search_segments`. Expected: a new migration folder and snapshot.
- [ ] Export `SearchSegmentRunRow` from `models.ts`. Run `npx nx typecheck xjobs` and expect PASS.
- [ ] Commit: `feat(db): builder cursor and search segment runs`

### Task 2: `modules/segments` — building segments and windows

**Files:** `apps/xjobs/src/modules/segments/{segments.ts,window.ts,index.ts}`, tests next to them

**Produces:**

- `buildSegments(builders: QuerySearchBuilderRow[], size = 10): SearchSegment[]`, where `SearchSegment = { key: string; hash: string; channel: Channel; members: QuerySearchBuilderRow[] }`.
- `segmentWindow(members, until: Date, window: { initialHours; overlapMinutes; maximumHours }): { since: Date; until: Date; clipped: boolean }`.

- [ ] Write the failing tests:
  - 25 on-site backend builders in one city give segments of 10, 10 and 5.
  - On-site and hybrid builders in the same city are split.
  - The same city with different domains is split.
  - Remote builders group by region; a null region uses the key `GLOBAL`.
  - Shuffled input gives the same keys, hashes and members.
  - Window: no cursors gives `until − 24h`; the oldest cursor minus 15 minutes; a 3-day-old cursor is clipped to 24 hours with `clipped: true`; a future cursor still gives `since < until`.
- [ ] Run them and see them fail. Implement. Run them again and see them pass. Commit: `feat(segments): build search segments and their windows`

### Task 3: Run records and cursors

**Files:** `apps/xjobs/src/modules/segments/{segments.repository.ts,segments.module.ts,testing/fakes.ts}`

**Produces:**

- `SearchSegmentsRepository.recordRun(run: NewSegmentRun): Promise<void>`
- `SearchSegmentsRepository.advanceCursors(queryIds: string[], until: Date): Promise<void>`
- A Prisma implementation and `FakeSearchSegmentsRepository`.
- `SearchSegmentsModule`, which exports the repository.

- [ ] Write the failing tests: the fake records runs and advances only the given ids. A Prisma repository type-level smoke test via `npx nx typecheck`.
- [ ] Implement. `advanceCursors` updates `coveredUntil` with `GREATEST`-style semantics: it never moves a cursor backwards. Commit: `feat(segments): record segment runs and advance builder cursors`

### Task 4: Channel config and segment collectors

**Files:**

- Modify `infrastructure/jobs/config/index.ts`.
- Delete `modules/collectors/config/*`.
- Modify `apify.provider.ts`, the three Apify triggers, and the four collectors in `types/collector.ts`.
- Tests: rewrite `search-input.spec.ts` and `collected-job.spec.ts`.

**Produces:**

- `channelJobsConfig[channel]` with `actor`, `maxRunChargeUsd`, `window`, `segmentSize` and a channel `collect` block. The values come from the old `channelConfig`.
- `ApifyActorProvider.run(...)` returns `{ items: unknown[]; costUsd: number | null }`.
- `Collector.collect(segment: SegmentSearch, config: ChannelJobConfig): Promise<SegmentResult>`, with both types as in spec decision 5.

- [ ] Write the failing tests, each with a 3-member segment:
  - **Job board:** one run whose `startUrls` contains the three URLs plus `sortBy=DD` and `f_TPR=r<seconds>`. Items are matched back by `scrapingInfo.inputUrl`. An unknown `inputUrl` is dropped and counted in `fetched`. A member is truncated when it scanned `maxRowsPerUrl` or more.
  - **Posts:** one run with three `searchQueries` and `postedLimitDate` set to `since` in ISO format. Items are matched back by `query.search`.
  - **Google, for Ashby and Greenhouse:** one run whose `queries` holds the three lines, with `quickDateRange: 'h<n>'`. Hits are matched back by `searchQuery.term`.
  - **Cost:** at 95% of the cap, `capped` is true. When Apify reports no cost, `costUsd` is null and `capped` is false.
- [ ] Implement, then run `npx nx test xjobs` and `npx nx typecheck xjobs`. Commit: `refactor(collectors): one Apify run per search segment`

### Task 5: `CollectionJob.run` over segments

**Files:** `infrastructure/jobs/collection/*.job.ts`, `jobs.module.ts` (import `SearchSegmentsModule`), `tests/collection.job.spec.ts`

**Produces:** `CollectionJob.run(): Promise<CollectionSummary>`. The summary gains `segments` and `segmentsFailed`.

- [ ] Write the failing tests, using fakes for queries, collector, ingest and the segments repository:
  - 12 builders give 2 collects.
  - Ingest is called per member with its own `queryId` and a shared `observedAt`, split into batches of 1000.
  - Cursors advance only for members whose ingest succeeded.
  - `recordRun` gets the key, hash, member ids, window, cost, `perQuery` and status (`succeeded`, `partial`, or `failed` when every member fails).
  - A segment that throws in collect is recorded as `failed` and the next one still runs.
  - The job rejects only when every segment failed.
  - No builders means no collect.
- [ ] Implement, run the tests, and commit: `feat(jobs): collect by search segment with cursors and run records`

### Task 6: Docs and verification

- [ ] Update the ingest README and `CLAUDE.md` if they mention `channelConfig`. Run `npx nx run-many -t lint test build typecheck` and expect it to be green.
- [ ] Commit: `docs: search segments`
