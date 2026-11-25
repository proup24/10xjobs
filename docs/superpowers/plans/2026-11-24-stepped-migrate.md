# Stepped migrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm db:migrate` migrates a fresh database in steps of at most 8 new invariants each, so every Prisma run peaks under 1 GB and the heap comes down from 12 GB to 2 GB.

**Architecture:** A pure step planner (`plan-steps.ts`) reads the migration graph, the `db` ref and the database's marker, and returns the steps. A thin runner (`run-stepped.ts`) writes a temporary ref per step, runs `prisma db migrate --to <ref>` for each one, and always cleans up. `migrate.cli.ts` wires in the real file system, `pg` and the child process. `db:migrate` calls the CLI after the unchanged remote guard.

**Tech Stack:** TypeScript (nodenext, strict), Vitest, `tsx`, `pg` 8, Prisma `8.0.0-rc.28` CLI (toolchain `rc.20`), Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-11-24-stepped-migrate-design.md`

## Global Constraints

- Step cap: `STEP_INVARIANT_CAP = 8` required invariants (in the `db` ref and not in the marker) per step.
- Heap per Prisma child: `NODE_OPTIONS=--max-old-space-size=2048`, for both `db:migrate` steps and `db:migrate:show`.
- Temporary ref names: `step-<run>-<n>` in `libs/database/src/migrations/app/refs/`, where `<run>` is `process.pid` and `<n>` starts at 1. Never a leading `.` (Prisma's `validateRefName` refuses it). Never `--to <raw hash>`.
- The last step is always `--to db`, the real ref, unchanged.
- The CLI takes no arguments. Any argument means exit code 2 with a message, and no Prisma run.
- The remote guard (`src/env/assert-local.cli.ts`) runs first, unchanged.
- No changes to migration folders, snapshots, `refs/db.json` or the `supabase` space.
- Work in a worktree on `feat/stepped-migrate`, branched from `origin/main` after the spec PR (`docs/stepped-migrate`) has merged, or stacked on it. Never `git switch` the main checkout (other sessions share it).

## Review Focus

1. **A `db` ref invariant that no migration on the route provides** (typo, or it lives on the dead-end branch): expect a clear error naming the invariant before any Prisma run, not an out-of-memory error or an opaque planner error. Pinned in Task 2 (`throws when a ref invariant is provided nowhere on the route`).
2. **A local database migrated on another branch,** so its marker hash isn't on main's graph: expect an error naming the hash and saying to reset, with no Prisma run. Pinned in Task 2 (`throws when the marker hash is off the route`).
3. **A PR that adds only a same-hash migration** (the most common case): marker at the head hash, one invariant missing. Expect a single `--to db` step. Pinned in Task 2 (`marker at head with a missing loop invariant gives one db step`).
4. **Two runs at once in a shared checkout:** each run removes only its own `step-<pid>-*` files. Pinned in Task 3 (`removes only its own step refs`).
5. **A failed step or Ctrl-C:** no `step-*.json` is left behind, and the exit code is Prisma's. Pinned in Task 3 (`stops at the first failing step and cleans up`, `cleans up when the runner throws`). SIGINT is checked by hand in Task 4.

---

### Task 1: Gate: prove stepping works on a fresh database

No code is committed except a one-line result in the spec. **If any check fails, stop and bring the output back to the user.**

**Files:**

- Modify: `docs/superpowers/specs/2026-11-24-stepped-migrate-design.md` (one bullet under "What we found")
- Scratch (not committed): `refs/step-gate-1.json`, `refs/step-gate-2.json`

- [ ] **Step 1: Start a private throwaway database container.** Follow the `processor_test` recipe in `apps/xjobs` (the processor README), with these changes: container `xjobs-stepped-test`, port `127.0.0.1:54398`, database `stepped_test`, `-c cron.database_name=stepped_test`. Don't touch the shared `xjobs-processor-test` container or the local stack's database. `URL=postgresql://supabase_admin:postgres@127.0.0.1:54398/stepped_test`.

- [ ] **Step 2: Pick two step points by hand.** Walk `libs/database/src/migrations/app/*/migration.json` in name order along the route (skip `20261107T1539_verification_steps_requirement_tags`, the dead end). Point 1 is the last node whose cumulative `db`-ref invariants are ≤ 8. Point 2 is the last node whose invariants beyond point 1 are ≤ 8. Write `refs/step-gate-1.json` as `{ "hash": <point 1>, "invariants": [cumulative to point 1] }`, and `step-gate-2.json` the same way for point 2 (cumulative from the start).

- [ ] **Step 3: Run both steps.** From `libs/database`:

```bash
XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=$URL NODE_OPTIONS=--max-old-space-size=2048 /usr/bin/time -v npx prisma db migrate --to step-gate-1
XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=$URL NODE_OPTIONS=--max-old-space-size=2048 /usr/bin/time -v npx prisma db migrate --to step-gate-2
```

Expected: both exit 0, and "Maximum resident set size" is under 1,000,000 kB for each.

- [ ] **Step 4: Check the marker after each step.** Run `select core_hash, invariants from prisma_contract.marker where space = 'app'`. Expected: after step 1 the hash and invariants are point 1's; after step 2 they're point 2's. Also check that the `supabase` space row exists with hash `110ad99e…`, and that `prisma_contract.ledger` holds the folders up to point 2, including each loop migration.

- [ ] **Step 5: Record the result and clean up.** Delete both `step-gate-*.json` files. Keep the container for Task 4. Add a bullet under "What we found" in the spec: "Gate passed 2026-11-2x: two hand-written step refs migrated a fresh database, at <rss1>/<rss2> MB peak; the marker held each step's hash and invariants." Then commit:

```bash
git add docs/superpowers/specs/2026-11-24-stepped-migrate-design.md
git commit -m "docs(spec): stepped migrate gate result"
```

---

### Task 2: Step planner (pure)

**Files:**

- Create: `libs/database/src/migrations-step/plan-steps.ts`
- Test: `libs/database/src/migrations-step/plan-steps.spec.ts`

**Interfaces:**

- Produces:

```ts
export const STEP_INVARIANT_CAP = 8;
export interface MigrationEdge {
  dirName: string;
  from: string | null; // null only for the first migration (empty database)
  to: string;
  providedInvariants: string[];
  createdAt: string;
  migrationHash: string;
}
export interface RefFile {
  hash: string;
  invariants: string[];
}
export interface Marker {
  coreHash: string;
  invariants: string[];
}
export interface Step {
  target: 'db' | RefFile; // 'db' only for the last step
  node: string; // the hash the step ends at
  newInvariants: string[]; // required invariants this step collects
  oversized: boolean; // newInvariants.length > STEP_INVARIANT_CAP
}
export function planSteps(edges: MigrationEdge[], dbRef: RefFile, marker: Marker | null): Step[];
export class StepPlanError extends Error {}
```

Algorithm, where the signature and tests leave a choice:

- **Route:** BFS over hash-changing edges (`from !== to`) from `marker?.coreHash ?? null` to `dbRef.hash`, shortest path. Ties go to the lower `(createdAt, to, migrationHash)`, the planner's `compareTieBreak` order.
- **Due at a node:** the `providedInvariants` of the edge into it, plus those of every loop edge (`from === to === node`). Required means in `dbRef.invariants` and not in `marker.invariants`.
- **Steps:** greedy along the route. Before adding a node's due invariants, close the current step at the previous node if `current + due > 8` and `current > 0`. A step's `RefFile.invariants` is every required invariant due from the route start up to its node. The final open step becomes `target: 'db'` with `node = dbRef.hash`.

- [ ] **Step 1: Write the failing tests.** Build fixtures with a `chain(...)` helper (edges `h0→h1→…`, loops on chosen nodes). Tests:

```ts
it('fresh chain is cut into steps of at most 8, cumulative ref invariants', () => {
  // 20 invariants: 4 loops × 3 on h1..h4, 8 on edge into h5
  const steps = planSteps(edges, dbRef, null);
  expect(steps.map((s) => s.newInvariants.length)).toEqual([6, 6, 8]);
  expect((steps[1].target as RefFile).invariants).toHaveLength(12);
  expect(steps.at(-1)!.target).toBe('db');
});
it('marker partway starts at its node and leaves out its invariants', ...);
  // steps[0].newInvariants contains none of marker.invariants; no step's node precedes the marker
it('marker at head with a missing loop invariant gives one db step', () => {
  expect(planSteps(edges, dbRef, { coreHash: head, invariants: allButOne })).toEqual([
    { target: 'db', node: head, newInvariants: [missing], oversized: false },
  ]);
});
it('marker at head with every invariant gives one db step with nothing new', ...);
it('resolves a fork by createdAt, then to, then migrationHash', ...);
it('never routes into a dead-end branch', ...); // shape of 20261107T1539
it('a node with more than 8 due invariants is one oversized step', () => {
  expect(steps.find((s) => s.oversized)?.newInvariants).toHaveLength(9);
});
it('throws when the marker hash is off the route', () => {
  expect(() => planSteps(edges, dbRef, { coreHash: 'feedface', invariants: [] })).toThrow(/feedface.*db:reset/);
});
it('throws when a ref invariant is provided nowhere on the route', () => {
  expect(() => planSteps(edges, { ...dbRef, invariants: [...dbRef.invariants, 'nope'] }, null)).toThrow(/nope/);
});
```

- [ ] **Step 2: Run them and confirm they fail.** Run `npx nx test @xjobs/database -- plan-steps`. Expected: FAIL, cannot resolve `./plan-steps`.

- [ ] **Step 3: Implement `planSteps` in `plan-steps.ts`** as described above. The error messages must name the offending hash or invariant, and the off-route error says "run pnpm db:reset".

- [ ] **Step 4: Run them and confirm they pass.** Run `npx nx test @xjobs/database -- plan-steps`. Expected: PASS.

- [ ] **Step 5: Check it against the real history.** Add one test, `real history from empty: every step ≤ 8, last is db, all 32 covered`. It loads the real `migration.json` files and `refs/db.json` through `loadEdges`/`loadDbRef` (see Task 3; implement those two readers here in `plan-steps.ts` as `loadEdges(appDir: string): MigrationEdge[]` and `loadDbRef(appDir: string): RefFile`, skipping `refs/`). Assert no step is oversized, the union of `newInvariants` equals `dbRef.invariants`, and no step's node is `f0cc0f…` (the dead end's target).

- [ ] **Step 6: Commit.**

```bash
git add libs/database/src/migrations-step/plan-steps.ts libs/database/src/migrations-step/plan-steps.spec.ts
git commit -m "feat(database): plan stepped migrations along the ref route"
```

---

### Task 3: Runner, CLI and scripts

**Files:**

- Create: `libs/database/src/migrations-step/run-stepped.ts`, `libs/database/src/migrations-step/migrate.cli.ts`
- Test: `libs/database/src/migrations-step/run-stepped.spec.ts`
- Modify: `libs/database/package.json` (scripts `db:migrate`, `db:migrate:show`; add `pg` `^8.23.1` to dependencies and `@types/pg` `^8.23.1` to devDependencies, the same versions as `apps/db-tests`), `.gitignore`, `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `planSteps`, `loadEdges`, `loadDbRef`, `StepPlanError`, `Step`, `RefFile`, `Marker` from Task 2.
- Produces:

```ts
export interface RunDeps {
  readMarker(): Promise<Marker | null>;
  writeRef(name: string, ref: RefFile): void;
  removeRef(name: string): void; // missing file is not an error
  runPrisma(args: string[]): Promise<number>; // exit code
  log(message: string): void;
  warn(message: string): void;
}
export async function runStepped(argv: string[], input: { edges: MigrationEdge[]; dbRef: RefFile; runId: string }, deps: RunDeps): Promise<number>; // process exit code
```

- [ ] **Step 1: Write the failing tests** with a fake `RunDeps` that records calls:

```ts
it('refuses any argument without running prisma', async () => {
  expect(await runStepped(['--show'], input, deps)).toBe(2);
  expect(deps.prismaCalls).toEqual([]);
});
it('runs each step ref then db, and removes the refs', async () => {
  expect(await runStepped([], input, deps)).toBe(0);
  expect(deps.prismaCalls).toEqual([
    ['db', 'migrate', '--to', 'step-42-1'],
    ['db', 'migrate', '--to', 'step-42-2'],
    ['db', 'migrate', '--to', 'db'],
  ]);
  expect(deps.written.size).toBe(0); // every written ref removed
});
it('an up-to-date database runs one db step and writes no ref', ...);
it('stops at the first failing step and cleans up', async () => {
  deps.failOnCall(2, 1);
  expect(await runStepped([], input, deps)).toBe(1);
  expect(deps.prismaCalls).toHaveLength(2);
  expect(deps.written.size).toBe(0);
});
it('cleans up when the runner throws', ...); // runPrisma rejects → rejects, refs removed
it('removes only its own step refs', ...); // a pre-existing 'step-7-1' in the fake store survives
it('warns with the node hash for an oversized step and still runs it', ...);
it('reports a StepPlanError as exit 1 without running prisma', ...);
```

The `input` fixture uses `runId: '42'` and a chain that plans 3 steps.

- [ ] **Step 2: Run them and confirm they fail.** Run `npx nx test @xjobs/database -- run-stepped`. Expected: FAIL, cannot resolve `./run-stepped`.

- [ ] **Step 3: Implement `runStepped`.** Before each step, log one line: `step <n>/<total>: --to <name> (<k> invariants: <ids>)`. Removal runs in `finally` over the names this run wrote.

- [ ] **Step 4: Run them and confirm they pass.** Run `npx nx test @xjobs/database -- run-stepped`. Expected: PASS.

- [ ] **Step 5: Write `migrate.cli.ts`** (not unit-tested; Task 4 exercises it).
  - `readMarker` uses `pg.Client` on `loadDatabaseEnvironment()`'s `DIRECT_DATABASE_URL ?? DATABASE_URL` and runs `select core_hash, invariants from prisma_contract.marker where space = 'app'`. It returns `null` on no row, or on error codes `42P01`/`3F000`.
  - `writeRef`/`removeRef` work on `src/migrations/app/refs/<name>.json`.
  - `runPrisma` spawns `node_modules/.bin/prisma` with `cwd` = `libs/database`, `stdio: 'inherit'`, and `NODE_OPTIONS=--max-old-space-size=2048`.
  - `runId = String(process.pid)`.
  - On SIGINT or SIGTERM: forward the signal to the child, remove this run's refs, then exit 130.
  - Finish with `process.exit(await runStepped(process.argv.slice(2), …))`.

- [ ] **Step 6: Wire up the scripts and the ignore rule.**
  - `db:migrate`: `tsx src/env/assert-local.cli.ts && tsx src/migrations-step/migrate.cli.ts`
  - `db:migrate:show`: `NODE_OPTIONS=--max-old-space-size=2048 prisma db migrate --show`
  - `.gitignore`: add `libs/database/src/migrations/app/refs/step-*.json`
  - Run `pnpm install`.

- [ ] **Step 7: Run the checks.** Run `npx nx run-many -t lint test typecheck -p @xjobs/database`. Expected: all pass.

- [ ] **Step 8: Commit.**

```bash
git add libs/database .gitignore pnpm-lock.yaml
git commit -m "feat(database): db:migrate steps a fresh database, heap down to 2 GB"
```

---

### Task 4: Prove it on the real history

Nothing new is committed except the results, which go in the PR body (Task 5). Use the `xjobs-stepped-test` container from Task 1. If it's gone, recreate it the same way.

- [ ] **Step 1: Run on a fresh database.** Drop and recreate `stepped_test` (and its auth/storage copy, as in Task 1), then run from the repo root:

```bash
XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=$URL /usr/bin/time -v pnpm --filter @xjobs/database db:migrate
```

Expected: exit 0, one `step n/N` line per step ending with `--to db`, and total time recorded. `/usr/bin/time -v`'s "Maximum resident set size" is the largest single process in the tree (`RUSAGE_CHILDREN`), so it is the worst step's peak: under 1,000,000 kB. Afterwards, `git status` shows no `step-*.json`.

- [ ] **Step 2: Run it again.** Expected: one step (`--to db`), nothing applied.

- [ ] **Step 3: Compare the marker with dev's.** Local `psql` versus dev through the read-only `supabase-dev` MCP: `select core_hash, invariants from prisma_contract.marker where space='app'`. Expected: the same hash `b5852fb8…` and the same 32 invariants as a set.

- [ ] **Step 4: Compare the ledger with dev's.** `select migration_name from prisma_contract.ledger where space='app' order by id`. Expected: an identical list of 63 rows on both, in the same order.

- [ ] **Step 5: Compare a catalog digest with dev's.** Write one SQL query, kept in the scratchpad, that returns sorted rows covering:
  - `public` tables and columns (name, type, nullability, default);
  - RLS enabled per table, and `pg_policies` rows;
  - functions (`pg_proc` in `public`, signature plus `md5(prosrc)`, `prosecdef`, `proconfig`);
  - triggers (`pg_trigger`, not internal);
  - grants (`information_schema.role_table_grants` and `routine_privileges` for `anon`, `authenticated` and `service_role`);
  - `cron.job` (`jobname`, `schedule`, `command`).

  Run it locally and on dev. Expected: no difference. Any difference stops the task; bring it to the user.

- [ ] **Step 6: Check Ctrl-C by hand.** Fresh database, start `db:migrate`, press Ctrl-C during step 1. Expected: exit 130 and no `step-*.json` left behind.

---

### Task 5: Docs, memory, PR

**Files:**

- Modify: `docs/shared-dev-database.md` (one line after the `db:migrate` step in the workflow list), `docs/roadmap/platform/01-migration-squash.md` (mark it built once merged; leave the status line from the spec PR as is until then)

- [ ] **Step 1: Docs.** In `docs/shared-dev-database.md`, add: "`db:migrate` walks a fresh database through the history in steps of at most 8 new invariants (`libs/database/src/migrations-step/`), because Prisma's planner grows exponentially with the invariants it has to collect in one run."

- [ ] **Step 2: Commit and push.** Commit the docs (`docs(database): stepped db:migrate`), then run `git push -u origin feat/stepped-migrate`, then `gh pr create` to `main`. The body has:
  - Task 4's results: the step count, peak memory per step, total time, and the marker, ledger and digest comparisons;
  - the post-merge check: the first Dev database run logs `step 1/1: --to db` and applies nothing;
  - a drafted prisma-next issue (title "Invariant-aware migrate planning is exponential in self-loop migrations"), covering the measured table (12 → 0.33 GB, 16 → 0.68 GB, 20 → 2.7 GB, 32 → over 12 GB, the same on `rc.25` with CLI `rc.35`), the cause (BFS over node × collected-invariant subset in `findPathWithInvariants`, with same-hash migrations as optional detours), and the cheap fix (on a route, self-loops that provide required invariants are mandatory: collect them greedily). It says the user files it.

- [ ] **Step 3: Check CI.** Expected: the database and e2e jobs are green with the heap at 2 GB. If a job fails at Supabase start (ports 54322/54324), rerun it; that's a known flake.

- [ ] **Step 4: Memory.** Update `migrate-heap-limit` (stepped migrate replaces the squash; the marker subtraction; the rc.25 result; the PR number) and `migration-ref-hash` (`step-*` refs are temporary and git-ignored, never committed). Remove the `xjobs-stepped-test` container.
