# Hosted Launch: Production Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give production a CI migration path behind an approval gate, a `cities` seed so production has approved cities, and a runbook the maintainer follows to create and verify the production project.

**Architecture:** A `production` job in the existing `Dev database` workflow runs after the dev job, waits on the GitHub environment `production-database`, then migrates and seeds the list tables only. A new idempotent `cities` seed upserts a committed list of approved cities. The dashboard work and the pre-UI checks live in a new `docs/production.md`.

**Tech Stack:** GitHub Actions, Prisma Next ORM (`tx.orm.public.*`), Vitest, Supabase Cloud, Vercel.

**Spec:** `docs/superpowers/specs/2026-11-07-hosted-launch-design.md`

## Global Constraints

- No secret in git. The only production secret in GitHub is `PROD_DATABASE_URL`, the session pooler URL (port 5432), connecting as `postgres`. Never the transaction pooler (6543).
- Production seed: `db:seed --only processor-lists,iso,cities`. Never the `users` seed.
- GitHub environment name: `production-database`, required reviewer the maintainer, deployment branches `main` only.
- Vercel Preview env stays on `10xjobs-dev`; Production env uses the production project. No service-role key in Vercel.
- Seeds are idempotent: a second run writes nothing.
- One branch (`docs/hosted-launch-spec`, already holding the spec) and one PR to `main`. Claude doesn't push. _(my call)_

## Review Focus

1. A seeded city that already exists on dev with different casing ("berlin" vs "Berlin"): it must match through the processor's key and not create a second row. Test in Task 1.
2. A city in the data file whose country isn't seeded: the foreign key fails and the whole seed transaction rolls back on production. Test in Task 2 (every `countryCode` is in `SEED.countries`).
3. The same city listed twice in the data file: the second upsert matches the first, which hides a data mistake. Test in Task 2 (keys unique).
4. A city that's already approved, with `approvedAt` and `occurrences` set: the seed must not reset either. Test in Task 1.
5. The dev job failing or being skipped: the production job must not run. Covered by `needs:` in Task 3; checked by reading the YAML, since nothing runs it in CI.

---

### Task 1: The `cities` seed

**Files:**

- Create: `libs/database/src/seeds/vocab/city-key.ts`
- Create: `libs/database/src/seeds/vocab/seed-cities.ts` (starts as an empty list; Task 2 fills it)
- Create: `libs/database/src/seeds/cities.seed.ts`
- Create: `libs/database/src/seeds/cities.seed.spec.ts`
- Modify: `libs/database/src/seeds/index.ts:27` (append `citiesSeed` after `isoSeed`; it must come after `processorListsSeed`)
- Modify: `libs/database/src/index.ts` (export `cityNameKey`)
- Modify: `apps/xjobs/src/modules/processor/repositories/vocab.repository.ts:179,186` (use `cityNameKey` instead of `name.toLowerCase()`; behavior unchanged, and the teammate is told)

**Interfaces:**

- Produces: `cityNameKey(name: string): string`, returning `name.toLowerCase()`. It's the one definition of the key, shared by the engine and the seed.
- Produces: `interface SeedCity { name: string; countryCode: string; aliases: string[]; geonamesId: number | null }` and `export const SEED_CITIES: readonly SeedCity[]` in `seed-cities.ts`.
- Produces: `makeCitiesSeed(cities: readonly SeedCity[]): Seed` and `citiesSeed = makeCitiesSeed(SEED_CITIES)`, with `name: 'cities'`.

- [ ] **Step 1: Write the failing tests** in `cities.seed.spec.ts`. Reuse the `FakeTable` pattern from `processor.seed.spec.ts`, with one `City` table keyed on `['nameKey', 'countryCode']`. Fixture: `[{ name: 'Berlin', countryCode: 'DE', aliases: ['berlín'], geonamesId: 2950159 }]`.
  - `creates a missing city as approved`: one row with `name 'Berlin'`, `nameKey 'berlin'`, `status 'approved'`, `occurrences 0`, `approvedAt` and `firstSeenAt` set, `geonamesId 2950159`, `aliases ['berlín']`.
  - `writes nothing on a second run`: after two runs, the writes during the second run are `0`.
  - `promotes a proposed city matched by key, case-insensitively`: a pre-existing `{ name: 'berlin', nameKey: 'berlin', countryCode: 'DE', status: 'proposed', occurrences: 5, approvedAt: null, geonamesId: null, aliases: ['bln'] }` ends with one row, `status 'approved'`, `approvedAt` set, `occurrences 5`, `name 'berlin'` (unchanged), `geonamesId 2950159`, aliases sorted `['berlín', 'bln']`.
  - `leaves an approved city's approvedAt and occurrences alone`: pre-existing approved row with `approvedAt = new Date('2026-01-01')` and `occurrences 9` keeps both.
  - `never touches cities not in the list`: a pre-existing `Paris, FR, proposed` stays exactly as it was.

- [ ] **Step 2: Run to verify it fails**

  Run: `npx nx test @xjobs/database -- cities.seed`
  Expected: FAIL, cannot resolve `./cities.seed`.

- [ ] **Step 3: Implement** `city-key.ts`, `seed-cities.ts` (`SEED_CITIES = []` plus a header comment: exported from approved cities on `10xjobs-dev`, edit by hand; the seed promotes and adds but never removes), and `cities.seed.ts`. For each city: look it up with `where({ nameKey: cityNameKey(name), countryCode }).first()`. If it's missing, `create` it as in Step 1. If it exists, `update` only the fields that change: `status` to `'approved'`, `approvedAt` if null, `geonamesId` if null, and aliases that are missing. Skip the update when nothing changes, so a second run writes nothing. Then wire it into `index.ts` and the lib export.

- [ ] **Step 4: Run to verify it passes**

  Run: `npx nx test @xjobs/database -- cities.seed && npx nx test xjobs -- vocab && npx nx run-many -t typecheck -p @xjobs/database xjobs`
  Expected: PASS.

- [ ] **Step 5: Run the seed against the local stack twice**

  Run: `pnpm db:reset && XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:seed --only cities`
  Expected: both runs succeed. (With an empty list there's nothing to insert; Task 2 repeats this with data.)

- [ ] **Step 6: Commit**

  ```bash
  git add libs/database/src apps/xjobs/src/modules/processor/repositories/vocab.repository.ts
  git commit -m "feat(database): cities seed that upserts approved cities"
  ```

### Task 2: Fill the cities list from dev

**Files:**

- Modify: `libs/database/src/seeds/vocab/seed-cities.ts`
- Create: `libs/database/src/seeds/vocab/seed-cities.spec.ts`

**Interfaces:**

- Consumes: `SEED_CITIES`, `SeedCity`, `cityNameKey` (Task 1); `SEED.countries` from `seed-data.ts`.

- [ ] **Step 1: Write the data tests** in `seed-cities.spec.ts`:
  - `every city's country is a seeded country`: each `countryCode` is in `SEED.countries.map(c => c.code)`.
  - `no city is listed twice`: `` `${countryCode}|${cityNameKey(name)}` `` values are unique.
  - `names are trimmed and non-empty`: `name === name.trim() && name.length > 0`.

- [ ] **Step 2: Ask the maintainer for the export (human step).** Claude can't reach dev, because credentials live in `.env*`. The maintainer runs this in the `10xjobs-dev` SQL editor and pastes the result:

  ```sql
  select coalesce(json_agg(json_build_object(
    'name', name, 'countryCode', "countryCode",
    'aliases', aliases, 'geonamesId', "geonamesId")
    order by "countryCode", name), '[]')
  from public.cities where status = 'approved';
  ```

- [ ] **Step 3: Write the pasted rows into `SEED_CITIES`**, sorted by country and then name. Show the maintainer the list and wait for their review before committing (spec: reviewed before it's committed).

- [ ] **Step 4: Run tests and the local seed twice**

  Run: `npx nx test @xjobs/database -- seed-cities cities.seed`, then the Task 1 Step 5 seed command twice, then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select count(*), bool_and(status='approved') from public.cities"`.
  Expected: tests pass. The count equals `SEED_CITIES.length`, `bool_and` is `t`, and the count is the same after both runs.

- [ ] **Step 5: Commit**

  ```bash
  git add libs/database/src/seeds/vocab
  git commit -m "feat(database): seed the cities approved on dev"
  ```

### Task 3: The production job

**Files:**

- Modify: `.github/workflows/dev-database.yml`

**Interfaces:**

- Consumes: the `cities` seed name (Task 1).

- [ ] **Step 1: Add the job `production`** after `deploy`. It reuses the dev job's checkout, pnpm, node and install steps, with these differences:
  - `needs: deploy`, `environment: production-database`, `timeout-minutes: 20`
  - `concurrency: { group: production-database, cancel-in-progress: false }`
  - env: `XJOBS_SKIP_ENV_FILES: '1'`, `XJOBS_ALLOW_REMOTE_DB: '1'`, `DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}`, and no `SUPABASE_*`
  - steps: `pnpm --filter @xjobs/database db:migrate`, then `pnpm --filter @xjobs/database db:seed --only processor-lists,iso,cities`

  Also update the header comment to say: migrates and seeds dev, then production once the maintainer approves. Keep the workflow name `Dev database`, because `docs/shared-dev-database.md` refers to it and renaming it buys nothing. _(my call)_

- [ ] **Step 2: Validate the YAML**

  Run: `npx --yes @action-validator/cli .github/workflows/dev-database.yml`, or, if that's unavailable, `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/dev-database.yml','utf8'))"`.
  Expected: no errors. Then check by reading: `production` has `needs: deploy`, no `if:` that could bypass it, and no `SUPABASE_` key.

- [ ] **Step 3: Commit**

  ```bash
  git add .github/workflows/dev-database.yml
  git commit -m "ci: migrate and seed production after dev, behind approval"
  ```

### Task 4: The runbook and doc updates

**Files:**

- Create: `docs/production.md`
- Modify: `docs/auth-production.md` (the "Session length and pg_cron" migrate commands and the "Pre-launch checklist (slice 09)" section)
- Modify: `docs/shared-dev-database.md` (Daily work, Recovery)
- Modify: `docs/roadmap/phase-1-accounts-and-preferences/09-hosted-launch.md`
- Modify: `CLAUDE.md` Commands only if a command changed (none expected)

- [ ] **Step 1: Write `docs/production.md`** with these sections, taking the content from the spec's matching sections:
  1. What production is: the project, Vercel Production on `<project>.vercel.app`, previews on dev.
  2. One-time setup: the spec's dashboard checklist, Supabase, GitHub, Vercel, numbered 1 to 7.
  3. How migrations reach production: the job, approving the newest waiting run, add-then-drop schema changes after launch, and that Vercel deploys before approval.
  4. Verification before any UI: the spec's steps 1 to 7, with the SQL written out. Step 2's query lists the twelve tables by their real names from `contract.prisma`. Step 6's commands use `read -rs` for keys, as in auth-production.md, and end with `unset`.
  5. Known gaps: no backups on Free, pausing, Gmail deliverability, and that moving to Pro fixes the first two.
  6. Launch check: a heading with "to be written after slices 07 and 08".

- [ ] **Step 2: Edit `docs/auth-production.md`.** Replace the manual `db:migrate` block with one line: production migrates from CI, see `production.md`. Keep the `cron.job` check and the Pro time-box note. Replace "Pre-launch checklist (slice 09)" with a link to `production.md`. In the settings table, the Site URL and redirect URLs become "the Vercel production URL (`<project>.vercel.app`)".

- [ ] **Step 3: Edit `docs/shared-dev-database.md`.** Add that Vercel previews use `10xjobs-dev`, so resetting dev also resets what previews see. Add that the `Dev database` workflow also has the production job, so re-running CI on `main` queues a production run waiting for approval, which can be rejected.

- [ ] **Step 4: Edit the 09 brief.** Under "For the slice spec", mark each question settled, with a one-line answer and a link to the spec: CI behind approval; no staging, previews on dev; error monitoring deferred.

- [ ] **Step 5: Check links and formatting**

  Run: `npx prettier --check docs` and `grep -n 'production.md' docs/*.md`.
  Expected: prettier is clean, and every link to `production.md` resolves.

- [ ] **Step 6: Commit**

  ```bash
  git add docs
  git commit -m "docs: production runbook; point auth-production and shared-dev docs at it"
  ```

### Task 5: Hand-off (the maintainer, after merge)

Not code. Claude ends by telling the maintainer, in this order:

1. Push `docs/hosted-launch-spec` and open the PR. CI must be green.
2. Before merging, do `docs/production.md` steps 1 to 7 of one-time setup, so the merge's run has the environment and the secret. If you merge first, re-run the latest CI run on `main` afterwards.
3. Approve the `production` job, then run the verification steps. Step 6 waits for the resume storage work on `main`.
4. Tell the teammate: `cityNameKey` replaces the inline `toLowerCase()` in `vocab.repository.ts`, and new dev approvals reach production only by adding them to `seed-cities.ts`.

- [ ] **Step 1: Final check**

  Run: `npx nx run-many -t lint test build typecheck`
  Expected: all pass.
