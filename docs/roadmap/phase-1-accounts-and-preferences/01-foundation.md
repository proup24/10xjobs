# 01: Foundation

## Goal

The Next.js app and the Supabase CLI stack enter the repo, with a database test setup that local runs and CI share. Every later slice builds on this.

## In scope

- **The Supabase CLI** as the local stack (`supabase start`), with auth settings in `supabase/config.toml`. It replaces the self-hosted Supabase services in `docker-compose.yaml`; Redis stays in Compose.
- **Prisma against that stack:** `prisma db migrate` applies the existing migrations to the CLI's Postgres, and the seed runs there. Prisma's Supabase extension pack is added to `prisma.config.ts`, so later slices can write RLS policies in the contract.
- **A database test setup** that runs in CI against the same stack, so RLS tests (slice 02 onward) run on every PR. CI starts the stack, applies the Prisma migrations, then runs the tests.
- **A Next.js app** scaffolded as an Nx project next to `apps/xjobs`, wired into `lint test build typecheck`.
- **The UI component and styling baseline**, so the UI slices start from a shared kit.
- **The Supabase client** (`supabase-js` with `@supabase/ssr`) set up for server and browser use in the Next.js app, always as the signed-in user. The service-role key is never used in the web app.
- **Database types** for the web app from `supabase gen types`, run against the migrated local database.
- **An empty app on Vercel**, preview deploys included.
- **Accounts and domain**, set up by the maintainer: Vercel, a Supabase Cloud project, and the app's domain. The domain is chosen here, not in slice 09, because slice 03's email sender needs a verified sending domain and the Auth redirect URLs need the app's domain.

## Out of scope

- New tables or RLS policies beyond what the test setup needs (slice 02 onward).
- Auth flows (slice 03) and any product screens.
- Changes to the engine beyond pointing its local `DATABASE_URL` and Storage settings at the CLI stack.

## Locked

- Supabase Cloud (Postgres, Auth, Storage) in production; the Supabase CLI locally and in CI. No self-hosted Supabase.
- The Prisma contract is the only schema source. The Supabase CLI runs the stack only; there is no `supabase/migrations` folder.
- The Next.js app runs on Vercel and talks to Supabase as the signed-in user.
- CI must stay green, and database tests are part of CI.

## For the slice spec

- The app's name and path in the monorepo (for example `apps/web`).
- How database tests are written: TypeScript tests (Vitest) that sign in test users through `supabase-js`, which is the path the app uses, or SQL tests (pgTAP). Recommendation: TypeScript. This choice shapes the isolation harness in slice 02.
- Whether generated database types are committed or generated in CI.
- Environments: local and production only, or a staging Supabase project as well. Slice 09 depends on the answer.
- The component library and styling choice.
- How the engine's existing local setup moves to the CLI stack (ports, keys, the Storage bucket).

## Done when

`npx nx run-many -t lint test build typecheck` covers the web app, CI runs a database test against the Supabase CLI stack with the Prisma migrations applied, the Supabase services are gone from `docker-compose.yaml`, and the empty app is live on a Vercel URL.
