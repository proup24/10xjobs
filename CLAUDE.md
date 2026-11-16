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
- LLMs are called from the engine through `claude -p` (Claude Code headless, version pinned in the repo), on the owner's Claude subscription for now. Claude does not orchestrate the engine.
- LinkedIn data comes only through Apify. Ashby and Greenhouse are read from their public APIs.

## Commands

- `npx nx serve xjobs`: run the engine.
- `npx nx worker-all xjobs`: run every worker in one process: infrastructure, ingest, processor (when `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` is set), match, webhook, and each enabled channel's scheduled collection (registers schedules only with `XJOBS_RUN_SCHEDULES=1`, set on the hosted engine).
- `npx nx worker-processor xjobs`: run the processor worker alone (needs `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`).
- `npx nx worker-match xjobs`: run the match worker alone.
- `npx nx worker-webhook xjobs`: run the webhook worker alone (sends the users' match webhooks; registers its sweep only with `XJOBS_RUN_SCHEDULES=1`, set on the hosted engine).
- `npx nx worker-<channel> xjobs` (`linkedin-job-board`, `linkedin-posts`, `greenhouse`, `ashby`): run one channel's scheduled collection worker (registers schedules only with `XJOBS_RUN_SCHEDULES=1`, set on the hosted engine).
- `npx nx run-many -t lint test build typecheck`: what CI runs.
- `npx nx test xjobs`: unit tests for the engine.
- `npx nx e2e xjobs-e2e`: e2e tests.
- `pnpm db:migrate`: apply migrations (local only unless `XJOBS_ALLOW_REMOTE_DB=1`).
- `pnpm db:seed`: seed the database (same guard).
- `pnpm users link <email>`: print a sign-in link without sending email.
- `pnpm --filter @xjobs/xjobs db:regenerate`: move published profiles to the current query recipe; run once after a recipe version bump.
- `pnpm --filter @xjobs/xjobs db:renormalize`: rebuild normalized jobs from raw storage; run once after a `NORMALIZER_VERSION` bump.
- `pnpm --filter @xjobs/xjobs db:reprocess -- <flags>`: send in-scope jobs back to the processor (`--null-status`, `--failed`, `--all-in-scope`, `--job <id>`); run after a prompt, schema or model change.
- `pnpm --filter @xjobs/xjobs db:archive-actor -- --actor <name> [--dry-run]`: archive every job seen only in that Apify actor's batches and delete their matches (one transaction; run `--dry-run` first; remote needs `XJOBS_ALLOW_REMOTE_DB=1`). Nothing un-archives a job except a new ingest observation.
- `pnpm --filter @xjobs/xjobs db:rematch -- --all | --job <id>`: re-decide jobs after a rule change; bump `MATCHER_VERSION` first so the sweep also picks them up.
- `pnpm --filter @xjobs/xjobs db:analyze`: read-only report on match and processor quality (check patterns, dropped facts, vocabulary gaps, processing errors).
- `pnpm --filter @xjobs/xjobs db:vocab -- <list> list|approve|reject|alias`: review terms the processor proposed (`cities` by id).
- `pnpm --filter @xjobs/xjobs db:places -- --days <n>`: list recent LinkedIn places that fell back to a country or to nothing (default 7 days), to find cities and aliases to add with `db:vocab`.
- `pnpm --filter @xjobs/xjobs db:spellings -- --days <n> [--check-totals [--dry-run]]`: read-only report from recent processed LinkedIn jobs (default 7 days) of search spellings worth adding per technology, spellings that never earn their place, and engineering titles missing the role words searched. `--check-totals` makes paid 3-row Apify runs for each suggestion (capped at $0.10 per invocation, off by default; only the maintainer runs it, use `--dry-run` to see the spend).
- `pnpm --filter @xjobs/xjobs db:match-shares -- --days <n>`: share of decisions (job × profile) per outcome (default 7 days by last write, current matcher version), and for `review` the share per rule and field; review must stay the exception.
- `pnpm --filter @xjobs/xjobs processor:eval`: run the processor against the golden set.
- `npm run test:hooks`: tests for the `.claude/hooks` scripts.

## Conventions

- The app is hosted and multi-tenant, and the tenant is the Supabase Auth user (no workspaces). Every record a user owns carries `userId` and is isolated by RLS; engine-only tables have RLS on with no policies.
- The Prisma contract (`libs/database/src/contract/contract.prisma`) is the only schema source, RLS policies included. The local stack is the Supabase CLI; production is Supabase Cloud.
- Qualify decisions record a reason, so wrong rejections can be found and fixed.
- UI work in `apps/web` follows `apps/web/DESIGN.md`: build only from `components/ui` and theme tokens.

## Workflow

Brainstorm, then spec (`docs/superpowers/specs/`), then plan (`docs/superpowers/plans/`), then a branch and a PR to `main`. CI must be green.

This project does not use Linear or any ticket tracker. Do not offer or sync tickets here, regardless of personal instructions.

## Guardrails

- `.env*` files (except `.env.example`) and the repo-root `private/` folder are off-limits. `.claude/hooks/guard.mjs` enforces this for file tools and Bash.
- Claude may push a feature branch only as `git push -u origin <branch>` and may open its PR to `main` with `gh pr create`. Claude never pushes `main`, force-pushes or deletes remote branches; `guard.mjs` blocks every other push form, and the human merges.
- Personal data (resumes, the fact bank) goes only in `private/`, and credentials only in untracked `.env*` files. None of these ever goes in git.
- Personal overrides go in `.claude/settings.local.json`.
- Prettier runs automatically on files Claude edits or writes.

## Roadmap

See [docs/roadmap/README.md](docs/roadmap/README.md).
