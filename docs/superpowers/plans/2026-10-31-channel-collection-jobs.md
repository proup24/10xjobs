# Channel Collection Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each channel gets a scheduled BullMQ collect job, its own config and a dedicated worker process. Each run takes the active query search builders from the queries module, collects them through the channel's collector, and saves the results through the ingest module.

**Architecture:** Everything for execution lives in `infrastructure/jobs`:

- per-channel config;
- queue names and the scheduler sync;
- the collection processor (queries → collector → ingest);
- a `ChannelWorkerModule` per channel.

`worker.ts` boots that module when `WORKER_CHANNEL` is set, and the existing infrastructure worker otherwise. The queries module gains `listActive(channel)`. The collectors module drops its static search lists and its scheduling fields.

**Tech Stack:** NestJS 11 application context, BullMQ 5 (`upsertJobScheduler`), Prisma 8 ORM, zod env validation, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-channel-collection-jobs-design.md`

## Global Constraints

- `channelJobsConfig: Record<Channel, ChannelJobConfig>` in `infrastructure/jobs/steps/collect/config.ts`, where `ChannelJobConfig = { enabled: boolean; schedule: { pattern: string; timezone: string }; concurrency: number; attempts: number }`. Every channel starts with `enabled: true`, `{ pattern: '0 * * * *', timezone: 'UTC' }`, `concurrency: 1` and `attempts: 1`.
- Queue per channel, named `collect-<channel>` in kebab-case: `collect-linkedin-job-board`, `collect-linkedin-posts`, `collect-greenhouse`, `collect-ashby`. Use the existing `REDIS_PREFIX`.
- Scheduler id `collect`, job name `collect`, data `{ channel }`.
- `enabled: false` means remove the scheduler and exit with code 0.
- When `WORKER_CHANNEL` is unset, the `infrastructure` queue, the `ping` job and `validateWorkerEnvironment` behave exactly as today.
- No static search fallback in collectors: delete `discovery.keywords`, `discovery.locations`, `discovery.queries` and `discovery.terms`.
- Ingest batches are at most `ingestConfig.maxBatchItems` (1000) items, with `queryId` set to the builder id.
- Queue payloads carry the channel only, never secrets.

## Review Focus

1. **`GLOBAL` region on LinkedIn.** The job board must send `Worldwide` instead. Test it in Task 2.
2. **An unknown `WORKER_CHANNEL` value.** It must fail at boot, never fall back to the infrastructure worker. Test it in Task 4.
3. **A collector returning more than 1000 items.** The results must be split into chunks for ingest instead of being rejected by ingest's batch limit. Test it in Task 3.
4. **Ingest throwing an infrastructure error for one builder.** That builder counts as failed and the others continue. Test it in Task 3.
5. **A builder whose `params` lacks optional keys.** The URL must omit those filters, not send `undefined`. Test it in Task 2.

---

### Task 1: `listActive(channel)` in the queries module

**Files:**

- Modify: `apps/xjobs/src/modules/queries/repositories/queries.repository.ts`, `testing/fakes.ts`, `services/queries.service.ts`
- Test: `apps/xjobs/src/modules/queries/services/queries.service.spec.ts`

**Interfaces:**

- Produces: `QuerySearchRepository.listActive(channel: Channel): Promise<QuerySearchBuilderRow[]>` (abstract, Prisma and fake).
- Produces: `QuerySearchService.listActive(channel: Channel): Promise<QuerySearchBuilderRow[]>`. It returns rows with `channel AND isActive AND NOT isDeleted`, sorted by `createdAt` then `id` ascending.

- [ ] **Step 1: Write the failing test.** Add `describe('listActive')`. Seed `FakeQuerySearchRepository` with rows for two channels: some active, one inactive, one soft-deleted. Expected: `listActive(Channel.ASHBY)` returns only the active, non-deleted ASHBY rows, oldest first. A channel with none returns `[]`.
- [ ] **Step 2: Run it and see it fail.** `npx nx test xjobs -- queries.service.spec`. Expected: FAIL.
- [ ] **Step 3: Implement.** Prisma: `orm.QuerySearchBuilder.where({ channel, isActive: true, isDeleted: false })`, ordered by `createdAt` then `id`. Fake: filter and sort. Service: delegate.
- [ ] **Step 4: Run the tests.** Same command, plus `npx nx typecheck xjobs`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(queries): list a channel's active builders`

### Task 2: Collectors search only with a builder's keyword and params

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/types/collector.ts`
- Modify: `apps/xjobs/src/modules/collectors/config/index.ts` (+ `index.spec.ts`)
- Modify: `apps/xjobs/src/modules/collectors/providers/apify/{google_search,linkedin.job_search,linkedin.post_search}.collector.ts`, `providers/{ashby,greenhouse}.service.ts`
- Test: `apps/xjobs/src/modules/collectors/providers/apify/search-input.spec.ts` (new)

**Interfaces:**

- Produces: `CollectorSearch = { id: string; channel: Channel; keyword: string; params: Record<string, unknown> }`.
- Produces: `GoogleJobsSearchProvider.search(channel: Channel.ASHBY | Channel.GREEN_HOUSE, keyword: string): Promise<DiscoveryHit[]>`.
- Produces: `linkedinJobSearchUrl(keyword: string, params: Record<string, unknown>): string`, exported from `linkedin.job_search.collector.ts`.

- [ ] **Step 1: Write the failing tests.** Stub `ApifyActorProvider.run` with `vi.fn().mockResolvedValue([])`.
  - `linkedinJobSearchUrl('senior backend engineer nestjs', { location: 'EMEA', experienceLevel: '4', workType: '2' })` has `keywords=senior+backend+engineer+nestjs` (or `%20`), `location=EMEA`, `f_E=4` and `f_WT=2`.
  - `linkedinJobSearchUrl('x', { location: 'GLOBAL' })` has `location=Worldwide` and contains no `f_E` and no `f_WT`.
  - The job-board provider makes one `run` call with `startUrls: [{ url: linkedinJobSearchUrl(...) }]`.
  - The posts provider makes one `run` call with `searchQueries: ['hiring senior backend engineer nestjs remote']`.
  - Google search for ASHBY with keyword `backend engineer` sends `queries` equal to `` `site:jobs.ashbyhq.com "backend engineer" ${suffix}` ``. GREEN_HOUSE uses `site:greenhouse.io`.
  - `config/index.spec.ts`: no `discovery` has `keywords`, `locations`, `queries` or `terms`, and no channel config has `schedule` or `enabled`. Replace the existing hourly-schedule test.
- [ ] **Step 2: Run them and see them fail.** `npx nx test xjobs -- collectors`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Change `CollectorSearch`. Delete the static lists from the config types and values, along with the scheduling and window fields: `enabled`, `schedule`, `initialLookbackHours`, `overlapMinutes`, `maximumWindowHours`, `recoveryDays` and `maximumSearchesPerOperation`. None of these is read anywhere.
  - Job board: build one URL with `URLSearchParams`, sending `GLOBAL` as `Worldwide`. Add `f_E` and `f_WT` only when the param is a string. Make one `run` with the full per-operation cap.
  - Posts: one `run` for `search.keyword`. Check the `harvestapi/linkedin-post-search` input schema. Pass `params.location` if the actor has a location filter, and otherwise leave a one-line comment.
  - Google: one query from `keyword`. Ashby and Greenhouse collectors pass `search.keyword`, and a comment notes that `params.locationTerms` and `params.remote` are not applied yet.
- [ ] **Step 4: Run the tests.** `npx nx test xjobs` and `npx nx typecheck xjobs`. Expected: PASS, including the ingest specs, which import `CollectedJob`, unchanged.
- [ ] **Step 5: Commit.** `refactor(collectors): search only with a builder's keyword and params`

### Task 3: Collection processor in the jobs module

**Files:**

- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/config.ts` (replace `JOB_CONFIG`)
- Create: `apps/xjobs/src/infrastructure/jobs/collection.processor.ts`
- Test: `apps/xjobs/src/infrastructure/jobs/tests/collection.processor.spec.ts`

**Interfaces:**

- Consumes: `QuerySearchService.listActive` (Task 1), `CollectorSearch` (Task 2), `COLLECTOR_PROVIDERS` and `Collector` from `modules/collectors`, `IngestService.ingest(batch: IngestBatch): Promise<IngestReport>` and `ingestConfig.maxBatchItems` from `modules/ingest`.
- Produces: `channelJobsConfig` and `ChannelJobConfig` (Global Constraints).
- Produces: `CollectionProcessor.run(channel: Channel): Promise<CollectionSummary>`, where
  `CollectionSummary = { channel; builders; succeeded; failed; collected; truncated; incomplete; inserted; updated; duplicate; invalid }` (all counts are `number`).

- [ ] **Step 1: Write the failing tests.** Build `CollectionProcessor` directly with fakes: `{ listActive: vi.fn() }`, an array of fake collectors, and `{ ingest: vi.fn().mockResolvedValue(report) }`.
  - Builders are loaded once, for the channel. The channel's collector is called once per builder, in order, with `{ id, channel, keyword, params }` from the row.
  - Ingest is called with `queryId` set to the builder id, the channel, the collected items, and the same `observedAt` for every builder in a run.
  - A builder returning 2,500 jobs gives three ingest calls of 1000, 1000 and 500.
  - The second of three builders fails in collect, and in a separate case in ingest. Expected: `succeeded: 2, failed: 1`, the third still runs, and `logger.warn` is called with a message containing the builder id.
  - Counts: `collected`, `truncated` and `incomplete` come from the collection results, and `inserted`, `updated`, `duplicate` and `invalid` are summed from the ingest reports.
  - Every builder fails, so `run` rejects with an error naming the channel and the failure count.
  - There are no builders, so it resolves to `builders: 0` with no collector or ingest call.
  - There is no collector for the channel, so it rejects at once.
  - `channelJobsConfig` has all four channels with the starting values.
- [ ] **Step 2: Run them and see them fail.** `npx nx test xjobs -- collection.processor`. Expected: FAIL.
- [ ] **Step 3: Implement.** `CollectionProcessor` is `@Injectable` and injects `QuerySearchService`, `@Inject(COLLECTOR_PROVIDERS) Collector[]` and `IngestService`. Log one summary line with every field. If needed, add a `modules/collectors/index.ts` barrel exporting `CollectorsModule`, `COLLECTOR_PROVIDERS` and `Collector`, and export `ingestConfig` from `modules/ingest/index.ts`.
- [ ] **Step 4: Run the tests.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(jobs): collect a channel's builders and ingest the results`

### Task 4: Per-channel queue, scheduler and worker process

**Files:**

- Modify: `apps/xjobs/src/config/environment.validation.ts` (+ `index.ts` exports, `validation.spec.ts`)
- Create: `apps/xjobs/src/infrastructure/jobs/collection.queue.ts`
- Create: `apps/xjobs/src/infrastructure/jobs/channel-worker.service.ts`
- Create: `apps/xjobs/src/infrastructure/jobs/channel-worker.module.ts`
- Modify: `apps/xjobs/src/worker.ts`
- Test: `apps/xjobs/src/infrastructure/jobs/tests/collection.queue.spec.ts`, `apps/xjobs/src/config/validation.spec.ts`

**Interfaces:**

- Consumes: `CollectionProcessor.run` and `channelJobsConfig` (Task 3), `REDIS_SETTINGS` / `RedisSettingsModule`, `DatabaseModule`, `QuerySearchModule`, `CollectorsModule`, `IngestModule`.
- Produces: `collectionQueueName(channel: Channel): string`.
- Produces: `syncCollectionScheduler(queue: Pick<Queue, 'upsertJobScheduler' | 'removeJobScheduler'>, channel: Channel, config: ChannelJobConfig): Promise<'scheduled' | 'removed'>`.
- Produces: `workerChannelSchema` (optional `z.enum(Channel)`), `channelWorkerEnvironmentSchema` (database + Redis + required `APIFY_TOKEN` + required `WORKER_CHANNEL`), `validateChannelWorkerEnvironment(config)`, and `ChannelWorkerEnvironmentVariables`.
- Produces: `ChannelWorkerModule.forChannel(channel: Channel): DynamicModule`.

- [ ] **Step 1: Write the failing tests.**
  - `collectionQueueName` gives exactly the four names in Global Constraints.
  - Enabled: `syncCollectionScheduler` calls `upsertJobScheduler('collect', { pattern: '0 * * * *', tz: 'UTC' }, { name: 'collect', data: { channel }, opts: { attempts: 1 } })` and returns `'scheduled'`.
  - Disabled: it calls only `removeJobScheduler('collect')` and returns `'removed'`.
  - `validateChannelWorkerEnvironment` throws on `WORKER_CHANNEL=ASHBYY`, throws when `APIFY_TOKEN` is missing, and passes with database, Redis, token and `WORKER_CHANNEL=ASHBY`.
  - `workerChannelSchema.parse(undefined)` returns `undefined`, and parsing `'nope'` throws.
- [ ] **Step 2: Run them and see them fail.** `npx nx test xjobs -- collection.queue validation`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **`ChannelWorkerService`:** it mirrors `WorkerService`'s Redis options, startup timeout and shutdown order. It owns a `Queue` and a `Worker` on `collectionQueueName(channel)` with the channel's `concurrency`, and calls `syncCollectionScheduler` on init. The processor function rejects with `UnrecoverableError` unless `job.name === 'collect'` and `job.data.channel` is this process's channel. Otherwise it calls `CollectionProcessor.run`.
  - **When the channel is disabled,** the service removes the scheduler and does not start the `Worker`. `worker.ts` then closes the context and exits 0.
  - **`ChannelWorkerModule.forChannel`** imports `ConfigModule.forRoot({ isGlobal: true, cache: true, ignoreEnvFile: true, validate: validateChannelWorkerEnvironment })`, `DatabaseModule`, `RedisSettingsModule`, `QuerySearchModule`, `CollectorsModule` and `IngestModule`. It provides the channel token, `CollectionProcessor` and `ChannelWorkerService`.
  - **Config readers:** check that `getDatabaseConfig` and `getApifyToken` read only keys this schema validates, and widen their `ConfigService` type if needed.
  - **`worker.ts`:** parse `process.env.WORKER_CHANNEL` with `workerChannelSchema`. Boot `ChannelWorkerModule.forChannel(channel)` when one is set, and `WorkerModule` otherwise. The startup-failure log names the channel.
- [ ] **Step 4: Run the tests.** `npx nx test xjobs` and `npx nx typecheck xjobs`. Expected: PASS, with `processor.spec` and `smoke.spec` unchanged.
- [ ] **Step 5: Smoke-check the boot error.** From `apps/xjobs`, run `WORKER_CHANNEL=ASHBYY npx tsx --tsconfig tsconfig.app.json src/worker.ts`. Expected: it exits non-zero with an error naming `WORKER_CHANNEL`.
- [ ] **Step 6: Commit.** `feat(jobs): dedicated scheduled worker per channel`

### Task 5: Scripts, Nx targets and docs

**Files:**

- Modify: `apps/xjobs/package.json` (scripts + `nx.targets`), root `package.json`, `CLAUDE.md`, `.env.example`, `apps/xjobs/src/modules/ingest/README.md` (the "not currently implemented" sentence)

- [ ] **Step 1: Add the scripts and targets.**
  - `apps/xjobs/package.json`: add `worker:<kebab>:dev` scripts, each `WORKER_CHANNEL=<CHANNEL> tsx watch --tsconfig tsconfig.app.json src/worker.ts`.
  - Add four continuous Nx targets: `worker-linkedin-job-board`, `worker-linkedin-posts`, `worker-greenhouse` and `worker-ashby`. Each copies `worker` with `"env": { "WORKER_CHANNEL": "<CHANNEL>" }`.
  - Add matching root scripts.
- [ ] **Step 2: Update the docs.**
  - `CLAUDE.md` Commands: add `npx nx worker-<channel> xjobs: run one channel's scheduled collection worker`.
  - `.env.example`: add a commented `# WORKER_CHANNEL=` line listing the four values.
  - Ingest README: say that the per-channel workers in `infrastructure/jobs` call it.
- [ ] **Step 3: Verify.** `npx nx run-many -t lint test build typecheck`. Expected: all green.
- [ ] **Step 4: Commit.** `chore(jobs): per-channel worker targets and docs`
