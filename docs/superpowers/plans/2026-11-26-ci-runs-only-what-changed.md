# CI Runs Only What Changed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CI, Dev database and Deploy engine each run only the jobs whose Nx project a change affects, measured from the last commit each one handled. A PR fails when it changes a file nothing covers.

**Architecture:**

- One Node script, `.github/ci/changes.mjs`, asks Nx which projects are affected between two commits and turns that into job flags (`main`, `database`, `e2e`, `hooks`, `migrate`, `deploy`). It also runs the gap check.
- A second script, `.github/ci/last-handled.mjs`, finds the commit a workflow last handled from its run names.
- CI gets a `changes` job that every other job gates on, plus an always-on `CI passed` job. Dev database gates its migrate and seed steps. Deploy engine gains a `changes` job that gates build and deploy.

**Tech Stack:** GitHub Actions, Nx 24 (`nx show projects --affected`, `nx graph --file`), Node 24 (`node:test`, `path.posix.matchesGlob`), `gh api`, `nrwl/nx-set-shas@v5`.

**Spec:** `docs/superpowers/specs/2026-11-26-ci-runs-only-what-changed-design.md`

## Global Constraints

- The chain stays CI → Dev database → Deploy engine. No new `workflow_run` workflow after Deploy engine (GitHub's three-level limit).
- A CI run where every gated job is skipped must still conclude `success`, so Dev database still starts.
- Dev database's `deploy` job must end `success` when it skips migrate and seed. Deploy engine's existing guard reads that job's conclusion.
- Deploy engine: `check` stays read-only, `build` alone gets `packages: write`, `deploy` alone holds SSH. The new `changes` job gets no secrets and no environment.
- Manual Deploy engine dispatches skip change detection.
- Any failed lookup (no earlier run, API error, commit missing from history) means "run everything", with a `::notice::` saying why.
- `nx.json` sets `pluginsConfig["@nx/js"].projectsAffectedByDependencyUpdates: "auto"`.
- Dependency-file fallback: a `pnpm-workspace.yaml` change always runs everything. A `package.json` change to any field other than `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies` runs everything. A `pnpm-lock.yaml` change when Nx reports no affected project runs everything.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Plan calls (not in the spec)

- The scripts live in `.github/ci/`, not `scripts/`. The spec gives `scripts/**` to the `database` project, but CI logic should touch everything, so `.github/ci/**` joins `sharedGlobals`. The scripts' own tests run in CI's `changes` job every time (under a second).
- CI's `workflow_dispatch` takes no input and always runs every job. An unchecked "run every job" box would have nothing sensible to compare against on a branch.
- Deploy engine's detection is a new `changes` job rather than steps inside `check`, so the install never runs inside the `dev` environment.
- The gap check ignores deleted files (`--diff-filter=d`). Job decisions still see deletions through Nx.
- Workflow behaviour is proved by running the script against probe commits in a scratch worktree, not by throwaway PRs (Claude can't delete the remote branches those would leave behind). The merged behaviour gets checked after merge (see the PR body in Task 7).

## Review Focus

1. A change that combines a `packageManager` bump with a web-only file must run everything, not only `web` (Nx alone reports `web`). Pinned in Task 2's `decide` tests.
2. An empty diff (a rerun, or the head equals the last handled commit) runs nothing and still ends green. Deploy engine must not redeploy. Pinned in Task 2's tests and Task 6's step.
3. Deploy engine runs from before this change have no commit in their name. The first lookup must return nothing, so that run deploys everything, instead of crashing or picking an unrelated SHA. Pinned in Task 3.
4. A `changes` job that errors (Nx crash, missing base) must turn `CI passed` red, not leave every job skipped and the run green. Pinned in Task 4's `CI passed` script and Task 7's probe.
5. A deleted or renamed root-level file must not trip the gap check. A renamed file is checked under its new path. Pinned in Task 2's `findGaps` tests.

---

### Task 0: Branch

- [ ] **Step 1:** In `/home/lab/apps/10xjobs/.worktrees/platform-03-spec`, rename the unpushed branch so it can carry code: `git branch -m docs/platform-03-ci-spec ci/platform-03-affected`. Expected: `git branch --show-current` prints `ci/platform-03-affected`. The worktree has no `node_modules`: run `pnpm install --frozen-lockfile` once. Never symlink the main checkout's copy into this worktree, because Nx rejects it.

### Task 1: Nx owns the root files

**Files:**

- Modify: `nx.json` (`namedInputs.sharedGlobals`, new `pluginsConfig`)
- Modify: `libs/database/package.json` (new `nx.namedInputs`)
- Modify: `apps/xjobs/package.json` (add `namedInputs` inside the existing `nx` block)
- Modify: `apps/xjobs-e2e/package.json` (new or extended `nx.namedInputs`)

**Interfaces:**

- Produces: the affected sets that Tasks 2 and 7 rely on, listed in Step 1.

- [ ] **Step 1: Record the expected affected sets (the test).** Run `npx nx show projects --affected --files=<f>` for each file. Today `supabase/config.toml`, `deploy/engine/compose.yaml`, `docker-compose.yaml`, `scripts/supabase-env.sh`, `tsconfig.json`, `vitest.config.mts`, `.github/workflows/deploy-engine.yml` and `.github/ci/x.mjs` all print `[]` (a file need not exist for `--files`). After Step 2 they must print:
  - `supabase/config.toml`, `scripts/supabase-env.sh`: includes `@xjobs/database`, `@xjobs/db-tests`, `@xjobs/xjobs`, `@xjobs/xjobs-e2e`
  - `deploy/engine/compose.yaml`: exactly `@xjobs/xjobs`, `@xjobs/xjobs-e2e`
  - `docker-compose.yaml`: exactly `@xjobs/xjobs-e2e`
  - `tsconfig.json`, `vitest.config.mts`, `.github/workflows/deploy-engine.yml`, `.github/ci/x.mjs`: all six projects
  - `docs/roadmap/README.md`: still `[]`

- [ ] **Step 2: Edit the config.**
  - **`nx.json`:**
    - `sharedGlobals` becomes `["{workspaceRoot}/.github/workflows/**/*", "{workspaceRoot}/.github/ci/**/*", "{workspaceRoot}/tsconfig.json", "{workspaceRoot}/vitest.config.mts"]`.
    - Add `"pluginsConfig": { "@nx/js": { "projectsAffectedByDependencyUpdates": "auto" } }`.
  - **Project `nx.namedInputs.default` values.** Each keeps `{projectRoot}/**/*` and `sharedGlobals`, and adds:
    - `database`: `{workspaceRoot}/supabase/**/*` and `{workspaceRoot}/scripts/**/*`
    - `xjobs`: `{workspaceRoot}/deploy/engine/**/*`
    - `xjobs-e2e`: `{workspaceRoot}/docker-compose.yaml`

- [ ] **Step 3: Verify.** Rerun Step 1's commands and get exactly the listed sets. Then run `npx nx run-many -t lint typecheck --projects=@xjobs/database,@xjobs/xjobs,@xjobs/xjobs-e2e`. Expected: passes, so the config still loads.

- [ ] **Step 3b: Try excluding project Markdown (the spec leaves this to the builder).** Add `!{projectRoot}/**/*.md` to the `xjobs` and `web` `namedInputs.default`. Then run `npx nx show projects --affected --files=apps/xjobs/src/modules/ingest/README.md`.
  - If it prints `[]`, keep the exclusion.
  - Otherwise revert it and note in the PR body that Markdown inside projects still counts as code.

- [ ] **Step 4: Commit** `build(nx): own supabase, deploy and root config files; narrow dependency updates`.

### Task 2: `changes.mjs`, the job decision and the gap check

**Files:**

- Create: `.github/ci/changes.mjs`
- Create: `.github/ci/runs-nothing.json`
- Test: `.github/ci/changes.test.mjs`

**Interfaces:**

- **Exports:**
  - `DEPENDENCY_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']`
  - `isIgnored(file: string, globs: string[]): boolean`. Uses `path.posix.matchesGlob`.
  - `packageJsonOtherFieldsChanged(before: object | null, after: object | null): boolean`. Compares with `util.isDeepStrictEqual` after dropping the four dependency fields. A missing side (null) counts as changed.
  - `decide({ all: boolean, changedFiles: string[], affected: string[], packageJsonOtherFieldsChanged: boolean }): { jobs: { main, database, e2e, hooks, migrate, deploy: boolean }, runAllReason: string | null }`
  - `findGaps({ addedOrModified: string[], projectRoots: string[], ignoreGlobs: string[], ownsRootFile: (file: string) => boolean }): string[]`
- **CLI:** `node .github/ci/changes.mjs (--all | --base <sha> --head <sha>) [--check-gaps]`
  - It writes `main`, `database`, `e2e`, `hooks`, `migrate` and `deploy` as `true` or `false`, plus `all`, `base` and `head`. Each is a `key=value` line, appended to `$GITHUB_OUTPUT` when that variable is set and printed to stdout either way.
  - It writes a short summary (changed file count, affected projects, run-all reason, gaps) to `$GITHUB_STEP_SUMMARY` when set.
  - It exits 1 when `--check-gaps` finds gaps. Each gap file is printed as `::error file=<f>::<f> is not covered: add it to a project's namedInputs in its package.json, or to .github/ci/runs-nothing.json`.
- **Consumed by:** Tasks 4, 5, 6 and 7.

- [ ] **Step 1: Write the failing tests** in `.github/ci/changes.test.mjs`, in the style of `.claude/hooks/guard.test.mjs` (`node:test`, `assert/strict`):

```js
const none = { all: false, changedFiles: [], affected: [], packageJsonOtherFieldsChanged: false };
test('empty diff runs nothing', () => {
  assert.deepEqual(decide(none).jobs, { main: false, database: false, e2e: false, hooks: false, migrate: false, deploy: false });
});
test('engine change', () => {
  const { jobs } = decide({ ...none, changedFiles: ['apps/xjobs/src/main.ts'], affected: ['@xjobs/xjobs', '@xjobs/xjobs-e2e'] });
  assert.deepEqual(jobs, { main: true, database: false, e2e: true, hooks: false, migrate: false, deploy: true });
});
test('database lib change runs database, migrate and everything downstream', () => {
  const { jobs } = decide({ ...none, changedFiles: ['libs/database/src/x.ts'], affected: ['@xjobs/database', '@xjobs/db-tests', '@xjobs/xjobs', '@xjobs/xjobs-e2e', 'web'] });
  assert.equal(jobs.database && jobs.migrate && jobs.deploy && jobs.e2e, true);
});
test('web only', () => {
  const { jobs } = decide({ ...none, changedFiles: ['apps/web/src/a.tsx'], affected: ['web'] });
  assert.deepEqual(jobs, { main: true, database: false, e2e: false, hooks: false, migrate: false, deploy: false });
});
test('hooks', () => assert.equal(decide({ ...none, changedFiles: ['.claude/hooks/guard.mjs'] }).jobs.hooks, true));
test('--all', () => assert.equal(Object.values(decide({ ...none, all: true }).jobs).every(Boolean), true));
test('packageManager plus a web file runs everything', () => {
  const r = decide({ ...none, changedFiles: ['package.json', 'apps/web/a.tsx'], affected: ['web'], packageJsonOtherFieldsChanged: true });
  assert.equal(Object.values(r.jobs).every(Boolean), true);
  assert.match(r.runAllReason, /package\.json/);
});
test('pnpm-workspace.yaml always runs everything', () => {
  assert.equal(Object.values(decide({ ...none, changedFiles: ['pnpm-workspace.yaml'], affected: ['@xjobs/xjobs'] }).jobs).every(Boolean), true);
});
test('lockfile with nothing affected runs everything', () => {
  assert.equal(Object.values(decide({ ...none, changedFiles: ['pnpm-lock.yaml'] }).jobs).every(Boolean), true);
});
test('lockfile narrowed to web stays web', () => {
  assert.equal(decide({ ...none, changedFiles: ['pnpm-lock.yaml'], affected: ['web'] }).jobs.deploy, false);
});
test('packageJsonOtherFieldsChanged', () => {
  assert.equal(packageJsonOtherFieldsChanged({ packageManager: 'pnpm@1', dependencies: { a: '1' } }, { packageManager: 'pnpm@1', dependencies: { a: '2' } }), false);
  assert.equal(packageJsonOtherFieldsChanged({ packageManager: 'pnpm@1' }, { packageManager: 'pnpm@2' }), true);
  assert.equal(packageJsonOtherFieldsChanged({ scripts: { t: 'a' } }, { scripts: { t: 'b' } }), true);
  assert.equal(packageJsonOtherFieldsChanged(null, {}), true);
});
const roots = ['apps/xjobs', 'apps/web', 'libs/database'];
const ignore = JSON.parse(readFileSync(new URL('./runs-nothing.json', import.meta.url)));
test('gaps: project files, ignored files, hooks and dependency files are covered', () => {
  assert.deepEqual(findGaps({ addedOrModified: ['apps/xjobs/a.ts', 'docs/x.md', 'README.md', '.claude/settings.json', '.claude/hooks/guard.mjs', 'package.json', 'pnpm-lock.yaml', 'tsconfig.tsbuildinfo', '.pnpm-store/v11/index.db'], projectRoots: roots, ignoreGlobs: ignore, ownsRootFile: () => false }), []);
});
test('gaps: an unowned root file is a gap; an owned one is not', () => {
  assert.deepEqual(findGaps({ addedOrModified: ['newtool.config.js', 'supabase/config.toml'], projectRoots: roots, ignoreGlobs: ignore, ownsRootFile: (f) => f.startsWith('supabase/') }), ['newtool.config.js']);
});
test('gaps: a project root prefix needs a slash', () => {
  assert.deepEqual(findGaps({ addedOrModified: ['apps/xjobs-old/a.ts'], projectRoots: roots, ignoreGlobs: ignore, ownsRootFile: () => false }), ['apps/xjobs-old/a.ts']);
});
```

- [ ] **Step 2:** Run `node --test .github/ci/changes.test.mjs`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `.github/ci/runs-nothing.json`.** It is the spec's "runs nothing" list as globs:

```json
["docs/**", "*.md", ".claude/**", ".vscode/**", ".editorconfig", ".env.example", ".gitignore", ".prettierrc", ".prettierignore", ".nx/ci-config.yaml", "docker-compose.worker.yaml", "tsconfig.tsbuildinfo", ".pnpm-store/**"]
```

`.claude/hooks/**` is matched before this list, so the `.claude/**` entry doesn't hide hook changes from the `hooks` job.

- [ ] **Step 4: Implement `.github/ci/changes.mjs`.**
  - **`decide`:**
    - `hooks` is true when any changed file matches `.claude/hooks/**`.
    - A run-all reason comes from the dependency-file fallback in Global Constraints, or from `all`.
    - With a reason, every flag is true.
    - Otherwise:
      - `main` = affected is not empty
      - `database` = affected includes `@xjobs/db-tests`
      - `e2e` = affected includes `@xjobs/xjobs-e2e`
      - `migrate` = affected includes `@xjobs/database`
      - `deploy` = affected includes `@xjobs/xjobs`
  - **`findGaps`:** a file is covered when any of these holds:
    - it sits under a project root followed by `/`;
    - it is one of `DEPENDENCY_FILES`;
    - it matches `.claude/hooks/**`;
    - it is ignored;
    - `ownsRootFile` returns true for it.

    It returns the uncovered files in input order.

  - **CLI, gathering the inputs** (run only when the file is executed directly; use a `process.argv[1]` check so the tests can import it):
    - `changedFiles`: `git diff --name-only -z <base> <head>`.
    - `addedOrModified`: the same command with `--diff-filter=d`.
    - `affected`: `npx nx show projects --affected --base=<base> --head=<head> --json`.
    - `projectRoots`: `npx nx graph --file=<os.tmpdir()>/nx-graph-<pid>.json`, then `graph.nodes[*].data.root`.
    - `ownsRootFile(f)`: `npx nx show projects --affected --files=<f> --json` is not empty. Call it only for files the other rules leave uncovered.
    - The `package.json` sides: `git show <base>:package.json` and `git show <head>:package.json`. A side that is missing parses to null.
    - Set `NX_DAEMON=false` for the child processes.
    - Any child process failing exits non-zero with its stderr. It must never print flags.

- [ ] **Step 5:** Run `node --test .github/ci/changes.test.mjs`. Expected: all pass.

- [ ] **Step 6:** Run a CLI smoke in the worktree: `node .github/ci/changes.mjs --base origin/main --head HEAD --check-gaps`. Expected: exit 0, and `main=true` (Task 1 touched `nx.json`, so every project is affected).

- [ ] **Step 7: Commit** `ci: add change detection and gap check script`.

### Task 3: `last-handled.mjs`

**Files:**

- Create: `.github/ci/last-handled.mjs`
- Test: `.github/ci/last-handled.test.mjs`

**Interfaces:**

- **Exports:**
  - `extractSha(title: string): string | null`. Returns a SHA only when the title holds exactly one `[0-9a-f]{40}` match.
  - `pickLastHandled(runs: { id: number, display_title: string }[], jobConclusion: (runId: number) => string | null): string | null`
- **CLI:** `node .github/ci/last-handled.mjs --workflow <file.yml> --job <name>`
  - Prints the SHA and a newline, or nothing.
  - Always exits 0. On an API error it prints `::warning::` to stderr and nothing to stdout.
  - Reads `GITHUB_REPOSITORY`. Runs `gh api "repos/$GITHUB_REPOSITORY/actions/workflows/<file>/runs?branch=main&status=success&per_page=30"`, then `gh api repos/$GITHUB_REPOSITORY/actions/runs/<id>/jobs` lazily, one run at a time.
- **Consumed by:** Tasks 5 and 6.

- [ ] **Step 1: Write the failing tests.**

```js
const A = 'a'.repeat(40),
  B = 'b'.repeat(40);
test('extractSha', () => {
  assert.equal(extractSha(`Dev database ${A}`), A);
  assert.equal(extractSha('Deploy engine'), null);
  assert.equal(extractSha(`${A} ${B}`), null);
});
test('newest run whose job succeeded', () => {
  const runs = [
    { id: 3, display_title: `x ${A}` },
    { id: 2, display_title: `x ${B}` },
  ];
  assert.equal(
    pickLastHandled(runs, (id) => (id === 3 ? 'skipped' : 'success')),
    B,
  );
});
test('an old-format title on the newest successful run gives null', () => {
  assert.equal(
    pickLastHandled(
      [
        { id: 2, display_title: 'Deploy engine' },
        { id: 1, display_title: `x ${A}` },
      ],
      () => 'success',
    ),
    null,
  );
});
test('no runs gives null', () =>
  assert.equal(
    pickLastHandled([], () => 'success'),
    null,
  ));
```

- [ ] **Step 2:** Run `node --test .github/ci/last-handled.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implement.** `pickLastHandled` walks the runs newest first and stops at the first run whose job concluded `success`. It returns that run's `extractSha`, which may be null. Stopping at the first success is the decision the old-format test pins.

- [ ] **Step 4:** Run `node --test ".github/ci/*.test.mjs"`. Expected: all pass. Then smoke against the real repo: `GITHUB_REPOSITORY=proup24/10xjobs node .github/ci/last-handled.mjs --workflow dev-database.yml --job deploy`. Expected: a 40-character SHA that `git cat-file -e <sha>^{commit}` accepts.

- [ ] **Step 5: Commit** `ci: add last-handled commit lookup`.

### Task 4: CI gates on `changes`

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md` (the "what CI runs" line)

**Interfaces:**

- Consumes: Task 2's CLI and outputs.
- Produces: a job named `CI passed`. A future required check points at that name.

- [ ] **Step 1: Write the `changes` job.**
  - Add `workflow_dispatch:` to `on:`.
  - Job settings: `timeout-minutes: 10`, permissions `contents: read`, `actions: read` (nx-set-shas reads runs).
  - Steps:
    - checkout with `fetch-depth: 0` and `filter: tree:0`
    - pnpm and node setup, then install, as the `main` job does today
    - `node --test ".github/ci/*.test.mjs"`
    - `nrwl/nx-set-shas@v5` with `id: shas`, skipped on `workflow_dispatch`
    - a detection step that runs `node .github/ci/changes.mjs --all` when the event is `workflow_dispatch` or `steps.shas.outputs.noPreviousBuild == 'true'` (with a `::notice::`), and `--base "$BASE" --head "$HEAD" --check-gaps` otherwise
  - Job outputs: `all`, `base`, `head`, `main`, `database`, `e2e`, `hooks`.

- [ ] **Step 2: Gate the existing jobs.**
  - `main`, `database` and `e2e` each get `needs: changes` and `if: needs.changes.outputs.<job> == 'true'`.
  - In `main`, replace the `run-many` line with two lines:
    - when `needs.changes.outputs.all == 'true'`: `pnpm exec nx run-many -t lint test build typecheck`
    - otherwise: `pnpm exec nx affected -t lint test build typecheck --base=<base> --head=<head>`, with base and head from the `changes` outputs
  - Keep `nx fix-ci` with `if: always()`.

- [ ] **Step 3: Add the `hooks` and `CI passed` jobs.**
  - `hooks`:
    - `needs: changes`, gated on the `hooks` output
    - checkout, then `actions/setup-node@v6` with `node-version: 24` (no pnpm, no install)
    - runs `npm run test:hooks`
  - `ci-passed`:
    - `name: CI passed`, `needs: [changes, main, database, e2e, hooks]`, `if: always()`
    - one step that fails when any `needs.*.result` is `failure` or `cancelled`. Pass `toJSON(needs)` in an env variable and check it with `jq`. A `changes` failure counts too.

- [ ] **Step 4: Update the `CLAUDE.md` line** to: ``- `npx nx affected -t lint test build typecheck`: what CI runs for a change (CI's `changes` job decides which jobs run; `.github/ci/runs-nothing.json` lists the files that run nothing; a manual CI dispatch runs everything).``

- [ ] **Step 5: Verify.**
  - `npx --yes actionlint .github/workflows/ci.yml`, or the `rhysd/actionlint` docker image if npx has no binary. Expected: no errors.
  - `node --test ".github/ci/*.test.mjs"`: passes.

- [ ] **Step 6: Commit** `ci: run each CI job only when its project is affected`.

### Task 5: Dev database migrates only on database changes

**Files:**

- Modify: `.github/workflows/dev-database.yml`

**Interfaces:**

- Consumes: Task 2's CLI (`migrate` output) and Task 3's CLI.

- [ ] **Step 1: Prepare the checkout and permissions.**
  - Add `actions: read` to `permissions`.
  - Give the checkout `fetch-depth: 0`, keeping the existing `ref`.

- [ ] **Step 2: Add a step with `id: changes` after install.** Set `GH_TOKEN: ${{ github.token }}` and `SHA: ${{ github.event.workflow_run.head_sha }}`. The step:
  - Sets `base` from `node .github/ci/last-handled.mjs --workflow dev-database.yml --job deploy`.
  - When `base` is not empty and `git cat-file -e "$base^{commit}"` passes, runs `node .github/ci/changes.mjs --base "$base" --head "$SHA"` (no `--check-gaps`).
  - Otherwise prints `::notice::No last migrated commit found; migrating anyway` and runs `--all`.

- [ ] **Step 3: Gate migrate and seed.**
  - Add `if: steps.changes.outputs.migrate == 'true'` to the migrate and seed steps.
  - Add a final step `if: steps.changes.outputs.migrate != 'true'` that prints `::notice::No database change since <base>; skipped migrate and seed`.
  - The job ends `success` either way.

- [ ] **Step 4: Verify.** Run `actionlint` on the file. Expected: no errors.

- [ ] **Step 5: Commit** `ci(dev-database): migrate only when the database project changed`.

### Task 6: Deploy engine deploys only on engine changes

**Files:**

- Modify: `.github/workflows/deploy-engine.yml`
- Modify: `deploy/engine/README.md`

**Interfaces:**

- Consumes: Task 2's CLI (`deploy` output), Task 3's CLI, and the existing `check` outputs `skip`, `sha` and `build`.

- [ ] **Step 1: Add a `run-name`** so later lookups can read each run's commit: `Deploy engine ${{ github.event_name == 'workflow_run' && github.event.workflow_run.display_title || inputs.image_tag || github.sha }}`. Each form holds exactly one 40-character SHA.

- [ ] **Step 2: Add a `changes` job.**
  - `needs: check`, `if: needs.check.outputs.skip != 'true'`, `timeout-minutes: 15`, permissions `contents: read`, `actions: read`. No `environment`.
  - Output `deploy`.
  - On `workflow_dispatch`, the only step echoes `deploy=true` to `$GITHUB_OUTPUT`.
  - On `workflow_run`:
    - checkout `needs.check.outputs.sha` with `fetch-depth: 0` and `persist-credentials: false`
    - pnpm and node setup, then install
    - `last-handled.mjs --workflow deploy-engine.yml --job deploy`, with the same `cat-file` fallback to `--all` as Task 5
    - `changes.mjs --base "$base" --head "$SHA"`
  - When `deploy` is `false`, print `::notice::No engine change since <base>; skipping build and deploy`.

- [ ] **Step 3: Gate build and deploy.**
  - `build`: `needs: [check, changes]`, and `&& needs.changes.outputs.deploy == 'true'` added to its `if`.
  - `deploy`: `needs: [check, changes, build]`, with `needs.changes.result == 'success' && needs.changes.outputs.deploy == 'true'` added to its condition.
  - Leave the stale-server check and everything after it unchanged.

- [ ] **Step 4: Update `deploy/engine/README.md`.** Add a short paragraph:
  - Automatic deploys happen only when the `xjobs` Nx project changed since the commit of the last run whose `deploy` job succeeded, which the run name carries.
  - A docs-only or web-only merge leaves the server untouched.
  - A manual dispatch always deploys.

- [ ] **Step 5: Verify.** Run `actionlint` on the file. Expected: no errors.

- [ ] **Step 6: Commit** `ci(deploy-engine): deploy only when the engine changed`.

### Task 7: Probe the decisions and open the PR

**Files:**

- Modify: `docs/roadmap/platform/03-ci-runs-only-what-changed.md` (`Status:` line)

- [ ] **Step 1: Probe in a scratch worktree.**
  - Run `git worktree add --detach <scratchpad>/ciprobe HEAD`, then `pnpm install --frozen-lockfile` there.
  - For each case below, make one commit and run `node .github/ci/changes.mjs --base HEAD~1 --head HEAD --check-gaps`, then `git reset --hard HEAD~1`:

    | Case                                                                       | Expected flags                                 |
    | -------------------------------------------------------------------------- | ---------------------------------------------- |
    | append a line to `docs/roadmap/README.md`                                  | all false, exit 0                              |
    | append a comment to `apps/web/src/app/layout.tsx` (or any web source file) | `main` only                                    |
    | append a comment to `supabase/config.toml`                                 | `main`, `database`, `e2e`, `migrate`, `deploy` |
    | change one `integrity:` hash of the `styled-jsx` entry in `pnpm-lock.yaml` | `main` only                                    |
    | `packageManager` → `pnpm@12.15.1` in `package.json`                        | all true, the reason names `package.json`      |
    | add a new root file `newtool.config.js`                                    | exit 1, with an `::error` naming it            |
    | delete `tsconfig.tsbuildinfo`                                              | exit 0                                         |
    | edit `.claude/hooks/guard.mjs`                                             | `hooks` only                                   |

  - Remove the scratch worktree afterwards.

- [ ] **Step 2: Set the roadmap status** to `Status: Built, pending merge (PR #<n>).` once the PR number is known (amend or follow-up commit), and commit.

- [ ] **Step 3: Run the full local CI equivalent:** `pnpm exec nx run-many -t lint test build typecheck` and `npm run test:hooks`. Expected: both green.

- [ ] **Step 4: Push and open the PR.**
  - Push with `git push -u origin ci/platform-03-affected`.
  - Run `gh pr create --base main` with a body that holds:
    - the summary
    - the probe table from Step 1 with its results
    - this PR's own CI run: everything runs, because the workflows changed
    - **Checks after merge:**
      1. This merge's Dev database run migrates, because its first lookup finds the pre-change run's SHA. Its Deploy engine run deploys everything, with the notice that no last deployed commit was found.
      2. The next docs-only PR shows only `changes` and `CI passed`, plus skipped jobs.
      3. The next docs-only merge shows Dev database's "skipped migrate and seed" notice and Deploy engine's "No engine change" notice. The server keeps its image.
  - End the body with the 🤖 Claude Code line.
