# Stepped migrate: design

Platform slice 01 (`docs/roadmap/platform/01-migration-squash.md`). Brainstormed 2026-11-24. This replaces the brief's leading direction, a squash.

## Intent

`prisma db migrate --to db` must run in well under a gigabyte again: on CI, for `pnpm db:reset` and for the processor test database. It must stay that way as migrations keep coming, without anyone having to remember to do something every week or two. Today a fresh local setup doesn't work at all, and CI only passes because the heap is at 12 GB (commit `7eafb80a`).

## What we found (2026-11-24, `main` at `59757fc1`)

- **The planner's search grows exponentially, by design.** `findPathWithInvariants` in `@prisma/orm-toolchain` runs a breadth-first search over (node, set of required invariants collected so far). 19 of the 64 migrations leave the hash unchanged, so each is an optional detour, and the reachable sets double with each one. Peak memory planning `--from @empty`: 12 invariants 0.33 GB, 16 0.68 GB, 20 2.7 GB, 32 over 12 GB.
- **`rc.25` doesn't change it.** It only runs with the matching CLI (`prisma` `8.0.0-rc.35`, `@prisma/cli-engine` `0.10.4`). With the current `rc.28` CLI it fails with "Cannot use 'in' operator to search for 'kind' in typeChoice". Once matched, it measures the same: 0.33 / 0.70 / 2.7 GB at 12 / 16 / 20.
- **The marker's invariants are not searched.** Before searching, the planner computes `required = ref.invariants − marker.invariants` (`resolveRecordedPath` and `aggregate-*.mjs` in the toolchain; the `rc.28` CLI loads `@prisma/orm-toolchain` `8.0.0-rc.20`, which has the same logic) and starts from the marker's hash. So a database whose marker already holds the earlier invariants only pays for the new ones. Dev's marker holds all 32: **the Dev database deploy is not at risk.** It only plans for what a new PR adds. Only a fresh database pays the full cost: CI's database and e2e jobs, `pnpm db:reset`, and the processor/ingest test databases.
- The graph is close to linear. There are 64 migration folders, the first with `from: null`. One node has a second hash-changing out-edge, `20261107T1539_verification_steps_requirement_tags` (`1cfd25…` → `f0cc0f…`). It is a dead end that no route uses, which is why dev's `prisma_contract.ledger` has 63 `app` rows, not 64. The route to `db` is unique.
- The busiest node (`692de7…`) gets 4 invariants from its loop migrations, and the largest single edge (`20261121T1131_profile_edits`) provides 5.
- **Not yet run end to end:** the stepping rests on reading the planner. Nobody has yet migrated a fresh database to an intermediate ref and then to `db`. The first build task proves it (see Proof it's safe).
- **Gate passed 2026-11-24:** two hand-written step refs migrated a fresh database, at 332/318 MB peak; the marker held each step's hash and invariants.

## Goals

- A fresh database migrates with every step's peak memory under 1 GB, and the migrate heap comes down from 12 GB.
- It stays under that as invariants are added, with no recurring chore.
- The end state is exactly the one a single `--to db` produces: the same migrations applied, in the same order, with the same marker.
- `pnpm db:migrate` keeps its name (it takes no extra arguments: the CLI refuses any, since a per-step `--show` or dry run can't work on a fresh database, and no caller passes any today), so `CLAUDE.md`, the docs and the workflows need no change in how they call it.

## Non-goals

- Squashing or rewriting the migration history. The 64 migration folders and the 23 MB of snapshots stay.
- Upgrading Prisma. The `rc.25` test was throwaway, and the upgrade is its own change.
- Changing how new migrations are written.
- Production (there is no production project).

## Anti-goals (failure even if it works)

- A fresh database ending with different invariants, or with a loop migration skipped. The project memory records how a migration can silently never apply. The wrapper must never make that easier to miss.
- A wrapper that hides or swallows Prisma's errors, or that leaves temporary files in the repo after a failed run.
- Weakening the remote guard (`assert-local.cli.ts`, `XJOBS_ALLOW_REMOTE_DB=1`).

## Approaches considered

1. **Stepped migrate (picked).** A wrapper behind `db:migrate` walks the history in steps. Each step migrates to a temporary ref placed at a point along the chain, holding the invariants up to that point. Each step searches only the few invariants the marker doesn't hold yet. The history stays as it is, nothing needs re-doing, and no branch ever has to rebase onto a new baseline. Costs: a wrapper in front of Prisma; it leans on the marker subtraction above; fresh setups slow down linearly as the history grows.
2. **Replay squash with a `db:squash` script and a CI threshold.** One baseline from empty to today providing all 32 invariants. At the pace so far (32 invariants in 24 days), a threshold of about 12 means re-squashing every ~9 days, each time rewriting history under in-flight branches. Rejected for that recurring cost.
3. **Re-plan squash.** Plan from empty, then carry over the rawSql still needed by hand. Rejected: the riskiest version of option 2.

The user picked option 1.

## Design

### Where it lives

- `libs/database/src/migrations-step/` (new): the step planner as a pure module, the CLI that runs it, and their specs. The pure part takes the migration folders' `migration.json` files, the `db` ref and the marker, and returns the steps. The CLI does the I/O.
- `libs/database/package.json`: `db:migrate` becomes `tsx src/env/assert-local.cli.ts && tsx src/migrations-step/migrate.cli.ts`. The remote guard runs first, unchanged.

### How it steps

1. **Read the marker.** Read space `app`'s row in `prisma_contract.marker` (core hash and invariants) through the same connection Prisma uses (`DIRECT_DATABASE_URL ?? DATABASE_URL`). If there is no schema or no row, the database is fresh: start from `empty` with no invariants.
2. **Find the route.** Follow hash-changing edges from the marker's hash to the `db` ref's hash. Pick the route the planner itself takes: the shortest one, with the same tie-break (`createdAt`, then `to`, then `migrationHash`). Today it's unique, since the only fork is a dead end, but a future fork must resolve the same way. If the marker's hash isn't on any route to the ref's hash, stop with a clear error. Don't guess.
3. **Place the steps.** Walk the route's nodes in order. At each node, the invariants that come due are the ones its loop migrations provide, plus those of the edge into it. Close a step at a node once adding the next node's new invariants would take the step past **8 required invariants not in the marker**. Count only invariants that are in the `db` ref and not in the marker. The last step is always the real `db` ref, unchanged.
4. **Run each step.** For each step except the last, write `src/migrations/app/refs/step-<run>-<n>.json` with `{ hash, invariants }`. `<run>` is unique per run (for example the pid), because several sessions share a checkout. The name can't start with `.`: Prisma's `validateRefName` refuses it. Never fall back to `--to <hash>`: a raw hash carries no invariants, so the planner would skip every loop migration silently, where `invariants` holds every ref invariant due up to that node (not only the step's own). Then run `prisma db migrate --to step-<run>-<n>` with `--max-old-space-size=2048`. The last step runs `--to db`. Prisma's output streams through unchanged, and the first non-zero exit stops the run with that exit code.
5. **Clean up.** Delete this run's step refs in a `finally`, including on failure and on SIGINT. `.gitignore` ignores `libs/database/src/migrations/app/refs/step-*.json` as a second line of defence. The real refs (`db.json`) never use the `step-` prefix.

The step size of 8 is my call: 8 invariants cost about 0.3 GB, and fewer, larger steps keep a fresh setup fast. It's one exported constant.

An already-migrated database (dev, or a local database one PR behind) has one step, `--to db`, the same as today.

If one node ever carries more than 8 required invariants, the step at that node goes over the cap. The CLI then prints a warning naming the node and runs it anyway. Only an upstream fix or a squash can help there, and it's unlikely: today's maximum per node is far below that.

### Other callers

- `db:migrate:show` stays a single `prisma db migrate --show` with the heap at 2048. It's only used against migrated databases (production docs, dev checks), where the marker keeps it cheap.
- The CI database and e2e jobs, Dev database, `pnpm db:reset` and the processor test recipe all call `db:migrate`, so they pick it up with no change.

### Upstream report

Draft an issue for the prisma-next team in the PR description: the measured table, the cause (BFS over node × collected subset, with self-loop migrations as optional detours), and the cheap fix on a linear history (self-loops that provide required invariants are mandatory, so take them greedily). The user files it. Claude doesn't post outside the repo.

## Proof it's safe

- **Unit specs on the step planner:** a fresh chain cut into steps of at most 8, with each step's ref invariants cumulative; a marker partway along starting at its node and leaving out its invariants; a marker at the head giving one `--to db` step; a synthetic fork resolved like the planner's tie-break, and a dead-end branch never taken; a marker hash off every route raising an error; a node with more than 8 invariants giving one oversized step and a warning.
- **First, the mechanism (a gate before the rest is built):** on a fresh `processor_test`-style database, write one step ref by hand partway along the chain, run `--to` it and then `--to db`. Check that both pass, that the marker after step one holds the step's hash and invariants, and that the `supabase` space plans cleanly on both. If it fails, stop and bring it back to the user.
- **Against the real history,** on a fresh local database (the `processor_test` recipe, or the local stack after `db:reset`):
  - Every step's peak RSS is under 1 GB (`/usr/bin/time -v`), and the total time is recorded in the PR.
  - The final marker equals dev's: core hash `b5852fb8…` and the same 32 invariants (dev read with the read-only `supabase-dev` MCP).
  - The ledger lists the same 63 `app` migrations in the same order as dev's ledger (compare the rows, not a count).
  - A catalog digest of tables, columns, RLS policies, functions (with a body hash), triggers, grants and the `cron.job` rows matches dev's. Both are read with the same SQL query: local through `psql`, dev through `supabase-dev`.
  - Running `db:migrate` a second time does nothing.
- **CI:** the database and e2e jobs go green with the heap at 2048 per step.
- **Dev:** the first Dev database run after merge logs a single `--to db` step and applies nothing.

## Docs and memory

- `docs/shared-dev-database.md`: one line saying `db:migrate` steps a fresh database, and why.
- The roadmap brief gets a status line pointing at this spec, with "Squash" marked as not chosen.
- Memory: update `migrate-heap-limit` (stepped migrate replaces the squash plan; marker subtraction; rc.25 result) and `migration-ref-hash` (`step-*` refs are temporary, never committed).

## Left to the builder

- How the CLI reads the marker: `pg` directly, or Prisma's own runtime client if it exposes it cleanly.
- How it runs Prisma: a child process of `prisma` from `node_modules/.bin`, with `NODE_OPTIONS` set per child.
- The exact catalog digest query, as long as it covers the objects listed above.
