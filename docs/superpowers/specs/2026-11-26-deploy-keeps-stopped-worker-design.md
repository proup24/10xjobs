# Deploy keeps a stopped worker stopped: design

Platform slice 02 (`docs/roadmap/platform/02-deploy-keeps-stopped-worker.md`). Brainstormed 2026-11-26. Small change: short design.

## Intent

When the owner stops the hosted `worker`, it stays stopped through every deploy until the owner starts it again. A deploy still ships the new image, so a later start runs current code. On 2026-11-25 a deploy restarted a stopped worker, and the processor used up the owner's Claude subscription limit twice. The owner stops the worker by hand often, so this would happen again with the next merge.

## Goals, non-goals, anti-goals

- Goal: a stopped worker stays stopped across automatic deploys, manual dispatches (rollbacks included) and reboots.
- Goal: the run summary says plainly when the deploy left the worker stopped.
- Non-goals: capping the processor's subscription use any other way, stopping `api` or Caddy, pausing single channels, production.
- Anti-goal: a deploy starts a worker the owner stopped (today's bug).
- Anti-goal: a worker stays stopped when the owner thinks it is running, so collection goes missing without anyone noticing. The notice in the run summary guards against this.

## Approaches

- **A. The container's own state (picked).** Before the rollout, the deploy reads the worker container's state. A worker that is stopped stays stopped. The owner keeps stopping it the way they do today: nothing new to remember. The brief worried that this can't tell a manual stop from a crash, but `restart: unless-stopped` never gives up on a crashed container, so an exited worker almost always means a deliberate stop.
- B. A marker file (`~/engine/worker.stopped`) written by a stop script. It is explicit, but a plain `docker stop` without the script would be undone by the next deploy, which is the same bug again.
- C (dropped) and D (dropped). A variable in `.env` and a Compose profile both need the owner to edit config to stop the worker, and `$C up -d` after an unrelated `.env` change would still interact with them. They are B with more steps.

## Design

### The rule

Before the rollout, `deploy/engine/worker-hold.sh` reads the `xjobs-engine` project's `worker` container state and prints `start` or `hold`:

| Worker state before the deploy | Decision |
|---|---|
| `running`, `restarting` | start (deploy as today) |
| no container (first deploy, or removed by hand), `removing` | start |
| `exited`, `created`, `paused`, `dead` | hold |
| `docker` itself fails | the script exits non-zero and the deploy fails; it never guesses |

Treating `removing` as start, and failing hard on a `docker` error, are my calls.

### The rollout

- **start:** unchanged (`$C up -d --remove-orphans`).
- **hold:** the deploy brings up every other service (`api`, `redis`, `redis-cache`, `caddy`, with `--remove-orphans`). It then recreates the worker from the new image without starting it (`$C up --no-start worker`, or `$C create worker`; the builder picks whichever recreates a changed container and leaves it `created`). The next deploy sees `created` and holds again, and `$C start worker` runs the new image.
- The script ships with the workflow, not the deploy files: the workflow sparse-checks out `worker-hold.sh` at `github.workflow_sha` and pipes it over `ssh … bash -s` in its own step, so a rollback to an older commit still holds, and nothing new is stored on the server. The rest of the rollout stays inline in `deploy-engine.yml`.
- When it holds, the rollout prints `::notice::Worker was stopped before this deploy; left stopped on <sha>. Start it with $C start worker` (a workflow command printed over ssh still reaches the run summary).
- The health check also prints the worker's state (`running` or `held`) and never fails on it. It still checks only `api` for health.
- A manual `workflow_dispatch` follows the same rule. It gets no `start_worker` input: starting the worker stays a server command.

### Runbook (`deploy/engine/README.md`)

- A new section, "Stop and start the worker":
  - Stop: `$C stop worker`, or `docker stop`. It stays stopped across deploys and reboots. A stop waits up to 7 minutes (`stop_grace_period`) for a collection segment to finish.
  - Start: `$C start worker`.
  - Check: `$C ps -a worker`. The deploy's run summary also says when it left the worker stopped.
- Line 17 (section 1): each deploy of a new image recreates `api` and `worker`, and restarts the worker unless it was stopped.
- Sections 5 (step 7), 5a (rotate step 3), 8 (step 4) and 8a: warn that `$C up -d` and `$C up -d worker` start a stopped worker. If you want it to stay stopped, run `$C up -d api caddy` instead.
- No new command, so `CLAUDE.md` doesn't change.

### Tests

- `deploy/engine/worker-hold.test.mjs` (`node --test`, like `.claude/hooks/guard.test.mjs`) runs the script with a stub `docker` first on `PATH`, for every row of the table, including a failing `docker`.
- CI doesn't run any shell or `node --test` tests today (`test:hooks` isn't in `ci.yml`), so this adds a step that runs the deploy test to the `main` job in `.github/workflows/ci.yml`. Adding `test:hooks` to CI too is out of scope.
- The hold path of the rollout itself (the Compose commands) isn't tested in CI. It is covered by the owner check below.

### Owner check after merge

On the server, after the merge's own deploy:

1. `$C stop worker`, then run Deploy engine by hand (Actions, Run workflow, `main`, no input).
2. The run summary shows the "left stopped" notice. `$C ps -a worker` shows `created`, and `docker inspect` on it shows the new image tag.
3. `$C start worker`. Its logs show it registering schedules.
4. Run Deploy engine once more with the worker running. It recreates and starts it as before, with no notice.

## Left to the builder

- `up --no-start` or `create`, and the exact `docker` call the script makes (for example `docker ps -a` filtered by the Compose project and service labels). Keep it to one call so the stub stays simple.
- The wording of the notice and of the README section.
