# Preferences Switch and Final Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The engine reads and writes only the new preference fields, the old profile columns and the four copied enums are gone, and `places`/`spokenLanguages` are renamed to `locations`/`languages` on `main`, so slice 07 can start.

**Architecture:** This plan runs steps 2 and 3 of `docs/superpowers/plans/2026-11-05-preferences-and-eligibility.md` (the "base plan"). Each task below points to a base-plan task and is that task **as written there, plus the deltas listed here**. Where a delta and the base plan disagree, the delta wins. There are two PRs: B (Tasks 1–6) and C (Tasks 7–8).

**Tech Stack:** Prisma 8 contract and migrations (`libs/database`), plpgsql triggers, Supabase CLI local stack, Vitest (`apps/db-tests`, engine unit tests), NestJS 11 with class-validator, zod 4 in the processor.

**Spec:** `docs/superpowers/specs/2026-11-07-preferences-switch-and-remove-design.md`, on top of `docs/superpowers/specs/2026-11-05-preferences-and-eligibility-design.md`.

**Linear ticket:** none (this project uses no ticket tracker).

**Branches and PRs:**

- PR B `feat/preferences-engine-switch` (Tasks 1–6). It already carries the spec commit, and it carries this plan.
- PR C `feat/preferences-remove-legacy` (Tasks 7–8), branched from `main` after PR B merges.

## Global Constraints

- **Start condition:** before Task 1's code, the user sends the handover notice from the spec's "Handover to the teammate". Task 5 (base Task 10a) starts only after PR #17 (resume storage) has merged to `main` and been merged into this branch.
- **Paths that moved since the base plan was written** (they apply to every base-plan task):
  - The contract is `libs/database/src/contract/contract.prisma`, and migrations are under `libs/database/src/migrations/app/`.
  - `db:migration:plan`, `db:migrate` and `db:seed` run as `pnpm --filter @xjobs/database <script>`, or from the root as `pnpm db:migrate` and `pnpm db:seed`.
  - The enums are defined in `libs/database/src/enums/` (with `enums.spec.ts`). `apps/xjobs/src/common/enums` only re-exports them.
  - The vocab seed is `libs/database/src/seeds/vocab/` (`seed-data.ts`, `seed-data.spec.ts`).
  - The generated types are `libs/database/src/supabase/database.types.ts`, regenerated with `pnpm db:types`. CI fails if this file differs from the output of `pnpm db:types`.
  - The db tests run with `pnpm db:test` (or `npx nx run @xjobs/db-tests:db-test -- <filter>`).
- **Database errors carry `sqlState`, not `code`.** Follow `isUniqueViolation` in `apps/xjobs/src/database/errors.ts`, which walks `cause`.
- **Bad codes are a database error** with SQLSTATE `23514` and the message `<table>.<column>: '<value>' is not an approved <list> code`. The PR A triggers already raise these.
- **No production data exists.** Dev profiles may be deleted. Approved vocabulary rows are never deleted.
- **CI doesn't run e2e or the eval.** Before each PR, run `npx nx e2e xjobs-e2e` by hand. For PR B, the user also runs `pnpm --filter @xjobs/xjobs processor:eval` (it needs their OpenRouter key). Both results go in the PR description.
- **Before each PR:** `npx nx run-many -t lint test build typecheck`, `pnpm db:test`, and `pnpm db:types` with no diff.
- **Claude never pushes.** The human pushes each PR.

## Review Focus

1. **`db:regenerate` on a published profile with a city place.** Regeneration must look up place labels from the database and produce `'<name>, <country label>'`, not throw. Pinned in Task 2, `regenerate.spec.ts`.
2. **The dev-profile cleanup deletes only profiles missing a new field.** A profile with `places`, `spokenLanguages` and `contractTypes` all set survives the migration. Pinned in Task 1, Step 5.
3. **Converting `query_search_builders.technologies` to `text[]` keeps every value and hash.** Existing builder rows still match by hash after the migration, so the collection workers don't regenerate or duplicate them. Pinned in Task 1, Step 5.
4. **A profile whose techs all lack search wording** (for example only `saas` and `microservices`) generates the same searches as a profile with no skills does today, without throwing. Pinned in Task 2.
5. **A database check message reaches the API caller as a 400** that names the field, never as a 500. This covers `profiles.contractTypes` and the place and language fields, not only `position`. Pinned in Task 1, e2e.

---

## PR B: Switch

### Task 1: Codes in the contract and the profile API, and the dev-profile cleanup (base Task 7)

**Deltas:**

- **Contract:** `QuerySearchBuilder.technologies` also becomes `String[]` (the spec's addition). It gets no trigger, because only the engine writes that table.
- **Migration:** one more `rawSql` step, placed after the column type changes:

  ```sql
  DELETE FROM public.profiles
  WHERE places IS NULL OR "spokenLanguages" IS NULL OR "contractTypes" IS NULL;
  ```

  `profile_skills` and `profile_query_search_builders` cascade.

- **Error detection:** `isCheckViolation(error: unknown): boolean` in `apps/xjobs/src/database/errors.ts` checks `sqlState === '23514'` along the `cause` chain, the same way `isUniqueViolation` does. Its tests use `{ sqlState: '23514' }`, `{ sqlState: '23505' }` and a wrapped `new Error('x', { cause: { sqlState: '23514' } })`.
- **Error mapping:** in the service spec, the repository rejects with `Object.assign(new Error("profiles.position: 'support' is not an approved role_kinds code"), { sqlState: '23514' })`. The `BadRequestException` message is the error's `message`.
- **DTO cleanup:** remove `PROFILE_SENIORITIES` and its `IsIn` from `profile.dto.ts`, which PR A added to refuse `unstated`. Seniorities become code strings like the rest, and the trigger refuses `unstated` (a 400 through the mapping above). Keep the `[['unstated']]` case in `profile.dto.spec.ts`, but move it to the e2e suite as "unstated seniority gives 400".
- **Compile fixes:** after the type changes, fix whatever the compiler flags in `modules/queries/steps/`, `queries/services/` and `queries/dto/` in this task as well. Logic changes there belong to Task 2.
- **Extra e2e cases** (Review Focus 5) in `apps/xjobs-e2e/src/xjobs/users.spec.ts`. Each returns 400 with the field in the message:
  - `contractTypes: ['gig']` names `profiles.contractTypes`.
  - `locations: { remote: [{ kind: 'country', code: 'ZZ' }], hybrid: [], onsite: [] }` names `profiles.places`.
  - `languages: [{ lang: 'xx', level: 'fluent' }]` names `profiles.spokenLanguages`.

- [ ] **Step 1:** Write base Task 7's failing tests, with the deltas above.
- [ ] **Step 2:** Run `npx nx test xjobs -- errors profile.dto profiles.service`. Expected: FAIL.
- [ ] **Step 3:** Edit the contract. Run `pnpm --filter @xjobs/database db:migration:plan`, add the `DELETE` step, then implement the types, DTOs, repository and error mapping.
- [ ] **Step 4:** Before migrating, set up local data:
  - Insert one profile with all three new fields set, and one with `places` null.
  - Note `SELECT id, hash FROM query_search_builders ORDER BY id`.
- [ ] **Step 5:** Run `pnpm db:migrate`. Expected:
  - Only the profile with null `places` is gone.
  - The builder ids and hashes are identical to Step 4 (Review Focus 2 and 3).
  - `pnpm db:test` passes.
- [ ] **Step 6:** Run `npx nx test xjobs` and `npx nx e2e xjobs-e2e`. Expected: PASS, except query tests that Task 2 fixes.
- [ ] **Step 7:** Commit: `feat(users): profiles take codes, places, languages with levels, contract types, salary and currencies; clear dev profiles without them`

### Task 2: Query generation from codes and places (base Task 8)

**Deltas:**

- **Regeneration resolves labels.** `regeneratePublished` (in `profiles.service.ts`) resolves place labels through `ProfilesRepository.placeLabels` for each profile before building its input, so `db:regenerate` works on the new fields. Its `toInput` parameter becomes `(profile: ProfileWithSkills, labels: PlaceLabels) => QuerySearchProfileInput`. `apps/xjobs/src/scripts/regenerate-query-search.ts` needs no change beyond what the compiler asks for.
- **New test in `regenerate.spec.ts`** (Review Focus 1): a published profile with `onsite: [{ kind: 'city', id: 'c1' }]` and labels `c1 → { name: 'Paris', countryCode: 'FR' }`, `FR → 'France'` regenerates, and the input passed to `generate` has `locations.onsite` equal to `['Paris, France']`.
- **New test in `technology.spec.ts`** (Review Focus 4): skills `[{ technology: 'saas', importance: 10 }, { technology: 'microservices', importance: 9 }]` give the same `topTechnologies` as an empty skill list. Also add an `expand.scenarios.spec.ts` case: that profile expands to the same combinations as one with no skills, without throwing.
- **Local check:** after the tests pass, publish one profile locally through the e2e helper or the API, then run `pnpm --filter @xjobs/xjobs db:regenerate` with the local `DATABASE_URL`. Expected: it logs `Regenerated 1 published profiles`, and the builders have `recipeVersion` 11.

- [ ] **Step 1:** Write base Task 8's failing tests, plus the two above.
- [ ] **Step 2:** Run `npx nx test xjobs -- queries place-labels regenerate`. Expected: FAIL.
- [ ] **Step 3:** Implement base Task 8 and the `regeneratePublished` change.
- [ ] **Step 4:** Run `npx nx test xjobs`, then do the local regenerate check. Expected: PASS, and the log line above.
- [ ] **Step 5:** Commit: `feat(queries): search from tech codes with search wording and from place labels; recipe v11`

### Task 3: Publishing needs eligibility (base Task 9)

There are no deltas. Check that `update-user.dto.ts` and `user.response.dto.ts` match commit `8a92138`, which kept the eligibility columns out of the user response. This task adds them back on purpose, as base Task 9 says.

- [ ] **Steps 1–5:** as in base Task 9.

### Task 4: Processor on `isEngineering` and four authorization kinds (base Task 10)

**Deltas:**

- `Position` is imported in `validate.ts` from `src/common/enums`. After this task, nothing in `modules/processor` imports `Position`. Check with `grep -rn "Position" apps/xjobs/src/modules/processor`, which should return only `roleKind`-style names, not the enum.
- **Step 4's eval:** Claude runs the unit tests. The user runs `processor:eval` and pastes the scores. Claude compares them with the scores from `main`, which the user runs on `main` first.

- [ ] **Steps 1–5:** as in base Task 10.

### Task 5: Remove the engine's resume endpoints (base Task 10a)

**Start:** merge `origin/main` into the branch after PR #17 merges. Base Task 10a's text and #17's migration arrive with it. Resolve the expected conflict in `docs/roadmap/phase-1-accounts-and-preferences/07-guided-setup-ui.md` by keeping this branch's "Starts after slice 06a" line and dropping #17's version.

There are no other deltas. The file and line references in base Task 10a were written against #17's branch, so re-check the line numbers it cites.

- [ ] **Steps 1–5:** as in base Task 10a.

### Task 6: PR B handoff (base Task 11)

**Deltas:**

- **The grep in Step 2 also runs over `apps/xjobs/src/modules/processor`.**
- **Base plan edits, in the same commit:**
  - The "Step 2: Switch (PR B, the teammate)" heading and the Architecture line say "the user".
  - A note under "Branches and PRs" points to this plan for steps 2 and 3.
- **The PR description lists:**
  - e2e passed, and the `processor:eval` scores against `main`.
  - After merge, the user runs `pnpm --filter @xjobs/xjobs db:regenerate` once against the shared dev database (`XJOBS_ALLOW_REMOTE_DB=1`). Expected: 0 published profiles, and the v10 builders retired.
  - No `db:reprocess`, by the spec's decision.
  - Once the dev-database workflow runs, every dev profile missing a new field is gone.

- [ ] **Step 1:** Run the full pre-PR set from Global Constraints. Expected: all green, and `pnpm db:types` shows no diff.
- [ ] **Step 2:** Run the grep. Expected: only new-shape uses.
- [ ] **Step 3:** Edit the base plan and draft the PR description.
- [ ] **Step 4:** Commit with `docs: steps 2 and 3 of the preferences plan move to the user`, then hand PR B to the human to push.

---

## PR C: Remove

### Task 7: Drop the old columns and enums, and use the final names (base Task 12)

**Deltas:**

- **Enum files:** delete them from `libs/database/src/enums/`: `technology.enum.ts`, `position.enum.ts`, `region.enum.ts` and `language.enum.ts`. Remove their exports from `libs/database/src/enums/index.ts`, their re-exports from `apps/xjobs/src/common/enums/index.ts`, and their cases in `libs/database/src/enums/enums.spec.ts`.
- **Also edit `libs/database/src/seeds/vocab/seed-data.spec.ts`,** which imports `Position`. Compare `ENGINEERING_ROLE_KINDS` against a literal list of the 17 codes instead (the list is in the base plan's Global Constraints).
- **Drift test, corrected:** the TypeScript `Seniority` includes `unstated` and `Engagement` doesn't.
  - `Object.values(Seniority)` sorted equals the `SEED.seniorities` codes, sorted.
  - `Object.values(Engagement)` sorted equals the `SEED.engagements` codes without `unstated`, sorted.

  The seed holds `junior, mid, senior, staff, lead, principal, unstated` and `employee, contractor, eor, agency, per_task, unstated`, so both assertions fail on any code added or removed on either side.

- **Migration order:**
  1. The cleanup `DELETE` (expected to delete 0 rows after PR B).
  2. Drop the old `country`, `city`, `languages` and `locations` columns. This also drops their checks: `profiles_languages_nonempty`, `profiles_locations_shape` and `profiles_locations_nonempty`.
  3. Rename `places` to `locations` and `spokenLanguages` to `languages`.
  4. Set `NOT NULL` and add the final-name checks. These reuse the names `profiles_languages_nonempty` and `profiles_locations_nonempty`, which is why step 2 must come first.
  5. Replace `profiles_check_codes()`.
  6. Re-run the column grants.

  If `db:migration:plan` orders steps differently, reorder its ops by hand.

- **Error messages:** the trigger messages now say `profiles.locations` and `profiles.languages`. Update the e2e cases from Task 1 to match.
- **The Prisma enums `Technology`, `Position`, `Region` and `Language` are deleted.** The Prisma `Seniority` enum stays, because `QuerySearchBuilder.experience` still uses it. The Prisma `Engagement` enum has no column left after Task 1. It stays anyway, because the spec only names the four, and the PR description notes it as unused.

- [ ] **Steps 1–6:** as in base Task 12, with the deltas above. Step 4 also runs `npx nx e2e xjobs-e2e`.

### Task 8: Final types and handoff (base Task 13)

**Deltas:**

- The types command is `pnpm db:types`.
- The PR description states that e2e passed.
- After PR C merges, the user tells the teammate the freeze is lifted and that the four enums are gone.

- [ ] **Steps 1–2:** as in base Task 13, then hand PR C to the human to push.
