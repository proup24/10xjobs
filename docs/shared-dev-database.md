# Shared dev database (Supabase Cloud)

One hosted Supabase project, `10xjobs-dev`, is the shared dev database. Use it when you work on the engine or the web app and do not need to change the schema. For schema work, use the local stack. A GitHub workflow migrates and seeds the dev project after CI passes on `main`, so nobody migrates it by hand.

## One-time setup (the human)

1. Create the Supabase project `10xjobs-dev`.
2. Mirror the auth settings, the Gmail SMTP sender and the email templates as in [auth-production.md](auth-production.md). Set up SMTP first: Supabase only lets you edit the templates once custom SMTP is on, and without the repo's templates the emails carry a link the app can't use and no code. Set the Site URL to `https://10xjobs.vercel.app` and the redirect URLs to `https://10xjobs.vercel.app/**` and `http://localhost:3001`. Email links then open the Vercel app; locally, sign in with the code.
3. Storage: create a private bucket named `resumes`.
4. In GitHub, create the environment `dev` with three secrets:
   - `DEV_DATABASE_URL`: the **session pooler** URL (port 5432), `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. Not the transaction pooler (6543).
   - `DEV_SUPABASE_URL`: `https://<ref>.supabase.co`.
   - `DEV_SUPABASE_SERVICE_ROLE_KEY`: the service-role key from Project Settings, API.

   Then restrict the environment: Deployment branches and tags, Selected branches, `main` only. No other branch's workflow can then read the secrets.

5. Merge `.github/workflows/dev-database.yml` to `main`. A `workflow_run` workflow only takes effect once it is on `main`. Add the secrets before merging; the merge's CI run triggers the first migrate and seed. To re-run later, re-run the latest CI run on `main`.

The workflow (`.github/workflows/dev-database.yml`) runs after `CI` succeeds on a push to `main`: it migrates, then seeds.

## Daily work

Point your env at the shared project. In the root `.env`, replace the local values with the commented shared-dev block from `.env.example`: `DATABASE_URL` (session pooler), `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. In `apps/web/.env.local`, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the dev project's API settings. Then run `npx nx serve xjobs` and `npx nx dev web` as usual.

The hosted engine owns every schedule, collection and sweeps alike. Local workers register none, so they only run jobs someone triggers. Do not set `XJOBS_RUN_SCHEDULES` locally.

Vercel previews use `10xjobs-dev`, so resetting dev also resets what previews see.

Print a sign-in link instead of waiting for an email. The users CLI reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the root `.env` (shell values win):

```sh
pnpm users link you@example.com
```

It prints a sign-in link through `/auth/confirm` and sends nothing. The link points at `http://localhost:3001`; set `WEB_URL` to use another host. A user with no profile lands on `/setup` after signing in. The seed creates `admin@`, `recruiter@` and `candidate@xjobs.local`; link one of those to sign in as a seeded user.

## Schema work

Schema changes go through the local stack, never the shared project:

1. Comment out the shared values in `.env` (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and restore the local ones, in `apps/web/.env.local` too. Leftover shared values point local commands at the shared project.
2. `pnpm db:start`, then `pnpm db:reset`.
3. Edit the contract, run `pnpm --filter @xjobs/database db:migration:plan`, then `pnpm db:migrate`, `pnpm db:types` and `pnpm db:test`.

Merging to `main` applies the migration to the dev project.

`db:migrate`, `db:update`, `db:init` and `db:seed` refuse any non-local `DATABASE_URL`, `DIRECT_DATABASE_URL` or `SUPABASE_URL` unless `XJOBS_ALLOW_REMOTE_DB=1` is set. The documented `pnpm` commands read the flag only from the shell or CI environment, not from `.env` (Nx loads `.env` into task env, so it could take effect through `nx run`). Pass it inline and never put it in `.env`. Never run it from your own machine against the dev project; CI does that.

## Recovery

If the dev database drifts from the migrations (a manual change, a failed migration), reset it in the dashboard and re-run the latest `CI` run on `main` from the Actions tab (this queues a production run too; reject it). The `Dev database` workflow then migrates and seeds from scratch.
