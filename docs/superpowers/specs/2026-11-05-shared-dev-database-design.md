# Shared dev database and a database library

Status: draft, 2026-11-05.

## Intent

Two developers work on 10xjobs, and today each runs a private local Supabase
stack. They want one shared development database on Supabase Cloud, so day to
day work needs no local stack and both see the same data and the same test
accounts.

Separately, everything about the schema lives inside the engine
(`apps/xjobs/src/database/`), although the web app depends on it too. It should
move into its own Nx library that both apps consume.

The why is ease of use: less setup, one place for the schema, and one copy of
the shared enums (the "taxonomies": `Position`, `Technology`, `Seniority`, and
so on).

## Goals

- A Supabase Cloud project, separate from production, that both developers use
  for daily development.
- The shared database always matches `main`. Migrations reach it only after
  their PR merges, applied by CI and never by hand.
- The users seed runs against the shared database, so both developers sign in
  with the same test accounts (`admin@`, `recruiter@`, `candidate@xjobs.local`).
- Getting started on daily work means filling in a few values in the untracked
  `.env`, without running `supabase start`.
- An Nx library owns the Prisma contract, the migrations, the seeds, the Prisma
  config, the contract enums, and the generated Supabase types. `web` and
  `xjobs` import from it.

## Non-goals

- Deciding whether taxonomies stay enums or become database tables. Tech tags
  created on the fly will probably need a table someday. That is a later,
  separate decision, and this work only moves the enums as they are.
- Production deployment or production migrations. The production project is
  covered by `docs/auth-production.md` and later slices.
- Retiring the local stack. It stays for schema work and database tests.
- Moving `supabase/` (`config.toml`, templates, snippets). It stays at the repo
  root, where the CLI expects it.

## Anti-goals

- A developer's unmerged schema change reaching the shared database, so the
  other developer's work on `main` breaks under them.
- Destructive local-only commands (`db:reset`, the `db-tests` suite, which
  creates and deletes users) running against the shared database by accident.
- Shared-database credentials, or the service-role key, in git.

## How schema changes flow (decided)

1. On a branch, a developer edits the contract and plans the migration, then
   tests it against their **local** stack (`pnpm db:start`, migrate, seed,
   `pnpm db:test`), as today.
2. The PR's CI runs the existing `database` job against a throwaway local stack
   in the runner, which is also unchanged.
3. After the PR merges to `main`, a CI job applies the pending migrations to
   the shared database and then runs the seeds there.

The developers coordinate schema changes between themselves. The process does
not need to handle two conflicting migrations merged on the same day, beyond
the rule that migrations are planned against an up-to-date `main`.

## Shared dev database

- A new Supabase Cloud project, for example `10xjobs-dev`, created by the human
  in the dashboard. Claude has no Supabase Cloud credentials and does not create
  it.
- Auth settings and email templates are mirrored from `supabase/config.toml` by
  hand, as `docs/auth-production.md` already describes for production. The dev
  project's Site URL and redirect URL are `http://localhost:3001`, matching
  `config.toml`, so sign-in links from the shared project open the local web
  app.
- Storage: the private `resumes` bucket that `config.toml` creates locally has
  to exist in the dev project too.
- Connection: the engine uses the **session pooler** URL (port 5432), as
  `.env.example` already says. Migrations use the same URL or
  `DIRECT_DATABASE_URL`.

### Signing in as the test accounts (decided)

Sign-in is by emailed code only, and the test accounts use `@xjobs.local`
addresses. Locally those emails land in Mailpit. On Cloud they can't be
delivered: the domain receives no mail, and Supabase's built-in mailer only
sends to the project team's addresses.

So the existing admin script gains a command, `pnpm users link <email>`. It asks
the Supabase admin API for a sign-in link (`auth.admin.generateLink`) and prints
it in the terminal. Opening the link signs that user in, with no email sent. It
works against any project whose service-role key is in the env, the local stack
included.

- The link must go through the web app's existing `/auth/confirm` route (with
  `token_hash` and `type`), as the email templates do. The builder builds the
  URL from the generated token hash and the web URL, not from Supabase's
  default action link.
- It refuses unknown or blocked users, as `invite` and `block` handle them
  today.
- The seed, the invite-only rules and the email templates don't change.

### CI deploy job

- Triggers on push to `main` only, never on pull requests.
- Runs `db:migrate` against the shared database, then every seed (`db:seed`).
  The users seed is idempotent: it finds existing auth users and updates their
  names. From now on, every seed must be safe to re-run on each merge against
  data both developers are using. The seed runner's header comment states this
  rule (my call).
- Reads `DATABASE_URL` (or `DIRECT_DATABASE_URL`), `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` for the dev project from GitHub Actions secrets,
  ideally scoped to a GitHub environment named `dev`. The human adds the
  secrets.
- A concurrency group serialises runs, so two quick merges never migrate at the
  same time.
- Sets `XJOBS_SKIP_ENV_FILES=1`, as the existing `database` job does.

### Developer setup

- The root `.env.example` gains a clearly marked shared-dev block next to the
  local defaults, with the pooler URL template and the dev project's
  `SUPABASE_URL`. The web's `NEXT_PUBLIC_*` values stay in
  `apps/web/.env.local`, where Next reads them today (`apps/web/.env.example`
  gets the same shared-dev note). So that is two files, not one, and Next's env
  loading doesn't change (my call). Secrets are left blank and shared between
  the developers outside git.
- The README (or a short `docs/` page) explains both modes: daily work against
  the shared database, and schema work against the local stack, including how
  to switch.

### Guarding against destructive commands

`db:reset` and `db:test` must only ever touch the local stack. They already
pass or default to `127.0.0.1:54322`, but `db-tests` falls back to
`DATABASE_URL` when it's set. The builder makes both of them refuse to run (or
ignore the env) when the target isn't local.

`db:migrate` (and the other schema-writing `db:*` commands) is the bigger risk.
Once a developer's `.env` points at the shared database, running it on a branch
would apply unmerged migrations there. So they refuse a non-local target unless
the caller opts in explicitly, for example with an env flag that the CI deploy
job sets (my call). The production steps in `docs/auth-production.md` that run
`db:migrate` by hand get the same opt-in and are updated to say so. `db:seed`
takes the same guard. How the guards are built is the builder's choice.

## The database library

### What moves in

- `contract.prisma`, plus the emitted `contract.json` and `contract.d.ts`.
- `migrations/` (`app`, `supabase`, `snapshots`, `refs`), with history intact.
  The migration ids and snapshot hashes must not change, or the shared and
  local databases would see them as new migrations.
- `prisma.config.ts` and the `db:*` scripts (`emit`, `format`, `migration:plan`,
  `migrate`, `seed`, and so on), which now live on the library's package.
- The seeds and the seed runner.
- The enums that mirror the contract (`Position`, `Language`, `Region`,
  `Engagement`, `Arrangement`, `Seniority`, `ContactKind`, `SkillDomain`,
  `Technology`, `Channel`, `ProfileState`) and the drift test, `enums.spec.ts`.
  Engine-only enums (`environment`, `error-code`, `response-status`) stay in
  `xjobs`.
- The generated `database.types.ts`, currently in
  `apps/web/src/lib/supabase/`. `pnpm db:types` and the CI drift check move to
  the new path.
- The framework-free database client (`connection.source.ts`), the row types
  (`models.ts`) and the error helpers (`errors.ts`), if they have no Nest
  dependency, or once that dependency is removed.

### What stays in the apps

- `xjobs` keeps the Nest wiring: `database.module.ts`, `connection.service.ts`,
  the logger middleware, and its env validation. It imports the client and the
  types from the library.
- `web` keeps its Supabase clients (`client.ts`, `server.ts`, `session.ts`,
  `env.ts`) and imports the generated types and the enums from the library.
- `supabase/` stays at the repo root.

### Shape (my call, open to change)

- Location `libs/database`, package `@xjobs/database`. `pnpm-workspace.yaml`
  gains `libs/*`.
- Separate entry points, so `web` never bundles the Prisma runtime or Node-only
  code. For example: `@xjobs/database/enums`, `@xjobs/database/types` (the
  Supabase types), and `@xjobs/database` (the client, contract and rows, for the
  engine only).
- It follows the workspace's existing TypeScript project-reference setup (the
  `@xjobs/source` custom condition), so the apps consume source in development.
- Root scripts (`db:reset`, `db:types`, and the rest) and the CI `database` job
  point at the new package instead of `@xjobs/xjobs`.

### Dependencies the builder has to untangle

The seeds and the database environment loader import from engine code today:
`src/config` (`loadDatabaseEnvironment`, `loadSeedEnvironment`),
`src/admin/auth-users` (`findAuthUserByEmail`), `EnvironmentType`, and the Nest
`Logger`. The library must not depend on `xjobs`. The builder moves what the
library needs (for example a small env loader for the database variables), or
injects it. Which pieces move and how they are split is left to the builder. The
one requirement is that `xjobs` and the library read the same root `.env` the
same way, as they do now.

## Constraints

- Prisma 8 (rc) with `@prisma/cli-engine` and the Supabase extension pack, as
  today. No change of ORM or version.
- The Prisma contract stays the only schema source, RLS policies included.
- `.env*` files (except `.env.example`) stay untracked and off-limits to Claude.
- Claude cannot push or create the cloud project. The human does both, and adds
  the GitHub secrets.
- CI (`lint test build typecheck` plus the `database` job) stays green
  throughout, and the move lands as its own PR before the shared-database PR.

## Suggested order

1. **PR 1, the library move.** A pure refactor with no behaviour change: the
   local stack and CI work exactly as before, only from new paths.
2. **PR 2, the shared database.** The CI deploy job, the guards on destructive
   commands, the `users link` command, `.env.example`, and the docs. Merge it after the human has created
   the dev project and added the secrets. The first run on `main` then migrates
   the empty project from scratch and seeds it.

## Left to the builder

- Exact file layout inside the library and the names of its entry points.
- How the env loading and the auth-user helper get split between the library
  and `xjobs`.
- How the destructive-command guards work.
- The workflow file layout, whether it's a new workflow or a new job in
  `ci.yml`, gated on `main`.
- Wording and placement of the setup docs.
