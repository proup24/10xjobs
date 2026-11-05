# Redis cache, pub/sub, and workers

The API produces BullMQ jobs. A separate Nest application context consumes them; starting the API does not start a worker.

## Launch locally

```sh
pnpm infra:redis
pnpm exec nx build @xjobs/xjobs
pnpm worker
```

Run the API in another terminal with `pnpm exec nx serve @xjobs/xjobs`. For worker development with restart on changes, use `pnpm worker:dev`. `pnpm exec nx worker @xjobs/xjobs` builds and launches the worker as an Nx target.

To run the whole pipeline in one process (infrastructure, ingest with its sweeper, and every enabled channel's scheduled collection), use `npx nx worker-all xjobs`, or `pnpm worker:all:dev` to restart on changes. It sets `WORKER_ROLE=all` and needs `APIFY_TOKEN`. A disabled channel is skipped and the others keep running. The per-role workers (`pnpm worker:ingest`, `npx nx worker-<channel> xjobs`) remain for scaling roles separately.

With a worker running, `pnpm jobs:smoke` enqueues a ping and verifies its result. The only initial processor is this infrastructure ping. Add business processors explicitly as workflows are implemented.

## Configuration

All schemas live in `src/config/environment.validation.ts`. The API validates the full environment; the worker uses `validateWorkerEnvironment` for its Redis settings. Both use Nest `ConfigService` and the typed `getRedisConfig()` accessor in `src/config/index.ts`, following the existing configuration pattern. The shared environment loader loads `.env.local` and `.env`; `XJOBS_SKIP_ENV_FILES=1` uses only the supplied process environment for containers and isolated tests.

| Variable                   | Default                  | Purpose                                                |
| -------------------------- | ------------------------ | ------------------------------------------------------ |
| `REDIS_URL`                | `redis://127.0.0.1:6379` | Durable job queues and transient pub/sub               |
| `REDIS_CACHE_URL`          | `redis://127.0.0.1:6380` | Disposable cache                                       |
| `REDIS_PREFIX`             | `xjobs`                  | Queue/key/channel namespace; letters, digits, `_`, `-` |
| `REDIS_COMMAND_TIMEOUT_MS` | `3000`                   | Cache/pubsub/producer command deadline                 |
| `CACHE_TTL_SECONDS`        | `300`                    | Default cache lifetime                                 |
| `JOBS_CONCURRENCY`         | `5`                      | Jobs processed concurrently by each worker (1–100)     |
| `REDIS_PORT`               | `6379`                   | Compose queue Redis host port                          |
| `REDIS_CACHE_PORT`         | `6380`                   | Compose cache Redis host port                          |
| `REDIS_CACHE_MAXMEMORY`    | `128mb`                  | Cache container memory budget                          |

Connection URLs support credentials and `rediss://` TLS. The `.env.example` URLs refer to the Compose port variables. For an existing local env file, add the new settings or use the default ports; changing a host port also requires changing its application URL.

Queue Redis retains its existing `redis-data` volume, uses AOF (`everysec`), and explicitly disables eviction. Cache Redis uses `allkeys-lru`, has no persistent volume, and can be cleared or restarted independently. Local Redis ports bind to loopback. Use authenticated/TLS Redis endpoints for remote deployments. AOF every-second persistence is not a guarantee against losing the most recent second on a host crash.

## Use from Nest modules

Import `RedisModule` into a consuming module and inject `CacheService` or `PubSubService`. Import `JobsModule` to inject `JobsService`. These modules are registered in the API root but exports remain scoped to importing modules, following Nest module boundaries.

```ts
const profile = await cache.remember(`user:${userId}:profile:${profileId}`, () => repository.findById(userId, profileId), 60);
await cache.delete(`user:${userId}:profile:${profileId}`);

const unsubscribe = await pubsub.subscribe(`user:${userId}:profile-updated`, async (message: unknown) => {
  /* validate payload, then handle */
});
await pubsub.publish(`user:${userId}:profile-updated`, { profileId });
await unsubscribe();

await jobs.enqueuePing('deployment-check');
```

Cache values must be JSON serializable. Reads treat errors/corrupt entries as misses, writes tolerate Redis outages, and source-loader errors propagate. Invalidation errors propagate so callers cannot assume stale data was removed. A cached `null` is treated as a miss; concurrent misses can invoke the loader more than once. Do not use this cache as authoritative storage or a lock.

Redis pub/sub is transient and delivers only to connected subscribers. Use BullMQ for work requiring persistence and retries. Subscriber callbacks receive `unknown` and should validate messages. Channels and cache keys containing domain data must include user IDs; Redis database numbers do not isolate pub/sub channels.

Jobs default to three attempts, exponential backoff starting at one second, completed retention of up to one day/1,000 jobs, and failed retention of up to seven days/5,000 jobs. Cleanup is lazy as BullMQ processes jobs. Unknown jobs and invalid ping payloads fail without retries. Enqueue operations fail promptly during outages; callers decide how to report/retry failed enqueue requests. Workers reconnect after temporary Redis loss.

To add business work, define a dedicated queue and producer, validate its payload (including the owning `userId` and `profileId`), and register its worker only in `WorkerModule`. Handlers must be idempotent because retries and stalled-job recovery can execute a job again. Use BullMQ's `prefix` option, not ioredis `keyPrefix`.

## Docker worker

Prepare runtime artifacts, then launch using the optional worker override:

```sh
pnpm exec nx prune @xjobs/xjobs
docker compose -f docker-compose.yaml -f docker-compose.worker.yaml up -d --build worker redis-cache
```

The worker uses the same image layout as the API, with `node worker.js` as its command. It talks to `redis:6379` within the Compose network and requires no HTTP/Supabase/database credentials. To add workers:

```sh
docker compose -f docker-compose.yaml -f docker-compose.worker.yaml up -d --scale worker=3 worker
```

Each worker has its own `JOBS_CONCURRENCY`; total parallelism grows with the worker count. SIGTERM stops fetching work and waits for active handlers. Compose allows 60 seconds before forcibly terminating the container; adjust that grace period to the longest job. BullMQ recovers stalled jobs after forced termination.

## Verification

```sh
pnpm exec nx build @xjobs/xjobs
pnpm test:redis
```

The integration suite uses a unique namespace, starts a compiled worker child process, and cleans up only its own jobs. It verifies cache TTL/invalidation, pub/sub isolation/unsubscribe, separate-process execution, retries, unknown-job rejection, and graceful shutdown. It uses default local ports or explicit `REDIS_URL`/`REDIS_CACHE_URL`; it does not load secret env files. Unit runs skip live tests and the opt-in smoke test.

References: [BullMQ connections](https://docs.bullmq.io/guide/connections), [production guidance](https://docs.bullmq.io/guide/going-to-production), [Redis pub/sub semantics](https://redis.io/docs/latest/develop/pubsub/).
