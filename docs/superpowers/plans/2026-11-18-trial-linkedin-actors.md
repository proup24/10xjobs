# Trial LinkedIn Job-Board Actors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `cheap_scraper/linkedin-job-scraper` as a second LinkedIn job-board intake (`LINKEDIN_JOB_BOARD_CHEAP`) beside harvestapi, with one job per LinkedIn id, harvestapi's data winning, an actor badge in the web app, and a read-only `db:actor-compare` report.

**Architecture:** A new channel value plus an `isLinkedinJobBoard` predicate lets the trial reuse harvestapi's searches, segments, splits, ingest and processing. A runtime env switch turns its collection on. Ingest makes a trial item key onto its harvestapi twin's job, re-links trial items when harvestapi arrives, and sends a "joined" job to the processor. The processor then reuses the trial's extraction instead of calling Claude. Trial sources never contribute fields or seen times to a job harvestapi is behind.

**Tech Stack:** NestJS engine (apps/xjobs), BullMQ workers, Apify, Prisma-next contract + generated migration (libs/database), Supabase Postgres, Next.js (apps/web), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-18-trial-linkedin-actors-design.md`

## Global Constraints

- Work only in the worktree `/home/lab/apps/10xjobs/.worktrees/trial-actors`, branch `feat/trial-linkedin-actors` (from `origin/main` `6ccff04`). Never touch the main checkout `/home/lab/apps/10xjobs`: other sessions use it. One PR to `main`, pushed only with `git push -u origin feat/trial-linkedin-actors`.
- Channel value, exactly: `LINKEDIN_JOB_BOARD_CHEAP`. Actor, exactly: `cheap_scraper/linkedin-job-scraper`.
- Env names, exactly: `COLLECTION_TRIAL_CHANNELS` (comma-separated channel values, default empty) and `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP` (default 3). `COLLECTION_DAILY_BUDGET_USD` stays harvestapi's, default 3.
- cheap_scraper run config: `maxRowsPerSearch: 100`, `maxRowsCeiling: 1000`, `maxRunChargeUsd: 0.15`. Schedule `0 9-21 * * 1-5` Africa/Casablanca, window one hour back, no catch-up. Queue `collect-linkedin-job-board-cheap`.
- Search URL: `sortBy=DD`, `f_TPR=r3600`, `geoId` and no text `location` when a geoId resolves. Input `saveOnlyUniqueItems: false`, `enrichCompanyData: false`.
- New processing reason, exactly: `joined`.
- harvestapi's behaviour must not change: its builders keep their hashes, and its config, row limits, cap and splits stay as they are.
- The Prisma contract is the only schema source. The migration is generated (`pnpm --filter @xjobs/database db:migration:plan`). Then set `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the new migration's `to`, and keep `invariants` unchanged.
- The ingest Postgres specs need `INGEST_TEST_DATABASE_URL`, and the processor and segments specs need `PROCESSOR_TEST_DATABASE_URL`. Build both DBs with the processor_test recipe in memory and apply this branch's migrations to them. Confirm each suite ran, not skipped.
- UI is built only from `components/ui` and theme tokens (`apps/web/DESIGN.md`), and works at 360px. Badge copy, exactly: `LinkedIn · harvestapi` and `LinkedIn · cheap_scraper`.
- CI command: `npx nx run-many -t lint test build typecheck` must pass.

## Review Focus

1. **harvestapi links onto a trial job with the same `linkedin-job:` key** (about half of harvestapi's jobs). The job must go to processing as `joined`, reuse the trial's extraction with no Claude call, and get harvestapi's listing facts. Pinned in Task 6 (same-key join test) and Task 7 (joined reuse test).
2. **harvestapi and the trial ingest the same LinkedIn id at the same moment** (both tick at the same minute; ingest concurrency 2). The result must be one job, not two. Pinned in Task 6 (concurrent link test).
3. **harvestapi's tick erasing the trial's remembered splits** (and the reverse). Each must keep the other's rows. Pinned in Task 3 (`prune` scoped by channel test).
4. **A trial sighting of an archived harvestapi job, or of a harvestapi job missing a field.** The job stays archived, and the field stays null. Pinned in Task 5.
5. **A location text the parser can't read, or a one-part city name found in two countries.** It gives no place, `fellBack` is true, and it is listed by `db:places`. Pinned in Task 8.

---

### Task 0: Docs

- [ ] **Step 1:** `git -C /home/lab/apps/10xjobs/.worktrees/trial-actors log --oneline -2` shows the spec commit `4807d05` on top of `6ccff04`.
- [ ] **Step 2:** Commit this plan: `docs(plan): trial LinkedIn job-board actors`.

### Task 1: Channel value, predicate, `joined` reason, migration

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (`enum Channel` line 72; `normalized_jobs_processing_reason` check line 641 and the `processingReason` comment)
- Modify: `libs/database/src/enums/channel.enum.ts`, `apps/xjobs/src/common/enums/index.ts` (re-exports)
- Create: `libs/database/src/migrations/app/<timestamp>_trial_linkedin_channel/` (generated)
- Modify: `libs/database/src/migrations/app/refs/db.json` (`hash`)
- Modify: `apps/xjobs/src/modules/ingest/normalize/processing.ts` (`ProcessingReason`)
- Test: `libs/database/src/enums/channel.enum.spec.ts` (create)

**Interfaces:**

- Produces:
  - `Channel.LINKEDIN_JOB_BOARD_CHEAP = 'LINKEDIN_JOB_BOARD_CHEAP'`
  - `TRIAL_CHANNELS: readonly Channel[] = [Channel.LINKEDIN_JOB_BOARD_CHEAP]`
  - `isLinkedinJobBoard(channel: Channel | string): boolean`: true for `LINKEDIN_JOB_BOARD` and every trial channel
  - `isTrialChannel(channel: Channel | string): boolean`
  - `ProcessingReason = 'new' | 'reopened' | 'joined'`

- [ ] **Step 1: Write the failing test.** `channel.enum.spec.ts`:
  - `isLinkedinJobBoard` is true for `LINKEDIN_JOB_BOARD` and `LINKEDIN_JOB_BOARD_CHEAP`, false for `LINKEDIN_POSTS`, `ASHBY`, `GREEN_HOUSE`.
  - `isTrialChannel` is true only for `LINKEDIN_JOB_BOARD_CHEAP`.
  - `TRIAL_CHANNELS.every(isLinkedinJobBoard)` is true.
- [ ] **Step 2:** `npx nx test @xjobs/database -- channel.enum` → FAIL.
- [ ] **Step 3: Implement.**
  - Add the enum value in the contract and in `Channel`, then the two predicates and `TRIAL_CHANNELS` beside `ACTIVE_CHANNELS`. Leave `ACTIVE_CHANNELS` alone until Task 2.
  - Widen the processing reason check to `"processingReason" IS NULL OR "processingReason" IN ('new', 'reopened', 'joined')`.
  - Add `'joined'` to `ProcessingReason` with the comment "harvestapi's first source joined a job only trial actors had seen; the processor may reuse the trial's extraction".
- [ ] **Step 4: Generate the migration.** `pnpm --filter @xjobs/database db:migration:plan` (name: `trial_linkedin_channel`). Expected ops: the `Channel` column checks gain the new value (on every table with a `Channel` column), and the processing-reason check is dropped and re-added. Nothing else. Set `refs/db.json` `"hash"` to the migration's `to`. Then `pnpm db:types` (local stack running) to refresh `libs/database/src/supabase/database.types.ts`.
- [ ] **Step 5:** `npx nx run-many -t typecheck` → it fails only where a `Record<Channel, …>` lacks the new key. Add placeholder entries so the build compiles, each replaced in later tasks:
  - `ingest/config/channels.ts`: copy `LINKEDIN_JOB_BOARD`'s config (final in Task 4).
  - `normalize.ts` mappers: `mapLinkedinJob`.
  - `merge.ts` precedence: `2.4` (final in Task 5).
  - `queries/channels/index.ts`: `new LinkedinJobBoardBuilder()` (final in Task 2).
  - `collect/config.ts`: a temporary entry `{ queueName: 'collect-linkedin-job-board-cheap', ...linkedinJobBoard, enabled: false, run: LinkedinJobBoardCollector.config }`, so CI stays green between tasks (Task 3 replaces it). `CollectionService.fetch` gets a temporary case that throws `SearchNotStartedError('trial collector not built')`.
  - `apps/web/src/lib/matches/sources.ts`: `LINKEDIN_JOB_BOARD_CHEAP: 'LinkedIn'`.
- [ ] **Step 6:** Apply the migration to the local stack and both test DBs (`XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=… pnpm db:migrate`). `pnpm --filter @xjobs/database db:verify` → OK. Unit tests → PASS.
- [ ] **Step 7:** Commit `feat(db): LinkedIn job-board trial channel and joined processing reason`.

### Task 2: Searches for every LinkedIn job-board channel

**Files:**

- Modify: `libs/database/src/enums/channel.enum.ts` (`ACTIVE_CHANNELS`, its comment)
- Modify: `apps/xjobs/src/modules/queries/steps/combinations.ts:59,65`, `queries/sets/technology.ts:81`
- Modify: `apps/xjobs/src/modules/queries/channels/linkedin_board.builder.ts:45` (channel from the constructor), `queries/channels/index.ts`
- Modify: `apps/xjobs/src/modules/segments/services/segments.ts:55,168`
- Test: `queries/steps/combinations.spec.ts`, `queries/channels/channels.spec.ts`, `segments/services/segments.spec.ts`

**Interfaces:**

- Consumes: `isLinkedinJobBoard`, `Channel.LINKEDIN_JOB_BOARD_CHEAP` (Task 1).
- Produces:
  - `ACTIVE_CHANNELS = [LINKEDIN_JOB_BOARD, LINKEDIN_JOB_BOARD_CHEAP]`. Its comment now reads: the channels searches are built for; whether a channel collects is `collectsNow` (Task 3).
  - `new LinkedinJobBoardBuilder(channel: Channel = Channel.LINKEDIN_JOB_BOARD)`.

- [ ] **Step 1: Write the failing tests.**
  - `combinations.spec.ts`: a profile with one location and one seniority gives the same combinations for `LINKEDIN_JOB_BOARD_CHEAP` as for `LINKEDIN_JOB_BOARD`, field for field except `channel` (expanded places, `experienceLevel`, packed technology sets).
  - `channels.spec.ts`: the recipes built for the two channels differ only in `channel` and `hash`. harvestapi's recipe hash for a fixed profile equals the hash on `origin/main`: compute it in the test from a literal snapshot taken before the change.
  - `segments.spec.ts`: two builders with equal params on the two channels get different segment keys, starting `LINKEDIN_JOB_BOARD|` and `LINKEDIN_JOB_BOARD_CHEAP|`, and each is planned with the LinkedIn job-board chunking (`evenChunks` + `fitChunks`).
- [ ] **Step 2:** `npx nx test xjobs -- combinations channels segments` → FAIL.
- [ ] **Step 3: Implement.** Replace each `=== Channel.LINKEDIN_JOB_BOARD` in the listed lines with `isLinkedinJobBoard(…)`. The builder registry maps the trial channel to `new LinkedinJobBoardBuilder(Channel.LINKEDIN_JOB_BOARD_CHEAP)`.
- [ ] **Step 4:** Same tests → PASS. Then `npx nx test xjobs -- queries segments` → PASS (no harvestapi snapshot changed).
- [ ] **Step 5:** Commit `feat(queries): build LinkedIn job-board searches for the trial channel`.

### Task 3: cheap_scraper collection, switch, cap, splits

**Files:**

- Create: `apps/xjobs/src/modules/collectors/providers/linkedin-job-board-cheap.collector.ts` (+ `.spec.ts`)
- Modify: `collectors/providers/mappers/cheap-scraper-input.ts` (+ spec), the collectors module providers and `index.ts` exports
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/config.ts`, `collect/collection.service.ts`
- Modify: `apps/xjobs/src/modules/segments/repositories/splits.repository.ts` (`prune`)
- Modify: `apps/xjobs/src/infrastructure/worker/collection.service.ts` (`start`)
- Modify: `apps/xjobs/src/config/environment.validation.ts` (`collectionBudgetShape`)
- Modify: `apps/xjobs/package.json` (nx target `worker-linkedin-job-board-cheap`, script `worker:linkedin-job-board-cheap:dev`), `deploy/engine/.env.example`, `deploy/engine/README.md`, `CLAUDE.md` (worker list)
- Test: `infrastructure/jobs/tests/collection.service.spec.ts`, `segments/repositories/splits.postgres.spec.ts`, `infrastructure/worker/tests/collection-worker.spec.ts`, `config/validation.spec.ts`

**Interfaces:**

- Consumes: `isLinkedinJobBoard`, `isTrialChannel`, `TRIAL_CHANNELS` (Task 1); `linkedinGeoId`, `linkedinGroupKey`, `mergedLinkedinKeyword` (`linkedin-job-board.mapper.ts`).
- Produces:
  - `LinkedinJobBoardCheapCollector` with `static config: LinkedinJobBoardRunConfig` (values in Global Constraints) and `collect(segment): Promise<SegmentResult>`
  - `channelJobsConfig[LINKEDIN_JOB_BOARD_CHEAP]: ChannelJobConfig<LinkedinJobBoardRunConfig>`
  - `collectsNow(channel: Channel, trialChannels: readonly Channel[]): boolean` in `collect/config.ts`
  - `LinkedinSearchSplitsRepository.prune(channel: Channel, keep: readonly string[]): Promise<number>`
  - env `COLLECTION_TRIAL_CHANNELS: Channel[]`, `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP: number`

- [ ] **Step 1: Write the failing tests.**
  - `cheap-scraper-input.spec.ts`: `linkedinJobSearchUrl('a OR b', { location: 'morocco', geoId: '102787409', experienceLevel: '4', workType: '2' }, 3600)` has `keywords=a OR b`, `geoId=102787409`, `f_E=4`, `f_WT=2`, `sortBy=DD`, `f_TPR=r3600`, and no `location` parameter. Without a geoId, `location` is kept as today.
  - `linkedin-job-board-cheap.collector.spec.ts`, with a fake `ApifyActorProvider`:
    - One run of actor `cheap_scraper/linkedin-job-scraper`, input `{ startUrls: [{ url }], maxItems: 100, saveOnlyUniqueItems: false, enrichCompanyData: false }`, `maxChargeUsd: 0.15`. The url's `geoId` is resolved through `linkedinGeoId`.
    - 100 items returned → every member is in `truncatedQueryIds`, and `searchTotals` is null.
    - 40 items → none truncated.
    - `segment.maxItems: 1000` → `maxItems: 1000`, `maxChargeUsd: 1.5`.
    - A place with no geoId → `SearchNotStartedError`, no Apify call.
    - Members with two group keys → `SearchNotStartedError`.
  - `collection.service.spec.ts`:
    - A `LINKEDIN_JOB_BOARD_CHEAP` tick runs the cheap collector, never harvestapi's.
    - Its budget reads `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP` and `spentMicroUsd(LINKEDIN_JOB_BOARD_CHEAP, …)`, with a null-cost run counted at $0.15.
    - A full cheap result splits, then reruns one member at `maxItems: 1000`.
    - `rememberSplits` uses `rowLimit` 100 of the running channel.
    - `prune` is called with the running channel.
    - The harvestapi tick still reads `COLLECTION_DAILY_BUDGET_USD`.
  - `splits.postgres.spec.ts`: with rows `LINKEDIN_JOB_BOARD|remote|group:X` and `LINKEDIN_JOB_BOARD_CHEAP|remote|group:X`, `prune(LINKEDIN_JOB_BOARD, [])` deletes only the first, and `prune(LINKEDIN_JOB_BOARD_CHEAP, [])` only the second.
  - `collection-worker.spec.ts`:
    - `start(LINKEDIN_JOB_BOARD_CHEAP)` with `COLLECTION_TRIAL_CHANNELS` empty returns false and removes the schedule.
    - With `LINKEDIN_JOB_BOARD_CHEAP` listed, it returns true and registers `0 9-21 * * 1-5` Africa/Casablanca on queue `collect-linkedin-job-board-cheap`.
    - harvestapi starts whatever the setting says.
  - `validation.spec.ts`:
    - `COLLECTION_TRIAL_CHANNELS='LINKEDIN_JOB_BOARD_CHEAP'` parses to `['LINKEDIN_JOB_BOARD_CHEAP']`.
    - `''` parses to `[]`.
    - `'LINKEDIN_JOB_BOARD'` and `'NOPE'` fail validation, naming the setting.
    - The cheap budget defaults to 3.
- [ ] **Step 2:** Run those specs (the splits one with `PROCESSOR_TEST_DATABASE_URL`) → FAIL.
- [ ] **Step 3: Implement.**
  - **Search URL.** In `linkedinJobSearchUrl`, set `location` only when no `geoId` is set. Drop the "old actor, scripts only" header note.
  - **Collector.** Mirror `LinkedinJobBoardCollector`'s `input` guard. The url is `linkedinJobSearchUrl(mergedLinkedinKeyword(queries), { ...first.params, geoId: linkedinGeoId(first.params) }, 3600)`. Rank is dataset order, `truncated = items.length >= rows`, `source.actor` from the config.
  - **Channel config.** Add the `channelJobsConfig` entry: `...linkedinJobBoard`, its queue, `enabled: ACTIVE_CHANNELS.includes(…)`, `run: LinkedinJobBoardCheapCollector.config`. Add `collectsNow`: `config.enabled && (!isTrialChannel(channel) || trialChannels.includes(channel))`.
  - **`CollectionService`:**
    - Inject the new collector and add its `fetch` case.
    - Replace the `LINKEDIN_JOB_BOARD` tests at lines 151, 187, 201, 244, 302 and 329 with `isLinkedinJobBoard(channel)`.
    - Lines 293 and 347: `channelJobsConfig[channel].run` (typed through a helper `boardRun(channel): LinkedinJobBoardRunConfig`).
    - `chargeCapMicroUsd(channel, maxItems?)`.
    - `dailyBudget` picks `budgetSetting(channel)`: `COLLECTION_DAILY_BUDGET_USD` for `LINKEDIN_JOB_BOARD`, `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP` for the trial.
    - `pruneSplits(channel, built)`.
  - **Splits `prune`.** `DELETE … WHERE left("groupKey", length(${prefix})) = ${prefix} AND "groupKey" NOT IN (…)` with `prefix = channel + '|'`. Don't use `LIKE`: `_` is a wildcard.
  - **Worker `start`.** Use `collectsNow(channel, config.get('COLLECTION_TRIAL_CHANNELS'))` instead of `config.enabled`. Inject `ConfigService`. Its log line for a trial that's off: `${channel} trial collection off (COLLECTION_TRIAL_CHANNELS); scheduler removed`.
  - **Env.** `COLLECTION_TRIAL_CHANNELS: z.string().default('')` transformed to the trimmed non-empty parts, then `z.array(z.enum(TRIAL_CHANNELS))`. Add the cheap budget like the existing one.
  - **Docs.** Add the nx target and dev script mirroring `worker-linkedin-job-board` with `WORKER_CHANNEL=LINKEDIN_JOB_BOARD_CHEAP`. In `.env.example`, add both settings with comments. The README gets a "Trial actors" section: turn one on or off by editing `.env`, then `$C up -d worker`; its own cap. CLAUDE.md: add `linkedin-job-board-cheap` to the `worker-<channel>` list.
- [ ] **Step 4:** Same specs → PASS. Then `npx nx test xjobs -- collect worker` → PASS.
- [ ] **Step 5:** Commit `feat(collect): cheap_scraper trial collection behind COLLECTION_TRIAL_CHANNELS`.

### Task 4: Ingest and processor scope for the trial channel

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/utils/source-key.ts:60-76,123`, `ingest/utils/identity.ts:165`, `ingest/normalize/job-key.ts:73`, `ingest/normalize/normalize.ts`, `ingest/config/channels.ts`
- Modify: `apps/xjobs/src/modules/processor/config/processor.config.ts` (remove `PROCESSOR_CHANNEL`), `processor/index.ts`, `processor/repositories/processor.repository.ts:174-177`
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/ingest/processor.ts:46`
- Modify: `apps/xjobs/src/scripts/spellings.ts`, `scripts/places-recheck.ts` (they use `linkedInJobIds`: no change beyond the import, if any)
- Test: `ingest/utils/source-key.spec.ts`, `ingest/normalize/job-key.spec.ts`, `infrastructure/jobs/tests/ingest.processor.spec.ts`, `processor/repositories/processor.postgres.spec.ts`

**Interfaces:**

- Consumes: `isLinkedinJobBoard` (Task 1).
- Produces:
  - `linkedInJobIds(raw)` selects jobs with a source on any LinkedIn job-board channel.
  - `PROCESSOR_CHANNELS: readonly Channel[]` = `[LINKEDIN_JOB_BOARD, ...TRIAL_CHANNELS]`, exported from `processor/index.ts` in place of `PROCESSOR_CHANNEL`.

- [ ] **Step 1: Write the failing tests.**
  - `source-key.spec.ts`: a cheap payload `{ jobId: '4123', jobUrl: 'https://de.linkedin.com/jobs/view/x-4123' }` on `LINKEDIN_JOB_BOARD_CHEAP` → `{ key: 'id:4123' }`. The same payload with no `jobId` → `id:4123` from the URL.
  - `job-key.spec.ts`: a cheap record with no apply URL on the trial channel → `linkedin-job:4123`.
  - `ingest.processor.spec.ts`: pending job ids from a `LINKEDIN_JOB_BOARD_CHEAP` batch are enqueued to the processor, and ids from a `LINKEDIN_POSTS` batch still aren't.
  - `processor.postgres.spec.ts`: a pending job whose only source is on `LINKEDIN_JOB_BOARD_CHEAP` is listed by `listPendingInScope` and claimed by `claim`.
- [ ] **Step 2:** Run them → FAIL.
- [ ] **Step 3: Implement.**
  - Each listed `switch`/`if` takes the job-board branch for `isLinkedinJobBoard(channel)`. `linkedinFields` is keyed by a `'board' | 'posts'` kind instead of by channel.
  - `channelIngestConfig[LINKEDIN_JOB_BOARD_CHEAP]` reuses the same object as `LINKEDIN_JOB_BOARD` (a shared `const linkedinJobBoardIngest`).
  - `linkedInJobIds`: `WHERE r.channel = ANY(${`{${PROCESSOR_CHANNELS.join(',')}}`}::text[])`. Raw SQL takes scalars only, so pass the array literal as in `segments.repository.ts:124`.
  - The ingest hand-off uses `isLinkedinJobBoard(channel)`.
- [ ] **Step 4:** Same tests → PASS. Then `npx nx test xjobs` → PASS.
- [ ] **Step 5:** Commit `feat(ingest): ingest and process trial-channel LinkedIn jobs`.

### Task 5: harvestapi wins: merge, seen times, sightings

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/normalize/merge.ts`
- Modify: `apps/xjobs/src/modules/ingest/normalize/processing.ts` (`nextProcessing`)
- Modify: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts` (`remerge` seen times; the `nextProcessing` call in `linkJob`)
- Test: `ingest/normalize/merge.spec.ts`, `ingest/normalize/processing.spec.ts`, `ingest/repositories/raw.postgres.spec.ts`

**Interfaces:**

- Consumes: `isTrialChannel` (Task 1).
- Produces:
  - `mergeSources(sources)` ignores trial sources whenever one source is `LINKEDIN_JOB_BOARD`.
  - `boardSources<T extends { channel: Channel }>(sources: T[]): T[]` (exported from `merge.ts`): the sources that count, used by `remerge` for seen times.
  - `nextProcessing` input gains `sightingOnly: boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `merge.spec.ts`:
    - harvestapi `{ salary: null, location: 'Paris' }` + cheap `{ salary: {text:'$1'}, location: 'Lyon' }` → salary null, location Paris, and no `fieldSources` entry names the cheap item.
    - Cheap alone → its values.
    - Ashby + cheap → Ashby first, cheap fills Ashby's nulls (no harvestapi source).
    - Precedence: `LINKEDIN_JOB_BOARD` 2 < `LINKEDIN_JOB_BOARD_CHEAP` 2.4 < `LINKEDIN_POSTS` 3.
  - `processing.spec.ts`: `sightingOnly: true` returns `current` unchanged for an `archived` job seen newer than its last sighting, and for a `processed` job unseen past `reopenAfterMs`.
  - `raw.postgres.spec.ts`:
    - harvestapi item saved at T1, then a cheap item with the same `id:` at T2 > T1 + `reopenAfterMs` → the job's `lastSeenAt` stays T1, processing is unchanged, and fields are unchanged (harvestapi's `salaryText` null stays null).
    - An archived harvestapi job seen by the trial stays `archived`.
- [ ] **Step 2:** Run them → FAIL. The two-item Postgres test passes only after Task 6, which makes the cheap item join the harvestapi job. Until then, assert on the harvestapi job only and mark the join assertion `it.todo`. Task 6 turns it on.
- [ ] **Step 3: Implement.**
  - Precedence: `[LINKEDIN_JOB_BOARD_CHEAP]: 2.4`, with the comment "Trial actors rank below harvestapi in the planned order curious_coder 2.1, bebity 2.2, cheap_scraper 2.4; they count only when no harvestapi source is present (boardSources)."
  - `isAts` stays `=== 1`.
  - `remerge` takes `firstSeenAt`/`lastSeenAt` from `boardSources` of the items (with their channels).
  - `linkJob` passes `sightingOnly: isTrialChannel(item.channel) && <job has a LINKEDIN_JOB_BOARD source after the link>`.
- [ ] **Step 4:** Same tests → PASS.
- [ ] **Step 5:** Commit `feat(ingest): trial sources add nothing to a harvestapi job`.

### Task 6: One job per LinkedIn id, and the `joined` hand-off

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts` (`linkJob`, `renamed`, new helpers)
- Modify: `apps/xjobs/src/modules/ingest/services/renormalize.service.ts` (two passes)
- Test: `ingest/repositories/raw.postgres.spec.ts`, `ingest/services/batch.service.spec.ts` if it covers renormalize, otherwise the renormalize spec beside it

**Interfaces:**

- Consumes: `isLinkedinJobBoard`, `isTrialChannel` (Task 1); `sightingOnly` and `boardSources` (Task 5); `ProcessingReason 'joined'` (Task 1).
- Produces:
  - `twinJobKey(tx, item: { channel; sourceKey }): Promise<string | null>`: for a trial item, the job key of the job linked to the `LINKEDIN_JOB_BOARD` raw item with the same `sourceKey`, else null.
  - `lockLinkedinId(tx, sourceKey: string): Promise<void>`: `SELECT pg_advisory_xact_lock(hashtext(${'linkedin-job-id|' + sourceKey}))::text`.
  - `linkJob` outcome for a joined job: `pending: true`, and the job row has `processingStatus 'pending'`, `processingReason 'joined'`, `processingRequestedAt = observedAt`.
  - `rebuildAll` links every non-trial raw item before any trial-channel item.

- [ ] **Step 1: Write the failing tests** (`raw.postgres.spec.ts`; use real cheap and harvestapi payload fixtures from the existing specs, with the same LinkedIn id):
  - **harvestapi first, different key** (harvestapi has a Greenhouse apply URL): cheap then links to the `ats:` job, and there is one active job with two sources.
  - **harvestapi first, same key** (Easy Apply): one job, two sources.
  - **Trial first, different key:**
    - The cheap job becomes `merged` into harvestapi's job.
    - A user's `applied` decision and `job_views` row on the cheap job are on harvestapi's job.
    - harvestapi's job has `processingReason 'joined'`, pending.
  - **Trial first, same key:**
    - harvestapi links onto the cheap job (same id, no merge).
    - That job goes from `processed` to `pending` with reason `joined`.
    - Its fields are harvestapi's (`workplaceType` set).
  - **Trial first, then harvestapi sees it again an hour later** → reason is not changed again (joined happens once: only on harvestapi's first source).
  - **Rebuild** (`rebuild: true`) of a joined job doesn't change processing.
  - **Concurrent:**
    - With two connections, `Promise.all` of the cheap link and the harvestapi link (different key) → exactly one active job holding both sources.
    - Repeat 20 times in a loop, so the race is likely exercised.
  - **Re-key:** harvestapi's item gains an apply URL later (new `url:` key) → the trial source follows it, and there's no active trial-only job.
  - **renormalize:** with a cheap item whose id is lower than harvestapi's twin, `rebuildAll` ends with one job.
  - Turn on the `it.todo` from Task 5.
- [ ] **Step 2:** Run with `INGEST_TEST_DATABASE_URL` → FAIL.
- [ ] **Step 3: Implement in `linkJob`:**
  1. For `isLinkedinJobBoard(item.channel)`, call `lockLinkedinId(tx, item.sourceKey)` before the raw-item row lock. Advisory transaction locks are reentrant within a session, so the nested calls in step 4 take it again safely.
  2. After `effectiveKey`: for a trial item, `key = (await twinJobKey(tx, item)) ?? key`.
  3. Record `hadBoardSource`: whether the found job (before this link) already has a `LINKEDIN_JOB_BOARD` source other than this item.
  4. After the item's own link and `remerge`, when the item is `LINKEDIN_JOB_BOARD`: for each trial-channel raw item with the same `sourceKey` that is linked to another job, call `linkJob(tx, { rawItemId, observedAt: input.observedAt, rebuild: input.rebuild })`. Their key now resolves to this job's key through `twinJobKey`, so each moves through the existing "key changed" path (merge-away, `moveDecisions`, `moveViews`).
  5. `joined = !input.rebuild && item is LINKEDIN_JOB_BOARD && !hadBoardSource && job now has a trial-channel source`. When joined, write `processingColumns({ status: 'pending', reason: 'joined', requestedAt: input.observedAt })` after `nextProcessing`. It overrides `new`.
- [ ] **Step 4: Implement the rest:**
  - **`renamed`:** an other source on a trial channel whose `sourceKey` equals the linking item's `sourceKey` counts as keying to `key`.
  - **renormalize:** `listPage` gains a channel filter, and `rebuildAll` runs a pass over non-trial channels, then one over `TRIAL_CHANNELS`.
- [ ] **Step 5:** Same tests → PASS. Then all of `npx nx test xjobs -- ingest` → PASS, including the existing apply-link and merge tests.
- [ ] **Step 6:** Commit `feat(ingest): one job per LinkedIn id across harvestapi and trial actors`.

### Task 7: Processor reuses the trial's extraction for a joined job

**Files:**

- Modify: `apps/xjobs/src/modules/processor/repositories/processor.repository.ts` (`Claim`, `claim` RETURNING, new `findJoinedReusable`), `processor/testing/fakes.ts`
- Modify: `apps/xjobs/src/modules/processor/services/extraction-store.service.ts` (`reuse`), `processor/services/processor.service.ts:255-264`
- Test: `processor/repositories/processor.postgres.spec.ts`, `processor/services/processor.service.spec.ts`

**Interfaces:**

- Consumes: `processingReason 'joined'` written by Task 6.
- Produces:
  - `Claim.reason: 'new' | 'reopened' | 'joined' | null`
  - `ProcessorRepository.findJoinedReusable(jobId: string, key: Omit<ReuseKey, 'inputHash'>): Promise<{ id: string; jobId: string } | null>`: newest extraction with that schema, prompt and model whose `jobId` is `jobId` or a job with `"mergedIntoId" = jobId`
  - `ExtractionStore.reuse(key: ReuseKey, jobId: string, reason: Claim['reason']): Promise<string | null>`

- [ ] **Step 1: Write the failing tests.**
  - `processor.postgres.spec.ts`:
    - `findJoinedReusable` returns the merged job's extraction.
    - It returns the job's own older extraction.
    - It returns null for another prompt hash, and null for an unrelated job's extraction.
    - `claim` returns `reason: 'joined'`.
  - `processor.service.spec.ts` (fakes):
    - A `joined` claim whose input hash has no match but whose merged job has an extraction → outcome `reused`, no generator call, the extraction is copied to the job, and facts and match follow as for any reuse.
    - The same for a `new` claim → the generator is called.
    - A `joined` claim with nothing reusable → the generator is called once.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - `claim` adds `"processingReason" AS reason` to RETURNING.
  - `reuse` tries `findReusable(key)` first. Only when `reason === 'joined'` does it fall back to `findJoinedReusable`, copying when the row's `jobId` differs.
  - The service log for the fallback: `reused extraction ${id}: joined job, same posting`.
  - Update the fakes.
- [ ] **Step 4:** Same tests → PASS. Then `npx nx test xjobs -- processor matcher` → PASS.
- [ ] **Step 5:** Commit `feat(processor): reuse the trial's extraction when harvestapi joins a job`.

### Task 8: Place from location text

**Files:**

- Create: `apps/xjobs/src/modules/facts/places/location-text.ts` (+ `location-text.spec.ts`)
- Modify: `facts/places/resolver.ts` (`ListingLocation`, `PlaceVocabulary`, `resolveListingPlace`), `facts/places/place-vocabulary.repository.ts` (`load`), `facts/rules/listing.ts:71`, `scripts/places-recheck.ts` if it builds `ListingLocation`, and the vocabulary test fakes
- Test: `facts/places/resolver.spec.ts`, `facts/places/location-text.spec.ts`

**Interfaces:**

- Produces:
  - `ListingLocation.location: string | null`
  - `PlaceVocabulary.countryNames: Map<string, string>`: `foldPlaceName(label or alias)` → country code (approved countries only)
  - `PlaceVocabulary.cityCountries: Map<string, Set<string>>`: `foldPlaceName(city name or alias)` → country codes
  - `parseLocationText(text: string, vocab: PlaceVocabulary): { countryCode: string | null; city: string | null; named: boolean }` in `location-text.ts`
  - `US_STATE_CODES: ReadonlySet<string>` (the 50 states + `DC`) in `location-text.ts`

- [ ] **Step 1: Write the failing tests.** `location-text.spec.ts`, with a vocab of MA/FR/AT/NL/US/CA; cities Casablanca (MA), Amsterdam (NL), Agadir (MA), Austin (US), and London in both GB and CA:

  | Input                                               | `countryCode` | `city`                                       |
  | --------------------------------------------------- | ------------- | -------------------------------------------- |
  | `Casablanca, Casablanca-Settat, Morocco`            | MA            | Casablanca                                   |
  | `Rabat, Rabat-Salé-Kénitra, Morocco` (unknown city) | MA            | `Rabat` (resolver falls back to the country) |
  | `Île-de-France, France`                             | FR            | null                                         |
  | `Austria`                                           | AT            | null                                         |
  | `Amsterdam Area`                                    | NL            | Amsterdam                                    |
  | `Greater Amsterdam Area`                            | NL            | Amsterdam                                    |
  | `Agadir Metropolitan Area`                          | MA            | Agadir                                       |
  | `London` (two countries)                            | null          | null, `named: true`                          |
  | `Austin, TX`                                        | US            | Austin                                       |
  | `Springfield, ZZ`                                   | null          | null, `named: true`                          |
  | `Atlantis, Lemuria`                                 | null          | null, `named: true`                          |
  | `''` or `'  '`                                      | null          | null, `named: false`                         |

  `resolver.spec.ts`:
  - `{ countryCode: null, regionCode: null, city: null, geoId: null, location: 'Casablanca, Casablanca-Settat, Morocco' }` → a `city` place, `fellBack: false`.
  - `location: 'Atlantis, Lemuria'` → `place: null, fellBack: true`.
  - A listing with `countryCode: 'FR'` and `location: 'Austria'` ignores the text (FR).

- [ ] **Step 2:** `npx nx test xjobs -- location-text resolver` → FAIL.
- [ ] **Step 3: Implement.**
  - Split on `,`, trim, and drop empty parts.
  - **Last part:** a country by `countryNames`, else, with two parts and a US state code, `US`.
  - **City:** the first part when there are three parts (or the US form). For one part that isn't a country: strip `^Greater ` and ` (Metropolitan )?Area$`, then the city only when `cityCountries` gives exactly one country.
  - **`resolveListingPlace`:** only when the four structured fields are empty and the text isn't, run the parser and resolve its result through the existing country/city branch. `named` feeds `fellBack`.
  - **`load`:** build both maps from approved countries (`label`, `aliases`) and every city (`name`; aliases as `cityForms` reads them).
- [ ] **Step 4:** Same tests → PASS. Then `npx nx test xjobs -- facts` → PASS.
- [ ] **Step 5:** Commit `feat(facts): resolve a listing place from LinkedIn location text`.

### Task 9: Actor badge and one LinkedIn filter entry (web)

**Files:**

- Modify: `apps/web/src/lib/matches/sources.ts` (+ create `sources.spec.ts`), `lib/matches/group.ts:97,103-110`
- Modify: `components/matches/match-row.tsx:51-55`, `components/applications/decision-row.tsx:~58`, `components/matches/match-detail.tsx:410`, `components/matches/matches-view.tsx:169`
- Modify: `lib/matches/postings.ts` (keep `channel`), `components/matches/job-postings.tsx` (actor badge per posting)
- Test: `lib/matches/sources.spec.ts`, `lib/matches/group.spec.ts`, `components/matches/matches-view.spec.tsx`, `components/matches/job-postings.spec.tsx`

**Interfaces:**

- Produces (in `sources.ts`):
  - `sourceOf(channel: string): string`: `'LINKEDIN_JOB_BOARD'` for both LinkedIn job-board channels, else the channel
  - `channelBadges(channels: string[]): string[]`: one text per channel, LinkedIn job-board channels first, harvestapi before cheap_scraper, then the rest by label, deduped
  - `sourceText(channels: string[]): string`: the distinct source labels joined with `' and '`
  - `ACTOR_LABELS: Record<string, string>` = `{ LINKEDIN_JOB_BOARD: 'harvestapi', LINKEDIN_JOB_BOARD_CHEAP: 'cheap_scraper' }`

- [ ] **Step 1: Write the failing tests.**
  - `sources.spec.ts`:
    - `channelBadges(['LINKEDIN_JOB_BOARD_CHEAP','ASHBY','LINKEDIN_JOB_BOARD'])` → `['LinkedIn · harvestapi', 'LinkedIn · cheap_scraper', 'Ashby']`.
    - `sourceText(['LINKEDIN_JOB_BOARD','LINKEDIN_JOB_BOARD_CHEAP'])` → `'LinkedIn'`.
    - `sourceText(['GREEN_HOUSE','LINKEDIN_JOB_BOARD_CHEAP'])` → `'Greenhouse and LinkedIn'`, in label order as today.
  - `group.spec.ts`:
    - `sourceOptions` over jobs with both LinkedIn channels → one `{ value: 'LINKEDIN_JOB_BOARD', label: 'LinkedIn' }`.
    - `selectJobs` with `source: 'LINKEDIN_JOB_BOARD'` keeps a cheap-only job.
  - `matches-view.spec.tsx`: a row whose job has both channels shows the badges `LinkedIn · harvestapi` and `LinkedIn · cheap_scraper`, in that order.
  - `job-postings.spec.tsx`: a cheap posting shows `LinkedIn · cheap_scraper`.
- [ ] **Step 2:** `npx nx test web -- sources group matches-view job-postings` → FAIL.
- [ ] **Step 3: Implement.**
  - Badge text: `${CHANNEL_LABELS[c]} · ${ACTOR_LABELS[c]}` when there's an actor label, else `channelLabel(c)`.
  - Rows and postings render `channelBadges` with the existing `<Badge variant="outline">`.
  - The detail line uses `sourceText`.
  - `matches-view.tsx:169` labels `sourceOf(state.source)`.
- [ ] **Step 4:** Same tests → PASS. Then `npx nx test web` → PASS. Check at 360px in the running app (`run` skill or `npx nx dev web` with a seeded cheap job): the badges wrap, and nothing scrolls horizontally.
- [ ] **Step 5:** Commit `feat(web): actor badge on LinkedIn job-board matches`.

### Task 10: `db:actor-compare` report

**Files:**

- Create: `apps/xjobs/src/scripts/actor-compare.ts` (I/O: arguments, three queries, printing), `apps/xjobs/src/scripts/actor-compare/report.ts` (pure aggregation and formatting), `actor-compare/report.spec.ts`
- Modify: `apps/xjobs/package.json` (`"db:actor-compare"`, same form as `db:match-shares`), `CLAUDE.md` (command list)
- Test: `actor-compare/report.spec.ts`

**Interfaces:**

- Produces (`report.ts`):
  - `interface Sighting { jobId: string; actor: string; seenAt: Date; filterWorkType: string | null; itemWorkplaceType: 'remote' | 'hybrid' | 'onsite' | null }`: one per `raw_item_sightings` row since `since`, actor from `collection_batches.actor`, job via `normalized_job_sources`, filter from the builder's `params->>'workType'`, item workplace from that version's normalized record
  - `interface JobOutcome { jobId: string; outcome: 'qualified' | 'review' | 'rejected' | null; firstFailRule: string | null; applied: number; dismissed: number; workplaceType: boolean; place: boolean; salary: boolean; applyLink: boolean; joined: boolean; joinedReused: boolean | null }`: per job, the best outcome over its current-version matches (qualified > review > rejected), `firstFailRule` = the first `checks` element with `outcome = 'fail'` of a rejected match, decision counts from `job_decisions`, coverage from `normalized_jobs` (`place` = `countryCode` or `city` or `geoId` set), `joined` from any processing attempt or job row with reason `joined`, `joinedReused` = its latest extraction was copied (no attempt rows of its own)
  - `interface RunRow { actor: string; startedAt: Date; rows: number; costMicroUsd: number | null; sentKeyword: string | null; echoedKeywords: string[] }`
  - `buildActorReport(sightings: Sighting[], outcomes: JobOutcome[], runs: RunRow[], harvestActor = 'harvestapi/linkedin-job-search'): ActorReport`
  - `formatActorReport(report: ActorReport): string`

- [ ] **Step 1: Write the failing tests** (`report.spec.ts`, small literal fixtures):
  - **Overlap.** A job seen by both actors counts in `both` for each. First seen is the earliest sighting; the median lead of three shared jobs (leads 2, 5, 10 minutes, harvestapi first) is 5 minutes.
  - **Cost per qualified job** is cost / qualified, and `—` when nothing qualified.
  - **Grouping.** Days are Morocco days: a sighting at 23:30 UTC goes to the next Morocco day while Morocco is UTC+1.
  - **Decisions per group.** An applied job seen only by cheap_scraper adds to `trial only` → `applied 1`.
  - **AI search.** A harvestapi sighting with filter `2` (remote) and item `onsite` counts as contradicting, and one with item null doesn't. A cheap run whose echoed `searchString` doesn't contain the sent keyword counts as rewritten.
  - **Joined.** Two joined jobs, one reused → `joined 2, reused 1, ran Claude 1`.
  - **Formatting.** Contains a header per section and a `total` row.
- [ ] **Step 2:** `npx nx test xjobs -- actor-compare` → FAIL.
- [ ] **Step 3: Implement.**
  - `report.ts` makes the tests pass.
  - `actor-compare.ts` parses `--since <iso>` (default: the first batch of any trial actor, from `collection_batches`) and `--days <n>` (alternative to `--since`).
  - Database access as in `match-shares.ts`. Read-only: one `SELECT`-only connection, no writes.
  - `sentKeyword` comes from the run's segment members' merged keyword (use `mergedLinkedinKeyword` over the run's `queryIds` builders). `echoedKeywords` is the distinct `searchString` values of its batch's payloads, with the ` - <location>` suffix removed.
- [ ] **Step 4:** Same tests → PASS. Run the script against the local stack (`DATABASE_URL=… pnpm --filter @xjobs/xjobs db:actor-compare -- --days 7`): it prints without errors, even with no trial data (each table shows zeros).
- [ ] **Step 5:** Commit `feat(scripts): db:actor-compare report`.

### Task 11: Verify and open the PR

- [ ] **Step 1:** `npx nx run-many -t lint test build typecheck` → all pass. Also run the Postgres suites with both test URLs and confirm none skipped.
- [ ] **Step 2: End-to-end on the local stack** (no Apify spend):
  1. Apply migrations, then seed a published profile.
  2. Run `db:regenerate`. Both channels now have builders, and harvestapi's builder hashes are unchanged (compare before and after).
  3. Feed one harvestapi batch and one cheap batch built from the spec fixtures (the same id, cheap first) through ingest, then run the processor with a fake or no credential:
     - one active job
     - processing reason `joined`
     - no new `processing_attempts` row on the reuse
- [ ] **Step 3:** `git push -u origin feat/trial-linkedin-actors`, then `gh pr create --base main`. The body lists:
  - the channel and migration (it applies on dev at deploy)
  - collection off until `COLLECTION_TRIAL_CHANNELS` is set
  - the rollout steps from the spec: regenerate, `.env` cap and switch, the first-tick checks, the report after the first weekday
  - the review focus items
