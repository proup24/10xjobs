# Shared Dev Database and Database Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every database file out of `apps/xjobs` into an Nx library, `@xjobs/database`, that `web` and `xjobs` both consume. Then add a shared Supabase Cloud dev database that CI migrates and seeds after each merge to `main`, plus local-only guards and a `pnpm users link` sign-in command.

**Architecture:**

- `libs/database` is a framework-free TypeScript package. It owns the Prisma contract, migrations, seeds, Prisma config, the database env loading, the contract enums, the generated Supabase types, the Prisma client factory and the auth-user lookup.
- The package exposes separate entry points (`.`, `./enums`, `./types`, `./env`, `./auth`), so `web` imports only enums and types and never bundles Prisma.
- `xjobs` keeps the Nest wiring and re-exports from the library through its existing `src/database` and `src/common/enums` barrels. Its ~90 importers don't change.
- PR 2 adds a local-target guard to the schema-writing commands and the seed runner, a `workflow_run` deploy workflow that runs only after CI passes on `main`, the `users link` command, and the docs.

**Tech Stack:** Nx 24 (TS project references, `@xjobs/source` custom condition), pnpm workspaces, Prisma 8 rc (`@prisma/cli-engine` 0.9.0, `@prisma/orm-postgres` rc.21, `@prisma/orm-extension-supabase`), Supabase CLI and Supabase Cloud, `@supabase/supabase-js` 2.118, Next.js 16.4, NestJS 11, Vitest, `tsx`, zod 4, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-shared-dev-database-design.md`

**Branches:** two PRs to `main`, both branched from `main`.

- PR 1 is `refactor/database-lib` (Tasks 1–5). It also carries the spec and this plan.
- PR 2 is `feat/shared-dev-database` (Tasks 6–9), branched from `main` after PR 1 merges.

## Global Constraints

- PR 1 changes no behaviour. The local stack, CI, `nx serve xjobs`, `nx dev web` and the Docker image work exactly as before, only from new paths.
- Migration ids, snapshot hashes and the contract's storage hash must not change. After the move, `pnpm --filter @xjobs/database db:emit` produces no diff in `contract.json` or `contract.d.ts`.
- `libs/database` never imports from `apps/*` and never depends on `@nestjs/*`.
- `web` imports only `@xjobs/database/enums` and `@xjobs/database/types`. `apps/web/src/no-service-role.spec.ts` stays green.
- The Prisma contract stays the only schema source.
- Local hosts are exactly `127.0.0.1`, `localhost` and `::1`, the same set as `apps/db-tests/src/support/stack-env.ts`, plus `::1`.
- The remote opt-in variable is `XJOBS_ALLOW_REMOTE_DB=1`. No other spelling.
- The dev project's web URL is `http://localhost:3001`.
- The deploy workflow runs only after the `CI` workflow succeeds on `main`, never on pull requests. Its concurrency group is `dev-database`, with `cancel-in-progress: false`.
- GitHub secrets live in the `dev` environment: `DEV_DATABASE_URL`, `DEV_SUPABASE_URL`, `DEV_SUPABASE_SERVICE_ROLE_KEY`.
- No `.env*` file except `.env.example` files is read or written. Claude doesn't push.
- CI must be green: `npx nx run-many -t lint test build typecheck`, plus the `database` job including the `db:types` diff check.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A developer whose `.env` points at the shared database runs `db:migrate` on a branch.** It must refuse and name the host. Task 6 (`assertLocalDatabase` tests, and running the script against a fake remote URL).
2. **The seed runs with a local `DATABASE_URL` but a remote `SUPABASE_URL`, or the reverse.** It must refuse, because the users seed writes to both. Task 6 (`seed refuses when either URL is remote`).
3. **`users link` for a blocked user or an unknown email.** It must refuse and print no link. Task 7.
4. **The `web` production build after the move.** `nx build web` must not pull Prisma or Node-only code through `@xjobs/database`. Task 4 (a build plus a bundle grep for `orm-postgres`).
5. **The Docker image of `xjobs` after the move.** `docker:build` must include the library at runtime, not only at type level. Task 3 (boot `apps/xjobs/dist/main.js` against the local stack).

---

## File Structure (after PR 1)

```
libs/database/
  package.json          @xjobs/database; exports ., ./enums, ./types, ./env, ./auth; db:* scripts
  prisma.config.ts      moved from apps/xjobs; contract ./src/contract/contract.prisma, migrations src/migrations
  tsconfig.json, tsconfig.lib.json, tsconfig.spec.json, vitest.config.mts, eslint.config.mjs
  src/
    index.ts            engine entry: contract, createDatabaseClient, DatabaseClient, DatabaseLogger,
                        DatabaseConfig, row types, toStoredAddress, Seed, DatabaseTransaction
    contract/           contract.prisma, contract.json, contract.d.ts   (moved verbatim)
    migrations/         app/, supabase/, snapshots/                      (moved verbatim)
    client/             connection.source.ts, logger.middleware.ts, models.ts (+ connection.source.spec.ts)
    env/                environment.loader.ts, database-environment.ts, environment-type.ts, index.ts
    enums/              the 11 contract enums, index.ts, enums.spec.ts
    auth/               auth-users.ts, index.ts
    seeds/              index.ts (runner), seed.interface.ts, users.seed.ts
    supabase/           database.types.ts  (generated; types entry re-exports it from types.ts)
    types.ts            export type { Database } from './supabase/database.types'
```

`apps/xjobs/src/database/` keeps `connection.service.ts`, `database.module.ts`, `errors.ts` (it uses `ConflictException`) and `errors.spec.ts`. Its `index.ts` re-exports the library's engine entry. `apps/xjobs/src/common/enums/index.ts` re-exports the contract enums and `EnvironmentType` from the library and keeps `ErrorCode` and `ResponseStatus`.

---

## PR 1: the library move (no behaviour change)

### Task 1: Scaffold `@xjobs/database` and move the enums

**Files:**

- Create: `libs/database/package.json`, `libs/database/tsconfig.json`, `libs/database/tsconfig.lib.json`, `libs/database/tsconfig.spec.json`, `libs/database/vitest.config.mts`, `libs/database/eslint.config.mjs`
- Move: `apps/xjobs/src/common/enums/{arrangement,channel,contact-kind,engagement,language,position,profile-state,region,seniority,skill-domain,technology}.enum.ts` to `libs/database/src/enums/`
- Move: `apps/xjobs/src/common/enums/environment.enum.ts` to `libs/database/src/env/environment-type.ts`
- Create: `libs/database/src/enums/index.ts`
- Modify: `apps/xjobs/src/common/enums/index.ts`, `pnpm-workspace.yaml`, `tsconfig.json` (root references), `apps/xjobs/package.json` and `apps/web/package.json` (`"@xjobs/database": "workspace:*"`)

**Interfaces:**

- Produces: the package `@xjobs/database`. `@xjobs/database/enums` exports `Arrangement, Channel, ContactKind, Engagement, Language, Position, ProfileState, Region, Seniority, SkillDomain, Technology`. `@xjobs/database/env` exports `EnvironmentType`, and grows in Task 2.

- [ ] **Step 1: Branch.** `git checkout main && git checkout -b refactor/database-lib`. Then cherry-pick or copy the spec and this plan onto it, and commit them as `docs: shared dev database spec and plan`.
- [ ] **Step 2: Scaffold the library** as a buildable TS-solution library: add `libs/*` to `pnpm-workspace.yaml` and a root `tsconfig.json` reference. Each `exports` entry carries `"@xjobs/source"` pointing at the `.ts` source, then `types` and `default` pointing at `dist`, in that order. No `"type": "module"`, so it stays CJS like `xjobs`. `tsconfig.lib.json` sets `resolveJsonModule: true` and excludes `src/migrations/**` and specs. Use `npx nx g @nx/js:library` with `--directory libs/database --importPath @xjobs/database --bundler tsc --unitTestRunner vitest` if it produces this shape, then trim it. Run `pnpm install`.
- [ ] **Step 3: Move the enum files with `git mv`** and write `libs/database/src/enums/index.ts`. Rewrite `apps/xjobs/src/common/enums/index.ts` to re-export those 11 from `@xjobs/database/enums`, plus `EnvironmentType` from `@xjobs/database/env`, and keep `ErrorCode` and `ResponseStatus` local. `enums.spec.ts` stays in `xjobs` for now and moves in Task 2, when the contract does.
- [ ] **Step 4: Verify.** Run `npx nx run-many -t typecheck test build -p @xjobs/database @xjobs/xjobs`. Expected: all pass, and `src/modules/**` imports from `src/common/enums` are unchanged.
- [ ] **Step 5: Commit** with the message `refactor(database): scaffold @xjobs/database with the contract enums`.

### Task 2: Move the contract, migrations, env loading, client, auth lookup and seeds

**Files:**

- Move (`git mv`, content unchanged): `apps/xjobs/src/database/{contract.prisma,contract.json,contract.d.ts}` to `libs/database/src/contract/`, `apps/xjobs/src/database/migrations/` to `libs/database/src/migrations/`, and `apps/xjobs/prisma.config.ts` to `libs/database/prisma.config.ts`
- Move and adapt: `connection.source.ts`, `connection.source.spec.ts`, `logger.middleware.ts`, `models.ts` to `libs/database/src/client/`
- Move: `apps/xjobs/src/config/environment.loader.ts` to `libs/database/src/env/environment.loader.ts`. Its `findEnvFiles` walk already stops at `pnpm-workspace.yaml`, so the root `.env` resolves the same way from `libs/database`.
- Create: `libs/database/src/env/database-environment.ts` with `databaseEnvironmentSchema`, `seedEnvironmentSchema`, `DatabaseEnvironmentVariables`, `SeedEnvironmentVariables`, `DatabaseConfig`, `toDatabaseConfig`, `loadDatabaseEnvironment` and `loadSeedEnvironment`, all moved out of `apps/xjobs/src/config/{index,environment.validation}.ts`
- Move: `apps/xjobs/src/admin/auth-users.ts` to `libs/database/src/auth/auth-users.ts`
- Move and adapt: `apps/xjobs/src/database/seeds/` to `libs/database/src/seeds/`
- Move: `apps/xjobs/src/common/enums/enums.spec.ts` to `libs/database/src/enums/enums.spec.ts`
- Modify: `apps/xjobs/src/config/{index,environment.validation}.ts` (import and re-export from `@xjobs/database/env`), `apps/xjobs/src/database/index.ts`, `apps/xjobs/src/database/connection.service.ts`, `apps/xjobs/src/admin/{users-admin,users-cli,fake-auth}.ts`, the six direct importers of `src/database/{connection.source,models,contract.json,seeds/seed.interface}`, `apps/xjobs/eslint.config.mjs` and `apps/xjobs/tsconfig.app.json` (drop the migrations ignores), and `apps/xjobs/package.json` (`db:*` scripts and the Prisma deps move to `libs/database/package.json`; `users` stays)

**Interfaces:**

- Consumes: Task 1's package and `@xjobs/database/env`.
- Produces:
  - `@xjobs/database` exports `contract`, `createDatabaseClient(config: DatabaseConfig, logger?: DatabaseLogger): DatabaseClient`, `type DatabaseClient`, `interface DatabaseLogger { log(m: unknown): void; warn(m: unknown): void; error(m: unknown): void; debug(m: unknown): void }`, `type DatabaseConfig`, the row types and `Address`, `toStoredAddress`, `type Seed`, `type DatabaseTransaction`, and `queryLogger`.
  - `@xjobs/database/env` exports `EnvironmentType`, `loadEnvironmentFiles(start?: string): void`, `databaseEnvironmentSchema`, `seedEnvironmentSchema`, `parseEnvironment`, `toDatabaseConfig`, `loadDatabaseEnvironment()`, `loadSeedEnvironment()`, and the two variable types.
  - `@xjobs/database/auth` exports `type AdminAuth` and `findAuthUserByEmail`.
  - `libs/database/package.json` scripts: `db:emit`, `db:format`, `db:update`, `db:init`, `db:migration:plan`, `db:migration:status`, `db:migrate`, `db:migrate:show`, `db:verify`, `db:seed`. Same commands as today, with `db:seed` now `tsx src/seeds/index.ts`.

- [ ] **Step 1: Move the contract, migrations and Prisma config** with `git mv`. Point `prisma.config.ts` at `./src/contract/contract.prisma`, migrations `src/migrations`, and `loadDatabaseEnvironment` from `./src/env`. Fix the header comment in `contract.prisma` so it names the new package commands.
- [ ] **Step 2: Prove the contract didn't change.** Run `pnpm --filter @xjobs/database db:emit && git status --short libs/database/src/contract`. Expected: no modified files. If Prisma writes the emitted files to a different path, configure the output so they land beside the contract. Don't edit them by hand.
- [ ] **Step 3: Move the env loading.** `loadEnvironmentFiles` and `loadApplicationEnvironment` stay importable from `src/config` in `xjobs` through re-exports. `environmentSchema` in `xjobs` extends the library's `databaseEnvironmentSchema`. The existing `apps/xjobs/src/config/*.spec.ts` still pass.
- [ ] **Step 4: Make the client framework-free.** Replace `Logger` from `@nestjs/common` in `connection.source.ts` and `logger.middleware.ts` with the `DatabaseLogger` parameter. The default is a console-backed logger that prefixes `[Database]`. `DatabaseService` keeps passing its Nest `Logger`, which already satisfies the interface. Import `DatabaseConfig` from `../env`. `errors.ts` stays in `xjobs`.
- [ ] **Step 5: Move the auth lookup and the seeds.** The seed runner uses the console logger, `loadSeedEnvironment` and `EnvironmentType` from `../env`. The seed interface imports `SeedEnvironmentVariables` from `../env` and `DatabaseClient` from `../client/connection.source`. Add `findAuthUserByEmail` to `@xjobs/database/auth`. In `xjobs`, `users-admin.ts`, `users-cli.ts` and `fake-auth.ts` import `AdminAuth` and `findAuthUserByEmail` from there.
- [ ] **Step 6: Re-point `xjobs`.** `apps/xjobs/src/database/index.ts` keeps its current export list but sources it from `@xjobs/database`. Update the six files that import deeper paths, the ones `grep -rn "src/database/" apps/xjobs/src` lists, to use `src/database` or `@xjobs/database`. `enums.spec.ts` imports `../contract/contract.json`.
- [ ] **Step 7: Verify.** Run `npx nx run-many -t lint test typecheck -p @xjobs/database @xjobs/xjobs` and expect all of it to pass, including `enums.spec.ts` and `connection.source.spec.ts` in the library. Run `grep -rn "@nestjs\|apps/" libs/database/src` and expect no matches.
- [ ] **Step 8: Commit** with the message `refactor(database): move contract, migrations, env, client and seeds into @xjobs/database`.

### Task 3: Engine build, Docker and local stack still work

**Files:**

- Modify: `apps/xjobs/webpack.config.js`, `apps/xjobs/package.json` (`nx.targets`), only as far as the checks below need. Root `package.json` (`db:reset`, plus new aliases `db:migrate` = `pnpm --filter @xjobs/database db:migrate` and `db:seed` = `pnpm --filter @xjobs/database db:seed`). `.github/workflows/ci.yml` (`database` job filters move to `@xjobs/database`).

- [ ] **Step 1: Build and boot the engine from `dist`.** Run `npx nx build xjobs && pnpm db:start && pnpm db:reset`, then `node apps/xjobs/dist/main.js`. Expected: `Database connection established` in the log. If webpack can't resolve `@xjobs/database`, make it resolve the `@xjobs/source` condition or bundle the workspace library. The decision is the builder's, and the check is the boot.
- [ ] **Step 2: Docker.** Run `npx nx docker:build @xjobs/xjobs`. Expected: success, and the image's `node main.js` resolves `@xjobs/database`. `copy-workspace-modules` already exists for this. Confirm the library is built first (`dependsOn: ^build`).
- [ ] **Step 3: Update `db:reset` and CI** to the new package filters, and run `pnpm db:reset`. Expected: migrations apply and the seed reports `users seeded`.
- [ ] **Step 4: Run the database tests.** Run `pnpm db:test`. Expected: pass.
- [ ] **Step 5: Commit** with the message `build(database): wire engine build, Docker, db:reset and CI to @xjobs/database`.

### Task 4: Web consumes the generated types and enums from the library

**Files:**

- Move: `apps/web/src/lib/supabase/database.types.ts` to `libs/database/src/supabase/database.types.ts`
- Create: `libs/database/src/types.ts`
- Modify: `apps/web/src/lib/supabase/{client,server,session}.ts`, `apps/web/src/lib/auth/{landing,landing.spec}.ts` (import `type { Database }` from `@xjobs/database/types`), `apps/web/next.config.js` (`transpilePackages: ['@xjobs/database']`, plus condition resolution if needed), the root `package.json` `db:types` output path, and the `.github/workflows/ci.yml` diff path.

**Interfaces:**

- Produces: `@xjobs/database/types` exports `type Database`.

- [ ] **Step 1: Move the file and update the imports**, `db:types` and the CI `git diff --exit-code` path.
- [ ] **Step 2: Check the types are current.** Run `pnpm db:types && git diff --exit-code libs/database/src/supabase/database.types.ts`. Expected: exit 0.
- [ ] **Step 3: Check the web build doesn't pull in Prisma (Review Focus 4).** Run `npx nx build web && grep -rl "orm-postgres\|prisma" apps/web/.next/server apps/web/.next/static`. Expected: the build succeeds and grep finds nothing.
- [ ] **Step 4: Run web in dev.** Run `npx nx dev web` and open http://localhost:3001/sign-in. Expected: the page renders.
- [ ] **Step 5: Commit** with the message `refactor(web): import database types from @xjobs/database`.

### Task 5: Update path references in docs and run full CI

**Files:**

- Modify: `CLAUDE.md` (the contract path), `README.md` (local setup commands use `pnpm db:migrate` and `pnpm db:seed`, and the migration refs path becomes `libs/database/src/migrations/app/refs/db.json`), `docs/auth-production.md` (`pnpm --filter @xjobs/database db:migrate`). Leave historical specs and plans untouched.

- [ ] **Step 1: Fix the stale paths.** Run `grep -rn "apps/xjobs/src/database\|@xjobs/xjobs db:\|apps/web/src/lib/supabase/database.types" --exclude-dir={node_modules,.next,dist,.worktrees} . | grep -v docs/superpowers`. Expected: no matches after the edits.
- [ ] **Step 2: Run full CI locally.** Run `npx nx run-many -t lint test build typecheck && pnpm db:reset && pnpm db:test`. Expected: all green.
- [ ] **Step 3: Commit** with the message `docs: point database paths and commands at @xjobs/database`. The human pushes and opens PR 1.

---

## PR 2: the shared dev database

Branch `feat/shared-dev-database` from `main` after PR 1 has merged.

### Task 6: Local-target guard for schema-writing commands and the seed

**Files:**

- Create: `libs/database/src/env/local-guard.ts`, `libs/database/src/env/local-guard.spec.ts`, `libs/database/src/env/assert-local.cli.ts`
- Modify: `libs/database/src/env/index.ts`, `libs/database/package.json` (prefix `db:migrate`, `db:update` and `db:init` with `tsx src/env/assert-local.cli.ts &&`), `libs/database/src/seeds/index.ts`, `libs/database/src/seeds/seeds.spec.ts` (new)

**Interfaces:**

- Produces: `isLocalUrl(url: string): boolean`, and `assertLocalDatabase(urls: Record<string, string | undefined>, env: NodeJS.ProcessEnv): void`. The latter throws unless every defined URL is local or `env.XJOBS_ALLOW_REMOTE_DB === '1'`.

- [ ] **Step 1: Write the failing tests** in `local-guard.spec.ts`:

```ts
it.each(['postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'postgresql://u:p@localhost:5432/db', 'http://[::1]:54321'])('treats %s as local', (url) => expect(isLocalUrl(url)).toBe(true));
it('treats a pooler URL as remote', () => expect(isLocalUrl('postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres')).toBe(false));
it('refuses a remote URL and names the variable and host', () => expect(() => assertLocalDatabase({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/x' }, {})).toThrow(/DATABASE_URL.*db\.example\.com.*XJOBS_ALLOW_REMOTE_DB=1/));
it('allows a remote URL with XJOBS_ALLOW_REMOTE_DB=1', () => expect(() => assertLocalDatabase({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/x' }, { XJOBS_ALLOW_REMOTE_DB: '1' })).not.toThrow());
it('ignores undefined URLs', () => expect(() => assertLocalDatabase({ DIRECT_DATABASE_URL: undefined }, {})).not.toThrow());
```

- [ ] **Step 2: Run the tests.** Run `npx nx test @xjobs/database -- local-guard`. Expected: FAIL, because the module isn't found.
- [ ] **Step 3: Implement `local-guard.ts`.** The local hosts are the set from Global Constraints. Compare `URL.hostname` with the IPv6 brackets stripped. The error message is: `Refusing to use <VAR> at non-local host <host>. Set XJOBS_ALLOW_REMOTE_DB=1 to allow it.`
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Write the seed-runner test** in `seeds.spec.ts`. Extract the guard call into an exported `assertSeedTargets(env: SeedEnvironmentVariables, processEnv: NodeJS.ProcessEnv): void` in `seeds/index.ts`, and keep `main()` behind `require.main === module`. Test the four cases:
  - local `DATABASE_URL` with remote `SUPABASE_URL`: throws;
  - remote `DATABASE_URL` with local `SUPABASE_URL`: throws;
  - both local: passes;
  - both remote with `XJOBS_ALLOW_REMOTE_DB=1`: passes.
- [ ] **Step 6: Implement it.** Wire `assertSeedTargets` into `main()` before the client is created, and write `assert-local.cli.ts`. It calls `loadDatabaseEnvironment()`, then `assertLocalDatabase({ DIRECT_DATABASE_URL, DATABASE_URL }, process.env)`. On error it prints the message and exits with status 1. Run `npx nx test @xjobs/database`. Expected: PASS.
- [ ] **Step 7: Check against a fake remote URL (Review Focus 1).** Run `DATABASE_URL=postgresql://u:p@db.example.com:5432/x pnpm --filter @xjobs/database db:migrate`. Expected: exit 1 with the refusal, and no connection attempted. Run `pnpm db:reset`. Expected: success, because the stack is local.
- [ ] **Step 8: Confirm the existing guards and commit.** `db:test` is already guarded by `assertLocal` in `apps/db-tests/src/support/stack-env.ts`, and `db:reset` hardcodes the local URL. Confirm both and change neither. Commit with the message `feat(database): refuse non-local targets for migrate and seed unless XJOBS_ALLOW_REMOTE_DB=1`.

### Task 7: `pnpm users link <email>`

**Files:**

- Modify: `libs/database/src/auth/auth-users.ts` (add `'generateLink'` to the `AdminAuth` pick), `apps/xjobs/src/admin/users-admin.ts`, `apps/xjobs/src/admin/users-cli.ts`, `apps/xjobs/src/admin/fake-auth.ts`, `apps/xjobs/src/admin/users-admin.spec.ts`, `apps/xjobs/src/admin/users-cli.spec.ts`

**Interfaces:**

- Consumes: `findAuthUserByEmail`, `AdminAuth` (`@xjobs/database/auth`), `normalizeEmail`, `CommandResult`.
- Produces: `signInLink(auth: AdminAuth, email: string, webUrl: string): Promise<CommandResult>`. On success, `message` is the link.

- [ ] **Step 1: Write the failing tests** in `users-admin.spec.ts`. `fakeAuth` gains `generateLink`, which records its calls and returns `{ data: { properties: { hashed_token: 'hash-1' } }, error: null }`.

```ts
it('prints a confirm link for a known user', async () => {
  const auth = fakeAuth([makeUser({ email: 'admin@xjobs.local' })]);
  expect(await signInLink(auth, ' Admin@xjobs.local ', 'http://localhost:3001')).toEqual({ ok: true, message: 'http://localhost:3001/auth/confirm?token_hash=hash-1&type=email' });
  expect(auth.calls.generateLink).toEqual([{ type: 'magiclink', email: 'admin@xjobs.local' }]);
});
it('refuses an unknown email without generating a link', async () => {
  const auth = fakeAuth([]);
  expect(await signInLink(auth, 'nobody@xjobs.local', 'http://localhost:3001')).toEqual({ ok: false, message: 'No user with email nobody@xjobs.local.' });
  expect(auth.calls.generateLink).toEqual([]);
});
it('refuses a blocked user', async () => {
  const auth = fakeAuth([makeUser({ email: 'b@xjobs.local', banned_until: '2126-01-01T00:00:00Z' })]);
  expect(await signInLink(auth, 'b@xjobs.local', 'http://localhost:3001')).toEqual({ ok: false, message: 'b@xjobs.local is blocked; unblock them first.' });
});
it('reports a generateLink error', async () => {
  /* error → ok:false, message starts 'Could not create a sign-in link for' */
});
```

In `users-cli.spec.ts`: `link a@xjobs.local` prints the link and returns 0. `WEB_URL` overrides the default `http://localhost:3001`. `link` with no email prints usage and returns 1.

- [ ] **Step 2: Run the tests.** Run `npx nx test xjobs -- admin`. Expected: FAIL, because `signInLink` isn't defined.
- [ ] **Step 3: Implement `signInLink`.** It refuses when `banned_until` is in the future. It calls `generateLink({ type: 'magiclink', email })` and builds `${webUrl}/auth/confirm?token_hash=<hashed_token>&type=email`, which goes through the `/auth/confirm` route's existing `email` type and never Supabase's `action_link`. In the CLI, add `link` to `USAGE` (`pnpm users <invite|block|unblock|link> <email> | pnpm users list`) and read `env.WEB_URL ?? 'http://localhost:3001'`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Check it on the real local stack.** Run `pnpm db:reset && eval "$(scripts/supabase-env.sh)" && pnpm users link admin@xjobs.local`, then open the printed link with `npx nx dev web` running. Expected: you're signed in and land on the home page.
- [ ] **Step 6: Commit** with the message `feat(admin): users link prints a sign-in link without sending email`.

### Task 8: Deploy workflow for the shared database

**Files:**

- Create: `.github/workflows/dev-database.yml`

- [ ] **Step 1: Write the workflow.** It triggers on `workflow_run: { workflows: [CI], types: [completed], branches: [main] }`. The job runs `if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'`, with `environment: dev` and `concurrency: { group: dev-database, cancel-in-progress: false }`. Check out with `ref: ${{ github.event.workflow_run.head_sha }}`, then use the same pnpm and Node setup as `ci.yml`. Job env: `XJOBS_SKIP_ENV_FILES: '1'`, `XJOBS_ALLOW_REMOTE_DB: '1'`, `DATABASE_URL: ${{ secrets.DEV_DATABASE_URL }}`, `SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}`, `SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.DEV_SUPABASE_SERVICE_ROLE_KEY }}`. Steps: `pnpm --filter @xjobs/database db:migrate`, then `pnpm --filter @xjobs/database db:seed`.
- [ ] **Step 2: Lint the workflow.** Run `pnpm dlx @action-validator/cli .github/workflows/dev-database.yml` if available, or `actionlint`. Expected: no errors. This workflow can't run until the human has added the secrets. Say so in the PR description.
- [ ] **Step 3: Update the seed rule and commit.** In the header comment of `libs/database/src/seeds/index.ts`, add: "Every seed must be idempotent: CI re-runs all of them on the shared dev database after each merge." Commit with the message `ci: migrate and seed the shared dev database after CI passes on main`.

### Task 9: Setup docs and env examples

**Files:**

- Create: `docs/shared-dev-database.md`
- Modify: `.env.example`, `apps/web/.env.example`, `README.md`, `docs/auth-production.md`

- [ ] **Step 1: Write `docs/shared-dev-database.md`.** It covers:
  - **One-time project setup, done by the human:** create the `10xjobs-dev` project; mirror the auth settings and email templates as in `docs/auth-production.md`, with Site URL and redirect URL `http://localhost:3001`; create the private `resumes` bucket; create the GitHub `dev` environment with the three secrets (the session pooler URL on port 5432 for `DEV_DATABASE_URL`); then re-run the latest `CI` on `main`, or merge anything, to trigger the first migrate and seed.
  - **Daily work:** the root `.env` values and the `apps/web/.env.local` values to set, and signing in with `pnpm users link <email>`.
  - **Schema work:** switch to the local stack, run `pnpm db:start` and `pnpm db:reset`, and never `XJOBS_ALLOW_REMOTE_DB=1` from your own machine against the dev project.
  - **Recovery:** if the dev database drifts, reset it in the dashboard and re-run the deploy workflow.
- [ ] **Step 2: Add the shared-dev block to the env examples.** Add a commented block to `.env.example` (pooler URL template, `SUPABASE_URL=https://<ref>.supabase.co`, a blank service-role key) and one to `apps/web/.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, a blank publishable key), each pointing to the doc.
- [ ] **Step 3: Update the README and production doc.** In `README.md`, describe the two modes in two lines each and link to the doc. In `docs/auth-production.md`, the production migrate becomes `XJOBS_ALLOW_REMOTE_DB=1 pnpm --filter @xjobs/database db:migrate`, with one sentence explaining the flag.
- [ ] **Step 4: Run full CI locally.** Run `npx nx run-many -t lint test build typecheck && pnpm db:reset && pnpm db:test`. Expected: all green.
- [ ] **Step 5: Commit** with the message `docs: shared dev database setup and daily use`. The human pushes and opens PR 2, then completes the one-time setup before merging.
