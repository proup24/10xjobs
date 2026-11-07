# Production (Supabase Cloud and Vercel)

The runbook for the live app. The design and the reasons are in the [hosted launch spec](superpowers/specs/2026-11-07-hosted-launch-design.md). Never put a connection string, key or SMTP credential in git; they live only in GitHub environment secrets, Vercel env and the Supabase dashboard.

## What production is

- A production Supabase project, used only by the live app. It is separate from `10xjobs-dev` ([shared-dev-database.md](shared-dev-database.md)), on the Free plan, in the same region.
- The Vercel Production environment, built from `main`, served on `<project>.vercel.app`. There is no custom domain yet. That URL is the Auth Site URL and redirect URL.
- Vercel previews (pull requests) point at `10xjobs-dev`, never at production.
- No staging environment: `10xjobs-dev` plays that role for previews.
- The NestJS engine is not deployed (Phase 2).

## One-time setup

Done by hand, once, in this order. None of it goes in git.

**Supabase**

1. Create the production project on the Free plan, in the same region as `10xjobs-dev`. A Free organization allows two active projects; with `10xjobs-dev` this makes two.
2. Auth: set every setting in the [auth-production.md](auth-production.md) table, paste both email templates with their subjects, and set the Gmail SMTP sender.
3. Set the Site URL and the redirect URLs to the Vercel production URL (`<project>.vercel.app`), not a per-deployment URL.
4. Do not create the `resumes` bucket by hand: the resume storage migration creates it. That migration is not on `main` yet, so until the resume storage work is merged no bucket exists.

**GitHub**

5. Create the environment `production-database` (not `production`: Vercel's GitHub integration records its deploys under `Production`, and environment names ignore case). Set:
   - Required reviewers: the maintainer. The approval gate exists only because of this rule. If it is missing, the production job runs without approval.
   - Deployment branches and tags: Selected branches, `main` only.
   - Secret `PROD_DATABASE_URL`: the **session pooler** URL (port 5432) as `postgres`, `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. Not the transaction pooler (6543), and no other role: only `postgres` can create policies on `storage.objects` and write `storage.buckets` on Cloud.

   No `SUPABASE_*` secret is needed. The list seeds don't use the Supabase API, so the production service-role key stays out of GitHub.

**Vercel**

6. Production env: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the production project. The Preview env keeps the `10xjobs-dev` values. No service-role key in either.
7. No custom domain for now. A domain later changes only the Auth Site URL and redirect URLs and Vercel's domain list.

## How migrations reach production

The `Dev database` workflow (`.github/workflows/dev-database.yml`) has two jobs. After CI passes on a push to `main`, `deploy` migrates and seeds `10xjobs-dev`. Then the `production` job (`needs: deploy`) waits for approval on the `production-database` environment and, once approved:

1. Checks out the commit dev just migrated.
2. Runs `pnpm --filter @xjobs/database db:migrate`.
3. Runs `pnpm --filter @xjobs/database db:seed --only processor-lists,iso,cities`. The `users` seed never runs against production, so the test accounts (`admin@`, `recruiter@`, `candidate@xjobs.local`) are never created.

A migration that breaks on Cloud therefore breaks on dev first, and nothing reaches production without the maintainer's approval.

**Approving.** In the Actions tab, open the `Dev database` run and review the pending deployment to `production-database`. The `production-database` concurrency group (`cancel-in-progress: false`) may leave more than one run waiting, and which one waits can vary. Before approving, check that the run's commit is the latest on `main`. If it isn't, reject it, and the next run takes its place. One migrate applies everything pending, and migrations only go forward, so approving an older run is harmless but needs a second approval.

**The gate depends on the environment rule.** Set up the `production-database` environment (required reviewer, `main`-only deployment branches) and the `PROD_DATABASE_URL` secret before this PR merges. If the environment already exists, GitHub auto-created it with no protection rules, so add them. The approval step exists only if the environment has the required reviewer set. If the rule is missing, the job runs unapproved. Re-check the environment settings after any change to it.

**The first run.** The first production migrate runs on the first merge to `main` after the environment and secret exist, or by re-running the latest `CI` run on `main` (dev re-runs too, which is harmless; the seeds are idempotent). Re-running CI on `main` at any later time queues another production run waiting for approval. Reject it if you don't want it.

**Vercel deploys before approval.** Vercel deploys `main` as soon as it merges, before the migration is approved. Before launch that doesn't matter. After launch, approve promptly, and keep schema changes compatible with the code already live: add first, drop later (add the new column or table and ship code that uses it, then drop the old one in a later change). There is no Vercel token in GitHub.

**Cities.** Production gets cities only from the committed `cities` seed data in `libs/database/src/seeds/vocab/seed-cities.ts`. A city approved later on dev reaches production by adding it to that file.

## Verification before any UI

Run in this order, after the first production migrate and before anyone is invited. SQL runs in the production project's SQL editor. Every statement here is read-only.

1. **Migrations applied.** The production job's log shows the migrate finishing with nothing left pending. Then run `db:migrate:show` against production, with the session pooler URL exported in that shell only (as in step 6), and check that it reports nothing pending:

   ```sh
   read -rs DATABASE_URL && export DATABASE_URL   # paste the session pooler URL (port 5432)
   pnpm --filter @xjobs/database db:migrate:show
   unset DATABASE_URL
   ```

2. **Seed tables filled.** Each table the seeds write has rows, and every city is `approved`. The test accounts weren't seeded, so both user tables are empty.

   ```sql
   select 'countries' as tbl, count(*) from public.countries
   union all select 'regions', count(*) from public.regions
   union all select 'region_countries', count(*) from public.region_countries
   union all select 'tech_tags', count(*) from public.tech_tags
   union all select 'role_kinds', count(*) from public.role_kinds
   union all select 'seniorities', count(*) from public.seniorities
   union all select 'arrangements', count(*) from public.arrangements
   union all select 'contract_types', count(*) from public.contract_types
   union all select 'engagements', count(*) from public.engagements
   union all select 'junk_flags', count(*) from public.junk_flags
   union all select 'iso_languages', count(*) from public.iso_languages
   union all select 'iso_currencies', count(*) from public.iso_currencies
   union all select 'cities', count(*) from public.cities;
   ```

   Every count must be above zero. Then:

   ```sql
   select status, count(*) from public.cities group by status;   -- only 'approved'
   select count(*) from auth.users;                               -- 0
   select count(*) from public.users;                             -- 0
   ```

3. **Bucket.** Only once the resume storage work is merged; until then expect no rows, and skip this step. After that it returns `false`, `5242880`, `{application/pdf}`:

   ```sql
   select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resumes';
   ```

4. **pg_cron.** The list includes `end-expired-sessions` at `0 * * * *`:

   ```sql
   select jobname, schedule from cron.job;
   ```

5. **Auth settings.** Compare the dashboard against the [auth-production.md](auth-production.md) table, line by line. Nothing in the repo can check these.

6. **Storage policies on Cloud.** This needs the resume storage work merged to `main` first. Run `apps/db-tests/src/resume-storage.db.spec.ts` once against production from the maintainer's machine, with the values exported in that shell only:

   ```sh
   read -rs DATABASE_URL && export DATABASE_URL   # session pooler URL (port 5432)
   export SUPABASE_URL=https://<project-ref>.supabase.co
   read -rs SUPABASE_ANON_KEY && export SUPABASE_ANON_KEY
   read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
   export DB_TESTS_ALLOW_REMOTE=1
   pnpm db:test -- resume-storage   # the filter runs only that spec
   unset DATABASE_URL SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY DB_TESTS_ALLOW_REMOTE
   ```

   Check the target host before you run it. Afterwards, confirm nothing was left behind:

   ```sql
   select count(*) from auth.users where email like 'db-test-%@xjobs.test';   -- 0
   select count(*) from storage.objects where bucket_id = 'resumes';           -- 0
   ```

7. **Sign-in.** Run `pnpm users invite <maintainer's address>` against production (see [auth-production.md](auth-production.md)), then sign in with the code and with the link. Then block or keep that account as you prefer. This is also the first real test of Gmail deliverability.

## Known gaps

- **No backups on Free.** Profiles, preferences and eligibility can't be restored if lost. Resume PDFs aren't covered by database backups on any plan. Fix: move to Pro before anyone other than the maintainer relies on the app.
- **Free projects pause** after about a week without activity, and the live app is down until it's unpaused in the dashboard. There is no keep-alive job. Moving to Pro fixes this too.
- **Gmail deliverability** stays unproven ([auth-production.md](auth-production.md)). Verification step 7 is the first real test. If emails land in spam or get throttled, switch to Resend or Postmark; only the SMTP settings change.

## Launch check

To be written after slices 07 and 08, once the setup and edit UIs exist. The outline: invite a test user, sign in, complete setup, edit, and confirm a second user can't reach the first user's data, on the live app.
