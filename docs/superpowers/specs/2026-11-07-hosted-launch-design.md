# Hosted launch: production setup (Phase 1, slice 09)

Date: 2026-11-07
Status: draft
Brief: [09-hosted-launch.md](../../roadmap/phase-1-accounts-and-preferences/09-hosted-launch.md)

## Intent

Stand up production so the launch check has a real place to run: a production Supabase project and the Vercel Production environment, configured only from dashboard and environment settings, with migrations reaching the database through CI. This spec covers the production setup and the checks that prove it works before any UI exists. The launch check itself waits for slices 07 and 08 (see [Launch check](#launch-check-to-fill-in-after-slices-07-and-08)).

## Current state

- One Supabase Cloud project, `10xjobs-dev`. The `Dev database` workflow migrates and seeds it after CI passes on `main` ([shared-dev-database.md](../../shared-dev-database.md)).
- The Vercel project is being built separately, with PR previews pointed at `10xjobs-dev`.
- There is no production Supabase project and no production Vercel environment yet.
- `docs/auth-production.md` documents the Auth settings to mirror by hand, and a manual migrate command from the maintainer's machine. This spec replaces the manual command.

## Goals

- A production Supabase project, used only by the live app.
- Vercel Production (built from `main`) pointed at it. PR previews stay on `10xjobs-dev`.
- Migrations reach production from CI, on merge to `main`, only after the maintainer approves.
- Production holds the value lists, and nothing else, from the seeds.
- A written way to confirm the setup before any UI exists.

## Non-goals

- Deploying the NestJS engine, and usage limits (Phase 2).
- Any UI.
- A staging environment. `10xjobs-dev` plays that role for previews.
- Error monitoring. Deferred; Vercel's runtime logs and Supabase's logs are enough for an invite-only app. _(my call)_
- Backups (see [Known gaps](#known-gaps)).

## Anti-goals

- A secret in git: connection strings, keys and SMTP credentials live only in GitHub environment secrets, Vercel env and the Supabase dashboard.
- A migration reaching production that hasn't first applied cleanly to `10xjobs-dev`, or without the maintainer's approval.
- The seeded test accounts (`admin@`, `recruiter@`, `candidate@xjobs.local`) existing in production.
- Migrations connecting through the transaction pooler (port 6543), or as any role other than `postgres`.
- A preview deploy, or a machine set up for dev, reading or writing production data.

## Decisions

| Question                     | Decision                                                                                                                                                                                                                                                                                                                       | Whose                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| How migrations reach prod    | A CI job on merge to `main`.                                                                                                                                                                                                                                                                                                   | user                          |
| Gate                         | The job uses a GitHub environment `production-database` (not `production`: Vercel's GitHub integration records its deploys under `Production`, and environment names ignore case) with a required reviewer (the maintainer) and is restricted to `main`. Nothing reaches production until it's approved.                       | user                          |
| Where the job lives          | A second job, `production`, in `.github/workflows/dev-database.yml`, with `needs:` on the dev job. A migration that breaks on Cloud breaks on dev first.                                                                                                                                                                       | my call                       |
| Pending runs                 | One migrate applies everything pending, so the maintainer approves the newest waiting run and can reject or ignore older ones. A `production-database` concurrency group with `cancel-in-progress: false` should leave only the newest run waiting; the builder confirms how GitHub treats a run that is waiting for approval. | my call                       |
| Steps 2 and 3 of preferences | No special handling. Before launch, production holds no user data, so dropping and renaming profile columns is harmless. The maintainer can still hold the approval until both steps have merged.                                                                                                                              | my call                       |
| Connection                   | The session pooler URL (port 5432) as `postgres`, like dev. Only `postgres` can create policies on `storage.objects` and write `storage.buckets` on Cloud (resume storage spec).                                                                                                                                               | locked by resume storage spec |
| Production seed              | `db:seed --only processor-lists,iso,cities`. Never the `users` seed.                                                                                                                                                                                                                                                           | my call                       |
| Production secrets in GitHub | Only `PROD_DATABASE_URL`. The list seeds don't use the Supabase API (`SUPABASE_URL` and the service key are optional in the seed env), so the production service-role key stays out of GitHub.                                                                                                                                 | my call                       |
| Cities in production         | A new, committed `cities` seed (see [Cities seed](#cities-seed)), so slice 07's city picker isn't empty while the engine is undeployed.                                                                                                                                                                                        | user                          |
| Production URL               | No custom domain yet. Production starts on the Vercel `*.vercel.app` production URL, which becomes the Auth Site URL and redirect URL. A domain later changes only those settings and Vercel's domain list.                                                                                                                    | user                          |
| Staging                      | None. Slice 01 decided local and production only.                                                                                                                                                                                                                                                                              | slice 01                      |
| Previews                     | Vercel Preview env points at `10xjobs-dev`; Production env points at the production project. This reverses slice 01's "previews use the production project", which predates `10xjobs-dev`.                                                                                                                                     | user                          |
| Deploy order                 | Vercel deploys `main` as soon as it merges, before the migration is approved. Accepted: before launch it doesn't matter; after launch, approve promptly and keep schema changes compatible with the code already live (add first, drop later). No Vercel token in GitHub.                                                      | my call                       |
| Supabase plan                | Free for now.                                                                                                                                                                                                                                                                                                                  | user                          |
| Backups                      | Accepted gap on Free (no restorable backups). Moving to Pro comes before anyone other than the maintainer relies on the app.                                                                                                                                                                                                   | user                          |

## The production job

Added to `.github/workflows/dev-database.yml`, after the existing dev job:

- `needs: deploy` (the dev job), `environment: production-database`, its own concurrency group `production-database`, `cancel-in-progress: false`.
- Checks out `github.event.workflow_run.head_sha`, the same commit dev just migrated.
- Env: `XJOBS_SKIP_ENV_FILES=1`, `XJOBS_ALLOW_REMOTE_DB=1`, `DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}`. No `SUPABASE_*` values.
- Steps: install, `pnpm --filter @xjobs/database db:migrate`, `pnpm --filter @xjobs/database db:seed --only processor-lists,iso,cities`.

The first production migrate runs on the first merge after the environment and secret exist, or by re-running the latest CI run on `main` (dev re-runs too, which is harmless; the seeds are idempotent).

## Cities seed

- A seed named `cities`, run after `processor-lists` (cities reference countries), with its data in a committed file beside the other value lists in `libs/database/src/seeds/vocab/`.
- Initial content: a curated starter list of major software-hiring cities (name, country code, aliases; GeoNames id left empty), reviewed by the maintainer before it's committed, because `10xjobs-dev` had no cities to export. City names aren't personal data. _(my call)_
- Idempotent upsert on (`nameKey`, `countryCode`), with `nameKey` built by the same normalizer the processor uses. It sets `status = 'approved'` and `approvedAt` if empty, merges aliases, and never touches `occurrences` or other cities. On dev it promotes a matching `proposed` city and leaves the rest alone. _(my call)_
- Later approvals on dev reach production only by adding them to this file. A `db:vocab` export helper is left to the builder.

## Dashboard checklist (the maintainer)

Done by hand, once. None of it goes in git.

**Supabase**

1. Create the production project on the Free plan, in the same region as `10xjobs-dev`. A Free organization allows two active projects; with `10xjobs-dev` this makes two.
2. Auth: every setting in the [auth-production.md](../../auth-production.md) table, both email templates with their subjects, and the Gmail SMTP sender.
3. Site URL and redirect URLs: the Vercel production URL (`<project>.vercel.app`), not a per-deployment URL.
4. Don't create the `resumes` bucket by hand: the migration creates it.

**GitHub**

5. Create the environment `production-database`: required reviewer the maintainer; deployment branches `main` only; secret `PROD_DATABASE_URL` set to the session pooler URL (port 5432).

**Vercel**

6. Production env: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the production project. Preview env keeps the `10xjobs-dev` values. No service-role key in either.
7. No custom domain for now.

## Repo changes

- The `cities` seed and its data file, with a unit test like the other seeds'.
- The `production` job in `.github/workflows/dev-database.yml`, with comments. Consider renaming the workflow to `Database`; the builder decides.
- `docs/auth-production.md`: replace the manual migrate section with a pointer to the CI job. Keep the `cron.job` check. Replace the pre-launch checklist with a link to the new doc below.
- A new `docs/production.md`: the dashboard checklist above, the verification steps below, and the known gaps. It's the runbook the maintainer follows.
- `docs/shared-dev-database.md`: note that Vercel previews use `10xjobs-dev`, so a dev reset also resets what previews see.
- `09-hosted-launch.md`: link this spec, record the decisions above, note that previews use dev, and change "Backups confirmed on" to the accepted gap on Free.

## Verification before any UI

Run in this order, after the first production migrate and before anyone is invited. SQL runs in the production project's SQL editor.

1. **Migrations applied.** The production job's log shows the migrate finishing with nothing left pending. Running `db:migrate:show` against production with the session pooler URL in the shell only reports nothing pending.
2. **Seed tables filled.** The tables the two seeds write (countries, regions, `region_countries`, techs, roles, seniorities, arrangements, contract types, engagements, junk flags, languages, currencies, cities) each have rows, and every city is `approved`. `auth.users` and `public.users` are empty: the test accounts weren't seeded.
3. **Bucket.** `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resumes'` returns `false`, `5242880`, `{application/pdf}`.
4. **pg_cron.** `select jobname, schedule from cron.job` lists `end-expired-sessions` at `0 * * * *`.
5. **Auth settings.** Compare the dashboard against the auth-production.md table, line by line. Nothing in the repo can check these.
6. **Storage policies on Cloud.** Run `apps/db-tests/src/resume-storage.db.spec.ts` once against production from the maintainer's machine, with `DB_TESTS_ALLOW_REMOTE=1`, `DATABASE_URL` (session pooler), `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` exported in that shell only, then `unset`. Afterwards, check that no `db-test-*@xjobs.test` users and no objects in `resumes` are left. This needs the resume storage work merged to `main` first.
7. **Sign-in.** `pnpm users invite <maintainer's address>` against production (as in auth-production.md), then sign in with the code and with the link. Then block or keep that account as the maintainer prefers.

## Known gaps

- **No backups on Free.** Profiles, preferences and eligibility can't be restored if lost. Resume PDFs aren't covered by database backups on any plan. Fix: move to Pro before anyone else relies on the app.
- **Free projects pause** after about a week without activity, and the live app is down until it's unpaused in the dashboard. Same fix. No keep-alive job. _(my call)_
- **Gmail deliverability** stays unproven (auth-production.md). Step 7 is the first real test.

## Launch check (to fill in after slices 07 and 08)

To be written once the setup and edit UIs exist. The brief's outline: invite a test user, sign in, complete setup, edit, and confirm a second user can't reach the first user's data, on the live app.

## Left to the builder

- Exact YAML and comments, and whether to rename the workflow.
- The exact SQL for the verification steps, and whether to collect them in a single read-only script under `scripts/`.
- Wording and layout of `docs/production.md`.
