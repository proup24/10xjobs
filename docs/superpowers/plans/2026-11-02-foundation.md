# Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the self-hosted Supabase stack with the Supabase CLI, wire Prisma's Supabase extension pack, add a database test project that CI runs against the migrated stack, and add an empty, typed Next.js app at `apps/web` that later deploys to Vercel.

**Architecture:** `supabase/config.toml` defines the local stack (config only, no migrations); the Prisma contract and migrations in `apps/xjobs` stay the only schema source. A new Nx project `apps/db-tests` signs real users in through `supabase-js` and exposes only a `db-test` target. `apps/web` (Next.js, Tailwind v4, shadcn/ui) talks to Supabase only as the signed-in user, through `@supabase/ssr` clients typed by a committed `database.types.ts`.

**Tech Stack:** Nx 24, pnpm, Supabase CLI (`supabase` npm package), Prisma 8 RC (`@prisma/orm-*` 8.0.0-rc.21), `@supabase/supabase-js`, `@supabase/ssr`, Next.js 16 via `@nx/next` 24.0.2, Tailwind CSS v4, shadcn/ui, Vitest, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-11-02-foundation-design.md`

## Global Constraints

- Two PRs. PR 1 is Tasks 1–6 on branch `feat/foundation`, cut from `main` after the `docs/phase-1-architecture-decisions` and `docs/foundation-spec` PRs merge. PR 2 is Task 7 on `feat/foundation-vercel`, after the maintainer's accounts exist. Claude does not push; the human pushes and opens PRs.
- No `supabase/migrations/` folder and no schema SQL anywhere under `supabase/`. `[db.seed] enabled = false`.
- CLI default ports: API 54321, Postgres 54322, Studio 54323, Mailpit 54324. Supabase `project_id = "xjobs"`.
- Engine keeps `PORT=3000`. The web app's `dev` and `start` run on **3001**; Auth `site_url = "http://localhost:3001"`.
- Bucket `resumes`: private, `allowed_mime_types = ["application/pdf"]`, `file_size_limit = "5MiB"`.
- `@prisma/orm-extension-supabase` pinned to exactly `8.0.0-rc.21`, matching `@prisma/orm-postgres`. Enabling it must plan no migration; if one appears, stop and report.
- The service-role key never appears in `apps/web` (code, env or bundle). In `apps/db-tests` it is used only to create and delete test users.
- `apps/db-tests` has no `test` target. `npx nx run-many -t lint test build typecheck` must never need Docker.
- `apps/web/src/lib/supabase/database.types.ts` is committed; CI regenerates it and fails on any diff.
- Claude cannot read or write `.env*` files (except `.env.example`). Any local run that needs config passes env inline or reads it from `supabase status`.
- Engine code is out of scope beyond config. Its `SUPABASE_PUBLIC_URL` and `SERVICE_ROLE_KEY` fallbacks in `apps/xjobs/src/config` stay as they are.
- Existing local data is disposable: no dump or restore.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **`db-test` run while the stack is down:** it should fail within seconds, naming `pnpm db:start`, not hang on timeouts. Pinned in Task 3 (`loadStackEnv` test).
2. **A db-test that fails midway:** it must still delete the users it created, and reruns must not collide on email. Pinned in Task 3 (unique emails, `afterAll` cleanup, `cleanupTestUsers` test).
3. **Web build with no Supabase env** (CI, or a Vercel preview before env is set): `build` must still succeed, and a missing variable must fail at request time with an error naming that variable. Pinned in Task 5 (`readPublicSupabaseEnv` test and CI build without env).
4. **The service-role key leaking into the web app** through an import, a copied env var or a helper. Pinned in Task 4 (source-scan test).
5. **Schema changes without regenerated types:** they must fail CI, not drift silently. Pinned in Task 6 (types diff step), proven once by hand.

---

### Task 1: Supabase CLI stack replaces the self-hosted services

**Files:**

- Create: `supabase/config.toml` (via `pnpm exec supabase init`, then edited), `supabase/.gitignore` (from init)
- Delete: `supabase/volumes/`, `supabase/LICENSE`, `scripts/setup-supabase.mjs` (and any `package.json` script that calls it)
- Modify: `docker-compose.yaml` (keep only `redis`, `redis-cache` and the `redis-data` volume; drop the upstream header comment), `.env.example`, root `package.json`, `README.md`
- Check: `docker-compose.worker.yaml` still works (it depends only on `redis`)

**Interfaces:**

- Produces: root scripts `db:start` (`supabase start`), `db:stop` (`supabase stop`), `db:status` (`supabase status`), `db:reset` (stop with `--no-backup`, start, migrate, seed). `supabase` is a root dev dependency, run as `pnpm exec supabase`.
- Produces for every later task: a running local stack at `http://127.0.0.1:54321` (API) and `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

- [ ] **Step 1: Add the CLI and init.** `pnpm add -Dw supabase`, delete `supabase/volumes/` and `supabase/LICENSE`, then run `pnpm exec supabase init` (decline the IDE prompts).
- [ ] **Step 2: Edit `config.toml`.** Set `project_id = "xjobs"`, `[db.seed] enabled = false`, `[auth] site_url = "http://localhost:3001"` with `additional_redirect_urls = ["http://localhost:3001"]`, email sign-up on, and no external providers. Add `[storage.buckets.resumes]` with `public = false` and the Global Constraints values. Keep the default ports.
- [ ] **Step 3: Trim Compose and env.** Reduce `docker-compose.yaml` to the two Redis services. Delete `scripts/setup-supabase.mjs`. In `.env.example`, remove every variable only the self-hosted stack used (the Postgres, JWT, Kong, Studio, Realtime, Storage/MinIO, pooler, Logflare, SMTP and GoTrue groups, and `COMPOSE_FILE` if it only selected those). Set the engine's local values:
  - `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`
  - `SUPABASE_URL=http://127.0.0.1:54321`
  - `SUPABASE_SERVICE_ROLE_KEY=` empty, with a comment: "copy from `pnpm db:status`"
  - `STORAGE_RESUMES_BUCKET=resumes`
  - Keep `PORT=3000` and every Redis and engine variable.
- [ ] **Step 4: Root scripts and README.** Add the four `db:*` scripts. Add a "Local stack" section to `README.md` with the order: `pnpm db:start`, copy `.env.example` to `.env` and fill the key from `pnpm db:status`, `pnpm --filter @xjobs/xjobs db:migrate`, `db:seed`, `pnpm infra:redis`, `npx nx serve xjobs`. Also state that the old self-hosted data and `.env` are retired.
- [ ] **Step 5: Verify the stack, migrations and seed.** Run `pnpm db:start`, then:

  ```sh
  XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
    pnpm --filter @xjobs/xjobs db:migrate && \
  XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
    pnpm --filter @xjobs/xjobs db:seed
  ```

  Expected: all five migrations apply on a fresh stack, and the seed reports the three users. If a migration or seed assumed the self-hosted stack, fix it and record why in the commit message.

- [ ] **Step 6: Verify the bucket.** Run `pnpm db:status` and open Studio (54323) → Storage. Expected: a private `resumes` bucket. Then `docker compose config --services` prints only `redis` and `redis-cache`.
- [ ] **Step 7: Verify the engine.** Ask the human to rebuild their local `.env` per the README, run `npx nx serve xjobs` and confirm it boots against the CLI stack. Claude can't touch `.env`. Also run `npx nx run-many -t lint test build typecheck`. Expected: green.
- [ ] **Step 8: Commit** `build: run Supabase locally with the CLI instead of self-hosted Compose`.

### Task 2: Prisma Supabase extension pack

**Files:**

- Modify: `apps/xjobs/package.json` (add `"@prisma/orm-extension-supabase": "8.0.0-rc.21"` next to `@prisma/orm-postgres`), `apps/xjobs/prisma.config.ts`
- Possibly regenerated: `apps/xjobs/src/database/contract.json`, `contract.d.ts` (commit only if `emit` changes them)

**Interfaces:**

- Consumes: the running stack from Task 1.
- Produces: `extensions: [supabasePack]` in the `ormConfig(...)` call, where `supabasePack` is the default export of `@prisma/orm-extension-supabase/pack`. Read `skills/prisma-8/references/supabase.md` and `examples/supabase` in `prisma/orm` (Context7 `/prisma/orm`) for the exact subpath. Slice 02 relies on `@@rls`, `policy_*` and `supabase:auth.AuthUser` working.

- [ ] **Step 1: Install and wire.** `pnpm --filter @xjobs/xjobs add @prisma/orm-extension-supabase@8.0.0-rc.21`. Add the pack to `extensions` in `prisma.config.ts` and change nothing else.
- [ ] **Step 2: Emit.** Run `pnpm --filter @xjobs/xjobs db:emit`. Expected: success. If `contract.json`/`contract.d.ts` change, check that the diff only adds the pack's `supabase` space (external `auth`/`storage`), with no change to `public`.
- [ ] **Step 3: Prove no migration.** Run `XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=… pnpm --filter @xjobs/xjobs db:migration:plan` against the migrated stack from Task 1. Expected: no new migration. If one is planned, **stop and report its SQL**; don't commit it.
- [ ] **Step 4: Engine checks.** Run `npx nx run-many -t lint test build typecheck -p @xjobs/xjobs`. Expected: green.
- [ ] **Step 5: Commit** `build(db): enable Prisma's Supabase extension pack`.

### Task 3: Database test project

**Files:**

- Create: `apps/db-tests/package.json` (`@xjobs/db-tests`, private), `tsconfig.json`, `eslint.config.mjs` (copy `apps/xjobs-e2e`), `vitest.config.mts`
- Create: `apps/db-tests/src/support/stack-env.ts`, `src/support/test-users.ts`, `src/support/stack-env.spec.ts`, `src/smoke.db.spec.ts`
- Modify: `nx.json` (add `apps/db-tests/**/*` to the first `@nx/vitest` entry's `exclude`, and add a third `@nx/vitest` entry with `include: ["apps/db-tests/**/*"]`, `testTargetName: "db-test"`, `ciTargetName: "db-test-ci"`, `testMode: "run"`), root `package.json` (script `db:test` → `nx run @xjobs/db-tests:db-test`)

**Interfaces:**

- Produces (`stack-env.ts`): `type StackEnv = { url: string; anonKey: string; serviceRoleKey: string }`, and `loadStackEnv(): StackEnv`. It uses `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `process.env` when all three are set. Otherwise it parses `pnpm exec supabase status -o json` (use the CLI's actual key names: check the output of the installed version). If neither works, it throws an `Error` whose message is exactly: "Supabase stack not reachable: run pnpm db:start (or set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)".
- Produces (`test-users.ts`), for slice 02 to extend:
  - `type TestUser = { id: string; email: string; client: SupabaseClient }`
  - `createTestUser(): Promise<TestUser>`: admin `auth.admin.createUser({ email, password, email_confirm: true })`. The email is `` `db-test-${randomUUID()}@xjobs.test` ``. It then signs in with the password on a fresh anon client (`persistSession: false`).
  - `cleanupTestUsers(): Promise<void>`: deletes every user created in this process through the admin client and is safe to call twice.
  - `adminClient()` is module-private. Tests never get the service-role client.

- [ ] **Step 1: Scaffold the project** with the files above. `vitest.config.mts` includes `src/**/*.spec.ts` and gives a 30 s `testTimeout`. Run `npx nx show project @xjobs/db-tests`. Expected: targets include `db-test` and `lint`/`typecheck`, and **not** `test`.
- [ ] **Step 2: Write the failing tests.**
  - `stack-env.spec.ts`: `'uses the three env vars when all are set'` → returns them unchanged, with no CLI call (mock `execFileSync`). `'throws naming pnpm db:start when env is unset and the CLI fails'` → `toThrow(/pnpm db:start/)`.
  - `smoke.db.spec.ts`: `afterAll(cleanupTestUsers)`. Create users A and B. `'each session belongs to its own user'` → `(await A.client.auth.getUser()).data.user?.id === A.id`, the same for B, and `A.id !== B.id`. `'a signed-in user can query the Prisma schema through PostgREST'` → for each user, `await client.from('users').select('id').limit(1)` has `error === null`. Assert no row counts.
- [ ] **Step 3: Run** `pnpm db:test` with the stack up. Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** `stack-env.ts` and `test-users.ts` to the Interfaces above.
- [ ] **Step 5: Run** `pnpm db:test`. Expected: 4 passing. Then `pnpm db:stop && pnpm db:test`. Expected: fails within seconds with the `pnpm db:start` message. Then `pnpm db:start` again.
- [ ] **Step 6: Run** `npx nx run-many -t lint test build typecheck`. Expected: green, and the output shows no `db-tests` test run.
- [ ] **Step 7: Commit** `test(db): add a Supabase database test project with a two-user smoke test`.

### Task 4: Next.js app with the UI baseline

**Files:**

- Create: `apps/web/**` via `pnpm exec nx g @nx/next:app apps/web --name=web --appDir --src --style=tailwind --unitTestRunner=vitest --e2eTestRunner=none --linter=eslint`, then adjust
- Create: `apps/web/components.json`, `src/lib/utils.ts`, `src/lib/utils.spec.ts`, `src/components/ui/button.tsx`, `src/no-service-role.spec.ts`
- Modify: root `package.json` and `pnpm-lock.yaml` (Next 16, React, Tailwind v4, shadcn deps)

**Interfaces:**

- Produces: Nx project `web` with `lint`, `test`, `build`, `typecheck` and `dev` targets. `dev` and `start` run on port 3001.
- Produces: `cn(...inputs: ClassValue[]): string` in `src/lib/utils.ts` (shadcn's `clsx` + `tailwind-merge`), and the shadcn `Button` in `src/components/ui/button.tsx`. The path alias `@/` maps to `apps/web/src/`.

- [ ] **Step 1: Generate** the app. Confirm Tailwind is v4 (CSS-first `@import "tailwindcss"`; migrate if the generator produced v3), then run `pnpm dlx shadcn@latest init` in `apps/web` and `shadcn add button`. Replace the generated page with one placeholder page (the product name and one `Button`), and set port 3001 for `dev` and `start`.
- [ ] **Step 2: Write the tests.**
  - `utils.spec.ts`: `'cn merges conflicting tailwind classes'` → `cn('p-2', 'p-4') === 'p-4'`.
  - `no-service-role.spec.ts`: `'web source never references the service-role key'` reads every file under `apps/web/src` and `apps/web/*.{ts,mjs,js,json}` and asserts none match `/SERVICE_ROLE|service_role|SUPABASE_SECRET|sb_secret_/` (excluding this spec file itself).
- [ ] **Step 3: Run** `npx nx test web`. Expected: PASS. Prove the scan bites: temporarily add `process.env.SUPABASE_SERVICE_ROLE_KEY` to the page and expect FAIL, then revert.
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: green, now including `web`. `npx nx dev web` serves on http://localhost:3001.
- [ ] **Step 5: Commit** `feat(web): scaffold the Next.js app with Tailwind v4 and shadcn/ui`.

### Task 5: Supabase clients and generated types

**Files:**

- Create: `apps/web/src/lib/supabase/env.ts`, `env.spec.ts`, `server.ts`, `client.ts`, `session.ts`, `database.types.ts` (generated); `apps/web/src/proxy.ts` (Next 16; `middleware.ts` if the installed Next still uses it); `apps/web/.env.example`
- Modify: root `package.json` (script `db:types`), `apps/web/package.json` (`@supabase/supabase-js`, `@supabase/ssr`)

**Interfaces:**

- Produces:
  - `readPublicSupabaseEnv(): { url: string; publishableKey: string }` reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. It throws `Error('NEXT_PUBLIC_SUPABASE_URL is not set')` (or the key's name) when one is missing. Locally the key's value is the CLI's anon or publishable key; both work with `supabase-js`.
  - `createSupabaseServerClient(): Promise<SupabaseClient<Database>>` (`server.ts`, `@supabase/ssr` `createServerClient` with `next/headers` cookies)
  - `createSupabaseBrowserClient(): SupabaseClient<Database>` (`client.ts`)
  - `updateSession(request: NextRequest): Promise<NextResponse>` (`session.ts`), called from `proxy.ts`
  - `Database`, exported from `database.types.ts`
  - Root script `db:types`: `supabase gen types typescript --local --schema public > apps/web/src/lib/supabase/database.types.ts`, then Prettier on that file.
- Clients read env only when called, never at module load, so `build` works without env.

- [ ] **Step 1: Write the failing test.** `env.spec.ts`: `'returns both values when set'`; `'throws naming NEXT_PUBLIC_SUPABASE_URL when it is missing'` → `toThrow('NEXT_PUBLIC_SUPABASE_URL is not set')`; and the same for the key.
- [ ] **Step 2: Run** `npx nx test web`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `env.ts`, then the three client files following the current `@supabase/ssr` Next.js guide (Context7), typed with `Database`. Add `apps/web/.env.example` with the two `NEXT_PUBLIC_*` names and local values pointing at 54321.
- [ ] **Step 4: Generate types.** With the stack migrated (Task 1), run `pnpm db:types`. Expected: `database.types.ts` lists `users`, `profiles` and the other `public` tables.
- [ ] **Step 5: Verify.** Run `npx nx test web` (PASS). Then run `npx nx run-many -t lint test build typecheck` in a shell with no `NEXT_PUBLIC_*` set; expected: green, which proves the build needs no env. The scan from Task 4 still passes.
- [ ] **Step 6: Commit** `feat(web): add typed Supabase clients and generated database types`.

### Task 6: CI runs the database job

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: `pnpm db:start`, `db:types` and `db:test`, and the migrate command from Task 1.

- [ ] **Step 1: Add a `database` job** (separate from `main`, so the fast checks don't wait on Docker). It checks out, sets up pnpm and Node 24 like `main`, runs `pnpm install --frozen-lockfile`, then:
  1. `pnpm exec supabase start -x studio,realtime,edge-runtime,imgproxy,logflare,vector`. Keep `kong`, `gotrue`, `postgrest`, `storage-api`, `mailpit`, and `postgres-meta`, which `supabase gen types` needs. Check the exclude names against the installed CLI's `--help`.
  2. Migrate: `XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm --filter @xjobs/xjobs db:migrate`.
  3. Types: `pnpm db:types && git diff --exit-code apps/web/src/lib/supabase/database.types.ts`.
  4. `pnpm db:test`.
- [ ] **Step 2: Verify locally** that the same four commands pass in order on a fresh stack (`pnpm db:stop --no-backup && …`).
- [ ] **Step 3: Prove the types check bites.** Hand-edit `database.types.ts`, run step 3's command and expect a non-zero exit, then revert.
- [ ] **Step 4: Commit** `ci: run database tests against the Supabase CLI stack`.
- [ ] **Step 5: Hand off PR 1.** Run `npx nx run-many -t lint test build typecheck` one last time, then ask the human to push `feat/foundation` and open the PR. Expected: both CI jobs green on the PR.

### Task 7 (PR 2): Vercel wiring

**Blocked until the maintainer has:** registered the domain; created the Supabase Cloud project; created the Vercel project linked to the GitHub repo; and started domain verification for email sending (slice 03 needs it).

**Files:**

- Possibly create: `vercel.json` (only if the build can't be set in the project settings)
- Modify: `README.md` (a "Deploy" section: what Vercel builds, and which env vars are set where)

**Interfaces:**

- Consumes: the `web` project's `build` target, and the `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` env vars from Task 5.

- [ ] **Step 1: Configure the build** so Vercel builds `apps/web` from the pnpm monorepo: the root directory, install and build commands (for example `pnpm exec nx build web`) and the output directory. Use the `vercel:deployments-cicd` skill for current guidance. Production builds from `main`, and previews are on.
- [ ] **Step 2: Env.** The human sets both `NEXT_PUBLIC_*` variables for Production and Preview to the Supabase Cloud project's URL and publishable key. No other Supabase variable is set in Vercel.
- [ ] **Step 3: Verify.** On the PR, the preview deploy serves the placeholder page. After merge, the production URL serves it.
- [ ] **Step 4: Commit** `build(web): deploy the web app on Vercel`, and hand off for the human to push.
