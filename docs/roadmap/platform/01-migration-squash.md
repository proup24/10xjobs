# 01: Migration squash

Status: built as a stepped migrate in PR #131 (verified on Dev 2026-11-25); the squash was not chosen. Raised 2026-11-24, after PR #127's CI database job ran out of memory. Left: file the prisma-next issue about the planner's memory growth.

**Brainstormed 2026-11-24:** the direction is a stepped migrate, not a squash. See [the design](../../superpowers/specs/2026-11-24-stepped-migrate-design.md). `rc.25` was tested and doesn't change the planner's growth. The squash sections below are kept as history.

## Goal

`prisma db migrate --to db` runs in well under a gigabyte again: on CI, on the Dev database deploy, and locally for `pnpm db:reset`. It stays that way as the app grows, and we get warned well before it doesn't.

## Why now

- PR #124 had to drop a migration to pass CI (2026-11-23).
- PR #127 needed the migrate heap raised from 8 GB to 12 GB (commit `7eafb80a`) _(user: raise now, squash in its own PR)_.
- Locally, a full migrate runs out of memory even at 12 GB, so `pnpm db:reset` and a fresh local setup don't work today.
- GitHub runners have 16 GB, so raising the heap again buys little.

## What we know (measured 2026-11-24, on `main` at `93b659eb`)

- **It's the invariants, not the number of migrations.** The `db` ref (`libs/database/src/migrations/app/refs/db.json`) requires 32 invariants. Each one is provided by a rawSql migration: a function, a backfill or an RLS fix. 19 of the 64 migrations leave the contract hash unchanged, so they are loops in the migration graph, and the planner tries combinations of them to find a route that collects every required invariant.
- **The cost grows exponentially with the invariants required.** Planning `--show --from @empty` to a temporary ref with the same hash and only the first k invariants:

  | Invariants required | Peak memory | Time |
  | ------------------- | ----------- | ---- |
  | 12                  | 0.33 GB     | 2 s  |
  | 16                  | 0.68 GB     | 5 s  |
  | 20                  | 2.7 GB      | 25 s |
  | 32 (today)          | over 12 GB  | n/a  |

  Planning to a migration folder name (no invariants required) takes 0.3 GB at any point in the history.

- **Dev is safe to squash under.** Dev's `prisma_contract.marker` for space `app` records core hash `b5852fb8…` and all 32 invariants. A baseline migration from empty to that hash, providing all 32, should leave dev with nothing to apply. The ledger (64 rows) is history and isn't read for routing.
- **Prisma `8.0.0-rc.25` is out** (we're on `rc.21`). It might plan this differently. Not tested.

## The direction so far _(not yet decided; the brainstorm settles it)_

- **Replay** is the leading approach: one baseline migration whose steps are every old migration's steps, in order, from empty to the current hash, providing every invariant. It matches the old history by construction. **Re-plan** (plan from empty, then copy over only the rawSql still needed) gives cleaner output but makes the schema-dump diff the only safety net.
- **The problem comes back.** Every new invariant after the baseline counts again: past about 12 it starts to cost, past about 20 it takes gigabytes. At the pace so far (32 in 24 days), that is weeks, not months. So:
  - make the squash a repeatable script (`db:squash`), not a one-off edit;
  - add a CI check that fails with "re-squash migrations" once the invariants since the baseline pass a threshold (about 12);
  - report the planner's growth to the prisma-next team, and test whether `rc.25` fixes it.

## In scope

- The baseline migration, the `db` ref and the snapshots: the 45 snapshot folders the baseline doesn't import go (about 23 MB).
- The repeatable squash script and the CI threshold check.
- Proof the squash is safe:
  - a schema dump (tables, RLS policies, functions, triggers, grants, the cron job) after migrating from empty on the old history and on the squashed one, with no difference;
  - `prisma db migrate --show` against a database at dev's marker reports nothing to apply.
- Putting the migrate heap back down once it's no longer needed.
- Updating the project memory and `CLAUDE.md` if commands change.

## Out of scope

- Upgrading Prisma (its own change, tested separately).
- Changing how new migrations are written, unless the brainstorm finds a convention that avoids the loops.
- Production: there is no production project yet.

## Open questions

- Replay or re-plan?
- The threshold for the CI check, and whether it fails or warns.
- How to prove dev routes cleanly without credentials in this repo: a local database restored to dev's marker, or a read-only `--show` run by the Dev database workflow before it applies.
- Whether to wait for the `rc.25` test first: if it fixes the planner, the squash may only be needed for speed.
- Ordering against open PRs that add migrations: they must rebase onto the baseline and keep providing their invariants.
