# 03: CI runs only what a change affects

Status: Built, pending merge (PR #146). Checks after merge in the PR body.

## Goal

Every CI job, and every job in the workflows that follow a merge, runs only when the change touches files that job checks. No job runs on every change by default. A docs-only PR finishes in seconds, and a docs-only merge to main neither migrates Dev nor redeploys the engine.

## Why now

- Each PR waits about 3–5 minutes for all three CI jobs, whatever it changes. On 2026-11-25 more than half the merged PRs were docs only (#132, #134, #135, #137, #138).
- Each merge to main then runs the whole chain: CI, then Dev database, then Deploy engine. Docs-only merges #135 and #138 each built and deployed the engine on 2026-11-25 (16:44 and 16:47 UTC). A deploy also restarts a stopped worker (slice [02](02-deploy-keeps-stopped-worker.md)).
- The `database` and `e2e` jobs each start a Supabase stack. That stack's port conflicts are the most common CI flake, so every skipped run is one less chance of a rerun.

## What exists

- `.github/workflows/ci.yml` runs on every `pull_request` and on `push` to `main`, with no path filters. It has three jobs:
  - `main`: `nx run-many -t lint test build typecheck` over every project (not `nx affected`), then `nx fix-ci`.
  - `database`: starts Supabase, runs `db:migrate` and `db:seed`, checks that `database.types.ts` matches the schema, runs `db:test`.
  - `e2e`: starts Supabase and Redis, migrates and seeds, builds and starts the engine, and runs `@xjobs/xjobs-e2e`. These are the engine's API boundary tests; the web app has no e2e job.
- `.github/workflows/dev-database.yml` runs after a green CI `push` on main and migrates the Dev database.
- `.github/workflows/deploy-engine.yml` runs after Dev database, and only when its migrate job really ran. It then builds and deploys the engine image. It has no check for whether the engine changed.
- The `Default` ruleset on main requires a pull request but no status checks. So a skipped or missing job doesn't block a merge today, but nothing blocks a red one either.

## In scope

- A map from files to jobs, decided in the brainstorm. For example:
  - `database`: `libs/database/**`, the Supabase config, seeds;
  - `e2e`: `apps/xjobs/**`, `apps/xjobs-e2e/**`, `libs/database/**`;
  - `main`: `nx affected` against the base, so a web-only change doesn't test the engine;
  - Dev database: migrations or contract changed;
  - Deploy engine: anything that ends up in the engine image (`apps/xjobs/**`, shared libs, `deploy/engine/**`, the lockfile).
- Files that count as "touches everything": the lockfile, `package.json`, `nx.json`, the TypeScript base config and the workflows themselves.
- A docs-only change (`docs/**`, `*.md` outside code folders, `.claude/**` memory and skills) runs nothing, or a single fast job.
- How Dev database and Deploy engine learn what a merge changed, given that they start from `workflow_run` and not from a push.
- Updating `CLAUDE.md` (the "what CI runs" line) and `deploy/engine/README.md` if behaviour changes.

## Out of scope

- Speeding up the jobs that do run (caching Supabase, Nx Cloud task distribution).
- Adding a web e2e job. If the brainstorm wants one, it's its own slice.
- Making status checks required on main. That's a separate decision, but see the open questions.
- Production: there is no production project yet.

## Open questions

- How to detect changes: `on.pull_request.paths` per workflow (simple, but it filters a whole workflow, not a job), a `changes` job (`dorny/paths-filter` or `git diff` against the base) that later jobs read with `if:`, or `nx affected` for every job.
- A merge with several commits, or one that lands while another is still in the chain: is the diff against the previous green deploy or against the parent commit?
- Whether to add one always-on summary job ("CI passed") that a future required check can point at, so that skipped jobs never show as "waiting".
- Whether `.claude/hooks/**` changes run `npm run test:hooks`, which CI doesn't run today.
- A manual way to run everything anyway (`workflow_dispatch`, or a PR label).
- How a missed path would be noticed: for example, a weekly full run on main.
