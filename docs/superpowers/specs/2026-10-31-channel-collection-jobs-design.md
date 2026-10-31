# Channel collection jobs

Date: 2026-10-31. Supersedes the scheduling parts of `2026-10-29-channels-collection-design.md` for now (runs, cursors, windows, budgets, leases, outbox and gap recovery are not built here).

## Intent

Collection should run by itself. There is one recurring job for each channel (LinkedIn job board, LinkedIn posts, Greenhouse, Ashby). Each job searches exactly what the queries module says is wanted right now. That is the active, non-deleted shared query search builders for that channel, which come from published profiles. Each channel runs in its own worker process, so a slow or failing channel never holds up the others.

Today the collectors exist but nothing calls them, and `CollectorsModule` is not imported anywhere. The search terms are also hard-coded in `modules/collectors/config` (`discovery.keywords`, `locations`, `queries`, `terms`). The LinkedIn job-board provider ignores its input completely. This work makes the queries module the only source of what gets searched.

## Goals

- One BullMQ job scheduler for each channel, with its own schedule, in its own queue.
- One dedicated worker process for each channel. It consumes only that channel's queue.
- On each tick the job loads the channel's active builders through `QuerySearchService` and runs that channel's `Collector` once per builder.
- Collectors search with the builder's `keyword` and `params` only. The static search lists are removed from the collectors config.

## Rollout

Until ingest exists, collected jobs are only counted and logged. Nothing runs unless a channel worker process is started, so starting that process is the switch. Do not deploy the channel workers until ingest is wired. The user was asked about this and said to proceed; this is the builder's call.

## Non-goals

- Doing anything with collected jobs beyond logging counts. Ingest has a separate spec and is not built yet.
- Run records, time windows or cursors, budget accounting, recovery and gap tracking.
- Editing schedules at runtime or storing them in the database.
- An HTTP trigger or admin UI for runs.

## Anti-goals

- Searching anything that no published profile asked for. The static fallbacks must go, not just be bypassed.
- Silently skipping builders. Every builder that is skipped or fails gets a log line with its id and the reason.
- One channel's failure stopping another channel's collection.
- Overlapping runs of the same channel, which would double Apify spend.

## Decisions

Decided by the user:

- There is one job for each channel, and each job has its own schedule.
- What is searched comes from the queries module, not static config.
- Each channel has a dedicated worker process.
- The old channels-collection design is set aside.

Builder's calls (marked as mine, open to change):

1. **Schedules stay in code.** `channelConfig[channel].schedule` (cron pattern + timezone) and `enabled` keep living in `modules/collectors/config`. Only _what_ is searched is dynamic.
2. **Queues.** One queue for each channel, named `collect-<channel>` in kebab-case (for example `collect-linkedin-job-board`), with the existing `REDIS_PREFIX`. The `infrastructure` queue and the `ping` job are unchanged.
3. **Scheduler registration.** When a channel worker starts, it calls `queue.upsertJobScheduler('collect', schedule, { name: 'collect', data: { channel } })`. This is idempotent, so restarts and replicas are safe. If the channel is `enabled: false`, the worker removes the scheduler and exits cleanly.
4. **Process selection.** The existing `worker.ts` entry reads a new optional `WORKER_CHANNEL` env var:
   - unset: the infrastructure worker, as today;
   - set to a `Channel` value: that channel's collection worker.

   Add a package script and an Nx target for each channel (`worker:linkedin-job-board`, `worker:linkedin-posts`, `worker:greenhouse`, `worker:ashby`), plus `:dev` variants. The Dockerfile keeps one image, and the process is chosen by env.

5. **Worker environment.** A channel worker validates the Redis vars, the database vars, `APIFY_TOKEN` (required in a channel worker) and `WORKER_CHANNEL`. The infrastructure worker keeps today's Redis-only validation.
6. **No overlap.** Each channel worker uses concurrency 1, and the collect job uses `attempts: 1` so a failed paid run is never retried automatically. The next tick is the retry.
7. **Queries API.** Add `QuerySearchService.listActive(channel)` and the matching repository method. It returns builders where `channel = X AND isActive AND NOT isDeleted`, oldest first, and uses the existing `(channel, isActive, isDeleted)` index. There is no profile or user scope because builders are shared.
8. **Run loop.** Builders run one after another, in order. If one builder throws, the error is logged with the builder id and the loop continues. At the end there is one summary log line: channel, number of builders, number succeeded, number failed, jobs collected, and how many results were `truncated` or not `complete`. If every builder failed, the job fails so BullMQ records it.
9. **Collector input.** `CollectorSearch` becomes `{ id, channel, keyword, params }`. It loses `userId` and `profileId` because builders are shared, and `keywords: string[]` becomes the builder's single `keyword`. Each collector maps it as follows:
   - LinkedIn job board: one search URL built from `keyword`, `params.location`, `params.experienceLevel` (`f_E`) and `params.workType` (`f_WT`).
   - LinkedIn posts: one actor run for `keyword`. `params.location` goes to the actor's location filter if it has one, otherwise it is dropped. Check the actor's input schema.
   - Greenhouse and Ashby: one Google query `site:<site> "<keyword>" <suffix>`. `site`, `suffix` and `maxPagesPerQuery` stay in config. `params.locationTerms` and `params.remote` are not applied in this step, and the code says so in a comment.

   Remove `discovery.keywords`, `locations`, `queries` and `terms` from the config types and values. Keep the operational settings (actor ids, limits, fetch policy, per-operation budget caps).

10. **Module wiring.** A new `CollectionModule` in `modules/collection` imports `DatabaseModule`, `QuerySearchModule` and `CollectorsModule`. It provides the processor that picks the collector for the job's channel from `COLLECTOR_PROVIDERS`. `QuerySearchModule` currently registers an HTTP controller. The worker builds an application context and does not serve HTTP, so that is harmless, but the worker module should not need `BasicAuthGuard` config to boot.

## Testing

- Unit: `listActive` filters (active, not deleted, right channel, order). The run loop: per-builder failure isolation, the summary counts, all-failed makes the job fail, and an empty builder list is a successful no-op. Each collector builds its search from `keyword` and `params` with no static fallback.
- Unit: scheduler registration upserts when enabled and removes when disabled. `WORKER_CHANNEL` parsing rejects unknown values.
- Existing collector and queries tests keep passing after the `CollectorSearch` change.
- No e2e that calls Apify.

## Left to the builder

File layout inside `modules/collection`, log wording, and how the per-channel Nx targets are expressed.
