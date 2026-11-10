# 10xjobs

10xjobs is an open-source job-search automation workspace for software engineers. It finds jobs from LinkedIn, Ashby and Greenhouse, applies to them with care, and tracks the whole pipeline. It aims for precision over volume: the right jobs, applied to well.

## Status

Early: Phase 0, foundation.

## Quick start

```sh
npm ci
npx nx serve xjobs
```

## Local stack

Supabase runs locally through the Supabase CLI (Docker required); Compose only runs Redis. In order:

1. `pnpm db:start` starts Supabase (API 54321, Postgres 54322, Studio 54323, Mailpit 54324).
2. Copy `.env.example` to `.env`, fill `SUPABASE_SERVICE_ROLE_KEY` from `pnpm db:status`, and set `ENGINE_API_KEY` (at least 32 characters: `openssl rand -base64 48`). Every engine route requires it in the `X-Engine-Key` header.
3. `pnpm db:migrate`, then `eval "$(scripts/supabase-env.sh)"` and `pnpm db:seed`. The seed needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` because it creates `admin@`, `recruiter@` and `candidate@xjobs.local` as Supabase Auth users; a sign-up trigger adds their `public.users` rows.
4. `pnpm infra:redis` starts Redis.
5. `npx nx serve xjobs` runs the engine.
6. For the web app, copy `apps/web/.env.example` to `apps/web/.env.local` and fill `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from `pnpm db:status`. Also set `ENGINE_URL` (`http://localhost:3000`) and the same `ENGINE_API_KEY` as the engine. Then `npx nx dev web` serves on http://localhost:3001.

Migration refs: after `prisma migration ref set` or advancing the `db` ref in `libs/database/src/migrations/app/refs/db.json`, re-add `"end-expired-sessions"` to its `invariants`. Prisma writes `invariants: []`, and fresh databases would then skip the session-cleanup cron job.

`pnpm db:stop` stops the stack, and `pnpm db:reset` wipes it and re-applies migrations and the seed (it loads those two variables itself). The old self-hosted Compose stack is retired: its data and your old `.env` are not carried over, so build a fresh `.env` from `.env.example`.

Users are created through Supabase Auth. A stack started before the engine-auth change signs HS256 tokens, which the engine refuses: restart it with `pnpm db:stop && pnpm db:start` so it issues ES256 tokens. The e2e suite needs the same two variables, so run `eval "$(scripts/supabase-env.sh)"` before `npx nx e2e xjobs-e2e`.

### Signing in locally

Public sign-up is off, so invite yourself: `eval "$(scripts/supabase-env.sh)" && pnpm users invite you@xjobs.test`. Read the email at http://127.0.0.1:54324 (Mailpit), then open the link or type the 6-digit code on http://localhost:3001/sign-in. The seeded users (`admin@`, `recruiter@` and `candidate@xjobs.local`) can sign in by requesting a code there. Production setup is in [docs/auth-production.md](docs/auth-production.md).

### Two database modes

- **Local stack** (above): your own Supabase in Docker. Use it for schema work. `pnpm db:reset` wipes and rebuilds it.
- **Shared dev database**: one hosted Supabase project that CI migrates and seeds after every merge to `main`. Use it for engine and web work that needs no schema change. Setup and daily use are in [docs/shared-dev-database.md](docs/shared-dev-database.md).

## Debugging xjobs

In VS Code, set a breakpoint in `apps/xjobs/src`, select **Debug @xjobs/xjobs with Nx** in Run and Debug, and press **F5**.

To start from a terminal:

```sh
pnpm exec nx serve @xjobs/xjobs --inspect=inspect --port=9229
```

Then select **Attach to xjobs (9229)** in VS Code and press **F5**. Use `--inspect=inspect-brk` instead to pause before startup code runs. Nx rebuilds and restarts the app as you edit; the attach configuration reconnects automatically.

## Deploy

The web app (`apps/web`) runs on Vercel at https://10xjobs.vercel.app, against the shared dev database `10xjobs-dev`. There is no production project yet ([production.md](docs/production.md)). Vercel deploys `main` to that URL, and every pull request gets a preview behind Vercel's login.

Vercel project settings:

- Root Directory: `apps/web`, with files outside the root directory included (the build needs `libs/`).
- Build Command: `cd ../.. && NX_NO_CLOUD=true pnpm exec nx build web`. Nx builds `@xjobs/database` first; a plain `next build` fails because the app imports the compiled library.
- Install Command and Output Directory: the defaults.

Environment variables, the same for Production and Preview:

| Name                                   | Value                                  |
| -------------------------------------- | -------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://<ref>.supabase.co` (dev)      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the dev project's publishable key      |
| `ENABLE_EXPERIMENTAL_COREPACK`         | `1` (uses the pinned `packageManager`) |

No other Supabase variable is set in Vercel, and never the service-role key.

## Documentation

- [Redis, caching, pub/sub, and background workers](docs/redis-jobs.md)
- [Auth setup for production](docs/auth-production.md)
- [Shared dev database](docs/shared-dev-database.md)
- [Roadmap](docs/roadmap/README.md)
- [CLAUDE.md](CLAUDE.md): conventions and workflow for working in this repo with Claude Code

## License

MIT
