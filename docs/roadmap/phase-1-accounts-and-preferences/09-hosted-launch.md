# 09: Hosted launch

Spec: [Hosted launch: production setup](../../superpowers/specs/2026-11-07-hosted-launch-design.md) (the launch check section is filled in after slices 07 and 08).

## Goal

The shared, hosted app runs in production and the phase's exit criteria are checked on it.

## In scope

- A production Supabase project and production Vercel deployment (previews use `10xjobs-dev`), configured from environment settings (no secrets in git).
- Migrations applied to production through a repeatable, reviewed path, not by hand, connecting as `postgres` over the session pooler, which the Storage policies and the `resumes` bucket migration need.
- `db:seed --only processor-lists,iso,cities` run on production, which fills the ISO language and currency tables the profile checks rely on, and the approved cities.
- The `resumes` bucket confirmed private, with the 5 MiB and PDF-only limits.
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

Production isn't set up yet: for now the cloud database is `10xjobs-dev` only, and the production CI job was removed until production is wanted (see [production.md](../../production.md)). All settled in the [spec](../../superpowers/specs/2026-11-07-hosted-launch-design.md); the runbook is [production.md](../../production.md).

- How Prisma migrations reach the Supabase Cloud database: settled. A CI job on merge to `main`, behind a required-reviewer approval, over the session pooler ([spec](../../superpowers/specs/2026-11-07-hosted-launch-design.md#decisions)).
- Staging: settled. None; previews use `10xjobs-dev` ([spec](../../superpowers/specs/2026-11-07-hosted-launch-design.md#decisions)).
- Error monitoring in Phase 1: settled. Deferred; Vercel and Supabase logs are enough for an invite-only app ([spec](../../superpowers/specs/2026-11-07-hosted-launch-design.md#non-goals)).

## Done when

The exit criteria from the phase README pass on the live app.
