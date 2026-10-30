# 01: Foundation

## Goal

Next.js and Supabase enter the repo, with a database test setup that local runs and CI share. Every later slice builds on this.

## In scope

- Supabase in the repo: the Supabase CLI, a local stack for development, a migrations folder, and seed data.
- A database test setup that runs in CI against a local Supabase stack, so RLS tests (slice 02 onward) run on every PR.
- A Next.js app scaffolded as an Nx project next to `apps/xjobs`, wired into `lint test build typecheck`.
- The Supabase client set up for server and browser use in the Next.js app.
- An empty app deployed to Vercel, preview deploys included.
- Accounts and domain, set up by the maintainer: Vercel, a hosted Supabase project, and the app's domain. My call: the domain is chosen here, not in slice 09, because slice 03's email sender needs a verified sending domain and the Auth redirect URLs need the app's domain.

## Out of scope

- Any tables beyond what the test setup needs.
- Auth flows (slice 03) and any product UI.
- The engine's database access (Phase 2).

## Locked

- Supabase (Postgres, Auth, Storage) and Next.js on Vercel. See the phase README.
- CI must stay green, and database tests are part of CI.

## For the slice spec

- The app's name and path in the monorepo (for example `apps/web`).
- How database tests are written: SQL tests (pgTAP) or TypeScript tests that sign in as test users through the Supabase client. This choice shapes the isolation harness in slice 02.
- Whether generated database types are committed or generated in CI.
- Environments: local and production only, or a staging Supabase project as well. Slice 09 depends on the answer.
- The UI component and styling baseline, or whether to defer it to slice 07.

## Done when

`npx nx run-many -t lint test build typecheck` covers the web app, CI runs a database test against a local Supabase stack, and the empty app is live on a Vercel URL.
