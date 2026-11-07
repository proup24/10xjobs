# Preferences and Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Profiles and users store every preference and eligibility value as approved codes from the processor's value lists, the database itself rejects bad codes, users can read the approved lists, and the engine runs on the new fields.

**Architecture:** Three steps, each one or more PRs to `main` that leave CI green:

1. **Add (the user):** new columns, eligibility, ISO reference tables, code-checking triggers and read access to the lists, all next to the old columns.
2. **Switch (the teammate):** the engine reads and writes the new fields, and the enum-typed columns become plain codes.
3. **Remove (the user):** drop the old columns and enums, and give the new columns their final names.

Code validation lives in `SECURITY DEFINER` trigger functions, so engine writes, service-role writes and `supabase-js` writes as the user are all checked the same way.

**Tech Stack:** Prisma 8 contract and migrations (`@prisma/orm-postgres`, Supabase extension pack), Postgres triggers in plpgsql, Supabase CLI local stack, Vitest (`apps/db-tests` against the stack, and engine unit tests), NestJS 11 with class-validator, zod 4 in the processor.

**Spec:** `docs/superpowers/specs/2026-11-05-preferences-and-eligibility-design.md`

**Linear ticket:** none (this project uses no ticket tracker).

**Branches and PRs:**

- PR A `feat/preferences-add` (Tasks 1–6, the user's), carrying the spec and this plan.
- PR B `feat/preferences-engine-switch` (Tasks 7–11, the teammate's), branched from `main` after PR A merges.
- PR C `feat/preferences-remove-legacy` (Tasks 12–13, the user's), branched from `main` after PR B merges.

## Global Constraints

- **Start condition:** PR A starts only after PR 1 of `docs/superpowers/plans/2026-11-05-shared-dev-database.md` (the `libs/database` move) has merged. Every `apps/xjobs/src/database/...` path below then lives under `libs/database/src/...`, and the `db:*` scripts move to `pnpm --filter @xjobs/database`. Use whichever path is current.
- **Schema source:** `contract.prisma` is the only schema source, RLS included. A schema change is a contract edit, then `db:migration:plan`, then hand-written `rawSql` operations added to the planned migration for anything the contract can't express: triggers, functions, grants, data updates. Existing migrations are never edited.
- **Bad codes are a database error,** raised as SQLSTATE `23514` (`check_violation`) with a message of the form `<table>.<column>: '<value>' is not an approved <list> code`.
- **Allowed codes:**
  - Every value list allows `status = 'approved'` only.
  - `seniorities`, `contract_types` and `engagements` also exclude `unstated`.
  - `role_kinds` allows only `"isEngineering" = true`.
  - Places are `{ "kind": "worldwide" }`, `{ "kind": "region", "code" }`, `{ "kind": "country", "code" }` or `{ "kind": "city", "id" }`, at most 20 per arrangement, with no duplicate in a list. The `GLOBAL` region is refused in profiles.
- **Language levels** are exactly `native`, `fluent` and `working`. **Salary periods** are exactly `hour`, `day`, `month` and `year`. **Work-authorization kinds** are exactly `work-permit`, `citizenship`, `residency` and `clearance`.
- **The 17 engineering role kinds** are `backend_engineer`, `frontend_engineer`, `fullstack_engineer`, `mobile_engineer`, `devops_engineer`, `site_reliability_engineer`, `platform_engineer`, `cloud_engineer`, `security_engineer`, `data_engineer`, `ml_engineer`, `ai_engineer`, `qa_engineer`, `embedded_engineer`, `software_architect`, `tech_lead` and `engineering_manager`.
- **Readable lists:** `authenticated` reads approved rows of `tech_tags`, `role_kinds`, `seniorities`, `contract_types`, `engagements`, `regions`, `countries` and `cities`, plus all rows of `region_countries`, `iso_languages` and `iso_currencies`. Users get no write access, and no access to `status`, `occurrences`, `firstSeenAt` or `approvedAt`.
- **No production data exists.** Dev profiles may be cleared. Approved vocabulary rows must never be deleted.
- After every schema change, regenerate the web app's types (`apps/web/src/lib/supabase/database.types.ts`, via `supabase gen types`, the same way slice 01 did).
- Run `npx nx run-many -t lint test build typecheck` and the `db-tests` suite before each PR.
- Resume files are written only by the web app (see `2026-11-06-resume-storage.md`); the engine only reads and deletes them.

## Review Focus

1. **A user calling `supabase-js` directly with a `proposed` tech tag, an unknown city id or `unstated`** must get `23514`, not a stored row. This is pinned by `vocab-codes.db.spec.ts`, which runs as a signed-in user and not only as the service role.
2. **Trigger functions must still see `status` after users lose `SELECT` on it.** If they aren't `SECURITY DEFINER`, every user write fails with `42501`. This is pinned by the owner-insert cases in `isolation.db.spec.ts` (Task 3 adds `profiles` rows with all new fields set).
3. **A profile whose top-importance tech is a concept tag such as `saas`** must still be searched, using its best techs that have search wording, and must never send "SaaS" as a keyword. Pinned in Task 8.
4. **A place whose label has no geoId** must fall back to its label text, lowercased, not be dropped. Pinned in Task 8.
5. **`acceptsAnyCurrency = true` with a non-empty `acceptedCurrencies`**, and `false` with an empty one, must both be refused, so "any" and "none" can't be confused. Pinned in Task 2.

---

## Step 1: Add (PR A, the user)

### Task 1: ISO reference tables and `role_kinds.isEngineering`

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma`: add `model IsoLanguage` (`code String @id`, `label String`, `@@map("iso_languages")`, `@@rls`), `model IsoCurrency` (the same shape, `@@map("iso_currencies")`), and `isEngineering Boolean @default(false)` on `RoleKind`.
- Create: `apps/xjobs/src/database/seeds/iso-data.ts`
- Create: `apps/xjobs/src/database/seeds/iso.seed.ts`, and register it in `apps/xjobs/src/database/seeds/index.ts`
- Modify: `apps/xjobs/src/modules/processor/vocab/seed-data.ts`: export `ENGINEERING_ROLE_KINDS`.
- Modify: `apps/xjobs/src/database/seeds/processor.seed.ts`: sets `isEngineering` on create.
- Create: the migration folder from `db:migration:plan`, plus a `rawSql` step `UPDATE public.role_kinds SET "isEngineering" = true WHERE code = ANY(<the 17>)`.
- Test: `apps/xjobs/src/database/seeds/iso-data.spec.ts`, `apps/xjobs/src/modules/processor/vocab/seed-data.spec.ts`

**Interfaces:**

- Produces:
  - `ISO_LANGUAGES: readonly { code: string; label: string }[]` and `ISO_CURRENCIES: readonly { code: string; label: string }[]` (from `iso-data.ts`).
  - `ENGINEERING_ROLE_KINDS: readonly string[]`, the 17 codes.
  - The tables `iso_languages(code, label)` and `iso_currencies(code, label)`, and the column `role_kinds."isEngineering"`.

- [ ] **Step 1: Write the failing tests**

```ts
// iso-data.spec.ts
it('lists ISO 639-1 codes, lowercase, unique', () => {
  const codes = ISO_LANGUAGES.map((l) => l.code);
  expect(new Set(codes).size).toBe(codes.length);
  expect(codes.every((c) => /^[a-z]{2}$/.test(c))).toBe(true);
  expect(codes).toEqual(expect.arrayContaining(['ar', 'fr', 'en', 'es', 'de']));
});
it('lists ISO 4217 codes, uppercase, unique', () => {
  const codes = ISO_CURRENCIES.map((c) => c.code);
  expect(new Set(codes).size).toBe(codes.length);
  expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
  expect(codes).toEqual(expect.arrayContaining(['USD', 'EUR', 'MAD', 'GBP']));
});
// seed-data.spec.ts
it('marks exactly the 17 engineering role kinds, all seeded', () => {
  expect(ENGINEERING_ROLE_KINDS).toHaveLength(17);
  const seeded = SEED.roleKinds.map((t) => t.code);
  expect(seeded).toEqual(expect.arrayContaining([...ENGINEERING_ROLE_KINDS]));
  expect(ENGINEERING_ROLE_KINDS).not.toContain('support');
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx nx test xjobs -- iso-data seed-data`
Expected: FAIL, because `ISO_LANGUAGES` and `ENGINEERING_ROLE_KINDS` aren't exported.

- [ ] **Step 3: Add the constants, the seed and the contract models**

`iso-data.ts` is a checked-in literal list: the official ISO 639-1 set and the active ISO 4217 set, with English labels. Don't generate it at runtime, because `Intl` output varies with the ICU version. `iso.seed.ts` upserts by `code`, like `processor.seed.ts`.

- [ ] **Step 4: Plan the migration, add the `UPDATE` step, then migrate and seed locally**

Run: `pnpm --filter @xjobs/xjobs db:migration:plan`, add the `rawSql` update, then run `db:migrate` and `db:seed`.
Expected: `SELECT count(*) FROM role_kinds WHERE "isEngineering"` returns 17, and `iso_languages` and `iso_currencies` are non-empty.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx nx test xjobs -- iso-data seed-data`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(db): ISO language and currency tables; mark engineering role kinds"
```

### Task 2: New profile columns and the code-checking triggers

**Files:**

- Modify: `contract.prisma` `Profile`, adding nullable columns:
  - `contractTypes String[]?`
  - `places Jsonb?` (the new-shape locations)
  - `spokenLanguages Jsonb?` (the new-shape languages)
  - `salaryMin Int?`, `salaryCurrency String?`, `salaryPeriod String?`
  - `acceptsAnyCurrency Boolean @default(true)`
  - `acceptedCurrencies String[] @default([])`

  It also makes the old `languages`, `country` and `locations` nullable, so step 2 can stop writing them.

- Modify: `contract.prisma`, with these checks:
  - `profiles_salary_all_or_none`: all three salary columns are null, or none is.
  - `profiles_salary_min_positive`: `"salaryMin" > 0`.
  - `profiles_salary_period`: `"salaryPeriod" IN ('hour','day','month','year')`.
  - `profiles_currencies_any_xor_list`: `("acceptsAnyCurrency" AND cardinality("acceptedCurrencies") = 0) OR (NOT "acceptsAnyCurrency" AND cardinality("acceptedCurrencies") > 0)`.
  - `profiles_contract_types_nonempty`: `"contractTypes" IS NULL OR cardinality("contractTypes") > 0`.
- Create: the migration folder, with `rawSql` steps that create the functions and triggers below. The steps also re-run the profiles column grants from `20261105T1246_pipeline_from_develop`, with the new columns added to both `GRANT INSERT` and `GRANT UPDATE`.
- Test: `apps/db-tests/src/vocab-codes.db.spec.ts` (new)

**Interfaces:**

- Produces these SQL functions. All are `SECURITY DEFINER`, `SET search_path = ''`, with `EXECUTE` revoked from `PUBLIC`, `anon` and `authenticated`:
  - `public.assert_codes(field text, list text, codes text[]) RETURNS void`
    - `list` is one of `tech_tags`, `role_kinds`, `seniorities`, `contract_types`, `engagements`, `regions`, `countries`, `iso_languages`, `iso_currencies`. Any other value raises.
    - It applies the allow rules from Global Constraints.
    - It raises `23514` on the first bad code, using the message format from Global Constraints.
  - `public.assert_places(field text, places jsonb) RETURNS void`. It validates the shape (exactly the keys `remote`, `hybrid` and `onsite`, each an array of at most 20 places with no duplicates), then the codes: regions and countries through `assert_codes`, cities by `id` in `cities` with `status = 'approved'`. `GLOBAL` is refused.
  - `public.assert_languages(field text, langs jsonb) RETURNS void`. It requires a non-empty array of `{ lang, level }`, with `lang` in `iso_languages`, `level` among the three levels, and each `lang` only once.
  - `public.profiles_check_codes()`, a trigger `BEFORE INSERT OR UPDATE ON public.profiles`. It checks `position` (`role_kinds`), `seniorities`, `engagements`, `contractTypes` when not null, `places` when not null, `spokenLanguages` when not null, `salaryCurrency` when not null, and `acceptedCurrencies`.
  - `public.profile_skills_check_codes()`, a trigger `BEFORE INSERT OR UPDATE ON public.profile_skills`. It checks `technology` against `tech_tags`.
- Consumes: the tables from Task 1.

- [ ] **Step 1: Write the failing test**

`vocab-codes.db.spec.ts` signs in a test user (`createTestUser` from `support/test-users.ts`) and inserts through that user's client, not `admin()`. The spec also adds an `expectCheckViolation(error, field)` helper that asserts `error.code === '23514'` and that the message contains `field`.

Use `it.each` with one bad payload per row, applied over a valid draft `profileFields()` plus the new fields:

| case                  | override                                                                              | field in message            |
| --------------------- | ------------------------------------------------------------------------------------- | --------------------------- |
| proposed tech         | skill `technology: <a code inserted by admin() with status 'proposed'>`               | `profile_skills.technology` |
| non-engineering role  | `position: 'support'`                                                                 | `profiles.position`         |
| unstated seniority    | `seniorities: ['unstated']`                                                           | `profiles.seniorities`      |
| unknown contract type | `contractTypes: ['gig']`                                                              | `profiles.contractTypes`    |
| unstated engagement   | `engagements: ['unstated']`                                                           | `profiles.engagements`      |
| unknown country place | `places: { remote: [{ kind: 'country', code: 'ZZ' }], hybrid: [], onsite: [] }`       | `profiles.places`           |
| GLOBAL region         | `places: { remote: [{ kind: 'region', code: 'GLOBAL' }], hybrid: [], onsite: [] }`    | `profiles.places`           |
| unknown city id       | `places: { remote: [], hybrid: [], onsite: [{ kind: 'city', id: randomUUID() }] }`    | `profiles.places`           |
| 21 places             | 21 distinct approved country places in `remote`                                       | `profiles.places`           |
| bad language          | `spokenLanguages: [{ lang: 'xx', level: 'fluent' }]`                                  | `profiles.spokenLanguages`  |
| bad level             | `spokenLanguages: [{ lang: 'en', level: 'basic' }]`                                   | `profiles.spokenLanguages`  |
| duplicate language    | `spokenLanguages: [{ lang: 'en', level: 'fluent' }, { lang: 'en', level: 'native' }]` | `profiles.spokenLanguages`  |
| bad currency          | `salaryMin: 5000, salaryCurrency: 'EURO', salaryPeriod: 'month'`                      | `profiles.salaryCurrency`   |

Also add these cases:

- **Accepts a full valid profile:**
  - `contractTypes: ['full_time', 'contract']`
  - `places: { remote: [{ kind: 'worldwide' }, { kind: 'region', code: 'EMEA' }, { kind: 'country', code: 'MA' }], hybrid: [], onsite: [] }`
  - `spokenLanguages: [{ lang: 'en', level: 'fluent' }]`
  - `salaryMin: 3000, salaryCurrency: 'EUR', salaryPeriod: 'month'`
  - `acceptsAnyCurrency: false, acceptedCurrencies: ['EUR', 'USD']`

  The insert must succeed, and reading the row back must return the same values.

- **Refuses partial salary:** `salaryMin: 3000` with a null currency gives `23514`.
- **Refuses currency "any" with a list:** `acceptsAnyCurrency: true, acceptedCurrencies: ['EUR']` gives `23514`.
- **Refuses currency "not any" with an empty list:** `acceptsAnyCurrency: false, acceptedCurrencies: []` gives `23514`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx nx run db-tests:db-test -- vocab-codes`
Expected: FAIL. The new columns don't exist yet, so the inserts error with `PGRST204`.

- [ ] **Step 3: Edit the contract, plan the migration, and add the functions, triggers and grants as `rawSql` steps**

Order the steps as functions, then triggers, then grants. Each trigger is `FOR EACH ROW` and calls the `assert_*` helpers.

- [ ] **Step 4: Migrate and run the suite**

Run: `pnpm --filter @xjobs/xjobs db:migrate`, then `npx nx run db-tests:db-test`.
Expected: `vocab-codes` passes, and the existing suites still pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(db): profile contract types, places, languages with levels, salary and currencies, checked against the value lists"
```

### Task 3: Fixtures and the isolation harness on the new profile fields

**Files:**

- Modify: `apps/db-tests/src/support/fixtures.ts`. `profileFields()` adds:
  - `contractTypes: ['full_time']`
  - `places: { remote: [{ kind: 'region', code: 'MENA' }, { kind: 'country', code: 'MA' }], hybrid: [], onsite: [] }`
  - `spokenLanguages: [{ lang: 'en', level: 'fluent' }, { lang: 'fr', level: 'native' }]`
- Modify: `apps/db-tests/src/support/registry.ts`. The `profiles` patch becomes `{ noticePeriodDays: 60, contractTypes: ['full_time', 'part_time'] }`.
- Test: the existing `isolation.db.spec.ts` and `profile-freeze.db.spec.ts`.

**Interfaces:** consumes the columns from Task 2.

- [ ] **Step 1: Update the fixture and the patch**
- [ ] **Step 2: Run** `npx nx run db-tests:db-test -- isolation profile-freeze`
      Expected: PASS. The owner insert and update succeed through the triggers (Review Focus 2), and cross-user and published-profile writes still fail with `42501` or zero rows, as before.
- [ ] **Step 3: Commit:** `test(db): isolation and freeze suites write the new profile fields`

### Task 4: Eligibility on users, and `work_authorizations`

**Files:**

- Modify: `contract.prisma`.
  - `User` gains `residenceCountry String?` and `acceptsSponsorship Boolean?`.
  - New `model WorkAuthorization`, mapped to `work_authorizations`, with `@@rls`:
    - columns `id Uuid @id @onCreate(uuid(7))`, `userId Uuid` (relation to `User`, `onDelete: Cascade`), `kind String`, `place String`, `+Timestamps`
    - `@@check` `work_authorizations_kind`: `kind IN ('work-permit','citizenship','residency','clearance')`
    - `@@unique([userId, kind, place])`, `@@index([userId])`
  - A `policy_all work_authorizations_owner` for `authenticated` with `using` and `withCheck` set to `"userId" = auth.uid()`, the same as `contacts_owner`.
- Create: the migration, with `rawSql` steps for two triggers:
  - `public.users_check_codes()` (`BEFORE INSERT OR UPDATE ON public.users`): `residenceCountry` must be in `countries` when not null.
  - `public.work_authorizations_check_codes()`: `place` must be an approved `countries` or `regions` code, and `GLOBAL` is refused.
- Modify: `apps/db-tests/src/support/registry.ts`, adding a `work_authorizations` entry:
  - `seed`: admin-insert `{ userId, kind: 'work-permit', place: 'MA' }`
  - `insertPayload`: `{ id, userId, kind: 'citizenship', place: 'MA' }`
  - `patch`: `{ kind: 'residency' }`
  - `canDelete: true`
- Modify: the `users` registry patch becomes `{ name: 'Renamed', residenceCountry: 'MA', acceptsSponsorship: false }`.
- Create: `apps/db-tests/src/eligibility.db.spec.ts`

**Interfaces:**

- Produces:
  - The columns `users."residenceCountry"` and `users."acceptsSponsorship"`.
  - The table `work_authorizations(id, userId, kind, place)`.
  - A new helper in `fixtures.ts`: `seedWorkAuthorization(userId: string, kind: string, place: string): Promise<string>`.

- [ ] **Step 1: Write the failing tests in `eligibility.db.spec.ts`**, all as a signed-in user:
  - **Stores and reads eligibility:** update own `users` row to `{ residenceCountry: 'MA', acceptsSponsorship: true }`, insert authorizations `{ kind: 'work-permit', place: 'MA' }` and `{ kind: 'work-permit', place: 'EU' }`, and read them back as equal.
  - **Refuses a bad residence:** `residenceCountry: 'ZZ'` gives `23514`, with `users.residenceCountry` in the message.
  - **Refuses a bad kind:** `kind: 'visa'` gives `23514`.
  - **Refuses a bad place:** `place: 'ZZ'` gives `23514`, and `place: 'GLOBAL'` gives `23514`.
  - **Refuses a duplicate pair:** inserting the same `{ kind, place }` twice gives `23505`.
  - **Allows none:** a user with zero authorizations reads an empty list without error.
- [ ] **Step 2: Run them to make sure they fail.** Run `npx nx run db-tests:db-test -- eligibility`. Expected: FAIL, because the columns and table are missing.
- [ ] **Step 3: Edit the contract, plan the migration, add the triggers, and migrate**
- [ ] **Step 4: Run** `npx nx run db-tests:db-test`. Expected: `eligibility` passes, and `isolation` now covers `work_authorizations`: the owner can do everything, and the other user can do nothing.
- [ ] **Step 5: Commit:** `feat(db): per-user eligibility: residence, sponsorship and work authorizations`

### Task 5: Read-only access to the value lists

**Files:**

- Modify: `contract.prisma`. Add one `policy_select <table>_read_approved` for `authenticated` on each list model:
  - `TechTag`, `RoleKind`, `SeniorityTerm`, `ContractType`, `EngagementTerm`, `RegionTerm`, `Country` and `City` use `using = sql\`status = 'approved'\``.
  - `RegionCountry`, `IsoLanguage` and `IsoCurrency` use `using = sql\`true\``.
- Create: the migration, with a `rawSql` grants step. Per table, it runs `REVOKE ALL ON public.<t> FROM anon, authenticated;` followed by a column grant:
  - Lists: `GRANT SELECT (code, label, aliases) ...`
  - `role_kinds`: adds `"isEngineering"`.
  - `cities`: `GRANT SELECT (id, name, "countryCode", aliases) ...`
  - `region_countries`: `GRANT SELECT ("regionCode", "countryCode") ...`
  - ISO tables: `GRANT SELECT (code, label) ...`
- Create: `apps/db-tests/src/vocab-read.db.spec.ts`

**Interfaces:** produces the read access the web app's pickers use (slice 07).

- [ ] **Step 1: Write the failing tests.** Use `admin()` to insert one `proposed` row into `tech_tags` and one into `cities`, and remove them in `afterAll`. Then, as a signed-in user, for each of the 11 tables:
  - **Reads approved rows:** `select('code, label')` (or the table's granted columns) returns more than 0 rows.
  - **Hides proposed rows:** the proposed `tech_tags` and `cities` rows are absent.
  - **Refuses hidden columns:** `select('status')` errors with `42501`.
  - **Refuses writes:** insert, update and delete each error with `42501`, or affect 0 rows.
  - An anonymous client reads 0 rows, or gets `42501`.
- [ ] **Step 2: Run them to make sure they fail.** Run `npx nx run db-tests:db-test -- vocab-read`. Expected: FAIL, because users read 0 rows today.
- [ ] **Step 3: Add the policies, plan the migration, add the grants, and migrate**
- [ ] **Step 4: Run the whole `db-tests` suite.** Expected: PASS, including `rls-enabled` and `engine-tables` (unchanged: the list tables were never in its fixture list).
- [ ] **Step 5: Commit:** `feat(db): users read the approved value lists, read-only`

### Task 6: Web types and roadmap docs

**Files:**

- Modify: `apps/web/src/lib/supabase/database.types.ts` (regenerated).
- Modify: the roadmap docs, as the spec's section "Roadmap docs to update in the same PR" lists:
  - `docs/roadmap/phase-1-accounts-and-preferences/04-preferences-schema.md`
  - `docs/roadmap/phase-1-accounts-and-preferences/05-eligibility-schema.md`
  - `docs/roadmap/phase-1-accounts-and-preferences/07-guided-setup-ui.md`
  - `docs/roadmap/phase-1-accounts-and-preferences/README.md`

- [ ] **Step 1: Regenerate the types.** Run `npx nx run-many -t typecheck`. Expected: PASS.
- [ ] **Step 2: Edit the four roadmap docs**
- [ ] **Step 3: Run the CI set:** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 4: Commit:** `docs: roadmap slices 04, 05 and 07 follow the preferences and eligibility spec`. Then hand PR A to the human to push.

---

## Step 2: Switch (PR B, the teammate)

### Task 7: Enum-typed columns become codes; profile DTOs take the new shape

**Files:**

- Modify: `contract.prisma`:
  - `Profile.position` becomes `String`.
  - `Profile.seniorities` becomes `String[]`.
  - `Profile.engagements` becomes `String[]`.
  - `ProfileSkill.technology` becomes `String`.
  - The planned migration drops the generated enum check constraints on those columns, because the Task 2 triggers now do that check.
- Modify: `apps/xjobs/src/modules/users/types/profile.types.ts`. `ProfileInput`:
  - drops `country`, `city` and `languages: Language[]`
  - types `position` as `string`, `seniorities` as `string[]` and `engagements` as `string[]`
  - adds `contractTypes: string[]`
  - adds `locations: PlacesByArrangement`, written to the column `places`
  - adds `languages: SpokenLanguage[]`, written to the column `spokenLanguages`
  - adds `salary: { min: number; currency: string; period: SalaryPeriod } | null`
  - adds `acceptsAnyCurrency: boolean` and `acceptedCurrencies: string[]`

  `SkillInput.technology` becomes `string`.

- Create: `apps/xjobs/src/modules/users/types/place.types.ts`, exporting:
  - `Place = { kind: 'worldwide' } | { kind: 'region'; code: string } | { kind: 'country'; code: string } | { kind: 'city'; id: string }`
  - `PlacesByArrangement = Record<LocationArrangement, Place[]>`
  - `SpokenLanguage = { lang: string; level: 'native' | 'fluent' | 'working' }`
  - `SalaryPeriod = 'hour' | 'day' | 'month' | 'year'`
- Modify: `apps/xjobs/src/modules/users/dto/profile.dto.ts`, `locations.dto.ts`, `skill.dto.ts`, `profile.response.dto.ts` and `skill.response.dto.ts`.
  - DTOs check shapes only. Codes are strings matching `/^[a-z0-9_]+$/`, or the ISO regexes. The database checks membership.
  - Remove `IsEnum(Language|Position|Engagement|Seniority|Technology)`.
- Modify: `apps/xjobs/src/modules/users/repositories/profiles.repository.ts`. It writes `places`, `spokenLanguages`, `contractTypes`, the salary columns and the currency columns, and stops writing `country`, `city`, `languages` and `locations`.
- Modify: `apps/xjobs/src/database/errors.ts`, adding `isCheckViolation(error: unknown): boolean` (SQLSTATE `23514`).
- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts`. `create` and `replace` turn a check violation into `BadRequestException(<the database message>)`.
- Test: `profile.dto.spec.ts`, `profiles.service.spec.ts`, `database/errors.spec.ts`, and `apps/xjobs-e2e/src/xjobs/users.spec.ts`

**Interfaces:**

- Consumes: the columns and triggers from Tasks 2 and 4.
- Produces: `Place`, `PlacesByArrangement`, `SpokenLanguage`, `SalaryPeriod` and `isCheckViolation`.

- [ ] **Step 1: Write the failing tests**
  - `errors.spec.ts`: `isCheckViolation({ code: '23514' })` is true, and `isCheckViolation({ code: '23505' })` is false.
  - `profile.dto.spec.ts`:
    - A body with `locations.remote: [{ kind: 'planet', code: 'x' }]` fails validation.
    - `languages: [{ lang: 'EN', level: 'fluent' }]` fails, because the code must be lowercase.
    - `salary: { min: 0, currency: 'EUR', period: 'month' }` fails, because the minimum must be at least 1.
    - Sending `country` gets a 400, because it isn't whitelisted.
  - `profiles.service.spec.ts`: when the repository rejects with `{ code: '23514', message: "profiles.position: 'support' is not an approved role_kinds code" }`, `create` throws `BadRequestException` with that message.
  - `users.spec.ts` (e2e): creating a profile with the new shape returns 201 and echoes `locations` as places, and `position: 'support'` returns 400.
- [ ] **Step 2: Run** `npx nx test xjobs -- errors profile.dto profiles.service`. Expected: FAIL.
- [ ] **Step 3: Implement the contract change and migration, the types, the DTOs, the repository and the error mapping**
- [ ] **Step 4: Run** `npx nx test xjobs` and `npx nx e2e xjobs-e2e`. Expected: PASS. Query generation still compiles, because Task 8 lands in the same PR. If Task 8 isn't done yet, its tests are the next failing ones.
- [ ] **Step 5: Commit:** `feat(users): profiles take codes, places, languages with levels, contract types, salary and currencies`

### Task 8: Query generation from codes and places

**Files:**

- Modify: `apps/xjobs/src/modules/queries/types/query-search.types.ts`. `Position`, `Seniority` and `Technology` become `string` in `RankedSkill`, `TechnologySet`, `QuerySearchProfileInput` and `QuerySearchCombination`. `LocationsByArrangement` stays text: query generation still searches with text.
- Modify: `apps/xjobs/src/modules/queries/builders/keywords.ts`.
  - `POSITION_TITLES` becomes `Readonly<Record<string, readonly string[]>>`.
  - `TECHNOLOGY_TERMS` becomes `Readonly<Record<string, string>>`.
  - `SENIORITY_WORDS` becomes `Readonly<Record<string, string | null>>`.
  - The keys and values are unchanged.
- Modify: `apps/xjobs/src/modules/queries/channels/linkedin_board.builder.ts`. `LINKEDIN_TERMS` and `EXPERIENCE_LEVELS` are keyed by `string`.
- Modify: `apps/xjobs/src/modules/queries/sets/technology.ts`. `topSkills` keeps only skills whose `technology` is a key of `TECHNOLOGY_TERMS`, after dropping importance 0 and before ranking.
- Create: `apps/xjobs/src/modules/users/services/place-labels.ts`, exporting `placeTexts(places: PlacesByArrangement, labels: PlaceLabels): LocationsByArrangement`, where `PlaceLabels = { regions: Map<string, string>; countries: Map<string, string>; cities: Map<string, { name: string; countryCode: string }> }`. Each place maps to text:
  - `worldwide` becomes `'Worldwide'`
  - a region or country becomes its label
  - a city becomes `'<name>, <country label>'`
- Modify: `apps/xjobs/src/modules/users/repositories/profiles.repository.ts`, adding `placeLabels(places: Place[]): Promise<PlaceLabels>`. It reads `regions`, `countries` and `cities` by the codes and ids given.
- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts`. `toQuerySearchInput` becomes async, or receives `PlaceLabels`, and passes `placeTexts(...)` as `locations`.
- Modify: `apps/xjobs/src/modules/queries/builders/recipe.ts`. `QUERY_SEARCH_RECIPE_VERSION` becomes `11`.
- Test: `technology.spec.ts`, `place-labels.spec.ts` (new), `recipe.spec.ts`, `linkedin_board` cases in `channels.spec.ts`, and `expand.scenarios.spec.ts`

**Interfaces:**

- Consumes: `Place` and `PlacesByArrangement` from Task 7.
- Produces: `placeTexts` and `PlaceLabels`.

- [ ] **Step 1: Write the failing tests**
  - `technology.spec.ts`: skills `[{ technology: 'saas', importance: 10, mastery: 10 }, { technology: 'go', importance: 8 }, { technology: 'microservices', importance: 9 }, { technology: 'nodejs', importance: 7 }]` give `topTechnologies` equal to `['go', 'nodejs']` (Review Focus 3).
  - `place-labels.spec.ts`:
    - `{ remote: [{ kind: 'region', code: 'EMEA' }, { kind: 'worldwide' }], hybrid: [], onsite: [{ kind: 'city', id: 'c1' }] }`, with labels `EMEA → 'EMEA'` and `c1 → { name: 'Paris', countryCode: 'FR' }` and `FR → 'France'`, gives `{ remote: ['EMEA', 'Worldwide'], hybrid: [], onsite: ['Paris, France'] }`.
    - A missing label throws `Error` naming the code.
  - `channels.spec.ts`: the country `united kingdom` keeps geoId `'101165590'`, and a city `'Rabat, Morocco'` with no geoId searches its location text `'rabat, morocco'` (Review Focus 4).
  - `recipe.spec.ts`: `'is at recipe version 11'`.
- [ ] **Step 2: Run** `npx nx test xjobs -- queries place-labels`. Expected: FAIL.
- [ ] **Step 3: Implement the type changes, the wording filter, `placeTexts`, the repository lookup and the recipe bump**
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: PASS. Update the fixtures in `queries/testing/profiles.fixture.ts` to string codes.
- [ ] **Step 5: Commit:** `feat(queries): search from tech codes with search wording and from place labels; recipe v11`

### Task 9: Publishing needs eligibility

**Files:**

- Modify: `apps/xjobs/src/modules/users/repositories/users.repository.ts`, adding `eligibility(userId: string): Promise<{ residenceCountry: string | null; acceptsSponsorship: boolean | null }>`.
- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts`. `publish` throws `ConflictException(ELIGIBILITY_REQUIRED)` before any write when either value is null, where `ELIGIBILITY_REQUIRED = 'set your country of residence and answer the visa sponsorship question before publishing'`.
- Modify: `apps/xjobs/src/modules/users/dto/update-user.dto.ts` and `user.response.dto.ts`, adding optional `residenceCountry` (ISO alpha-2) and `acceptsSponsorship` (boolean). The e2e tests need them, and the web app will write them directly.
- Test: `profiles.service.spec.ts`, and `apps/xjobs-e2e/src/xjobs/users.spec.ts`

- [ ] **Step 1: Write the failing tests**
  - `publish` with eligibility `{ residenceCountry: null, acceptsSponsorship: false }` rejects with `ConflictException(ELIGIBILITY_REQUIRED)`, and the publish repository method isn't called.
  - With `{ 'MA', null }` it rejects the same way.
  - With `{ 'MA', false }` it publishes.
  - e2e: publishing before setting eligibility gives 409, and after `PATCH /users/me` with both values it succeeds.
- [ ] **Step 2: Run them to make sure they fail.** Run `npx nx test xjobs -- profiles.service`. Expected: FAIL.
- [ ] **Step 3: Implement the check and the update-user DTO fields**
- [ ] **Step 4: Run** `npx nx test xjobs` and `npx nx e2e xjobs-e2e`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(users): publishing requires residence and a sponsorship answer`

### Task 10: The processor uses `isEngineering` and the four authorization kinds

**Files:**

- Modify: `apps/xjobs/src/modules/processor/repositories/vocab.repository.ts`. `Vocabulary` gains `engineeringRoleKinds: ReadonlySet<string>`, which `snapshot()` fills from `role_kinds` rows where approved and `isEngineering`. Update the in-memory fake in `modules/processor/testing/`.
- Modify: `apps/xjobs/src/modules/processor/rules/validate.ts`. `checkConsistency(doc: ExtractionDocument, engineeringRoleKinds: ReadonlySet<string>)` drops `ENGINEERING_CODES` and the `Position` import. `fact-assembler.service.ts` passes the set from the snapshot.
- Modify: `apps/xjobs/src/modules/processor/schema/shared.ts`. The requirement `kind` becomes `z.enum(['work-permit', 'citizenship', 'residency', 'clearance'])`.
- Test: `rules/validate.spec.ts`, `schema/extraction.spec.ts`, `repositories/vocab.repository.spec.ts`

- [ ] **Step 1: Write the failing tests**
  - `checkConsistency(docWith({ roleKind: 'backend_engineer', isSoftwareEngineeringRole: false }), new Set(['backend_engineer']))` marks both facts `unsure`. The same document with an empty set and `isSoftwareEngineeringRole: true` also marks both `unsure`.
  - Parsing a requirement `{ kind: 'visa', place: 'US' }` fails, and `{ kind: 'work-permit', place: 'US' }` passes.
  - `snapshot().engineeringRoleKinds` holds 17 codes after the seed.
- [ ] **Step 2: Run** `npx nx test xjobs -- processor`. Expected: FAIL.
- [ ] **Step 3: Implement the changes**
- [ ] **Step 4: Run** `npx nx test xjobs`, then `pnpm --filter @xjobs/xjobs processor:eval`. Expected: tests PASS, and the eval scores are no worse than on `main`. If any golden case used another `kind`, fix the case.
- [ ] **Step 5: Commit:** `feat(processor): engineering role kinds from role_kinds; four work-authorization kinds`

### Task 10a: The resume endpoints go

This task belongs in PR B. It follows the spec's "Engine changes" list in `docs/superpowers/specs/2026-11-06-resume-storage-design.md`. Until it lands, the engine's temporary resume endpoints still work.

**Files:**

- Delete: `apps/xjobs/src/modules/users/controllers/resume.controller.ts`.
- Modify: `apps/xjobs/src/modules/users/services/resume.service.ts`. Remove the upload, download and delete methods and the engine's "drafts only" rule. Remove `onModuleInit`, the `OnModuleInit` import and `implements OnModuleInit`. Keep `RESUMES_BUCKET`, `deleteProfile` and `removeAllFor`, and change them as in Step 3.
- Modify: `apps/xjobs/src/modules/users/services/resume.service.spec.ts`. Remove the tests for the removed methods, and the test "ensures its bucket on startup" (lines 214-217), since `onModuleInit` goes.
- Modify: `apps/xjobs/src/modules/users/users.module.ts`. Drop the `ResumeController` import and its registration in `controllers`. Keep `ResumeService` and the `RESUMES_BUCKET` provider.
- Modify: `apps/xjobs/src/modules/users/dto/profile.response.dto.ts`: no change. `ResumeInfoResponseDto` stays, because `ProfileResponse` uses it (line 76).
- No change: `apps/xjobs/src/modules/users/controllers/profiles.controller.ts`. It only calls `resume.deleteProfile`.
- Modify: `apps/xjobs/src/swagger/contract.spec.ts`. Drop the `ResumeController` import (line 12) and registration (line 38), the three resume route assertions (`DELETE`, `GET` and `POST` on `/api/users/{userId}/profiles/{profileId}/resume`, lines 115-130), and the test "documents the resume upload limit and the PDF download" (line 195).
- Modify: `apps/xjobs-e2e/src/xjobs/users.spec.ts`. Remove the tests "uploads and downloads a resume PDF" and "rejects a file that is not a PDF" (lines 219-247).
- Modify: `apps/xjobs/src/modules/storage/services/storage.service.ts`. Add an abstract `deletePrefix(bucket: string, prefix: string): Promise<void>`, which removes every object whose key starts with `prefix/`. `ensureBucket` stays.
- Modify: `apps/xjobs/src/modules/storage/services/supabase-storage.service.ts`. Implement `deletePrefix` by paging through Storage `list(prefix)` (the default limit is 100, so loop with `offset` until a page comes back short) and recursing into folder entries (entries with `id == null`), then `remove` of the file keys; a missing folder is not an error. `ensureBucket` stays.
- Modify: `apps/xjobs/src/modules/storage/testing/memory-storage.service.ts`. Implement `deletePrefix` by removing every key under the prefix. `ensureBucket` stays.
- Test: `apps/xjobs/src/modules/storage/services/supabase-storage.service.spec.ts`, and `apps/xjobs/src/modules/users/services/resume.service.spec.ts`.

`StorageService.ensureBucket` is not removed. The collection and ingest workers still call it for `collection-batches` (`apps/xjobs/src/infrastructure/worker/collection.service.ts:27` and `ingest.service.ts:33`). Only the resume service's startup call goes.

- [ ] **Step 1: Remove the endpoints.** Delete `ResumeController` and its registration in `users.module.ts`. Remove the `save`, `get` and `delete` methods of `ResumeService`, the "drafts only" rule, and the `contract.spec.ts` and e2e tests listed above. Remove `onModuleInit` and its spec test.
- [ ] **Step 2: Write the failing tests.** In `supabase-storage.service.spec.ts`, `deletePrefix` removes every listed key under `<prefix>/` and tolerates an empty folder. In `resume.service.spec.ts`, put a file at `<userId>/<profileId>/first.pdf` and another at `<userId>/<profileId>/second.pdf` (not only `resumeKey`), then `deleteProfile` leaves no object under that folder, and `removeAllFor` clears everything under the user's prefix. Add a test that a file under a folder with no profile row (`<userId>/<unknownProfileId>/x.pdf`) is removed by `removeAllFor`. In `supabase-storage.service.spec.ts`, also cover more than 100 objects (paging) and a nested folder entry. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `deletePrefix` to the abstract `StorageService`, the Supabase implementation and the memory fake. In `resume.service.ts`, `deleteProfile` calls `deletePrefix(bucket, `${userId}/${profileId}`)`, and `removeAllFor` calls `deletePrefix(bucket, userId)` for the whole `<userId>/` prefix instead of looping over the database's profile list (that would orphan files whose profile row is gone), in place of the single-key `discard` of `resumeKey`. Keep the best-effort behaviour: a failure is logged and leaves an orphan, as `discard` does today. Remove `onModuleInit`, the `OnModuleInit` import and `implements OnModuleInit`. Keep `STORAGE_RESUMES_BUCKET`, which must be `resumes`: the migration, the policies and the web app fix that name. Suggest pinning it, e.g. `z.literal('resumes')` in `environment.validation.ts`.
- [ ] **Step 4: Run** `npx nx test xjobs` and `npx nx e2e xjobs-e2e`. Expected: PASS.
- [ ] **Step 5: Commit:** `refactor(xjobs): remove the temporary resume endpoints; delete a profile's whole folder`

### Task 11: Regenerate and hand off

- [ ] **Step 1: Regenerate the web types.** Run `npx nx run-many -t lint test build typecheck` and the `db-tests` suite. Expected: PASS.
- [ ] **Step 2: Check that nothing in the engine reads the old columns:** `grep -rnE "\.(country|city)\b|languages|locations" apps/xjobs/src/modules/users apps/xjobs/src/modules/queries`. Expected: only the new-shape uses (`spokenLanguages`, `places`, and the `LocationsByArrangement` text).
- [ ] **Step 3: Commit, and add to the PR description:** run `pnpm --filter @xjobs/xjobs db:regenerate` once after deploy, and `db:reprocess -- --all-in-scope` if the processor schema change requires it.

---

## Step 3: Remove (PR C, the user)

### Task 12: Drop the old columns and enums; final names

**Files:**

- Modify: `contract.prisma`:
  - Drop `Profile.country`, `city`, `languages` (old) and `locations` (old).
  - Rename `places` to `locations` and `spokenLanguages` to `languages`.
  - Make `locations`, `languages` and `contractTypes` required, with the checks `profiles_locations_nonempty` (at least one place overall), `profiles_languages_nonempty` and `profiles_contract_types_nonempty` (`cardinality > 0`).
  - Delete `enum Technology`, `Position`, `Region` and `Language`.
- Modify: the migration. Clear dev profiles first (`DELETE FROM public.profiles WHERE "locations" IS NULL OR "languages" IS NULL OR "contractTypes" IS NULL`, run before the renames and `NOT NULL`). Update the trigger function `public.profiles_check_codes()` for the new column names and field names in messages. Re-run the profiles column grants with the final column list.
- Delete: `apps/xjobs/src/common/enums/technology.enum.ts`, `position.enum.ts`, `region.enum.ts` and `language.enum.ts`, plus their exports and cases in `index.ts` and `enums.spec.ts`.
- Modify: the engine code the compiler flags after the rename (`profiles.repository.ts` column names), the db-tests fixtures and registry (`places` becomes `locations`, `spokenLanguages` becomes `languages`), `vocab-codes.db.spec.ts` field names, and `vocab.repository.ts` if it imports `Region`.
- Test: the whole `db-tests` suite, plus `npx nx run-many -t lint test build typecheck`

- [ ] **Step 1: Update the `vocab-codes` and `eligibility` specs to the final names,** and add a case: inserting a profile without `contractTypes` gives `23502`, without `locations` gives `23502`, and with all three location lists empty gives `23514`.
      Also add to `common/enums/enums.spec.ts`: `Object.values(Seniority)` equals the `SEED.seniorities` codes without `unstated`, and `Object.values(Engagement)` equals the `SEED.engagements` codes without `unstated`. Both enums stay as TypeScript unions, so this test is what catches drift.
- [ ] **Step 2: Run them to make sure they fail.** Run `npx nx run db-tests:db-test -- vocab-codes`. Expected: FAIL, because the columns still have their old names.
- [ ] **Step 3: Edit the contract, plan the migration, add the cleanup, trigger and grant steps, delete the enums, and fix compile errors**
- [ ] **Step 4: Migrate and run everything:** `db:migrate`, the `db-tests` suite, and `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Check that no copy of a list remains:** `grep -rnE "enum (Technology|Position|Region|Language)\b" apps libs`. Expected: no matches outside `migrations/snapshots`.
- [ ] **Step 6: Commit:** `refactor(db): drop the old profile columns and the enums copied from the value lists`

### Task 13: Final types and handoff

- [ ] **Step 1: Regenerate the web types.** Run the full CI set. Expected: PASS.
- [ ] **Step 2: Commit** `chore(web): regenerate database types` and hand PR C to the human to push.
