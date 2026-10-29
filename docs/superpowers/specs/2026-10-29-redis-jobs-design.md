# Redis and background jobs

The user requested Redis caching, pub/sub, and BullMQ execution infrastructure and selected a separate worker process. This builds reusable infrastructure; business job handlers and automatic caching of authenticated HTTP responses are outside this change.

## Approaches

Running processors in the API is simpler but couples execution and scaling to HTTP. The selected approach uses a standalone Nest application context with its own worker entry point. The API only produces jobs. Implementation choice: use `bullmq` and `ioredis` directly behind Nest injectable services, avoiding another integration wrapper.

## Components

- Keep the existing `redis` Compose service and data volume for queues and pub/sub. Explicitly set `noeviction`, retain AOF persistence, and use loopback-only host ports.
- Add `redis-cache` with a bounded memory budget and `allkeys-lru`; cache data is disposable. Separate URLs allow managed Redis/TLS in deployments.
- Add validated Redis configuration, namespaced JSON cache operations with mandatory TTLs, cache-aside loading, and explicit invalidation. Cache failures degrade to misses; failed loaders still propagate.
- Add namespaced JSON pub/sub using separate publishing and subscribing connections. Subscriptions return an unsubscribe function, multiple local listeners can share a channel, and malformed messages/listener errors are isolated. Pub/sub is transient; work requiring retries uses BullMQ.
- Add a queue producer with bounded connection/command waits, three attempts with exponential backoff, and bounded completed/failed retention. Prefixes isolate environments; business jobs must include workspace scope in their payloads and cache/channel keys.
- Add a standalone worker, configurable concurrency, reconnecting Redis connections, error logging, and graceful shutdown. Initially register only an infrastructure `ping` job with payload validation; reject unknown jobs. This verifies execution without inventing business workflows.
- Build both API and worker bundles and provide independent launch commands. Provide an optional Docker Compose worker service and documented scaling commands. The worker validates only its own settings and requires no HTTP or Supabase credentials.

## Verification

Unit tests cover configuration, cache behavior, payload validation and failures. Opt-in live Redis tests cover TTLs, invalidation, pub/sub, retries, and execution in a spawned compiled worker process. Run the existing test suite, TypeScript checks, lint, API/worker builds, and Compose validation. Do not read local secret env files or change existing Redis data.

## References

- https://docs.bullmq.io/guide/connections
- https://docs.bullmq.io/guide/going-to-production
- https://redis.io/docs/latest/develop/pubsub/
