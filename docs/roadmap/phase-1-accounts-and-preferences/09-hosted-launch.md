# 09: Hosted launch

## Goal

The shared, hosted app runs in production and the phase's exit criteria are checked on it.

## In scope

- A production Supabase project and production Vercel deployment, configured from environment settings (no secrets in git).
- Migrations applied to production through a repeatable, reviewed path, not by hand, connecting as `postgres` (direct or session pooler), which the Storage policies and the `resumes` bucket migration need.
- `db:seed` run on production, which fills the ISO language and currency tables the profile checks rely on.
- The `resumes` bucket confirmed private, with the 5 MiB and PDF-only limits.
- Production Auth settings: public sign-up off, the email sender connected, and redirect URLs locked to the app's domain.
- Backups confirmed on for the production database.
- A launch check against the live app: invite a test user, sign in, complete setup, edit, and confirm that a second user can't reach the first user's data.

## Out of scope

- Deploying the NestJS engine (Phase 2).
- Usage limits (Phase 2).

## Locked

- Vercel for the web app and hosted Supabase for the database, auth and storage.
- Platform keys live only in server environment config.

## For the slice spec

- How Prisma migrations reach the Supabase Cloud database: a CI job on merge to `main`, or a manual command the maintainer runs. Either way they connect through the session pooler or a direct connection, not the transaction pooler.
- Staging, if slice 01 chose to have it.
- Error monitoring in Phase 1, or deferred.

## Done when

The exit criteria from the phase README pass on the live app.
