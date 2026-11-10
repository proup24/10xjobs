# Engine Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host the engine (API + `worker-all` + two Redis instances + Caddy) on one Hetzner server, deployed from `main` by GitHub Actions. Scheduled jobs run only on that server.

**Architecture:** A new opt-in flag `XJOBS_RUN_SCHEDULES` controls whether worker processes register their BullMQ job schedulers; without it they remove them. Deploy files live in `deploy/engine/`. A new `Deploy engine` workflow runs after `Dev database`. It builds the image, pushes it to GHCR, copies the deploy files to the server over SSH, runs `docker compose up -d` there, then checks `/api/health` over HTTPS.

**Tech Stack:** NestJS 11 + BullMQ, Vitest, Docker Compose, Caddy 2, Redis 8.2, GitHub Actions, GHCR, Ubuntu 24.04 on Hetzner Cloud.

**Spec:** `docs/superpowers/specs/2026-11-10-engine-hosting-design.md`

**Branch:** `feat/engine-hosting` from `main`, one PR to `main`.

**Linear ticket:** none; this project does not use a ticket tracker.

## Global Constraints

- No secrets in git, the image, workflow logs or the runbook. Engine runtime secrets live only in `/home/deploy/engine/.env` on the server (mode 600).
- GitHub environment `dev` holds only `ENGINE_SSH_HOST`, `ENGINE_SSH_USER`, `ENGINE_SSH_PRIVATE_KEY`, `ENGINE_SSH_KNOWN_HOSTS`.
- Image: `ghcr.io/proup24/10xjobs-engine`, tags `<full sha>` and `dev`, private.
- Hostname comes from `ENGINE_HOSTNAME` (for example `api.203-0-113-10.sslip.io`).
- Inbound ports 22, 80, 443 only. Neither Redis nor the API publishes a host port.
- Queue Redis: `redis:8.2.10-alpine`, `--appendonly yes --appendfsync everysec --maxmemory-policy noeviction`, named volume. Cache Redis: same image, `--save "" --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru`.
- `api` and `worker`: `NODE_ENV=production`, `XJOBS_SKIP_ENV_FILES=1`, `REDIS_URL=redis://redis:6379`, `REDIS_CACHE_URL=redis://redis-cache:6379`, `stop_grace_period: 60s`, `restart: unless-stopped`. `worker` adds `WORKER_ROLE=all` and `XJOBS_RUN_SCHEDULES=1`.
- `XJOBS_RUN_SCHEDULES` defaults to off; it is never set in `.env.example` (only shown commented as server-only).
- Engine migrations stay in `dev-database.yml`. The deploy never migrates.
- Processor budget and channel set unchanged (`PROCESSOR_DAILY_BUDGET_USD` default, `ACTIVE_CHANNELS = [LINKEDIN_JOB_BOARD]`).
- Claude pushes only `git push -u origin feat/engine-hosting` and opens the PR with `gh pr create`; the human merges.

## Review Focus

1. **A laptop whose Redis already holds schedulers from before this change.** Expected: the first worker start without the flag removes the `collect` scheduler on each channel queue and the `sweep` scheduler on the ingest, process and match queues (all three sweeps share the id `sweep`, each on its own queue). Owned by Task 1 (test "removes every scheduler when schedules are off").
2. **A channel that is enabled while schedules are off.** Expected: the collection worker still starts, so a `collect` job enqueued on purpose still runs, and the process does not exit. Owned by Task 1 (test "starts the collection worker without a schedule when schedules are off").
3. **The flag set to a non-boolean or left empty** (`XJOBS_RUN_SCHEDULES=`). Expected: an empty value means off; an invalid value fails startup the way other `booleanFlag`s do, never silently on. Owned by Task 1 (validation tests).
4. **A merge before the server exists.** Expected: `Deploy engine` finishes green with a notice and touches nothing. Owned by Task 3 (guard step, checked with `actionlint` and a dry read).
5. **A deploy whose new image fails health.** Expected: the job fails red after its retry window and the previous containers are not torn down beforehand (`up -d` replaces in place). The runbook names the rollback. Owned by Task 3 (health step) and Task 4 (runbook).

---

### Task 0: Branch and spec

- [ ] **Step 1:** `git switch -c feat/engine-hosting main`
- [ ] **Step 2:** Commit the spec and this plan.

```bash
git add docs/superpowers/specs/2026-11-10-engine-hosting-design.md docs/superpowers/plans/2026-11-10-engine-hosting.md
git commit -m "docs: engine hosting spec and plan"
```

---

### Task 1: Schedules run only when `XJOBS_RUN_SCHEDULES` is set

**Files:**

- Modify: `apps/xjobs/src/config/environment.validation.ts` (`workerProcessEnvironmentSchema`)
- Modify: `apps/xjobs/src/infrastructure/worker/scheduler.ts`
- Modify: `apps/xjobs/src/infrastructure/worker/collection.service.ts`, `ingest.service.ts`, `processor.service.ts`, `match.service.ts`, `worker.module.ts`
- Test: `apps/xjobs/src/config/validation.spec.ts`, `apps/xjobs/src/infrastructure/worker/tests/scheduler.spec.ts`, `tests/collection-worker.spec.ts`, `tests/all-worker.spec.ts`

**Interfaces:**

- Produces: env var `XJOBS_RUN_SCHEDULES` (`booleanFlag.default(false)`) on `workerProcessEnvironmentSchema`.
- Produces: in `scheduler.ts`, `export const RUN_SCHEDULES = Symbol('RUN_SCHEDULES')`, a Nest injection token for a `boolean`, provided in `WorkerModule` by `useFactory: (config: ConfigService<WorkerProcessEnvironmentVariables, true>) => config.get('XJOBS_RUN_SCHEDULES', { infer: true })`.
- Produces: every sync function takes a trailing `run: boolean`. When it is `false`, the function calls `removeJobScheduler(<its id>)` and returns `'removed'`. When it is `true`, it upserts exactly as today and returns `'scheduled'`. The queue type becomes `Pick<Queue, 'upsertJobScheduler' | 'removeJobScheduler'>` for all four.
  - `syncCollectionScheduler(queue, config: ChannelJobConfig, run: boolean): Promise<'scheduled' | 'removed'>` removes when `!config.enabled || !run`.
  - `syncSweepScheduler(queue, run)`, `syncProcessSweepScheduler(queue, run)`, `syncMatchSweepScheduler(queue, run)`: `Promise<'scheduled' | 'removed'>`.
- `CollectionWorkerService.start` keeps `Promise<boolean>`, but returns `false` only when `config.enabled` is false. When the channel is enabled and `run` is false, it removes the scheduler and still starts the BullMQ worker, logging `${channel}: schedules off (XJOBS_RUN_SCHEDULES not set); scheduler removed`.
- Ingest, processor and match services inject `RUN_SCHEDULES`, pass it through, and log `schedules off` instead of `sweeping every …` when it is false.

- [ ] **Step 1: Write the failing tests**

In `validation.spec.ts`, against `workerProcessEnvironmentSchema` with the existing minimal valid env:

- `XJOBS_RUN_SCHEDULES` unset → `false`; `'1'` → `true`; `'true'` → `true`; `'0'` → `false`.
- `'maybe'` → parse fails, with an issue path of `['XJOBS_RUN_SCHEDULES']`.
- If `booleanFlag` rejects `''`, assert that it rejects and document `unset` as the off state. Otherwise assert `''` → `false`. Check `booleanFlag` and pick whichever matches it; don't change `booleanFlag` itself.

In `scheduler.spec.ts`:

- Keep the existing tests, now passing `true`.
- `'removes the collection scheduler when schedules are off'`: an enabled LinkedIn config with `run=false` → `'removed'`, `removeJobScheduler` called with `'collect'`, `upsertJobScheduler` not called.
- `'removes every scheduler when schedules are off'`: call each of the three sweep sync functions with `run=false`. Each returns `'removed'`, calls `removeJobScheduler` with its own id constant (`SWEEP_JOB`, `PROCESS_SWEEP_JOB`, `MATCH_SWEEP_JOB`, all `'sweep'` today) and never upserts.

In `collection-worker.spec.ts`, set `process.env.XJOBS_RUN_SCHEDULES` in the hoisted block for the existing cases, then add:

- `'starts the collection worker without a schedule when schedules are off'`: with the flag deleted, `start(LINKEDIN_JOB_BOARD)` returns `true`, `created.workers` contains `'collect-linkedin-job-board'`, `created.removedSchedulers` contains `'collect'`, and `created.schedulers` is empty.

If module-level env hoisting makes one file awkward for both states, put the flag-off case in a new spec file next to it.

In `all-worker.spec.ts`, keep the existing expectations with the flag set to `'1'`. Add a flag-off file or case that checks `WORKER_ROLE=all`: no scheduler is upserted, and `removeJobScheduler('sweep')` ran on the ingest and match queues and `removeJobScheduler('collect')` on the LinkedIn job-board queue (and `'sweep'` on the process queue when the OpenRouter key is set in that spec). Track removals per queue name in the mock.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx nx test xjobs -- src/config/validation.spec.ts src/infrastructure/worker/tests`
Expected: FAIL. The new cases fail because the flag doesn't exist yet and the sync functions take no `run` argument.

- [ ] **Step 3: Implement**

Add the schema field with a doc comment: "Registers the workers' cron and sweep schedulers. Set only on the hosted engine; local workers remove theirs." Add the token and the provider to `WorkerModule`. Thread `run` through the four services as in Interfaces. Keep each sync function idempotent.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx nx test xjobs`
Expected: PASS, with no other spec changed except the env setup in the worker specs.

- [ ] **Step 5: Update the docs**

- `.env.example`: under the worker block, add `# XJOBS_RUN_SCHEDULES=  # hosted engine only; never set locally. Without it workers register no schedules and remove old ones.`
- `docs/shared-dev-database.md`, in "Daily work": add a paragraph saying the hosted engine owns every schedule (collection and sweeps). Local workers register none, so they only run jobs someone triggers. Do not set `XJOBS_RUN_SCHEDULES` locally.
- `CLAUDE.md`, the `worker-all` and `worker-<channel>` command lines: add "(registers schedules only with `XJOBS_RUN_SCHEDULES=1`, set on the hosted engine)".
- The comment block at the top of `docker-compose.worker.yaml`: one line saying these local containers run without schedules unless the flag is passed.

- [ ] **Step 6: Run what CI runs and commit**

Run: `npx nx run-many -t lint test build typecheck`. Expected: all green.

```bash
git add apps/xjobs/src .env.example docs/shared-dev-database.md CLAUDE.md docker-compose.worker.yaml
git commit -m "feat(worker): register schedules only when XJOBS_RUN_SCHEDULES is set"
```

---

### Task 2: Server compose, Caddy and bootstrap script

**Files:**

- Create: `deploy/engine/compose.yaml`
- Create: `deploy/engine/Caddyfile`
- Create: `deploy/engine/.env.example`
- Create: `deploy/engine/bootstrap.sh` (executable)

**Interfaces:**

- Consumes: `XJOBS_RUN_SCHEDULES` from Task 1.
- Produces, for Task 3:
  - The server directory `/home/deploy/engine` holds `compose.yaml`, `Caddyfile` and `.env`.
  - Compose reads the image as `ghcr.io/proup24/10xjobs-engine:${ENGINE_IMAGE_TAG:?}`.
  - `ENGINE_IMAGE_TAG` lives in `/home/deploy/engine/image.env`, which the deploy writes, and is passed with `--env-file image.env --env-file .env`. Compose project name `xjobs-engine`.
  - Services `api`, `worker`, `redis`, `redis-cache`, `caddy`.

- [ ] **Step 1: Write `compose.yaml`**

Five services, everything per Global Constraints:

- `api`:
  - Image above; `env_file: .env`; Redis URLs and the fixed env inline; `expose: ["3000"]`.
  - Healthcheck: `wget -qO- http://127.0.0.1:3000/api/health || exit 1`, interval 15s, timeout 5s, retries 5, start_period 30s.
  - `depends_on` both Redis instances `service_healthy`.
- `worker`: the same image with `command: ["node", "worker.js"]`, `env_file: .env`, the worker env and the same `depends_on`.
- `redis` and `redis-cache`: the existing local definitions without `ports`, keeping their `redis-cli ping` healthchecks. The queue Redis uses volume `redis-data`.
- `caddy`:
  - `caddy:2.10.2-alpine`, or the latest 2.x patch tag that's at least two weeks old, pinned exactly.
  - Ports `80:80` and `443:443`, plus `443:443/udp`.
  - Mounts `./Caddyfile:/etc/caddy/Caddyfile:ro` and volumes `caddy-data:/data` and `caddy-config:/config`.
  - `ENGINE_HOSTNAME` comes from `.env`; `depends_on: api: condition: service_healthy`.
- Every service gets `logging: { driver: json-file, options: { max-size: "10m", max-file: "5" } }` (YAML anchor) and `restart: unless-stopped`.

- [ ] **Step 2: Write `Caddyfile`**

```
{$ENGINE_HOSTNAME} {
	encode gzip
	reverse_proxy api:3000
}
```

- [ ] **Step 3: Write `deploy/engine/.env.example`**

List the names only, each with a one-line comment: `ENGINE_HOSTNAME`, `DATABASE_URL` (session pooler, port 5432, never 6543), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD` (≥ 12 chars, `openssl rand -base64 24`), `APIFY_TOKEN`, `OPENROUTER_API_KEY`.

- [ ] **Step 4: Validate the compose file and the Caddyfile**

Run:

```bash
cd deploy/engine
printf 'ENGINE_IMAGE_TAG=test\n' > /tmp/image.env
docker compose -p xjobs-engine --env-file /tmp/image.env --env-file .env.example config -q
docker run --rm -e ENGINE_HOSTNAME=api.127-0-0-1.sslip.io -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:<pinned tag> caddy validate --config /etc/caddy/Caddyfile
```

Expected: compose exits 0 and Caddy prints `Valid configuration`. Write the temp file into the session scratchpad instead of `/tmp` if one is available. If Docker isn't available, say so in the PR and leave the check to the first deploy.

- [ ] **Step 5: Write `bootstrap.sh`**

Usage: `sudo ./bootstrap.sh <authorized_keys file>`. Bash with `set -euo pipefail`, Ubuntu 24.04, idempotent. Every step can be re-run without changing anything that's already set:

1. Refuse unless the script runs as root and the keys file exists and isn't empty.
2. Install Docker Engine and the Compose plugin from Docker's official apt repo (keyring in `/etc/apt/keyrings`). Skip this if `docker compose version` already works.
3. Create the user `deploy` with bash as its shell and add it to the `docker` group.
4. Install the keys file as `/home/deploy/.ssh/authorized_keys`, with mode 700 on the directory and 600 on the file, owned by `deploy`.
5. Write `/etc/ssh/sshd_config.d/10-xjobs.conf` with `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no` and `AllowUsers deploy`. Run `sshd -t`, then `systemctl reload ssh`.
6. `ufw`: default deny incoming, allow `22/tcp`, `80/tcp`, `443/tcp`, `443/udp`, then enable it.
7. Install `unattended-upgrades` and enable it.
8. Create `/home/deploy/engine`, owned by `deploy`, mode 700.
9. Print the next steps, pointing at the runbook.

No sudo for `deploy`: the `docker` group is enough, and the runbook says how to use root from the Hetzner console.

- [ ] **Step 6: Lint the script**

Run: `shellcheck deploy/engine/bootstrap.sh`, or `docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable deploy/engine/bootstrap.sh`. Expected: no findings.

- [ ] **Step 7: Commit**

```bash
git add deploy/engine
git commit -m "feat(deploy): server compose, Caddy and bootstrap script for the hosted engine"
```

---

### Task 3: `Deploy engine` workflow

**Files:**

- Create: `.github/workflows/deploy-engine.yml`

**Interfaces:**

- Consumes: Task 2's file layout, compose project name, `image.env` and service names.
- Produces: the workflow named `Deploy engine`.

- [ ] **Step 1: Write the workflow**

- `on`: `workflow_run` with `workflows: [Dev database]`, `types: [completed]` and `branches: [main]`; plus `workflow_dispatch` with input `image_tag` (string, optional, "existing image SHA to redeploy").
- `permissions`: `contents: read`, `packages: write`.
- `concurrency`: group `deploy-engine`, `cancel-in-progress: false`.
- One job `deploy`:
  - Runs when `github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'`.
  - `environment: dev`, `runs-on: ubuntu-latest`, `timeout-minutes: 30`.
- Steps:
  1. **Guard:** if `secrets.ENGINE_SSH_HOST` is empty (read it through `env` first), print `::notice::ENGINE_SSH_HOST not set; skipping engine deploy` and set an output `skip=true`. Every later step has `if: steps.guard.outputs.skip != 'true'`.
  2. **Resolve the SHA:** `inputs.image_tag` if given; otherwise `github.event.workflow_run.head_sha` on `workflow_run`; otherwise `github.sha` on a dispatch with no input. Set `build=false` only when `image_tag` was given.
  3. Checkout at that SHA. Do it even for rollbacks, so the copied deploy files are the ones that match the image.
  4. When `build=true`, follow the setup in `ci.yml` (`pnpm/action-setup@v6`, `actions/setup-node@v6` with node 24 and pnpm cache, `pnpm install --frozen-lockfile`). Then run `pnpm exec nx run @xjobs/xjobs:prune --configuration=production`, or whatever produces a production `apps/xjobs/dist` with `main.js`, `worker.js`, `package.json`, the lockfile and `workspace_modules`. Check the `build` target's configurations and pick the production one.
  5. When `build=true`, run `docker/login-action` against `ghcr.io` with `GITHUB_TOKEN`. Then run `docker/build-push-action` with context `apps/xjobs`, `file: apps/xjobs/Dockerfile`, `push: true` and tags `ghcr.io/proup24/10xjobs-engine:<sha>` and `:dev`.
  6. **Set up SSH:** write `ENGINE_SSH_PRIVATE_KEY` to `~/.ssh/id_ed25519` (mode 600) and `ENGINE_SSH_KNOWN_HOSTS` to `~/.ssh/known_hosts`, with `StrictHostKeyChecking yes`.
  7. Copy `deploy/engine/compose.yaml` and `deploy/engine/Caddyfile` to `$USER@$HOST:engine/` with `scp`.
  8. Deploy over `ssh`, as a script:
     - `cd ~/engine`.
     - `printf 'ENGINE_IMAGE_TAG=%s\n' "$SHA" > image.env`.
     - `echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin`.
     - Set `C="docker compose -p xjobs-engine --env-file image.env --env-file .env"`, then run `$C pull api worker` and `$C up -d --remove-orphans`.
     - `docker logout ghcr.io`.
     - `docker image prune -af --filter "until=168h"`, which keeps last week's images for rollback.
     - Pass `SHA`, `GITHUB_TOKEN` and `GITHUB_ACTOR` through the ssh command's environment, never by echoing them in the log.
     - `set -euo pipefail` on both sides, and `docker logout` in a `trap` so it runs on failure too.
  9. **Health check:** read `ENGINE_HOSTNAME` from the server with `ssh … 'grep ^ENGINE_HOSTNAME= ~/engine/.env | cut -d= -f2-'`. Then `curl -fsS --retry 24 --retry-delay 5 --retry-all-errors "https://$HOSTNAME/api/health"`. Expected: 200. On failure, print `$C ps` and `$C logs --tail 100 api worker` over ssh, then fail.

- [ ] **Step 2: Lint**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`. Expected: no findings for `deploy-engine.yml`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-engine.yml
git commit -m "ci: deploy the engine to the Hetzner server after the dev database migrates"
```

---

### Task 4: Runbook

**Files:**

- Create: `deploy/engine/README.md`
- Modify: `docs/roadmap/phase-2-find/01-engine-hosting.md`: add one closing line linking the spec and `deploy/engine/README.md`

- [ ] **Step 1: Write the runbook**

Sections, each a few numbered commands, with no secrets and no real IPs:

1. **What runs here:** the five services and what each does. Schedules run only here (`XJOBS_RUN_SCHEDULES=1`).
2. **Create the server:**
   - In the Hetzner console: Ubuntu 24.04, a shared-vCPU type with 4 GB of RAM, at the location nearest the `10xjobs-dev` Supabase region. Look the region up under Project Settings → General; Falkenstein or Nuremberg for `eu-central-1`.
   - Add both people's SSH keys at creation.
   - Create a Cloud Firewall allowing inbound 22/tcp, 80/tcp, 443/tcp and 443/udp, and attach it.
3. **Bootstrap:**
   - Create a keys file with one line per person plus the CI public key.
   - `scp bootstrap.sh keys root@<ip>:`, then `ssh root@<ip> ./bootstrap.sh keys`.
   - Check that `ssh deploy@<ip>` works and `ssh root@<ip>` is refused.
4. **The CI deploy key:** run `ssh-keygen -t ed25519 -N '' -f engine-deploy -C engine-deploy`. The `.pub` goes in the keys file and the private key in `ENGINE_SSH_PRIVATE_KEY`. Delete the local copy afterwards.
5. **Server secrets:**
   - `ssh deploy@<ip>`, then `cd engine`, then create `.env` from `deploy/engine/.env.example` and `chmod 600 .env`.
   - Set `ENGINE_HOSTNAME=api.<ip with dashes>.sslip.io`.
   - Get `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the same places as the `DEV_*` secrets in `docs/shared-dev-database.md`.
6. **GitHub secrets:**
   - In the `dev` environment, set `ENGINE_SSH_HOST` (the IP), `ENGINE_SSH_USER=deploy` and `ENGINE_SSH_PRIVATE_KEY`.
   - Set `ENGINE_SSH_KNOWN_HOSTS` to the output of `ssh-keyscan -t ed25519 <ip>`, checked against the fingerprint shown in the Hetzner console.
7. **First deploy:** Actions → Deploy engine → Run workflow, with no input, from `main`. Then check `curl https://api.<…>.sslip.io/api/health`.
8. **Everyday operations** (all in `~/engine`, with the alias `C="docker compose -p xjobs-engine --env-file image.env --env-file .env"`):
   - Read logs with `$C logs -f worker`.
   - Check status with `$C ps`.
   - Restart a service with `$C restart worker`.
   - Change a secret: edit `.env`, then run `$C up -d`.
9. **Roll back:** Actions → Deploy engine → Run workflow with `image_tag` set to an earlier merge SHA (from `git log main`).
10. **Add or remove a person:** edit `/home/deploy/.ssh/authorized_keys` on the server, and their key in the Hetzner project. The CI key stays separate.
11. **Move to a real domain:** add an A record, change `ENGINE_HOSTNAME` in `.env`, then run `$C up -d caddy`.
12. **Verify that collection works:** after the next weekday hour between 08:00 and 22:00 UTC, run `$C logs worker | grep -i collect`. Then query `10xjobs-dev` for jobs created since the deploy that have a processor status and match decisions. Name the tables after checking `libs/database/src/contract/contract.prisma`.

- [ ] **Step 2: Commit**

```bash
git add deploy/engine/README.md docs/roadmap/phase-2-find/01-engine-hosting.md
git commit -m "docs(deploy): runbook for the hosted engine"
```

---

### Task 5: Image smoke test, PR and handoff

- [ ] **Step 1: Build the image locally**

Build `dist` the same way the workflow does, then run `docker build -t xjobs-engine:local apps/xjobs`. Expected: the build succeeds. `docker run --rm xjobs-engine:local node -e "require('./worker.js')"` isn't safe because it boots the worker. Instead, run `docker run --rm --entrypoint ls xjobs-engine:local` and check that `main.js`, `worker.js` and `node_modules` are present. If the build fails because of `workspace_modules` or the lockfile, fix it in the workflow step and the Dockerfile together, and note it in the PR.

- [ ] **Step 2: Run the full CI command**

Run `npx nx run-many -t lint test build typecheck`. Expected: green.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/engine-hosting
gh pr create --base main --title "Host the engine on Hetzner; schedules run only on the server" --body-file <scratchpad>/pr.md
```

The PR body covers:

- The summary.
- That merging is safe before the server exists, because the workflow skips itself.
- The owner's setup steps: runbook sections 2–7.
- The live Done-when checks from the spec, which run after setup: 1, 2, 3, 4, 5 and 7.
- The Claude Code attribution line.

- [ ] **Step 4: After the owner's setup and first deploy**

Walk through the spec's Done-when list together with the owner. Check the dev database for collected, processed and matched jobs with the read-only `supabase-dev` MCP.
