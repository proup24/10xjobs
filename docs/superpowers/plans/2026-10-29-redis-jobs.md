# Redis and jobs implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task.

**Goal:** Provide cache, pub/sub, and BullMQ execution in an independently launched worker.
**Architecture:** Separate cache Redis from persistent queue/pubsub Redis. Nest services own connection lifecycles; only the worker registers processors.
**Tech stack:** NestJS, ioredis, BullMQ, Nx/Webpack, Vitest, Docker Compose.
**Spec:** `docs/superpowers/specs/2026-10-29-redis-jobs-design.md`

## Constraints and review focus

- Preserve existing Redis volume and application routes.
- No secrets in logs or committed files; do not read local env files.
- Cache outages must not prevent source reads; queue writes must fail promptly.
- Multiple listeners and malformed pub/sub messages must not break delivery.
- Worker shutdown and unknown jobs must be handled explicitly.
- Worker must boot without database, Supabase, or HTTP credentials.
- Worker/API builds must coexist and support independent starts.

## Task 1: Redis services

- [ ] Add failing tests in `src/infrastructure/redis/redis.spec.ts` and config tests for invalid URLs, TTL and concurrency.
- [ ] Add dependencies to `apps/xjobs/package.json` and lockfile.
- [ ] Implement shared validated settings in `src/config/redis.config.ts`, Redis client lifecycle, cache and pub/sub services in `src/infrastructure/redis/`.
- [ ] Integrate Redis settings into API environment validation and register the Redis module.
- [ ] Run unit tests and typecheck.

## Task 2: Queue and worker

- [ ] Add tests for infrastructure job validation and rejection of unknown jobs.
- [ ] Implement queue producer and worker service in `src/infrastructure/jobs/`, and a dedicated `src/worker.ts` with `WorkerModule`.
- [ ] Add both bundles to Webpack and launch scripts/targets to package manifests.
- [ ] Add opt-in real Redis integration tests that spawn the compiled worker and prove completion, retries, TTL and pub/sub delivery.
- [ ] Build and run tests.

## Task 3: Infrastructure and verification

- [ ] Configure queue Redis eviction policy, isolated cache Redis, and optional worker Compose file.
- [ ] Document environment settings, launch/scaling, extension points, and smoke-test commands.
- [ ] Run full unit suite, typecheck, lint, builds, Compose validation and live integration tests.
- [ ] Review final diff and resolve material findings.

## Execution notes

User authorized proceeding with the separate worker. Work remains in the current checkout; no commit, branch integration, or deployment is requested. Services use explicit DI tokens so Nest injection also works under the existing Vitest transform.
