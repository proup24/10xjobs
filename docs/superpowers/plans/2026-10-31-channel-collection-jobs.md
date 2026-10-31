# Channel Collection Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each channel gets a scheduled BullMQ collect job with its own schedule, run by a dedicated worker process. The job collects every active query search builder of that channel through that channel's collector.

**Architecture:** The queries module gains `listActive(channel)`. The collectors module drops its static search lists and searches only with a builder's `keyword` and `params`. A new `modules/collection` holds the run loop, the per-channel queue and scheduler, and a `ChannelWorkerModule`. `worker.ts` boots that module when `WORKER_CHANNEL` is set, and the existing infrastructure worker otherwise.

**Tech Stack:** NestJS 11 application context, BullMQ 5 (`upsertJobScheduler`), Prisma 8 ORM, zod env validation, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-channel-collection-jobs-design.md`

## Global Constraints

- Queue per channel, named `collect-<channel>` in kebab-case: `collect-linkedin-job-board`, `collect-linkedin-posts`, `collect-greenhouse`, `collect-ashby`. Use the existing `REDIS_PREFIX`.
- Scheduler id `collect`, job name `collect`, data `{ channel }`. Schedule from `channelConfig[channel].schedule`.
- Channel worker: concurrency 1, collect job `attempts: 1`.
- `enabled: false` means remove the scheduler and exit cleanly (exit code 0).
- The `infrastructure` queue, the `ping` job and `validateWorkerEnvironment` behave exactly as today when `WORKER_CHANNEL` is unset.
- No static search fallback anywhere in collectors: delete `discovery.keywords`, `discovery.locations`, `discovery.queries` and `discovery.terms`.
- Collected jobs are only counted and logged (ingest is out of scope).
- Queue payloads carry ids or the channel only, never secrets.

## Review Focus

1. **`GLOBAL` region on LinkedIn.** `locationText` returns `GLOBAL` for global remote builders, and LinkedIn does not know that location. The job board must send `Worldwide` instead. Test it in Task 2.
2. **A builder deactivated mid-run.** The run uses the list loaded at the start, which is fine. Do not re-query per builder. The test in Task 3 asserts `listActive` is called exactly once.
3. **An unknown `WORKER_CHANNEL` value**, for example a typo like `ASHBYY`. It must fail at boot with a clear message, never fall back to the infrastructure worker. Test it in Task 4.
4. **A builder whose `params` lacks optional keys** (no `experienceLevel` or `workType`). The URL must omit those filters, not send `undefined`. Test it in Task 2.
5. **An empty active list.** The run succeeds and makes no Apify call. Test it in Task 3.

---

### Task 1: `listActive(channel)` in the queries module

**Files:**

- Modify: `apps/xjobs/src/modules/queries/repositories/queries.repository.ts`
- Modify: `apps/xjobs/src/modules/queries/testing/fakes.ts`
- Modify: `apps/xjobs/src/modules/queries/services/queries.service.ts`
- Test: `apps/xjobs/src/modules/queries/services/queries.service.spec.ts`

**Interfaces:**

- Produces: `QuerySearchRepository.listActive(channel: Channel): Promise<QuerySearchBuilderRow[]>` (abstract, Prisma and fake implementations).
- Produces: `QuerySearchService.listActive(channel: Channel): Promise<QuerySearchBuilderRow[]>`. It returns rows with `channel = channel AND isActive AND NOT isDeleted`, sorted by `createdAt` then `id` ascending.

- [ ] **Step 1: Write the failing test.** Add `describe('listActive')` to `queries.service.spec.ts`. Use `FakeQuerySearchRepository` and seed rows for two channels: some active, one inactive (`associatedProfiles: 0`), one soft-deleted. Assert that `listActive(Channel.ASHBY)` returns only the active, non-deleted ASHBY rows, oldest first, and that a channel with none returns `[]`.
- [ ] **Step 2: Run it and see it fail.** `npx nx test xjobs -- queries.service.spec`. Expected: FAIL, `listActive is not a function`.
- [ ] **Step 3: Implement.** Add the abstract method with a doc comment. Prisma: `orm.QuerySearchBuilder.where({ channel, isActive: true, isDeleted: false })`, ordered by `createdAt` then `id`, with no transaction. Fake: filter and sort `rows`. Service: delegate.
- [ ] **Step 4: Run the tests.** Same command. Expected: PASS.
- [ ] **Step 5: Export the service.** `QuerySearchService` is already exported from `modules/queries/index.ts`, so nothing to change. Run `npx nx typecheck xjobs` and expect PASS.
- [ ] **Step 6: Commit.** `feat(queries): list a channel's active builders`

### Task 2: Collectors search only with a builder's keyword and params

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/types/collector.ts`
- Modify: `apps/xjobs/src/modules/collectors/config/index.ts` (+ `index.spec.ts`)
- Modify: `apps/xjobs/src/modules/collectors/providers/apify/{google_search,linkedin.job_search,linkedin.post_search}.collector.ts`
- Modify: `apps/xjobs/src/modules/collectors/providers/{ashby,greenhouse}.service.ts`
- Test: `apps/xjobs/src/modules/collectors/providers/apify/search-input.spec.ts` (new)

**Interfaces:**

- Produces: `CollectorSearch = { id: string; channel: Channel; keyword: string; params: Record<string, unknown> }`. It no longer has `userId`, `profileId` or `keywords`.
- Produces: `GoogleJobsSearchProvider.search(channel: Channel.ASHBY | Channel.GREEN_HOUSE, keyword: string): Promise<DiscoveryHit[]>`.
- Produces: `LinkedinJobSearchProvider.search(search: CollectorSearch)` and `LinkedinPostSearchProvider.search(search: CollectorSearch)` keep their signatures but read only `search.keyword` and `search.params`.
- Produces: `linkedinJobSearchUrl(keyword: string, params: Record<string, unknown>): string`, exported from `linkedin.job_search.collector.ts`.

- [ ] **Step 1: Write the failing tests** in `search-input.spec.ts`. Stub `ApifyActorProvider.run` with `vi.fn().mockResolvedValue([])` and capture its input.
  - `linkedinJobSearchUrl('senior backend engineer nestjs', { location: 'EMEA', experienceLevel: '4', workType: '2' })` has `keywords=senior%20backend%20engineer%20nestjs`, `location=EMEA`, `f_E=4` and `f_WT=2`.
  - `linkedinJobSearchUrl('x', { location: 'GLOBAL' })` has `location=Worldwide` and contains no `f_E` and no `f_WT`.
  - The job-board provider makes exactly one `run` call with `startUrls: [{ url: linkedinJobSearchUrl(...) }]`.
  - The posts provider makes exactly one `run` call with `searchQueries: ['hiring senior backend engineer nestjs remote']`.
  - Google search for ASHBY with keyword `backend engineer` sends `queries` equal to `` `site:jobs.ashbyhq.com "backend engineer" ${suffix}` ``, where `suffix` is from config. The GREEN_HOUSE variant uses `site:greenhouse.io`.
  - `channelConfig` has no `keywords`, `locations`, `queries` or `terms` key in any `discovery` (add this to `config/index.spec.ts`).
- [ ] **Step 2: Run them and see them fail.** `npx nx test xjobs -- collectors`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Change `CollectorSearch` and delete the four static lists (types and values).
  - Job board: build one URL with `URLSearchParams`. Map location `GLOBAL` to `Worldwide`. Add `f_E` and `f_WT` only when the param is a string. Make one `run` with the full `maximumOperationBudgetMicroUsd` cap. `titleExcludes` stays, applied as today if it is applied at all.
  - Posts: one `run` for `search.keyword`. Check the `harvestapi/linkedin-post-search` input schema in the Apify store. If it has a location filter, pass `params.location`. Otherwise leave a one-line comment saying the location is unused.
  - Google: one query from `keyword`. Ashby and Greenhouse collectors pass `search.keyword`, and a comment notes that `params.locationTerms` and `params.remote` are not applied yet.
- [ ] **Step 4: Run the tests.** `npx nx test xjobs -- collectors` and `npx nx typecheck xjobs`. Expected: PASS.
- [ ] **Step 5: Commit.** `refactor(collectors): search only with a builder's keyword and params`

### Task 3: The collection run

**Files:**

- Create: `apps/xjobs/src/modules/collection/collection.runner.ts`
- Create: `apps/xjobs/src/modules/collection/collection.module.ts`
- Test: `apps/xjobs/src/modules/collection/collection.runner.spec.ts`

**Interfaces:**

- Consumes: `QuerySearchService.listActive` (Task 1), `CollectorSearch` (Task 2), `COLLECTOR_PROVIDERS` and `Collector` from `modules/collectors`.
- Produces: `CollectionRunner.run(channel: Channel): Promise<CollectionSummary>`, where
  `CollectionSummary = { channel: Channel; builders: number; succeeded: number; failed: number; jobs: number; truncated: number; incomplete: number }`.
- Produces: `CollectionModule`, which imports `QuerySearchModule` and `CollectorsModule` and provides and exports `CollectionRunner`.

- [ ] **Step 1: Write the failing tests.** Build `CollectionRunner` directly with a fake `QuerySearchService` (`{ listActive: vi.fn() }`) and an array of fake collectors.
  - It loads builders once (`listActive` called once, with the channel). It calls the channel's collector once per builder, in order, with `{ id, channel, keyword, params }` taken from the row.
  - The second of three builders throws. Expected: `succeeded: 2, failed: 1`, the third still runs, and the logger's `warn` is called with a message containing the builder id.
  - Counts: two builders return `{ jobs: [a, b], truncated: true, complete: true }` and `{ jobs: [c], truncated: false, complete: false }`. Expected: `jobs: 3, truncated: 1, incomplete: 1`.
  - Every builder fails, so `run` rejects with an error naming the channel and the failure count.
  - There are no builders, so it resolves to `builders: 0`, no collector call.
  - There is no collector for the channel, so it rejects at once.
- [ ] **Step 2: Run them and see them fail.** `npx nx test xjobs -- collection.runner`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `CollectionRunner` (`@Injectable`, injects `QuerySearchService` and `@Inject(COLLECTOR_PROVIDERS) Collector[]`) and `CollectionModule`. Log one summary line with every `CollectionSummary` field. Export `COLLECTOR_PROVIDERS` from a `modules/collectors/index.ts` barrel if there is none.
- [ ] **Step 4: Run the tests.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(collection): run a channel's active builders through its collector`

### Task 4: Per-channel queue, scheduler and worker process

**Files:**

- Modify: `apps/xjobs/src/config/environment.validation.ts` (+ `index.ts` exports, `validation.spec.ts`)
- Create: `apps/xjobs/src/modules/collection/collection.queue.ts`
- Create: `apps/xjobs/src/modules/collection/channel-worker.service.ts`
- Create: `apps/xjobs/src/modules/collection/channel-worker.module.ts`
- Modify: `apps/xjobs/src/worker.ts`
- Test: `apps/xjobs/src/modules/collection/collection.queue.spec.ts`, `apps/xjobs/src/config/validation.spec.ts`

**Interfaces:**

- Consumes: `CollectionRunner.run` (Task 3), `channelConfig`, `REDIS_SETTINGS` / `RedisSettingsModule`, `DatabaseModule`.
- Produces: `collectionQueueName(channel: Channel): string` (for example `collect-linkedin-job-board`).
- Produces: `syncCollectionScheduler(queue: Pick<Queue, 'upsertJobScheduler' | 'removeJobScheduler'>, channel: Channel, config: { enabled: boolean; schedule: { pattern: string; timezone: string } }): Promise<'scheduled' | 'removed'>`.
- Produces: `workerChannelSchema` (zod optional `z.enum(Channel)`), `channelWorkerEnvironmentSchema` (database + redis + `APIFY_TOKEN` required + `WORKER_CHANNEL` required), `validateChannelWorkerEnvironment(config)`, and `ChannelWorkerEnvironmentVariables`.
- Produces: `ChannelWorkerModule.forChannel(channel: Channel): DynamicModule`.

- [ ] **Step 1: Write the failing tests.**
  - `collectionQueueName` gives exactly the four names in Global Constraints.
  - `syncCollectionScheduler` with `enabled: true` calls `upsertJobScheduler('collect', { pattern: '0 * * * *', tz: 'UTC' }, { name: 'collect', data: { channel }, opts: { attempts: 1 } })` and returns `'scheduled'`. With `enabled: false` it calls `removeJobScheduler('collect')`, not upsert, and returns `'removed'`.
  - `validateChannelWorkerEnvironment` throws on `WORKER_CHANNEL=ASHBYY`, throws when `APIFY_TOKEN` is missing, and passes with database, Redis, token and `WORKER_CHANNEL=ASHBY`.
  - `workerChannelSchema.parse(undefined)` returns `undefined`, and parsing `'nope'` throws.
- [ ] **Step 2: Run them and see them fail.** `npx nx test xjobs -- collection.queue validation`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`ChannelWorkerService`** (one per process, `onModuleInit` and `onApplicationShutdown`): it mirrors `WorkerService`'s Redis options and startup timeout. It owns a `Queue` and a `Worker` on `collectionQueueName(channel)` with concurrency 1, and calls `syncCollectionScheduler`. The processor checks that `job.name === 'collect'` and that `job.data.channel` matches the process channel (otherwise `UnrecoverableError`), then calls `CollectionRunner.run`.
  - **When the channel is disabled**, the service removes the scheduler, logs it, and does not start the `Worker`. `worker.ts` then closes the context and exits 0.
  - **`ChannelWorkerModule.forChannel`** imports `ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: true, validate: validateChannelWorkerEnvironment })`, `DatabaseModule`, `RedisSettingsModule` and `CollectionModule`. Check that `DatabaseService`'s `getDatabaseConfig` and `ApifyActorProvider`'s `getApifyToken` read only keys this schema validates, and widen their `ConfigService` type if needed.
  - **`worker.ts`** reads `process.env.WORKER_CHANNEL` through `workerChannelSchema`. It boots `ChannelWorkerModule.forChannel(channel)` when one is set, and `WorkerModule` otherwise. The startup-failure log names the channel.
- [ ] **Step 4: Run the tests.** `npx nx test xjobs` and `npx nx typecheck xjobs`. Expected: PASS, with the existing `processor.spec` and `smoke.spec` unchanged.
- [ ] **Step 5: Smoke-check the boot error.** Run `WORKER_CHANNEL=ASHBYY npx tsx --tsconfig apps/xjobs/tsconfig.app.json apps/xjobs/src/worker.ts`. Expected: it exits non-zero with an error naming `WORKER_CHANNEL`.
- [ ] **Step 6: Commit.** `feat(collection): dedicated scheduled worker per channel`

### Task 5: Scripts, Nx targets and docs

**Files:**

- Modify: `apps/xjobs/package.json` (scripts + `nx.targets`)
- Modify: `package.json` (root scripts)
- Modify: `CLAUDE.md` (Commands), `.env.example` (`WORKER_CHANNEL` comment)

- [ ] **Step 1: Add the scripts and targets.** In `apps/xjobs/package.json`, add `worker:<kebab>:dev` scripts: `WORKER_CHANNEL=<CHANNEL> tsx watch --tsconfig tsconfig.app.json src/worker.ts`. Add four continuous Nx targets, `worker-linkedin-job-board`, `worker-linkedin-posts`, `worker-greenhouse` and `worker-ashby`, each a copy of `worker` with `"env": { "WORKER_CHANNEL": "<CHANNEL>" }`. Add matching root scripts.
- [ ] **Step 2: Update the docs.** In `CLAUDE.md`, add one line under Commands: `npx nx worker-<channel> xjobs: run one channel's collection worker (do not deploy until ingest exists)`. In `.env.example`, add a commented `# WORKER_CHANNEL=` line listing the four values.
- [ ] **Step 3: Verify.** `npx nx run-many -t lint test build typecheck`. Expected: all green.
- [ ] **Step 4: Commit.** `chore(collection): per-channel worker targets and docs`
