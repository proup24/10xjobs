# Channel collection jobs

Date: 2026-10-31. Supersedes the scheduling parts of `2026-10-29-channels-collection-design.md` (runs, cursors, windows, budgets, leases, outbox and gap recovery are not built here).

## Intent

Collection runs by itself, end to end. Each channel (LinkedIn job board, LinkedIn posts, Greenhouse, Ashby) has its own cron-scheduled job and its own dedicated worker process, configured separately. The jobs module manages execution. On each tick a channel job does four things:

1. It asks the **queries module** for the channel's search segments: the active, non-deleted shared query search builders.
2. It runs the **collectors module**'s collector for that channel once per builder.
3. It hands each builder's results to the **ingest module**, which validates, normalizes, deduplicates and saves them, attributed to that builder.
4. It reports what happened.

Today the collectors and ingest exist, but nothing calls them. The search terms are hard-coded in `modules/collectors/config`, and the LinkedIn job-board provider ignores its input completely.

## Goals

- Every channel has its own scheduler, queue and worker process. The jobs module registers the schedules on its own.
- Each channel worker has a dedicated config in `infrastructure/jobs/config`.
- What is searched comes only from the queries module. The static search lists are removed from the collectors config.
- Every collected batch goes through `IngestService.ingest`.

## Non-goals

- Changes inside the ingest module.
- Run history records, time windows or cursors, budget accounting, recovery and gap tracking.
- Editing schedules at runtime or storing them in the database.
- An HTTP trigger or admin UI for runs.

## Anti-goals

- Searching anything no published profile asked for. The static fallbacks must go, not just be bypassed.
- Silently skipping builders. Every builder that is skipped or fails is logged with its id and the reason.
- One channel's failure stopping another channel.
- Overlapping runs of the same channel, which would double Apify spend.

## Decisions

Decided by the user:

- There is one cron job and one dedicated worker process for each channel, each with its own config.
- The jobs module manages execution. No separate collection module.
- Searches come from the queries module, collection from the collectors module, and saving, deduplication and normalization from the ingest module.
- The old channels-collection design is set aside.

Builder's calls (open to change):

1. **Per-channel worker config.** `infrastructure/jobs/config/index.ts` replaces the unused `JOB_CONFIG` with `channelJobsConfig: Record<Channel, ChannelJobConfig>`, where `ChannelJobConfig = { enabled: boolean; schedule: { pattern: string; timezone: string }; concurrency: number; attempts: number }`. The starting values for every channel are `enabled: true`, `{ pattern: '0 * * * *', timezone: 'UTC' }`, concurrency 1 and attempts 1. `enabled`, `schedule` and the unused window and recovery fields move out of `modules/collectors/config`. The collectors config keeps only operational settings: actors, limits, fetch policy and per-operation budget caps.
2. **Queues.** One queue for each channel, named `collect-<channel>` in kebab-case (for example `collect-linkedin-job-board`), with the existing `REDIS_PREFIX`. The `infrastructure` queue and the `ping` job are unchanged.
3. **Automatic scheduling.** When a channel worker starts, it calls `queue.upsertJobScheduler('collect', { pattern, tz }, { name: 'collect', data: { channel }, opts: { attempts } })`. This is idempotent, so restarts and replicas are safe. If the channel is `enabled: false`, the worker removes the scheduler and exits with code 0.
4. **Process selection.** `worker.ts` reads an optional `WORKER_CHANNEL`. If it is unset, the infrastructure worker runs as today. If it is set to a `Channel`, that channel's worker runs. An unknown value fails startup. There is one package script and Nx target for each channel, and one Docker image.
5. **Worker environment.** A channel worker validates the Redis vars, the database vars, `APIFY_TOKEN` (required) and `WORKER_CHANNEL`. The infrastructure worker keeps today's validation.
6. **Queries API.** Add `QuerySearchService.listActive(channel)`. It returns builders where `channel = X AND isActive AND NOT isDeleted`, oldest first, with no profile scope.
7. **Run loop** (`infrastructure/jobs/collection.processor.ts`). Fix `observedAt` at the start of the run. For each builder, in order:
   - collect;
   - ingest `{ queryId: builder.id, observedAt, channel, items: jobs }`, split into chunks of at most `ingestConfig.maxBatchItems` (1000).

   If collect or ingest throws for one builder, log it with the builder id and continue. At the end there is one summary line: channel, number of builders, succeeded, failed, collected, truncated, incomplete, inserted, updated, duplicate and invalid. If every builder failed, the job fails so BullMQ records it. An empty builder list is a successful no-op.

8. **Collector input.** `CollectorSearch` becomes `{ id, channel, keyword, params }`. Each collector maps it as follows:
   - **LinkedIn job board:** one URL from `keyword`, `params.location` (with `GLOBAL` sent as `Worldwide`), `f_E` from `params.experienceLevel` and `f_WT` from `params.workType`. A missing param is omitted.
   - **LinkedIn posts:** one actor run for `keyword`. `params.location` is used only if the actor supports a location filter.
   - **Greenhouse and Ashby:** one Google query `site:<site> "<keyword>" <suffix>`. `params.locationTerms` and `params.remote` are not applied yet, and the code says so in a comment.

## Testing

Unit tests cover the following. No test calls Apify.

- **`listActive`:** filtering and order.
- **Run loop:** builders loaded once, ingest called per builder with the builder id and the fixed `observedAt`, chunking above 1000 items, isolation of a failure in one builder (collect or ingest), the summary counts, the all-failed rejection, and the empty no-op.
- **Collectors:** each builds its search from `keyword` and `params`, with no static fallback.
- **Scheduler:** it upserts when enabled and removes when disabled.
- **Config:** `WORKER_CHANNEL` and channel-worker env validation.

## Left to the builder

File names inside `infrastructure/jobs`, log wording, and how the per-channel Nx targets are expressed.
