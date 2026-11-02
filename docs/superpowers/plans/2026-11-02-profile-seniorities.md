# Profile Seniorities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace a profile's single `seniority` with a set `seniorities`, and generate one query search recipe per seniority in the set.

**Architecture:** Query generation gets a new pure step (`steps/seniorities.ts`) that normalizes and asserts the set. `locationCombinations` adds seniority as the innermost axis, so each combination still carries one `experience`, and recipes, hashes, channel builders and segments stay the same. The profile column, DTOs, types and service move from `seniority` to `seniorities`, through one schema-only migration.

**Tech Stack:** NestJS, class-validator, Prisma Next contract (`contract.prisma`) and migrations, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-profile-seniorities-design.md`

## Global Constraints

- Work on a new branch `feat/profile-seniorities`, cut from the current `feat/processor` HEAD (the spec commit `35ba851` is on it). Claude never pushes.
- The processor (`modules/processor/**`, including its seniority specs and golden cases) is not touched.
- `QuerySearchBuilder.experience` and `QuerySearchCombination.experience` stay a single `Seniority`.
- `QUERY_SEARCH_RECIPE_VERSION` stays `9`.
- Every `Seniority` value is allowed in `seniorities`, `unstated` included.
- Sets are deduped and stored in `Seniority` enum order: `junior, mid, senior, staff, lead, principal, unstated`.
- The empty-set error message is exactly `seniorities must list at least one seniority`.
- `seniority` is removed from the API without an alias. Sending it is a 400.
- Existing migrations are not edited. Existing data is not converted (the local DB is reset).
- CI gate: `npx nx run-many -t lint test build typecheck` is green.

## Review Focus

1. **The same set in a different order** (`['staff','senior']` vs `['senior','staff']`) must produce identical recipes and be stored identically. Pinned in Task 1 (`normalizeSeniorities` order test, scenario hash equality) and Task 2 (service stores the sorted set).
2. **A set mixing `unstated` with real levels** must give the `unstated` recipes no seniority word and no `experienceLevel`, while the other levels keep theirs. Pinned in Task 1 (scenario test).
3. **Duplicates that slip past the DTO** (internal callers, scripts) must not produce duplicate combinations. Pinned in Task 1 (`normalizeSeniorities` dedupe test, and a combinations count with a duplicated input through `expand`).
4. **A client still sending `seniority`** must get a 400, not a silently ignored field. Pinned in Task 2 (DTO test).
5. **Replacing a draft with a different set** must store the new set, not merge it with the old one. Pinned in Task 2 (service replace test).

---

### Task 1: Seniority as a query-generation axis

**Files:**

- Create: `apps/xjobs/src/modules/queries/steps/seniorities.ts`
- Create: `apps/xjobs/src/modules/queries/steps/seniorities.spec.ts`
- Modify: `apps/xjobs/src/modules/queries/steps/index.ts` (export the new step)
- Modify: `apps/xjobs/src/modules/queries/steps/normalize.ts` (`normalizeProfile`)
- Modify: `apps/xjobs/src/modules/queries/steps/combinations.ts` (`locationCombinations` + doc comment)
- Modify: `apps/xjobs/src/modules/queries/types/query-search.types.ts:37` (`QuerySearchProfileInput`)
- Modify: `apps/xjobs/src/modules/queries/services/queries.service.ts` (`expand`: assert, doc comment)
- Modify: `apps/xjobs/src/modules/queries/index.ts` (add `normalizeSeniorities` to the existing `./steps` re-export block next to `normalizeLocations`)
- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts:73` (`toQuerySearchInput`: temporary `seniorities: [profile.seniority as Seniority]` so the build stays green until Task 2)
- Test/fixtures: `steps/combinations.spec.ts`, `steps/normalize.spec.ts`, `steps/skills.spec.ts`, `services/queries.service.spec.ts`, `services/expand.scenarios.spec.ts`, `testing/profiles.fixture.ts`

**Interfaces:**

- Produces:
  - `SENIORITIES_REQUIRED: string` = `'seniorities must list at least one seniority'`
  - `normalizeSeniorities(seniorities: Seniority[]): Seniority[]`: deduped, in `Object.values(Seniority)` order
  - `assertHasSeniorities(profile: QuerySearchProfileInput): void`: throws `BadRequestException(SENIORITIES_REQUIRED)` when `profile.seniorities` is empty
  - `QuerySearchProfileInput.seniorities: Seniority[]` (replaces `seniority`)

- [ ] **Step 1: Branch**

```bash
git switch -c feat/profile-seniorities
```

- [ ] **Step 2: Write the failing tests**

`steps/seniorities.spec.ts`:

- `normalizeSeniorities` dedupes and orders: `normalizeSeniorities([staff, senior, staff, unstated, junior])` equals `[junior, senior, staff, unstated]`.
- `normalizeSeniorities([])` equals `[]`.
- `assertHasSeniorities({ ...profile, seniorities: [] })` throws `new BadRequestException(SENIORITIES_REQUIRED)`. With `[senior]` it doesn't throw.
- `SENIORITIES_REQUIRED` is `'seniorities must list at least one seniority'`.

`steps/combinations.spec.ts` (switch the fixture to `seniorities: [Seniority.senior]`, so the existing counts hold):

- `it('expands one combination per seniority')`: with `seniorities: [senior, staff]`, the length is `3 * channels * 2 * 2`, and each `(type, channel, location, technologies)` tuple appears once with `experience: senior` and once with `experience: staff`.
- The existing ordering test is extended so seniority is innermost: with `[senior, staff]`, `combinations[0].experience === senior`, `combinations[1].experience === staff`, and both have the same `technologies`.

`steps/normalize.spec.ts`:

- `normalizeProfile({ ...input, seniorities: [staff, senior, staff] }).seniorities` equals `[senior, staff]`.

`services/expand.scenarios.spec.ts`:

- `it('one search per seniority, shared across profiles')`: profile A is `remoteBackendMa` with `seniorities: [senior, staff]`, and profile B is the same with `seniorities: [staff]`. Then `expand(A).length === 2 * expand(B).length`, every hash of `expand(B)` is in `expand(A)`, and on `LINKEDIN_JOB_BOARD` the `experienceLevel` params of A are `'4'` (senior) and `'4,5'` (staff), one of each per location × technology set.
- `it('the same set in another order gives the same recipes')`: the hash sets of `expand({ ...p, seniorities: [staff, senior] })` and `expand({ ...p, seniorities: [senior, staff] })` are equal.
- `it('duplicate seniorities do not duplicate recipes')`: `expand({ ...p, seniorities: [senior, senior] })` has the same length as with `[senior]`.
- `it('unstated alongside a level')`: with `[unstated, senior]`, the `unstated` recipes on `LINKEDIN_JOB_BOARD` have no `experienceLevel`, the `LINKEDIN_POSTS` keywords for `unstated` contain no `senior` word, and the `senior` recipes keep `experienceLevel: '4'` and the `senior` word.
- `it('rejects an empty seniority set')`: `expand({ ...p, seniorities: [] })` throws `new BadRequestException(SENIORITIES_REQUIRED)`.

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `npx nx test xjobs -- src/modules/queries`
Expected: FAIL (`seniorities.ts` is missing, and `seniorities` isn't on `QuerySearchProfileInput`).

- [ ] **Step 4: Implement**

- Add `seniorities.ts` with the three exports above. `normalizeSeniorities` filters `Object.values(Seniority)` by membership in the input.
- `QuerySearchProfileInput`: `seniorities: Seniority[]`.
- `normalizeProfile` returns `{ ...input, locations: normalizeLocations(input.locations), seniorities: normalizeSeniorities(input.seniorities) }`.
- `expand` calls `assertHasSeniorities(profile)` right after `assertHasLocations(profile)`. Doc comment: `arrangement × channel × location × technology × seniority`.
- `locationCombinations`: the innermost loop is `profile.seniorities.map((experience) => ({ …, experience }))`. Doc comment updated.
- `profiles.fixture.ts`: every `seniority: X` becomes `seniorities: [X]`. Same for the other spec fixtures listed under Files.
- `toQuerySearchInput`: `seniorities: [profile.seniority as Seniority]` (replaced in Task 2).

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npx nx test xjobs -- src/modules/queries && npx nx typecheck xjobs`
Expected: PASS. The existing scenario counts are unchanged, because every fixture has one seniority.

- [ ] **Step 6: Commit**

```bash
git add apps/xjobs/src/modules/queries apps/xjobs/src/modules/users/services/profiles.service.ts
git commit -m "feat: generate one query search per profile seniority"
```

---

### Task 2: Profile `seniorities` field, storage and API

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma:252` (field + check)
- Create: `apps/xjobs/src/database/migrations/app/<timestamp>_profile_seniorities/` (planned, not hand-written)
- Regenerate: `apps/xjobs/src/database/contract.json`, `contract.d.ts`, and the snapshot the planner writes
- Modify: `apps/xjobs/src/modules/users/dto/profile.dto.ts:105-106`
- Modify: `apps/xjobs/src/modules/users/dto/profile.response.dto.ts:64-65`
- Modify: `apps/xjobs/src/modules/users/types/profile.types.ts:26`
- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts` (`toProfileView` :73, `toQuerySearchInput`, `create` :186, `replace` :220)
- Test: `users/dto/profile.dto.spec.ts`, `users/services/profiles.service.spec.ts`, `users/services/resume.service.spec.ts`, `apps/xjobs-e2e/src/xjobs/users.spec.ts`

**Interfaces:**

- Consumes: `normalizeSeniorities` (Task 1), imported from `src/modules/queries` the way `normalizeLocations` is.
- Produces: `ProfileInput.seniorities: Seniority[]`, `ProfileView.seniorities: Seniority[]`, and the column `profiles.seniorities Seniority[]` with check `profiles_seniorities_nonempty`.

- [ ] **Step 1: Contract and migration**

In `contract.prisma`, replace `seniority Seniority` with `seniorities Seniority[]` and add, next to the other `_nonempty` checks:

```prisma
  @@check(expression: sql`cardinality("seniorities") > 0`, name: "profiles_seniorities_nonempty")
```

Run: `pnpm --filter @xjobs/xjobs db:migration:plan`, then name the new folder `<timestamp>_profile_seniorities`, following the existing folders.
Expected: one new migration whose ops drop `seniority`, add `seniorities`, and add the check. No other migration changes (`git status` shows only the new folder, the contract files and a new snapshot).

- [ ] **Step 2: Write the failing tests**

`profile.dto.spec.ts` (the base payload uses `seniorities: ['senior']`):

- A valid `['senior', 'staff']` passes.
- `[]`, `['senior', 'senior']`, `['wizard']` and `'senior'` (not an array) each fail validation on the property `seniorities`.
- A payload that also has `seniority: 'senior'` is rejected (whitelist with `forbidNonWhitelisted`, as the existing `regions` test does).

`profiles.service.spec.ts`:

- `create` with `seniorities: [staff, senior, staff]` calls the repository with `seniorities: [senior, staff]`, and the view returns `[senior, staff]`.
- `replace` of a draft stored as `[senior]`, with `seniorities: [lead]`, writes exactly `[lead]`.
- `toQuerySearchInput(row with seniorities [senior, staff])` returns `seniorities: [senior, staff]`.

Update `resume.service.spec.ts` and the e2e `users.spec.ts` payload to `seniorities: [...]`. The e2e also asserts the created profile returns `seniorities: ['senior']`.

- [ ] **Step 3: Run the tests to make sure they fail**

Run: `npx nx test xjobs -- src/modules/users`
Expected: FAIL (the DTO still has `seniority`).

- [ ] **Step 4: Implement**

- DTO: `seniorities!: Seniority[]` with `@ApiProperty({ enum: Seniority, enumName: 'Seniority', isArray: true })`, `@IsArray()`, `@ArrayNotEmpty()`, `@ArrayUnique()`, `@IsEnum(Seniority, { each: true })`, copied from `engagements`.
- Response DTO: `@ApiProperty({ enum: Seniority, enumName: 'Seniority', isArray: true }) seniorities!: Seniority[]`.
- `ProfileInput`: `seniorities: Seniority[]`.
- Service: `create` and `replace` store `normalizeSeniorities(data.seniorities)`. `toProfileView` and `toQuerySearchInput` read `profile.seniorities as Seniority[]`. Remove the Task 1 shim.

- [ ] **Step 5: Verify**

Run: `npx nx run-many -t lint test build typecheck`
Expected: all green.

Then the local reset and e2e, which needs a local Postgres (the human runs these if this environment can't reach the DB):

```bash
pnpm --filter @xjobs/xjobs db:init   # on a dropped, fresh local database
pnpm --filter @xjobs/xjobs db:migrate
pnpm --filter @xjobs/xjobs db:verify
pnpm --filter @xjobs/xjobs db:seed
npx nx e2e xjobs-e2e
```

Expected: verify passes, and the e2e profile round-trips `seniorities`.

- [ ] **Step 6: Commit**

```bash
git add apps/xjobs/src/database apps/xjobs/src/modules/users apps/xjobs-e2e
git commit -m "feat: replace profile seniority with a seniorities set"
```

The PR description lists the local reset steps from Step 5.
