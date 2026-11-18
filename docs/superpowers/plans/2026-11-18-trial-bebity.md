# Trial Actor bebity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `bebity/linkedin-jobs-scraper` as a third LinkedIn job-board intake (`LINKEDIN_JOB_BOARD_BEBITY`), make every channel's daily cap count Apify's final run cost, and make `db:actor-compare` compare each pair of actors only on search groups both ran in the same tick.

**Architecture:** The channel plugs into the trial machinery cheap_scraper built (`TRIAL_CHANNELS`, `isLinkedinJobBoard`, per-channel caps, splits, joins). Its collector sends bebity's own search fields, because its URL mode drops `f_WT`. Trial items key by LinkedIn id. Segment runs gain the Apify run id and a final-cost time; each tick re-reads unsettled costs before reading the budget. The report gains run, builder and tick data and computes overlap per actor pair on (group, tick) pairs both ran.

**Tech Stack:** NestJS engine (apps/xjobs), BullMQ, Apify, Prisma-next contract + generated migration (libs/database), Supabase Postgres, Next.js (apps/web), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-trial-bebity-design.md` (it builds on `docs/superpowers/specs/2026-11-18-trial-linkedin-actors-design.md`; read that one's Decisions too).

## Global Constraints

- Work only in the worktree `/home/lab/apps/10xjobs/.worktrees/bebity`, branch `feat/trial-bebity` (on top of `fix/cheap-scraper-1gb`, PR #95, which adds `ActorRunConfig.memoryMbytes`). Never touch the main checkout `/home/lab/apps/10xjobs`. One PR to `main`, pushed only with `git push -u origin feat/trial-bebity`. Never read or write `.env*`.
- Channel value, exactly: `LINKEDIN_JOB_BOARD_BEBITY`. Actor, exactly: `bebity/linkedin-jobs-scraper`. Queue `collect-linkedin-job-board-bebity`, nx target `worker-linkedin-job-board-bebity`.
- Env, exactly: `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_BEBITY`, default **1**. `COLLECTION_TRIAL_CHANNELS` accepts it.
- bebity run config: `maxRowsPerSearch: 100`, `maxRowsCeiling: 1000`, `maxRunChargeUsd: 0.15`, `memoryMbytes: 1024`. Schedule and window: harvestapi's (`linkedinJobBoard` in `collect/config.ts`).
- bebity input: `titles: [mergedLinkedinKeyword(queries)]`, `locations: [<name by geoId>]`, `workTypes: [workType]` when set, `experienceLevels: <codes split on ','>` when set, `publishedAt: 'r3600'`, `rows`, `companyProfile: false`, `enrichCompany: false`. No `startUrls`.
- geoId → bebity place name, exactly: `102787409` Morocco, `103644278` United States, `100506914` Europe, `91000001` Middle East, `91000011` Latin America, `103537801` Africa, `101174742` Canada. Any other geoId (MENA is `91000008`) → `SearchNotStartedError`.
- Merge precedence: bebity `2.2` (harvestapi `2`, cheap_scraper `2.4`).
- A trial channel's job key is always `linkedin-job:<id>`. harvestapi's rule is unchanged.
- New `search_segment_runs` columns, exactly: `apifyRunId String?`, `costFinalAt TimestamptzJsDate(3)?`. Cost is final when read ≥ 5 minutes after `finishedAt`; re-read covers `finishedAt` within the last 24 hours.
- harvestapi's and cheap_scraper's builders keep their hashes. harvestapi's collection is unchanged except that its cap counts re-read final costs.
- The Prisma contract is the only schema source. Generate the migration (`pnpm --filter @xjobs/database db:migration:plan`), then set `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the migration's `to`; keep `invariants` unchanged.
- Postgres specs need `INGEST_TEST_DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:54398/ingest_test` and `PROCESSOR_TEST_DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:54399/processor_test` (containers `xjobs-ingest-test`, `xjobs-processor-test`; `docker.exe start …`). Apply this branch's migrations to both, and confirm each suite ran, not skipped. Two VocabRepository and two webhooks merge-root failures also fail on `main`; ignore them.
- Tests never hard-code Morocco's UTC offset (CI's Node has different tz data).
- Badge copy, exactly: `LinkedIn · bebity`. Badge order: harvestapi, bebity, cheap_scraper. UI only from `components/ui` and theme tokens.
- CI: `npx nx run-many -t lint test build typecheck` passes.

## Review Focus

1. **bebity's daily cap stops it partway through a tick.** Groups it didn't reach must not count in any pair with bebity; they show as "skipped". Pinned in Task 6 (`excludes groups an actor did not run from that pair`).
2. **A MENA segment on bebity.** No Apify call, a failed run row with cost 0, and the report shows "not started". Pinned in Task 2 (`does not start a search whose geoId has no bebity place`) and Task 6 (`labels not-run reasons`).
3. **A run that started and then failed or timed out.** Its run id is stored and its final cost is re-read, so the cap counts real spend rather than the charge cap forever. Pinned in Task 4 (`stores the run id of a run that failed after starting`).
4. **bebity and cheap_scraper see the same LinkedIn id, then harvestapi sees it with an `ats:` key.** One job throughout, and both trial items re-link to harvestapi's job. Pinned in Task 3 (`joins two trial actors and then harvestapi`).
5. **Old bebity raw rows (no `postedTime`) on renormalize** map exactly as before. Pinned in Task 3 (`maps an old bebity item as before`).

---

### Task 0: Docs

- [ ] **Step 1:** `git log --oneline -3` shows `docs: trial actor bebity design` on top of `fix(collectors): run cheap_scraper at 1 GB…`.
- [ ] **Step 2:** Commit this plan: `docs(plan): trial actor bebity`.

### Task 1: Channel value, run cost columns, migration

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (`enum Channel` line 72; `model SearchSegmentRun` line 419)
- Modify: `libs/database/src/enums/channel.enum.ts`, `libs/database/src/enums/channel.enum.spec.ts`
- Create: `libs/database/src/migrations/app/<timestamp>_trial_bebity/` (generated)
- Modify: `libs/database/src/migrations/app/refs/db.json`
- Modify (placeholders, finished in later tasks): `ingest/config/channels.ts`, `ingest/normalize/normalize.ts`, `ingest/normalize/merge.ts`, `ingest/normalize/job-key.ts`, `ingest/utils/source-key.ts`, `queries/channels/index.ts`, `infrastructure/jobs/steps/collect/config.ts`, `collection.service.ts` (`fetch`, `boardRun`, `budgetSetting`), `apps/web/src/lib/matches/sources.ts`

**Interfaces:**

- Produces: `Channel.LINKEDIN_JOB_BOARD_BEBITY`; `TRIAL_CHANNELS = [CHEAP, BEBITY]`; `ACTIVE_CHANNELS = [LINKEDIN_JOB_BOARD, CHEAP, BEBITY]`; `SearchSegmentRun.apifyRunId: string | null`, `SearchSegmentRun.costFinalAt: Date | null`.

- [ ] **Step 1: Failing test.** In `channel.enum.spec.ts`: `isTrialChannel` and `isLinkedinJobBoard` are true for `LINKEDIN_JOB_BOARD_BEBITY`; `ACTIVE_CHANNELS` contains it.
- [ ] **Step 2:** `npx nx test @xjobs/database -- channel.enum` → FAIL.
- [ ] **Step 3: Implement.** Add the value (contract and `Channel`, after `LINKEDIN_JOB_BOARD_CHEAP`), to `TRIAL_CHANNELS` and `ACTIVE_CHANNELS`. Add the two nullable columns to `SearchSegmentRun` with comments: `apifyRunId` "the Apify run, for every run Apify started (also failed ones), so its final cost can be read again"; `costFinalAt` "when costMicroUsd was read at least 5 minutes after the run finished; null while late Apify charges may still arrive".
- [ ] **Step 4: Generate the migration** (name `trial_bebity`). Expected ops: every `Channel` column check gains the value; two columns added to `search_segment_runs`. Nothing else. Set `refs/db.json` `"hash"`. Refresh types with `pnpm db:types` (local stack running).
- [ ] **Step 5: Placeholders** so typecheck passes, each finished later: copy cheap_scraper's entry for bebity in `ingest/config/channels.ts` (final), `normalize.ts` (`mapLinkedinJob`, final), `source-key.ts` and `job-key.ts` (same case as cheap; Task 3 changes `job-key.ts`), `merge.ts` precedence `2.2` (final), `queries/channels/index.ts` (`new LinkedinJobBoardBuilder(Channel.LINKEDIN_JOB_BOARD_BEBITY)`, final), `collect/config.ts` a temporary entry `{ queueName: 'collect-linkedin-job-board-bebity', ...linkedinJobBoard, enabled: false, run: LinkedinJobBoardCheapCollector.config }`, `fetch` a temporary case throwing `SearchNotStartedError('bebity collector not built')`, `sources.ts` `CHANNEL_LABELS` `'LinkedIn'`.
- [ ] **Step 6:** Apply migrations to the local stack and both test DBs; `pnpm --filter @xjobs/database db:verify` → OK; `npx nx run-many -t typecheck test -p xjobs @xjobs/database` → PASS.
- [ ] **Step 7:** Commit `feat(db): bebity trial channel and segment run cost columns`.

### Task 2: bebity collection

**Files:**

- Create: `apps/xjobs/src/modules/collectors/providers/mappers/bebity-input.ts`, `bebity-input.spec.ts`
- Create: `apps/xjobs/src/modules/collectors/providers/linkedin-job-board-bebity.collector.ts`, `.spec.ts`
- Modify: collectors module/index exports, `collect/config.ts`, `collection.service.ts` (`fetch`, `boardRun` cast, `budgetSetting`), `apps/xjobs/src/config/environment.validation.ts`, `apps/xjobs/package.json` (nx target), `deploy/engine/.env.example`, `deploy/engine/README.md` §8a, `CLAUDE.md`

**Interfaces:**

- Consumes: `oneSearchInput`, `runChargeCapUsd` (`collectors/utils/linkedin-board-run.ts`); `mergedLinkedinKeyword`, `linkedinGeoId` (`providers/mappers/linkedin-job-board.mapper.ts`); `reachedChargeCap`.
- Produces:
  - `BEBITY_ACTOR = 'bebity/linkedin-jobs-scraper'`
  - `BEBITY_PLACES: Readonly<Record<string, string>>` (the geoId map in Global Constraints)
  - `toBebityInput(keyword: string, params: Record<string, unknown>, rows: number): Record<string, unknown>`; throws `Error` when `linkedinGeoId(params)` has no entry in `BEBITY_PLACES` (wrapped into `SearchNotStartedError` by `oneSearchInput`)
  - `LinkedinJobBoardBebityCollector` with `static config` and `collect(segment): Promise<SegmentResult>`

- [ ] **Step 1: Failing tests.**
  - `bebity-input.spec.ts`:
    - `builds bebity's fields for a remote mid-level US search`: params `{ location: 'united states', workType: '2', experienceLevel: '4' }`, rows 100 → `toEqual({ titles: ['kw'], locations: ['United States'], workTypes: ['2'], experienceLevels: ['4'], publishedAt: 'r3600', rows: 100, companyProfile: false, enrichCompany: false })`.
    - `splits several level codes`: `experienceLevel: '3,4'` → `experienceLevels: ['3', '4']`.
    - `omits filters the builder does not set`: no `workType`/`experienceLevel` → neither key present.
    - `names the place by geoId, whatever its spelling`: `location: 'north africa'` → `locations: ['Africa']`.
    - `refuses a geoId with no bebity place`: `location: 'mena'` throws.
    - `has a place for every geoId but MENA`: each of the 7 geoIds maps; `91000008` doesn't.
  - `linkedin-job-board-bebity.collector.spec.ts` (mirror the cheap collector spec):
    - config `toEqual({ actor: 'bebity/linkedin-jobs-scraper', maxRunChargeUsd: 0.15, maxRowsPerSearch: 100, maxRowsCeiling: 1000, memoryMbytes: 1024 })`.
    - `runs one search for the segment`: one `actor.run` call, options `{ maxChargeUsd: 0.15, memoryMbytes: 1024 }`, input has no `startUrls`; result `searchTotals` null, `source.actor` bebity.
    - truncated when `items.length >= rows`, not below; `maxItems: 1000` → `rows: 1000` and `maxChargeUsd: 1.5`.
    - `does not start a search whose geoId has no bebity place`: a MENA segment → `SearchNotStartedError`, `run` not called.
  - `collection.service.spec.ts`: bebity's daily budget reads `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_BEBITY`; environment validation defaults it to 1 and accepts `COLLECTION_TRIAL_CHANNELS=LINKEDIN_JOB_BOARD_BEBITY`.
- [ ] **Step 2:** `npx nx test xjobs -- bebity collection.service environment` → FAIL.
- [ ] **Step 3: Implement.** Input and collector following `LinkedinJobBoardCheapCollector` (one run per segment; dataset order is rank; `truncated = items.length >= rows`). Replace Task 1's placeholders in `collect/config.ts` (`run: LinkedinJobBoardBebityCollector.config`, `enabled: ACTIVE_CHANNELS.includes(...)`), `fetch`, `boardRun`, `budgetSetting`. Env default 1. nx target beside `worker-linkedin-job-board-cheap`. Docs: `.env.example` lists both trial values and the bebity budget (`=1`); README §8a describes bebity beside cheap_scraper (its own cap, MENA searches don't start); CLAUDE.md's `worker-<channel>` list gains `linkedin-job-board-bebity`.
- [ ] **Step 4:** Same tests → PASS; `all-worker*.spec.ts` updated for the new queue (bebity removes its schedule when not listed) → PASS.
- [ ] **Step 5:** Commit `feat(collectors): bebity trial collector on its own search fields`.

### Task 3: Ingest: job key, mapper, joins

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/normalize/job-key.ts` (+ spec)
- Modify: `apps/xjobs/src/modules/ingest/normalize/mappers/bebity-job.mapper.ts`; `ingest/normalize/linkedin.spec.ts`
- Create: `apps/xjobs/src/modules/ingest/utils/fixtures/linkedin-job-bebity.json` (one real item from `/tmp/claude-1000/-home-lab-apps-10xjobs/d6c1aa15-97f2-4090-8717-7c7c865da0e6/scratchpad/bebity-real-sample.json`; if that file is gone, build one with the field list in the spec's "Fields without enrichment")
- Test: `ingest/repositories/jobs.writer` Postgres spec (the one that covers cheap_scraper joins)

**Interfaces:**

- Consumes: `isTrialChannel`; `postedAtFromAgo(ago, scrapedAt, publishedDate)`; `datePart`.

- [ ] **Step 1: Failing tests.**
  - `job-key.spec.ts`: `keys a trial item by its LinkedIn id even with an ATS apply URL`: for `LINKEDIN_JOB_BOARD_CHEAP` and `LINKEDIN_JOB_BOARD_BEBITY`, sourceKey `id:123`, `applyUrl: 'https://boards.greenhouse.io/acme/jobs/9'` → `linkedin-job:123`; the same record on `LINKEDIN_JOB_BOARD` → `ats:greenhouse/acme/9`.
  - `linkedin.spec.ts`:
    - `maps a current bebity item` (the fixture): title, company, location text, `postedAt` = scrapedAt minus its `postedTime`, `applyUrl` null for an `EXTERNAL` item with empty `applyUrl`, `postingUrl` from `id`.
    - `maps an old bebity item as before`: the existing bebity test payload (no `postedTime`) gives `postedAt: null` and the same record as on `main`.
  - Ingest Postgres spec: `joins two trial actors and then harvestapi`: a bebity item and a cheap item with source key `id:777` → one `linkedin-job:777` job; then a harvestapi item `id:777` with an ATS apply URL → one job keyed `ats:…`, both trial raw items linked to it, the trial job `merged`, processing reason `joined`. And `bebity first, harvestapi same key`: harvestapi without an employer link links onto the bebity job, which becomes `joined`.
- [ ] **Step 2:** Run them (ingest DB URL set) → FAIL.
- [ ] **Step 3: Implement.** In `jobKey`, trial channels return `linkedin-job:<id>` before the apply-URL rule. bebity mapper: `postedAt: postedAtFromAgo(cleanText(p.postedTime), ctx.scrapedAt, datePart(p.publishedAt))` (match cheap_scraper's argument types), take `ctx`, add `postedTime` to `BebityJobItem`, drop the "no longer collected from" note. If the join test fails because a writer path compares to `LINKEDIN_JOB_BOARD_CHEAP` directly instead of `isTrialChannel`, fix that path.
- [ ] **Step 4:** Tests → PASS, including `renormalize` specs unchanged (no `NORMALIZER_VERSION` bump; if a renormalize spec shows changed output for stored rows, stop and report).
- [ ] **Step 5:** Commit `feat(ingest): bebity items key by LinkedIn id and map their posted time`.

### Task 4: Final run cost

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/providers/apify/apify.provider.ts` (+ spec)
- Modify: `apps/xjobs/src/modules/segments/repositories/segments.repository.ts` (+ Postgres spec), segment run types (`NewSegmentRun`)
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts` (+ spec)

**Interfaces:**

- Produces:
  - `class ApifyRunError extends Error { readonly runId: string }`, thrown by `ApifyActorProvider.run` when a started run didn't finish in time (after abort) or ended other than `SUCCEEDED`.
  - `NewSegmentRun.apifyRunId: string | null`, `NewSegmentRun.costFinalAt: Date | null` (null on write).
  - `SearchSegmentsRepository.unsettledCosts(channel: Channel, finishedSince: Date): Promise<{ id: string; apifyRunId: string; finishedAt: Date }[]>`: runs with an `apifyRunId`, `costFinalAt` null, `finishedAt >= finishedSince`.
  - `SearchSegmentsRepository.settleCost(id: string, costMicroUsd: number, finalAt: Date | null): Promise<void>`.
  - `CollectionService` re-reads costs (private) at tick start for LinkedIn job-board channels, before `dailyBudget`.

- [ ] **Step 1: Failing tests.**
  - Provider spec: `throws ApifyRunError with the run id when a run fails` and `… when a run is aborted for time`.
  - Repository Postgres spec (processor DB): `lists only the channel's unsettled runs with a run id since the given time`; `settleCost stores the cost and final time`.
  - `collection.service.spec.ts`:
    - `stores the Apify run id of a succeeded run` (from `result.source.apifyRunId`).
    - `stores the run id of a run that failed after starting` (collector throws `ApifyRunError('…', 'run-9')` → recorded failed run has `apifyRunId: 'run-9'`, `costMicroUsd: null`).
    - `re-reads unsettled costs before reading the daily budget`: `findRun` returns `usageTotalUsd: 0.1514` for a run recorded at 147200 → `settleCost(id, 151400, now)` when finished ≥ 5 min ago, then `spentMicroUsd` is called after it.
    - `does not mark a cost final within 5 minutes of the run finishing` → `settleCost(id, …, null)`.
    - `keeps the stored cost when the re-read fails`: `findRun` throws → no `settleCost`, tick continues.
    - `re-reads runs finished in the last 24 hours`: `unsettledCosts` called with `now − 24h`.
    - Non-LinkedIn channels: no re-read.
- [ ] **Step 2:** Run them → FAIL.
- [ ] **Step 3: Implement.** Provider throws `ApifyRunError` in its two post-start failure branches (keep the messages). Collection service sets `run.apifyRunId` from the result, or from an `ApifyRunError` on failure; inject `ApifyActorProvider` for `findRun`. The re-read stores Apify's value as-is (it may be lower than the charge cap a null cost counted at). Repository writes `apifyRunId` in `recordRun` and `recordCollectedRun`.
- [ ] **Step 4:** Tests → PASS, with both DB URLs set and the segments suite not skipped.
- [ ] **Step 5:** Commit `feat(collect): store run ids and count Apify's final run cost`.

### Task 5: Actor badge

**Files:** Modify `apps/web/src/lib/matches/sources.ts` (+ its spec).

- [ ] **Step 1: Failing test.** `channelBadges(['LINKEDIN_JOB_BOARD_CHEAP', 'LINKEDIN_JOB_BOARD_BEBITY', 'LINKEDIN_JOB_BOARD'])` → `['LinkedIn · harvestapi', 'LinkedIn · bebity', 'LinkedIn · cheap_scraper']`; `sourceOf('LINKEDIN_JOB_BOARD_BEBITY')` → `'LINKEDIN_JOB_BOARD'`.
- [ ] **Step 2:** `npx nx test web -- sources` → FAIL.
- [ ] **Step 3:** `ACTOR_LABELS` gains `LINKEDIN_JOB_BOARD_BEBITY: 'bebity'` between harvestapi and cheap_scraper (its key order is the badge order).
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat(web): bebity actor badge`.

### Task 6: Fair `db:actor-compare`

**Files:**

- Modify: `apps/xjobs/src/scripts/actor-compare/queries.ts`, `report.ts`, `report.spec.ts`, `apps/xjobs/src/scripts/actor-compare.ts`
- Modify: CLAUDE.md's `db:actor-compare` line (pairs, fair groups, not-run reasons)

**Interfaces:**

- Consumes: `linkedinGroupKey(params)` (collectors mapper), `moroccoDay`.
- Produces (pure, in `report.ts`):
  - `ACTOR_BY_CHANNEL: Record<string, string>`: `LINKEDIN_JOB_BOARD` → harvestapi, `LINKEDIN_JOB_BOARD_CHEAP` → `cheap_scraper/linkedin-job-scraper`, `LINKEDIN_JOB_BOARD_BEBITY` → `bebity/linkedin-jobs-scraper` (used when a run has no batch).
  - `tickOf(startedAt: Date): string`: the Morocco-time hour, `YYYY-MM-DDTHH`, built with `Intl.DateTimeFormat` in `Africa/Casablanca`.
  - `type NotRunReason = 'skipped' | 'not started' | 'failed' | 'capped'`.
  - `coverage(runs: SegmentRunRow[], builders: BuilderRow[]): Map<string /* actor */, Map<string /* group|tick */, 'ran' | NotRunReason>>`.
  - `SegmentRunRow { runId; actor; channel; startedAt: Date; status; capped: boolean; costMicroUsd: number | null; queryIds: string[] }`; `BuilderRow { id; channel; group: string }` (group = `linkedinGroupKey(params)`); `Sighting` gains `runId: string`.
  - `PairRow { label; a: string; b: string; aOnly; bOnly; both; aFirst; bFirst; medianLeadMinutes: number | null }`; `NotRunRow { label; actor; skipped; notStarted; failed; capped }`; `ThreeWayRow { label; one; two; three }`.
- Queries: `loadSegmentRuns` (every run of the three channels since `since`, with or without a batch; actor = batch actor else `ACTOR_BY_CHANNEL`; cost re-read values are already stored), `loadBuilders` (id, channel, params of builders on the three channels; group computed in TS), `loadSightings` gains `runId` (via the batch's `segmentRunId`); channel lists include bebity. `resolveSince` uses any trial channel's first batch.

- [ ] **Step 1: Failing tests** (`report.spec.ts`, pure):
  - `tickOf` gives the same tick for runs at :00 and :40 of one Morocco hour and different ticks across an hour, computed without a hard-coded offset (compare to `Intl` in the test).
  - `ran a group only when every builder of it ran`: two harvestapi builders in group G, one covered by a succeeded uncapped run → G is not `ran`.
  - `labels not-run reasons`: no run row → `skipped`; failed with cost 0 → `not started`; failed with null cost → `failed`; capped → `capped`.
  - `excludes groups an actor did not run from that pair`: harvestapi ran G1 and G2, bebity ran only G1 (G2 skipped by cap) → the harvestapi–bebity pair counts only G1's jobs; harvestapi–cheap still counts G2 if cheap ran it.
  - `counts A only, B only and both per pair, with who saw first and the median lead`.
  - `counts jobs seen by one, two or three actors on groups all three ran`.
  - `credits a run with no batch by its channel's actor`.
  - Existing outcome, rejection, coverage and AI-search tests are rewritten for per-pair groups (`'<A> only' | '<B> only' | 'both'` per pair) and still pass; bebity's AI-search row is `n/a`.
- [ ] **Step 2:** `npx nx test xjobs -- actor-compare` → FAIL.
- [ ] **Step 3: Implement** the pure functions and queries; print tables in the existing plain-text style: per-pair overlap, not-run per actor, three-way, then the existing per-actor and per-group tables.
- [ ] **Step 4:** Tests → PASS. Run it read-only against the local stack (`XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm --filter @xjobs/xjobs db:actor-compare -- --days 7`): exits 0 (empty tables are fine).
- [ ] **Step 5:** Commit `feat(scripts): actor-compare per actor pair on groups both ran`.

### Task 7: Verify and open the PR

- [ ] **Step 1:** `npx nx run-many -t lint test build typecheck` → PASS (with both test DB URLs; only the known `main` failures).
- [ ] **Step 2:** `git push -u origin feat/trial-bebity`; `gh pr create --base main` with the spec's rollout steps, noting it contains PR #95's commit until #95 merges.
