# 01: Engine hosting

## Goal

The NestJS engine runs hosted, all day, against `10xjobs-dev`: its HTTP API reachable over HTTPS, and collection, ingest, processing and matching running on their schedules with no manual step.

## What already exists (on `main`)

- `apps/xjobs/Dockerfile` and `docker-compose.worker.yaml`.
- `npx nx worker-all xjobs` runs every worker in one process (infrastructure, ingest, processor when `OPENROUTER_API_KEY` is set, match, and each enabled channel's scheduled collection).
- The engine's environment validation (`apps/xjobs/src/config/environment.validation.ts`).

## In scope

- One Hetzner cloud server, set up repeatably (a script or a short runbook kept in the repo, no secrets).
- Docker Compose on the server: the API, one `worker-all` process, Redis, and Caddy in front of the API for HTTPS on a domain or subdomain.
- A GitHub Actions job that builds the engine image, pushes it to a registry and deploys it on merge to `main`.
- Secrets in GitHub secrets and on the server only.
- Health: the API has a health endpoint; containers restart on failure; logs can be read on the server.
- Which channels are enabled on the hosted engine: LinkedIn job board for sure; whether the others keep collecting now (useful later, but costs Apify runs) is for the spec.

## Out of scope

- Token auth (slice 02). Until it lands, the hosted API either stays on Basic auth or isn't exposed; the spec decides.
- A production engine.
- Monitoring and alerting beyond container restarts and logs.

## Locked

- Hetzner, Docker Compose, Caddy, Redis in a container, Supabase Cloud Postgres (`10xjobs-dev`).
- Deploys on merge to `main` from CI; Claude can't push, so the human merges.
- Engine migrations stay on the existing path; the engine doesn't migrate the database on startup.

## For the slice spec

- Server size, region (close to the Supabase project), and the registry (GHCR is the obvious default).
- How CI reaches the server (SSH deploy key, or the server pulling on a webhook).
- Domain and DNS for the API.
- Redis persistence: whether the queues need to survive a restart, given the matcher's and processor's sweeps already heal lost jobs from the database.
- Backups of the server itself: likely none needed, since the database holds all state.

## Done when

A merge to `main` deploys the engine without manual steps, the health endpoint answers over HTTPS, and a scheduled LinkedIn job-board collection run lands jobs that are processed and matched in `10xjobs-dev`.
