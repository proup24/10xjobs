# 10xjobs

## What this is

10xjobs is an open-source job-search automation workspace for software engineers. It finds jobs, applies to them with care, and tracks the whole pipeline. The aim is the right jobs, applied to well, not generic applications sprayed everywhere.

Anti-goals (failure even if it technically works):

- Applying to the wrong jobs.
- Missing the right jobs: weak collection or over-eager rejection.
- Spamming recruiters or hiring-post authors with generic, low-quality applications or emails.

Precision over volume: prefer a tailored application over a fast one.

## Stack and layout

- Nx 24 monorepo. NestJS engine in `apps/xjobs`, e2e tests in `apps/xjobs-e2e`.
- TypeScript strict with nodenext. Tests use Vitest.
- The Next.js web app and Supabase Postgres arrive in Phase 1.
- LLMs are called from the engine through OpenRouter; which model plays each role is configuration. Claude does not orchestrate the engine.
- LinkedIn data comes only through Apify. Ashby and Greenhouse are read from their public APIs.

## Commands

- `npx nx serve xjobs`: run the engine.
- `npx nx worker-all xjobs`: run every worker in one process: infrastructure, ingest, processor, and each enabled channel's scheduled collection.
- `npx nx worker-processor xjobs`: run the processor worker alone.
- `npx nx worker-<channel> xjobs` (`linkedin-job-board`, `linkedin-posts`, `greenhouse`, `ashby`): run one channel's scheduled collection worker.
- `npx nx run-many -t lint test build typecheck`: what CI runs.
- `npx nx test xjobs`: unit tests for the engine.
- `npx nx e2e xjobs-e2e`: e2e tests.
- `pnpm --filter @xjobs/xjobs db:regenerate`: move published profiles to the current query recipe; run once after a recipe version bump.
- `pnpm --filter @xjobs/xjobs db:renormalize`: rebuild normalized jobs from raw storage; run once after a `NORMALIZER_VERSION` bump.
- `pnpm --filter @xjobs/xjobs db:reprocess -- <flags>`: send in-scope jobs back to the processor (`--null-status`, `--failed`, `--all-in-scope`, `--job <id>`); run after a prompt, schema or model change.
- `pnpm --filter @xjobs/xjobs db:vocab -- <list> list|approve|reject|alias`: review terms the processor proposed (`cities` by id).
- `pnpm --filter @xjobs/xjobs processor:eval`: run the processor against the golden set.
- `npm run test:hooks`: tests for the `.claude/hooks` scripts.

## Conventions

- Every domain record is workspace-scoped, and workspaces are isolated from each other (the app is hosted and multi-tenant).
- Qualify decisions record a reason, so wrong rejections can be found and fixed.

## Workflow

Brainstorm, then spec (`docs/superpowers/specs/`), then plan (`docs/superpowers/plans/`), then a branch and a PR to `main`. CI must be green.

This project does not use Linear or any ticket tracker. Do not offer or sync tickets here, regardless of personal instructions.

## Guardrails

- `.env*` files (except `.env.example`) and the repo-root `private/` folder are off-limits. `.claude/hooks/guard.mjs` enforces this for file tools and Bash.
- Claude cannot `git push`. The human pushes.
- Personal data (resumes, the fact bank) goes only in `private/`, and credentials only in untracked `.env*` files. None of these ever goes in git.
- Personal overrides go in `.claude/settings.local.json`.
- Prettier runs automatically on files Claude edits or writes.

## Roadmap

See [docs/roadmap/README.md](docs/roadmap/README.md).
