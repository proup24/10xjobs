# Phase 1, slice 01: Foundation

Status: draft, 2026-11-02. Implements
[01-foundation.md](../../roadmap/phase-1-accounts-and-preferences/01-foundation.md)
under the decisions in the
[Phase 1 README](../../roadmap/phase-1-accounts-and-preferences/README.md).

## Intent

Every later Phase 1 slice needs three things that don't exist yet: a Next.js app
in the monorepo, a local Supabase stack that matches production, and a database
test setup that runs the same way locally and in CI. Slice 02's isolation
harness ("one user can never read or change another user's data, and tests
prove it") is built on this setup, so it must run through the same path the web
app uses: `supabase-js` with a signed-in user's session.

This slice adds no product behaviour. It's done when the plumbing is in place
and proven by one end-to-end database test and one empty, deployed page.

## Goals

- The Supabase CLI stack (`supabase start`) replaces the self-hosted Supabase
  services in `docker-compose.yaml`, locally and in CI.
- The existing Prisma migrations and seed run against that stack, and Prisma's
  Supabase extension pack is wired in so slice 02 can write RLS in the contract.
- A database test project that CI runs on every PR against the migrated stack.
- An empty Next.js app at `apps/web`, covered by
  `npx nx run-many -t lint test build typecheck`, live on Vercel with preview
  deploys.
- A UI baseline (Tailwind and shadcn/ui) the UI slices start from.
- Typed `supabase-js` clients for server and browser, always acting as the
  signed-in user.

## Non-goals

- New tables, columns or RLS policies (slice 02 onward).
- Sign-in flows, invite handling or any product screen (slice 03 onward).
- Engine changes beyond pointing its local config at the CLI stack.
- Removing the engine's CRUD controllers.
- A staging environment.

## Anti-goals

- **The service-role key reaching the web app** in code, env or bundle. The web
  app only ever acts as the signed-in user, so RLS is always in force.
- **Database tests that bypass RLS** (connecting as `postgres` or with the
  service-role key to perform the operation under test). They would prove
  nothing about isolation. The service role is allowed only to _set up_ test
  users and data.
- **A second schema source.** No `supabase/migrations` folder and no SQL in
  `supabase/` that creates schema objects; the Prisma contract and its migrations
  stay the only source.
- **A plain `test` run that needs Docker.** Unit tests stay fast and
  stack-free; database tests have their own target.

## Decisions (agreed with the user)

| Question                       | Decision                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| App name and path              | `apps/web`, Nx project `web`, using `@nx/next`.                                                                         |
| How database tests are written | TypeScript and Vitest, signing users in through `supabase-js`. A separate Nx project with its own `db-test` target.     |
| Generated database types       | Committed in the web app. CI regenerates them after migrating and fails on any difference.                              |
| Environments                   | Local and production only. Vercel preview deploys use the production Supabase project.                                  |
| Components and styling         | shadcn/ui with Tailwind CSS v4.                                                                                         |
| Engine on the CLI stack        | CLI default ports; resumes bucket declared in `supabase/config.toml`; all Supabase services leave Compose, Redis stays. |

Preview deploys against production are accepted knowingly: only the maintainer
opens PRs, RLS still applies, sign-up is invite-only, and migrations reach
production only from `main`. The cost is that a preview of a PR that changes the
schema fails until the migration ships.

## Shape

### 1. Supabase CLI stack

- `supabase init` creates `supabase/config.toml` (project id `xjobs`). The
  directory holds config only: no `migrations/`, and `seed.sql` disabled
  (`[db.seed] enabled = false`), since Prisma owns schema and seed.
- Default CLI ports: API 54321, Postgres 54322, Studio 54323, the mail catcher
  (Mailpit) 54324.
- Auth settings live in `config.toml`. For this slice: `site_url` is
  `http://localhost:3001`, email sign-up enabled, and every other provider off.
- **Existing local data is disposable (the user's call).** No dump or restore:
  the self-hosted volumes, `scripts/setup-supabase.mjs` and the `.env` values it
  wrote are simply retired. `.env.example` and the README say how to rebuild a
  local `.env` for the CLI stack.
- **Ports (my call):** the engine keeps `PORT=3000`, and the web app's `dev`
  and `start` run on **3001**, so the two never collide and the engine's config
  is untouched.
  Slice 03 tightens these for invite-only sign-in.
- Storage: a private `resumes` bucket declared under `[storage.buckets.resumes]`,
  PDF only (`application/pdf`), with a 5 MiB size limit (my call). Its name
  matches the engine's `STORAGE_RESUMES_BUCKET`.
- `docker-compose.yaml` keeps only `redis` and `redis-cache` (and their
  volumes). Every Supabase service goes, as does `supabase/volumes/` and the
  upstream Supabase `LICENSE` copied with it. `.env.example` drops every variable
  that only the self-hosted stack used.
- The CLI is a dev dependency (`supabase` npm package), run through `pnpm exec
supabase`, so its version is pinned in the lockfile. Root scripts:
  `db:start` (`supabase start`), `db:stop`, `db:reset` (stop, start, migrate,
  seed).

### 2. Engine on the CLI stack

- `.env.example` documents the local values:
  `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
  `SUPABASE_URL=http://127.0.0.1:54321`, and `SUPABASE_SERVICE_ROLE_KEY` copied
  from `supabase status` (the CLI's local key is fixed and public, but it still
  goes only in untracked `.env*` files).
- `pnpm --filter @xjobs/xjobs db:migrate` applies the existing migrations to
  the CLI's Postgres, and `db:seed` runs there. Any migration or seed that
  assumed the self-hosted stack is fixed so both run cleanly on a fresh
  `supabase start`.
- `BASIC_AUTH_*` and the other engine variables are untouched; the token check
  that replaces Basic auth comes with publishing.

### 3. Prisma Supabase extension pack

The pack is published as `@prisma/orm-extension-supabase` (in Prisma's
monorepo it is `@internal/extension-supabase`; its docs live under
`skills/prisma-8/references/supabase.md` and `examples/supabase` in
`prisma/orm`). Its `pack` export goes in the `extensions` array of the
`ormConfig` in `apps/xjobs/prisma.config.ts`, so the contract can use `@@rls`,
`policy_*` blocks and a `supabase:auth.AuthUser` relation. This slice adds no
RLS to the contract.

- **Version (my call):** pin it to the same release candidate as the other
  `@prisma/orm-*` packages. If no matching release exists, move all
  `@prisma/orm-*` packages (and `prisma`, `@prisma/cli-engine` if required) to
  the nearest release candidate that has one, in its own commit, with the
  engine's tests green. A bigger upgrade than that is a stop-and-ask.
- **Proof it works (my call):** `prisma contract emit` succeeds and
  `prisma migration plan` produces no migration for `public`. The pack declares
  `auth` and `storage` as external, so it should emit no DDL for them. If any
  migration appears, stop and report rather than commit it.
- The engine keeps its stock `postgres()` runtime. The pack's role-based
  runtime (`asUser`, `asServiceRole`) is not adopted here.

### 4. Database test project

- A new Nx project, `apps/db-tests` (my call on the name), with a `db-test`
  target and no `test` target, so `run-many -t test` never needs the stack.
- Vitest, with `@supabase/supabase-js` clients:
  - an **admin** client (service role) used only for setup and teardown:
    creating and deleting test users;
  - **user** clients, each signed in as one test user, used for every operation
    under test.
- Helpers that slice 02 extends: `createTestUser()` (admin API, confirmed email,
  random address under a reserved test domain, password sign-in) returning a
  signed-in client and the user id, and cleanup that deletes the users it
  created.
- Connection details come from env (`SUPABASE_URL`, anon key, service-role key).
  Locally they come from an untracked `.env` in the project or the root; in CI
  from `supabase status -o env`.
- The one test this slice ships: two users are created, both sign in, each
  session's `auth.getUser()` returns its own id, and a `select` through each
  user client on `users` returns without error (proving PostgREST sees the
  Prisma schema). It asserts no error only, never row counts, so it keeps
  passing when slice 02 turns RLS on (my call). Slice 02 adds the A/B isolation
  cases.
- Between slices 01 and 02 the tables have no RLS, so a signed-in local user
  can read every row. That's accepted: it's local and CI only, since nothing
  migrates to Supabase Cloud before slice 02 lands.

### 5. Next.js app

- `apps/web`, generated with `@nx/next` (App Router, TypeScript strict), wired
  into `lint`, `test` (Vitest), `build` and `typecheck`. One placeholder page.
- Tailwind CSS v4 and shadcn/ui initialised, with the components the UI slices
  will obviously need added only when they need them. Here: the config, the
  `cn` helper and one component (`Button`) to prove the setup.
- Supabase clients with `@supabase/ssr`: a server client (cookies) for Server
  Components, Server Actions and Route Handlers, a browser client, and the
  session-refresh middleware. All typed with the generated `Database` type.
- Env: only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or
  the publishable key, whichever the current Supabase docs recommend). No
  service-role key, and a lint or test check that fails if the web app's source
  references `SERVICE_ROLE` or `SECRET_KEY`.

### 6. Generated types

- `supabase gen types typescript --local` writes
  `apps/web/src/lib/supabase/database.types.ts`, committed.
- A root script `db:types` regenerates it.
- CI, after migrating, regenerates and runs `git diff --exit-code` on the file.

### 7. CI

The existing job keeps running `nx run-many -t lint test build typecheck`. A
database job (separate, or extra steps; builder's call) does, in order:

1. Install dependencies.
2. `supabase start`, excluding services nothing uses yet (Studio, Realtime,
   Edge Runtime, imgproxy, analytics, Vector). Auth, PostgREST, Storage and Kong
   stay, since tests go through them.
3. Apply the Prisma migrations to the CLI's Postgres.
4. Check the generated types are up to date.
5. Run `nx run db-tests:db-test`.

### 8. Vercel and accounts

- **Maintainer task (not a decision for the builder):** choose and register the
  app's domain, create the Vercel project and the Supabase Cloud project, and
  verify the domain for sending email (slice 03 needs it).
- The Vercel project builds `apps/web` from the monorepo. Production deploys from
  `main`; every PR gets a preview. Both use the production Supabase URL and anon
  key from Vercel env.
- No migrations run against Supabase Cloud in this slice; how production is
  migrated is slice 09's call.

### PRs (my call)

1. **Repo work:** the CLI stack, engine move, extension pack, database tests,
   the web app, types and CI. It doesn't wait on any account.
2. **Vercel wiring**, once the maintainer's accounts exist: project settings
   (root and build command, or a `vercel.json` if needed), env vars, and a
   preview deploy shown on the PR.

The slice is done when both have merged.

## Tests

- `db-tests`: the two-user smoke test above, in CI.
- `web`: one unit test (for example, the `cn` helper or the placeholder page
  renders), so `test` covers the project, plus the service-role-key check.
- Engine: existing unit and e2e tests still pass. The Redis integration test
  still runs against Compose Redis.

## Done when

- `npx nx run-many -t lint test build typecheck` covers `web` and passes.
- CI starts the Supabase CLI stack, applies the Prisma migrations, checks the
  generated types and runs the database test, on every PR.
- `docker-compose.yaml` holds only Redis services.
- The engine serves and seeds against the CLI stack locally.
- The empty app is live on a Vercel URL, with a preview deploy on a PR.

## Left to the builder

- The exact `config.toml` values beyond those listed, and how the bucket
  limits are expressed.
- Whether the CI database work is a separate job or more steps in the existing
  one.
- File layout inside `apps/web` and `apps/db-tests`, and the test-user email
  domain.
- Which Supabase public key name the web app uses (anon or publishable),
  following current Supabase docs.
- How `db:reset` is scripted.
