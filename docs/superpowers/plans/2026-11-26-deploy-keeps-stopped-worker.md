# Deploy keeps a stopped worker stopped Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Deploy engine run leaves the hosted `worker` stopped when it was stopped before the run, and still puts the new image in place.

**Architecture:** A small script, `deploy/engine/worker-hold.sh`, reads the worker container's state and prints `start` or `hold`. The deploy pipes it over ssh in its own step. The rollout then either runs `up -d` as today or brings up everything except the worker and creates the worker without starting it. A `node --test` file tests the script against a stub `docker`, and CI runs it.

**Tech Stack:** bash, Docker Compose v2, GitHub Actions, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-26-deploy-keeps-stopped-worker-design.md`

## Global Constraints

- Compose project `xjobs-engine`, service `worker`. On the server, `C="docker compose -p xjobs-engine --env-file image.env --env-file .env"`.
- Decision table: `running`, `restarting`, no container, `removing` → `start`. `exited`, `created`, `paused`, `dead` → `hold`. A failing `docker` → non-zero exit and a failed deploy. The script never guesses.
- Notice text: `::notice::Worker was stopped before this deploy; left stopped on <sha>. Start it with $C start worker`.
- The health check prints the worker's state and never fails on it. It still checks only `api`.
- `workflow_dispatch` gets no new input.
- The owner stops with `$C stop worker` (or `docker stop`) and starts with `$C start worker`.

**One change from the spec, decided here:** the spec says the script is copied to the server with the deploy files. But the deploy job checks out the *deployed* SHA, so a rollback to a commit from before this change would have no `worker-hold.sh`. The scp would fail, or the rollback would lose the hold. Instead, the workflow sparse-checks out the script at `github.workflow_sha` (the commit of the workflow being run) and pipes it over `ssh … bash -s`. Nothing new is stored on the server. Task 3 updates the spec to match.

## Review Focus

1. **More than one worker container** (a leftover from an interrupted recreate). If any is `running` or `restarting`, the answer is `start`. Otherwise, if any is held, it is `hold`. Test: `two containers, one running → start` and `exited plus created → hold` (Task 1).
2. **Untidy `docker` output**: a trailing newline, CRLF or blank lines must not change the answer. Test: `trailing CRLF and blank lines → hold` (Task 1).
3. **A state the table doesn't list** (a future Docker state). The script must fail, not start. Test: `unknown state → exit 1` (Task 1).
4. **A rollback to a commit from before this change** must still hold. This is covered by the `workflow_sha` checkout (Task 2, Step 2). The check is a grep that the script path is never read from the deploy checkout.
5. **`docker` failing during the decision** must fail the deploy before the pull, leaving the running deploy untouched. Test: `docker exits 1 → exit 1` (Task 1). The decision step runs before `Copy the deploy files` (Task 2).

---

### Task 1: The hold decision script, its tests, and CI

**Files:**
- Create: `deploy/engine/worker-hold.sh`
- Test: `deploy/engine/worker-hold.test.mjs`
- Modify: `package.json` (scripts, beside `test:hooks`)
- Modify: `.github/workflows/ci.yml` (job `main`, after `pnpm install --frozen-lockfile`)
- Modify: `CLAUDE.md` (Commands, after the `npm run test:hooks` line)

**Interfaces:**
- Produces: `bash worker-hold.sh` takes no arguments and has no stdin. It makes exactly one docker call:
  `docker ps -a --filter label=com.docker.compose.project=xjobs-engine --filter label=com.docker.compose.service=worker --format '{{.State}}'`
  It prints exactly `start` or `hold` plus a newline on stdout and exits 0. On a `docker` failure or an unknown state it prints a message to stderr starting `worker-hold:` and exits 1.
- Produces: `pnpm test:deploy` (= `node --test "deploy/engine/*.test.mjs"`).

- [ ] **Step 1: Write the failing tests** in `deploy/engine/worker-hold.test.mjs`.

  A helper `run(stdout, exitCode = 0)` creates a temp dir holding an executable `docker` stub. The stub writes its argv to `args.txt` in that dir, prints `stdout` verbatim (use `printf '%s'` with the value passed in an env var) and exits with `exitCode`. The helper runs `spawnSync('bash', [scriptPath], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } })` and returns `{ code, out: stdout.trim(), err, args }`. Tests, each `assert.equal`:
  - `running → start`, `restarting → start`, `removing → start`
  - `no container (empty output) → start`
  - `exited → hold`, `created → hold`, `paused → hold`, `dead → hold`
  - `two containers, one running → start`: `'exited\nrunning\n'`
  - `exited plus created → hold`: `'exited\ncreated\n'`
  - `trailing CRLF and blank lines → hold`: `'exited\r\n\r\n'`
  - `unknown state → exit 1`: `'sleeping\n'`. Code 1, `out` is `''`, `err` matches `/^worker-hold:/`.
  - `docker exits 1 → exit 1`: code 1, `out` is `''`.
  - `queries the worker of xjobs-engine`: `args` includes `label=com.docker.compose.project=xjobs-engine` and `label=com.docker.compose.service=worker`.

- [ ] **Step 2: Run them and see them fail**

  Run: `node --test deploy/engine/worker-hold.test.mjs`
  Expected: every test fails (bash can't open the script).

- [ ] **Step 3: Write `deploy/engine/worker-hold.sh`**

  - Starts with `#!/usr/bin/env bash` and `set -euo pipefail`, then a comment pointing to the spec.
  - Captures the docker output into a variable, so a failure exits through `set -e` with a `worker-hold:` message. Use `if ! out="$(docker ps …)"; then echo "worker-hold: docker ps failed" >&2; exit 1; fi`.
  - Strips `\r`, skips blank lines, and loops over the states. Running or restarting wins (`start`). Exited, created, paused or dead sets hold. Removing is ignored, so it counts like no container. Anything else fails with exit 1.
  - Prints `hold` if any container was held, otherwise `start`.

- [ ] **Step 4: Run the tests and see them pass**

  Run: `node --test deploy/engine/worker-hold.test.mjs`
  Expected: all 14 pass.

- [ ] **Step 5: Wire up CI and the command**

  - `package.json`: add `"test:deploy": "node --test \"deploy/engine/*.test.mjs\""`.
  - `ci.yml` job `main`: add `- run: pnpm test:deploy` straight after `pnpm install --frozen-lockfile`.
  - `CLAUDE.md`: add the line ``- `pnpm test:deploy`: tests for the deploy scripts in `deploy/engine` (run in CI).``
  - Run `pnpm test:deploy`. Expected: 14 pass.

- [ ] **Step 6: Commit**

  ```bash
  git add deploy/engine/worker-hold.sh deploy/engine/worker-hold.test.mjs package.json .github/workflows/ci.yml CLAUDE.md
  git commit -m "feat(deploy): decide whether a deploy starts or holds the worker"
  ```

### Task 2: The deploy holds a stopped worker

**Files:**
- Modify: `.github/workflows/deploy-engine.yml`, job `deploy`: the steps `actions/checkout` (around line 196), `Roll out the image` (277–316) and `Health check` (318–368), plus a new step and a second checkout.

**Interfaces:**
- Consumes: `deploy/engine/worker-hold.sh` from Task 1 (stdout `start`/`hold`, exit 1 on failure).
- Produces: the step output `steps.worker.outputs.decision` (`start`|`hold`). The rollout's remote script takes `$1` = SHA and `$2` = decision.

- [ ] **Step 1: Check the hold commands against a throwaway local Compose project (not committed)**

  In the scratchpad, write a `compose.yaml` with two `busybox` services, `api` and `worker` (`command: sleep 3600`, `restart: unless-stopped`), and image tag `${TAG:?}`. Retag `busybox` as `local/x:a` and `local/x:b`.
  1. `TAG=a docker compose -p holdcheck up -d`, then `docker compose -p holdcheck stop worker`.
  2. `TAG=b docker compose -p holdcheck up -d --remove-orphans api`, then `TAG=b docker compose -p holdcheck up --no-start worker`.
  3. Expected: `docker ps -a --filter label=com.docker.compose.project=holdcheck --format '{{.Names}} {{.State}} {{.Image}}'` shows the worker `created` on `local/x:b`.
  4. Run `bash deploy/engine/worker-hold.sh` with the project label swapped to `holdcheck` (copy it to the scratchpad and sed the label). Expected: `hold`.
  5. `docker compose -p holdcheck start worker` → `running` on `local/x:b`.

  If step 3 shows `exited` on `local/x:a`, `up --no-start` doesn't recreate a stopped container. Use `$C rm -f worker` then `$C create worker` instead, and repeat. Then `docker compose -p holdcheck down`. Record which command worked in the PR body.

- [ ] **Step 2: Add the checkout and the decision step**

  - After the existing checkout, add a second one: `uses: actions/checkout@v7` with `ref: ${{ github.workflow_sha }}`, `path: .deploy-tooling`, `sparse-checkout: deploy/engine/worker-hold.sh`, `sparse-checkout-cone-mode: false`, `persist-credentials: false`. Comment why: the deployed SHA may predate the script, and a rollback must still hold.
  - After `Skip if the server runs a newer commit` and before `Copy the deploy files`, add the step `Decide whether to start the worker`, with `id: worker`, `if: steps.newer.outputs.stale != 'true'`. It runs `decision="$(ssh "$ENGINE_SSH_USER@$ENGINE_SSH_HOST" 'bash -s' < .deploy-tooling/deploy/engine/worker-hold.sh)"`, checks that it is `start` or `hold` (`::error::` and exit 1 otherwise), echoes `Worker decision: $decision`, and writes `decision=$decision` to `$GITHUB_OUTPUT`.

- [ ] **Step 3: Use the decision in `Roll out the image`**

  - Pass it as a second argument: `"bash -s $(printf '%q' "$SHA") $(printf '%q' "$DECISION")"`, with `DECISION: ${{ steps.worker.outputs.decision }}` in the step `env`.
  - Change the pull, `mv`, image cleanup and Caddy reload in place: nothing.
  - Replace `$C up -d --remove-orphans` with a `case "$2"`:
    - `start`: `$C up -d --remove-orphans`, unchanged.
    - `hold`: `$C up -d --remove-orphans api redis redis-cache caddy`, then the command Step 1 proved (`$C up --no-start worker`), then `echo "::notice::Worker was stopped before this deploy; left stopped on $1. Start it with \$C start worker"`.
    - Anything else: `echo "::error::unknown worker decision '$2'"` and `exit 1`, before any `up`.

- [ ] **Step 4: Print the worker state in `Health check`**

  At the end of its remote script, after the `Healthy with the key; 401 without it` line, print `Worker: <state>`. Read the state with `$C ps -a --format '{{.State}}' worker` (or the same `docker ps -a` label query as the script), and print `none` when it is empty. It never exits non-zero for any state.

- [ ] **Step 5: Static checks**

  - Run `actionlint .github/workflows/deploy-engine.yml` if it is installed. Otherwise run `npx --yes action-validator .github/workflows/deploy-engine.yml`, or at least `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/deploy-engine.yml','utf8'))"`. Expected: no errors.
  - `grep -n "worker-hold" .github/workflows/deploy-engine.yml` shows it read only from `.deploy-tooling/` (Review Focus 4).
  - `grep -n "up -d" .github/workflows/deploy-engine.yml` shows the bare `up -d --remove-orphans` only in the `start` branch.

- [ ] **Step 6: Commit**

  ```bash
  git add .github/workflows/deploy-engine.yml
  git commit -m "feat(deploy): keep a stopped worker stopped across deploys"
  ```

### Task 3: Runbook, spec and roadmap

**Files:**
- Modify: `deploy/engine/README.md`: line 17 (section 1), section 8 (lines 98–114), and a new section `## 8c. Stop and start the worker` after 8b (before `## 9. Roll back`).
- Modify: `docs/superpowers/specs/2026-11-26-deploy-keeps-stopped-worker-design.md`, the bullet "The script ships with the deploy files".
- Modify: `docs/roadmap/platform/02-deploy-keeps-stopped-worker.md`, the Status line.

- [ ] **Step 1: README**
  - Line 17: "Each deploy of a new image recreates `api` and `worker`, so the API is briefly down (a short outage). The worker restarts, unless it was stopped before the deploy (section 8c)." Keep the rest of the paragraph.
  - Section 8, step 3: add "Stop and start: section 8c."
  - Section 8, step 4: add "This also starts a stopped worker; to keep it stopped, run `$C up -d api caddy` instead."
  - New section 8c. Stop: `$C stop worker` (or `docker stop`), which can take up to 7 minutes while a collection segment finishes (`stop_grace_period`). A stopped worker stays stopped across deploys (automatic and manual, rollbacks too) and reboots. Each deploy still puts the new image in place and adds the notice "Worker was stopped before this deploy; left stopped on `<sha>`" to its run summary. Start: `$C start worker`. Check: `$C ps -a worker`. Warning: every `$C up -d` and `$C up -d worker` in this runbook (sections 5, 5a, 8, 8a, 8b, 13–17) starts a stopped worker. For `.env` changes that only `api` needs, use `$C up -d api caddy`.

  *My call:* one warning in 8c that lists the sections, plus §8 step 4, instead of editing each of the roughly twelve `up -d` lines. The spec named only §5, 5a, 8 and 8a, but the other sections have the same commands.
- [ ] **Step 2: Spec.** Replace the bullet with: the workflow sparse-checks out `worker-hold.sh` at `github.workflow_sha` and pipes it over `ssh … bash -s` in its own step, so a rollback to an older commit still holds, and nothing new is stored on the server.
- [ ] **Step 3: Roadmap.** Status: "Built, PR <n>. Owner check after merge in the PR body." (Fill in the number in Task 4.)
- [ ] **Step 4: Commit**

  ```bash
  git add deploy/engine/README.md docs/superpowers/specs/2026-11-26-deploy-keeps-stopped-worker-design.md docs/roadmap/platform/02-deploy-keeps-stopped-worker.md
  git commit -m "docs(deploy): stop and start the worker; deploys keep it stopped"
  ```

### Task 4: Verify and open the PR

- [ ] **Step 1:** `pnpm test:deploy` (14 pass) and `npm run test:hooks` (pass).
- [ ] **Step 2:** `git push -u origin docs/platform-02-worker-hold-spec`, then `gh pr create --base main`. Put this in the body:
  - the decision table;
  - which hold command Task 2 Step 1 proved;
  - the spec's owner check as a checklist: stop, manual dispatch, notice plus `created` on the new tag, start, a deploy with it running;
  - a warning that this PR's own merge deploy already runs the new logic, so if the worker is stopped at merge time it stays stopped.

  Then fill in the PR number in the roadmap status and push that commit.
