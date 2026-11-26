# Platform slice 03: CI runs only what a change affects

Date: 2026-11-26
Status: draft, awaiting approval
Slice: [03 CI runs only what changed](../../roadmap/platform/03-ci-runs-only-what-changed.md)

## Intent

Every PR waits 3–5 minutes for all three CI jobs, and every merge to main migrates Dev and rebuilds and redeploys the engine, whatever the change touched. On 2026-11-25 more than half the merged PRs were docs only, and two of them redeployed the engine. A redeploy also restarts a worker the owner stopped (slice 02). Each Supabase-backed job is another chance of the port flake.

After this slice, each job in CI, Dev database and Deploy engine runs only when the change affects what that job checks or ships. A docs-only PR finishes in well under a minute, and a docs-only merge neither migrates Dev nor redeploys the engine.

## Goals

- Each CI job (`main`, `database`, `e2e`) runs only when Nx says the project it checks is affected.
- Dev database migrates and seeds only when the `database` project changed since the commit it last migrated.
- Deploy engine builds and deploys only when the `xjobs` project changed since the commit it last deployed.
- A gap in the map (a changed file that no project owns and that isn't on the "runs nothing" list) fails the PR that creates it, with the file names in the error.
- `.claude/hooks/**` changes run `npm run test:hooks`, which CI doesn't run today.
- A manual way to run every CI job anyway.

## Non-goals

- Making the jobs that do run faster (Supabase caching, Nx Cloud distribution).
- A web e2e job.
- Making status checks required on main. This slice only makes that possible (see "CI passed").
- Production: there is no production project.
- The web app's Vercel builds. Vercel decides those itself.
- A scheduled full run on main. The owner chose the PR-time gap check instead.

## Anti-goals

- A change that should have been tested, migrated or deployed silently isn't. When in doubt, run.
- A failed or skipped deploy that the next unrelated merge never catches up.
- A docs PR that still waits on Supabase.

## Constraints

- CI → Dev database → Deploy engine is already three `workflow_run` levels, GitHub's maximum. Nothing new can be chained after Deploy engine.
- Dev database starts only after a green CI `push` run on main. If CI skips every job, the CI run must still end green, so the chain still starts and decides for itself.
- Deploy engine goes ahead only when Dev database's `deploy` job concluded `success`. "Nothing to migrate" must end as success, not as a skipped job.
- Deploy engine's three jobs keep credentials apart: `check` only reads, `build` alone pushes to GHCR, `deploy` alone holds SSH. The new change detection runs in `check` and gets no new secrets.
- Manual dispatches of Deploy engine (rollbacks, rebuilds from main) keep working and skip change detection.
- The `Default` ruleset on main requires a PR but no status checks. A skipped job blocks nothing today.

## Approaches

The owner picked **C**.

- **A. Our own script and map file.** One map file lists each job's paths. One script diffs two commits, prints the jobs to run and fails on uncovered files. All three workflows share it. About 60 lines of shell to own, and a second map next to Nx's graph that can drift from it.
- **B. `dorny/paths-filter`.** The YAML filters live in each workflow. There's no script, but the uncovered-file check isn't built in, the map is spread over three workflows, and it adds a third-party action to pin.
- **C. `nx affected` for every job (picked).** Nx already knows that an engine change affects `xjobs-e2e`, and that `nx.json`, `tsconfig.base.json`, `eslint.config.mjs` and the workflows (through `sharedGlobals`) affect everything. The root folders no project owns get listed as inputs of an existing project. Tested on 2026-11-26: listing `{workspaceRoot}/supabase/**/*` in the `database` project's `namedInputs.default` makes `supabase/config.toml` affect `database`, `db-tests`, `xjobs`, `xjobs-e2e` and `web`. Listing `{workspaceRoot}/deploy/engine/**/*` in `xjobs` makes `deploy/engine/compose.yaml` affect `xjobs` and `xjobs-e2e`. There's one map, and it's Nx's. The cost is a full install in CI's change job (about 40 s); Dev database and Deploy engine's build already install.

## Decisions

### What each job runs on

| Job                          | Runs when                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| CI `main`                    | any project is affected. It runs `nx affected -t lint test build typecheck` instead of `run-many` |
| CI `database`                | `@xjobs/db-tests` is affected                                                                     |
| CI `e2e`                     | `@xjobs/xjobs-e2e` is affected                                                                    |
| CI `hooks` (new)             | a file under `.claude/hooks/**` changed. It runs `npm run test:hooks` with only Node, no install  |
| Dev database migrate + seed  | `@xjobs/database` is affected since the last migrated commit                                      |
| Deploy engine build + deploy | `@xjobs/xjobs` is affected since the last deployed commit                                         |

Dev database also runs on a `libs/database` code change that touches no migration. Migrate and seed are safe to repeat, so this is accepted.

### Files no project owns today, and where they go

Found by running `nx show projects --affected --files=<f>` on every tracked root-level file.

- **Owned by `database`** (its `namedInputs.default` gets these): `supabase/**`, `scripts/**` (the signing-key and Supabase env scripts that the `database` and `e2e` jobs use).
- **Owned by `xjobs`**: `deploy/engine/**`.
- **Owned by `xjobs-e2e`**: `docker-compose.yaml` (the e2e job starts Redis from it). It goes on the e2e project and not on `xjobs`, so a Redis compose change doesn't redeploy the engine.
- **Touches everything**: `nx.json`, `tsconfig.base.json` and `eslint.config.mjs` already do, and they stay that way. `.github/workflows/**` needs adding to `sharedGlobals` (today only `ci.yml` is there). So do `tsconfig.json` and `vitest.config.mts`, which affect nothing today.
- **Dependency files are narrowed** _(owner's call)_. `nx.json` gets `pluginsConfig["@nx/js"].projectsAffectedByDependencyUpdates: "auto"`. Probed on 2026-11-26 with real commits and `--base`:
  - A root `package.json` dependency bump already affects only its users (`next` → `web`; `apify-client` → `xjobs`, `xjobs-e2e`).
  - Without the setting, any lockfile change affects all six projects. With it, a lockfile change affects only the projects that pull the package in, through transitive dependencies too (`styled-jsx` → `web`; `proxy-from-env`, pulled in through `axios` → `xjobs`, `xjobs-e2e`).
  - The engine image's pruned lockfile comes from the same Nx graph. So if Nx thinks the engine doesn't use a package, the image doesn't contain it either.
- **Dependency-file fallback.** A change to `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` that Nx ties to no project runs everything; it doesn't fail the gap check. This covers `packageManager` (the pnpm version every job installs) and root scripts that CI calls (`db:test`, `db:types`, `test:hooks`): both were probed and affect no project. It applies in all three workflows, so a pnpm version change also migrates and redeploys. A `pnpm-workspace.yaml` change that Nx does tie to projects (today it ties to `xjobs` and `xjobs-e2e`) is treated the same way and runs everything: that file holds workspace-wide pnpm settings. _(My call.)_
- **Runs nothing** (the gap check's ignore list): `docs/**`, root `*.md` (`README.md`, `CLAUDE.md`), `.claude/**` except `.claude/hooks/**`, `.vscode/**`, `.editorconfig`, `.env.example`, `.gitignore`, `.prettierrc`, `.prettierignore` (CI runs no format check), `.nx/ci-config.yaml` (Nx agents are off), `docker-compose.worker.yaml` (local only), `tsconfig.tsbuildinfo`, `.pnpm-store/**`.

The last two are build artefacts that are tracked by mistake. Untracking them is out of scope; listing them here keeps them from tripping the gap check.

### The base each run compares against (owner's call: the last commit handled)

- **CI on a PR:** the merge base with `main`.
- **CI on a push to main:** the last commit with a successful CI push run on main (`nrwl/nx-set-shas` does this). This follows the same rule as the two below: a failed CI run is caught up by the next push.
- **Dev database:** the commit that its most recent run with a successful `deploy` job migrated, read from that run's name (it already carries the SHA). A run that found nothing to migrate still counts as handled, because nothing between the two commits needed migrating.
- **Deploy engine:** the commit of the most recent Deploy engine run whose `deploy` job succeeded. Deploy engine gets a `run-name` carrying its SHA, like Dev database, and `check` reads it with `gh api`. A run that skipped as stale (the server was newer) gives an older base, so the diff only grows. That's safe. After a manual rollback, the next automatic run diffs from the rolled-back commit and redeploys.
- **If any lookup fails** (no earlier run, API error, a commit missing from history): run everything and log a notice saying why.
- Deploy engine's manual dispatch skips change detection, as it skips the migration guard today.

### The gap check

It lives in CI's change job and runs on PRs and on pushes to main. Each changed file between base and head must either:

- belong to an affected project (`nx show projects --affected --files=<f>` is not empty), or
- match the "runs nothing" list, or
- be under `.claude/hooks/**`, or
- be one of the dependency files above (they fall back to running everything).

Otherwise the job fails and names each file, with one line saying to add it to a project's inputs or to the "runs nothing" list. The ignore list is kept in one place, which the builder chooses (see "Left to the builder").

### "CI passed"

A new job that always runs, `needs` every other CI job, and fails if any of them failed or was cancelled. Skipped jobs count as fine. A future required check points at this one name, so skipped jobs never show as waiting. _(My call; the owner didn't object.)_

### Running everything anyway

CI gets `workflow_dispatch` with a single boolean input, "run every job". It skips change detection and runs all jobs, on any branch. A dispatch on main doesn't start Dev database, which only follows `push` runs. _(My call.)_

### Docs to update

- `CLAUDE.md`: the "what CI runs" line.
- `deploy/engine/README.md`: deploys happen only when the engine changed, plus the rollback/dispatch note.
- The slice 03 roadmap doc: status.

## Left to the builder

- Where the "runs nothing" list lives: a JSON file read by the change job, or inline in the workflow. Pick whichever keeps it in one place.
- Whether docs inside project folders (`apps/xjobs/README.md`, `apps/web/DESIGN.md`) should stop counting as code, for example by excluding `{projectRoot}/**/*.md` from `namedInputs.default`. Try it. If Nx's affected check ignores the exclusion, leave it: the cost is an occasional extra run.
- How the change job exposes its answer (job outputs read by `if:` is the expected shape).
- How Deploy engine's `check` job gets Nx (checkout with full history and an install). Raise its 5-minute timeout if needed.
- Tests: a docs-only PR, a web-only PR, a `supabase/` change, a web-only lockfile bump, a `packageManager`-only change and an unowned new root file are the six cases to show working on the PR itself (draft PRs or pushed probe commits), plus one docs-only merge to show Dev database and Deploy engine skipping.
