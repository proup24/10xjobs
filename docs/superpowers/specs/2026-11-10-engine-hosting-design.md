# Engine hosting: design

Roadmap slice: [Phase 2 / 01: Engine hosting](../../roadmap/phase-2-find/01-engine-hosting.md).

## Intent

The NestJS engine (`apps/xjobs`) runs all day on a hosted server against the shared dev database `10xjobs-dev`. LinkedIn job-board collection, ingest, processing and matching run on their schedules with no one at a laptop, and the HTTP API is reachable over HTTPS so later slices (web app to engine auth, publish on create) have something to call. A merge to `main` deploys it; nobody runs a manual step.

Why now: every later Phase 2 slice assumes an engine that is always up and current with `main`. Until now, the engine runs only on someone's machine.

## Goals

- One Hetzner Cloud server, set up repeatably from files in the repo (no secrets in git).
- On the server, under Docker Compose: the API, one `worker-all` process, the queue Redis, the cache Redis, and Caddy terminating HTTPS in front of the API.
- A merge to `main` builds the engine image, pushes it to GHCR and deploys it, after the dev database has been migrated.
- Containers restart on failure; logs can be read on the server; the API's health endpoint answers over HTTPS.
- Two people (the owner and a teammate) can log in and operate the server, each with their own key.

## Non-goals

- Token auth between the web app and engine (slice 02).
- A production engine or production database (production is deferred).
- Monitoring and alerting beyond container restarts and logs.
- A real domain (see Decisions: sslip.io for now).
- Backups of the server: all state lives in Supabase; the server is rebuildable from the repo and the secrets.
- Running migrations from the engine or from the deploy job. Migrations stay on the existing `Dev database` workflow.

## Anti-goals (failure even if it works)

- Secrets in git, in the image, in workflow logs, or in the repo's runbook.
- New engine code running against a schema it was not migrated for.
- A server only one person can get into, or one where removing a person's access breaks deploys.
- Paid work (Apify, OpenRouter) running unbounded: the existing caps stay in force.
- Redis or the engine's internal ports reachable from the internet.
- Scheduled (cron or interval) jobs running on a laptop. Only the hosted engine runs schedules.

## What already exists (on `main`)

- `apps/xjobs/Dockerfile`: `node:lts-alpine`, copies `dist`, installs production deps, `CMD node main.js`. The worker runs from the same image with `node worker.js`.
- `@nx/docker` plugin: `npx nx docker:build @xjobs/xjobs` (depends on `build` and `prune`, which emits the pruned `package.json`, lockfile and `workspace_modules` into `apps/xjobs/dist`).
- `docker-compose.yaml` (local): queue Redis (`redis:8.2.10-alpine`, AOF `everysec`, `noeviction`, volume) and cache Redis (no persistence, `allkeys-lru`, `maxmemory`). The hosted setup copies these settings.
- `docker-compose.worker.yaml` (local): worker containers, `XJOBS_SKIP_ENV_FILES=1`, `stop_grace_period: 60s`.
- `GET /api/health` (`apps/xjobs/src/app/controllers/health.controller.ts`): public, `no-store`, 200 when Postgres and the queue Redis answer (`degraded` if only the cache is down), 503 otherwise.
- Basic auth on every other API route (`BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD` ≥ 12 chars).
- `ACTIVE_CHANNELS` in `libs/database/src/enums/channel.enum.ts` is `[LINKEDIN_JOB_BOARD]`. Disabled channels remove their schedule. LinkedIn job board runs hourly 08:00–22:00 UTC on weekdays.
- Environment validation: `apps/xjobs/src/config/environment.validation.ts`. The API needs `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BASIC_AUTH_*`, Redis URLs; `worker-all` additionally needs `APIFY_TOKEN`, and runs the processor only when `OPENROUTER_API_KEY` is set.
- `.github/workflows/ci.yml` (`CI`) and `.github/workflows/dev-database.yml` (`Dev database`, runs on `workflow_run` of CI on `main`, GitHub environment `dev`, secrets `DEV_DATABASE_URL`, `DEV_SUPABASE_URL`, `DEV_SUPABASE_SERVICE_ROLE_KEY`).
- The repo is private (`proup24/10xjobs`), so GHCR images are private by default.

## Decisions

Marked **(owner)** where the owner decided, **(call)** where it was the designer's call and is open to correction.

### Server

- **(owner)** Hetzner Cloud, Docker Compose, Caddy, Redis in containers, Supabase Cloud Postgres `10xjobs-dev` (locked by the roadmap).
- **(call)** One shared-vCPU server with 4 GB RAM (CX22-class or its current equivalent), Ubuntu 24.04 LTS. Location: the Hetzner location nearest the `10xjobs-dev` Supabase region (check it in the Supabase dashboard; for `eu-central-1` that is Falkenstein or Nuremberg). Size up only if the processor or matcher run short of memory.
- **(call)** Hetzner Cloud Firewall in front of the server, plus `ufw` on it: inbound 22, 80, 443 only.
- **(call)** The server is created by hand in the Hetzner console following the runbook (no Terraform for one box). Everything after creation is a script in the repo.

### Access

- **(owner)** Both the owner and the teammate log in to operate the server.
- **(call)** One non-root user (`deploy`) in the `docker` group. Each person's public SSH key and a separate CI deploy key go in its `authorized_keys`. Root SSH login and password auth are off. Personal keys may also have `sudo` (owner's choice at setup); the CI key does not need it.
- **(call)** Public keys are not secrets but are personal; the bootstrap script takes them as input rather than committing them.

### Domain and HTTPS

- **(owner)** No domain yet; use sslip.io and don't wait for a domain.
- **(call)** Hostname `api.<ip-with-dashes>.sslip.io` (for example `api.203-0-113-10.sslip.io`), set as `ENGINE_HOSTNAME` in the server's env. Caddy gets a Let's Encrypt certificate for it automatically. Moving to a real domain later is changing `ENGINE_HOSTNAME` and adding a DNS record.
- **(call)** Caddy reverse-proxies everything to the API container on its internal port. The API's own port is not published on the host.

### API exposure until slice 02

- **(call)** The API is public over HTTPS and keeps Basic auth on every route except `GET /api/health`. Strong random credentials, stored as secrets. Slice 02 replaces this.

### Channels and spend

- **(owner)** Keep the existing caps: LinkedIn job board hourly on weekdays via Apify, processor spend capped at `PROCESSOR_DAILY_BUDGET_USD` (default $20/day). No overrides on the server.
- **(code)** Only LinkedIn job board collects, because `ACTIVE_CHANNELS` says so. No hosting change is needed to keep the other channels off.

### Schedules run only on the hosted engine

- **(owner)** From now on no scheduled job runs on a local machine. Today every worker registers BullMQ job schedulers in its own Redis at startup (`apps/xjobs/src/infrastructure/worker/scheduler.ts`): channel collection (cron), the ingest sweep, the processor sweep and the match sweep. A laptop running `worker-all` against `10xjobs-dev` would collect a second time each hour, paying Apify twice and landing duplicate jobs in the shared database.
- **(call)** A new opt-in env flag, `XJOBS_RUN_SCHEDULES=1`, is set only in the server's compose file. Without it, a worker registers no schedulers and removes any it already has in its Redis at startup, so old schedules left in a laptop's Redis are cleared on the first run. It logs one line saying schedules are off. Workers still process jobs that are enqueued on purpose, such as the API's testing endpoints and the `db:*` scripts, so local work keeps going.
- The flag defaults to off everywhere, including against the local Supabase stack. Locally, collection and sweeps run only when someone triggers them.
- `docs/shared-dev-database.md`, `.env.example` and `CLAUDE.md` (the `worker-*` command lines) say that local workers don't run schedules and that the hosted engine owns them.
- Unit tests cover both paths: with the flag, the schedulers are upserted as today; without it, they are removed and none are upserted.

### Processes

- **(call)** Services on the server: `api` (`node main.js`), `worker` (`node worker.js`, `WORKER_ROLE=all`), `redis` (queue), `redis-cache`, `caddy`. One image for `api` and `worker`.
- **(call)** `restart: unless-stopped` on all; `stop_grace_period: 60s` on `api` and `worker` (as locally). `api` has a Docker healthcheck against `/api/health` (wget is in alpine's busybox); Caddy starts after `api`.
- **(call)** `OPENROUTER_API_KEY` is set on the server, so `worker-all` runs the processor. The API gets it too (its processor testing endpoints need it), behind Basic auth.
- **(call)** `XJOBS_SKIP_ENV_FILES=1` and `NODE_ENV=production` in both engine containers, and `XJOBS_RUN_SCHEDULES=1` in the worker container; values come from Compose `env_file` on the server.

### Redis persistence

- **(call)** Queue Redis keeps AOF on a named volume, as the local compose does. It costs nothing and keeps scheduled repeatable jobs and in-flight work across restarts; the processor's and matcher's sweeps still heal anything lost. Cache Redis has no persistence.
- Neither Redis publishes a host port.

### Logs

- **(call)** Docker `json-file` logging with rotation (for example `max-size: 10m`, `max-file: 5`) on every service, set in the compose file. Read with `docker compose logs -f <service>` on the server. Nothing ships logs elsewhere.

### Registry and images

- **(call)** GHCR: `ghcr.io/proup24/10xjobs-engine`, private (the repo is private). Tags: the full commit SHA on every build, plus a moving `dev` tag.
- **(call)** The server pulls with a short-lived credential: the deploy job logs Docker in on the server with the job's `GITHUB_TOKEN` (`packages: read`), pulls, then logs out. No long-lived registry token on the server. Restarts reuse the local image and need no login.

### Deploy

- **(owner, locked)** Deploys on merge to `main` from CI; the human merges.
- **(call)** New workflow `.github/workflows/deploy-engine.yml`, triggered by `workflow_run` of `Dev database` completing with `success` on `main` (so the schema is migrated first), plus `workflow_dispatch` with an optional `image_tag` input for rollback/redeploy. Runs in the GitHub environment `dev`; `concurrency: deploy-engine`, not cancel-in-progress.
- Steps:
  1. Check out the `head_sha` of the triggering run.
  2. Install, then `nx docker:build @xjobs/xjobs` (or the equivalent `build` + `prune` + `docker build`), tag `:<sha>` and `:dev`, push to GHCR. Skipped on a `workflow_dispatch` rollback that names an existing tag.
  3. Copy the server's deploy files from the repo (`deploy/engine/compose.yaml`, `deploy/engine/Caddyfile`) to the server over SSH, so changes to them ship with the code.
  4. On the server: `docker login ghcr.io` with the job token, set `ENGINE_IMAGE_TAG=<sha>`, `docker compose pull`, `docker compose up -d --remove-orphans`, `docker logout ghcr.io`, prune old images (keep a few for rollback).
  5. Wait for `https://$ENGINE_HOSTNAME/api/health` to return 200 (retry for a couple of minutes); fail the job otherwise.
- **(call)** SSH from CI: a dedicated ed25519 deploy key (`ENGINE_SSH_PRIVATE_KEY`), the server's host key pinned in `ENGINE_SSH_KNOWN_HOSTS`, host and user in `ENGINE_SSH_HOST` / `ENGINE_SSH_USER`. All in the `dev` environment.
- **(call)** Until the server exists, the workflow skips itself: the deploy job runs only when the `ENGINE_SSH_HOST` secret is set (checked in an early step that ends the job green with a notice). The workflow can therefore merge before the server is set up, and merges stay green.
- Rollback: run the workflow by hand with `image_tag` set to an earlier SHA.

### Secrets

- **(owner, locked)** In GitHub secrets and on the server only.
- GitHub `dev` environment: the SSH secrets above. Engine runtime secrets live only on the server, in `/home/deploy/engine/.env` (mode 600), created by hand following the runbook: `DATABASE_URL` (session pooler, port 5432), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD`, `APIFY_TOKEN`, `OPENROUTER_API_KEY`, `ENGINE_HOSTNAME`. Redis URLs and prefix are fixed in the compose file. CI never sees the engine's runtime secrets.
- A committed `deploy/engine/.env.example` lists the names with no values.

### Who sets up the server

- **(owner)** The owner does the one-time setup by hand, following the runbook: creating the Hetzner server and firewall, running `bootstrap.sh`, writing the server `.env` and adding the GitHub `dev` secrets and the CI deploy key. The builder writes the scripts and the runbook and verifies them as far as possible without the server (for example `shellcheck`, `docker compose config`, `caddy validate`). The live checks in Done when happen after the owner's setup and the first deploy.

### Repo layout (call)

```
deploy/engine/
  compose.yaml        # api, worker, redis, redis-cache, caddy
  Caddyfile           # {$ENGINE_HOSTNAME} -> api:3000
  .env.example        # names only
  bootstrap.sh        # one-time server setup, run as root on a fresh box
  README.md           # runbook
.github/workflows/deploy-engine.yml
```

`bootstrap.sh` is idempotent: creates `deploy`, installs Docker Engine and the Compose plugin from Docker's apt repo, installs `authorized_keys` from arguments or a file, hardens `sshd` (no root, no passwords), enables `ufw` (22/80/443), enables unattended security upgrades, creates `/home/deploy/engine`. No secrets.

The runbook covers: creating the server and firewall in Hetzner, running `bootstrap.sh`, writing the server `.env`, adding the GitHub `dev` secrets and the CI public key, the first deploy, reading logs, restarting a service, changing a secret (edit `.env`, `docker compose up -d`), rolling back, adding or removing a person's key, and moving to a real domain.

## Done when

1. A merge to `main` runs CI, then `Dev database`, then `Deploy engine`, with no manual step, and the server runs the image tagged with the merge commit's SHA.
2. `curl https://api.<ip>.sslip.io/api/health` returns 200 with a valid certificate; any other route without Basic auth returns 401.
3. Within a scheduled LinkedIn job-board window, a collection run lands jobs in `10xjobs-dev` that the processor then processes and the matcher decides (checked by querying the dev database).
4. `docker compose restart worker` (or a killed container) comes back on its own; `docker compose logs` shows each service's output.
5. Both the owner and the teammate can SSH in with their own keys; root and password logins are refused.
6. A worker started on a laptop without `XJOBS_RUN_SCHEDULES` registers no schedulers and removes any left in its Redis; the hosted worker registers them all.
7. A manual `workflow_dispatch` with an older SHA rolls the engine back.

## Left to the builder

- Exact Hetzner server type name and location once the Supabase region is checked.
- Whether to call `nx docker:build` or the underlying steps in CI, and how to make the build reproducible in the workflow.
- Exact healthcheck, log rotation and image-prune numbers.
- Any small engine change the hosted run turns out to need (for example a missing env default), kept minimal and called out in the PR.
