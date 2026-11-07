# 09: Hosted launch

Spec: [Hosted launch: production setup](../../superpowers/specs/2026-11-07-hosted-launch-design.md) (the launch check section is filled in after slices 07 and 08).

## Goal

The shared, hosted app runs in production and the phase's exit criteria are checked on it.

## In scope

- A production Supabase project and production Vercel deployment, configured from environment settings (no secrets in git).
- Migrations applied to production through a repeatable, reviewed path, not by hand.
- Production Auth settings: public sign-up off, the email sender connected, and redirect URLs locked to the app's domain.
- Backups: the production project starts on Supabase Free, which has no restorable backups. Accepted until it moves to Pro, before anyone other than the maintainer relies on the app (see the spec).
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
