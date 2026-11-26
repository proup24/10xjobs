# 02: Deploy keeps a stopped worker stopped

Status: Built, PR #143. Owner check after merge in the PR body.

## Goal

If the owner stops the hosted `worker` container, it stays stopped across deploys until the owner starts it again. A deploy still ships the new image, so the worker runs the current code when it is started.

## Why now

- On 2026-11-25 the worker was down from about 04:00 to 11:00 UTC. The 11:05 UTC Deploy engine run (one of 8 that day) started it again, and collection ran every hour from 12:00 to 18:00 UTC.
- The processor then sent about 2,400 listings through `claude -p` on the owner's subscription. That was 5.8M output tokens, about $88 at API prices. It hit `claude usage limit reached` at 14:xx and 17:xx UTC, the same windows in which the owner's Claude Code sessions were cut off. The owner hit the limit twice that day.
- The owner stops the worker by hand fairly often (tick gaps are often that, not an outage), so this happens again with the next merge to main.

## What exists

- `.github/workflows/deploy-engine.yml` runs `docker compose … up -d --remove-orphans` on the server after pulling `api` and `worker`. `up -d` starts every service in the file, so a stopped `worker` starts again. A new image tag also recreates it.
- `deploy/engine/compose.yaml`: `worker` has `restart: unless-stopped`, so a manual `docker stop` survives a reboot but not an `up -d`.
- The health check looks only at `api` (container health, `/api/health` with and without the key). It doesn't check the worker.
- `deploy/engine/README.md` documents `$C restart worker` and `$C up -d worker`, but not how to stop the worker and keep it stopped. Its line 17 says each deploy restarts the worker.
- The processor already pauses itself on a usage limit and at `PROCESSOR_WEEKLY_STOP_AT`. Neither of those stops collection or the deploy restart.

## In scope

- A way for the owner to mark the worker stopped that the deploy reads and respects.
- The deploy still pulls and puts the new image in place for a stopped worker, so a later start runs current code.
- The deploy log says plainly when it left the worker stopped.
- A documented way to stop and to start the worker in `deploy/engine/README.md` (a new section). Line 17 updated to match.
- Updating `CLAUDE.md` if a command is added.

## Out of scope

- Stopping or capping the processor's use of the subscription in other ways, such as a usage-aware pause or moving to `ANTHROPIC_API_KEY` (that is the API-key gate in the [roadmap](../README.md)).
- Stopping the `api` container or Caddy.
- Pausing single channels or the processor alone while collection keeps running (unless the brainstorm finds it falls out cheaply).
- Production: there is no production project yet.

## Open questions

- What the stop signal is:
  - the container's own state before the deploy (stopped means stay stopped); this can't tell a manual stop from a crash that `unless-stopped` gave up on;
  - a marker file in `~/engine` (for example `worker.stopped`) written by a stop script;
  - a variable in `.env`;
  - a Compose profile.
- Whether to stop and start with a small script on the box (`engine/worker stop|start`) or only with documented `$C` commands.
- Whether a manual `workflow_dispatch` deploy may start the worker on purpose (for example an input `start_worker`), or never does.
- What the deploy does with a worker that was recreated but marked stopped: `up -d --no-start worker`, `create`, or `up -d` for every service except `worker`.
- Whether the health check should report the worker's state (running or held stopped) so a held worker is visible in the run summary.
- How to test it without SSH for Claude: a dry run of the remote script against a local Compose project, or a check the owner runs on the box after the first deploy.
