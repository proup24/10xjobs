# Query Search `generate` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `QuerySearchService.expand` a short pipeline of pure steps that emits top-2 single-technology recipes, region-free city-bound onsite/hybrid recipes, treats `unstated` as remote, defaults remote to `GLOBAL`, and is pinned by mock-profile scenario tests.

**Architecture:** One pure function per step under `apps/xjobs/src/modules/queries/steps/`, composed in `expand`. `locationRegion` becomes nullable end to end (contract, types, DTO). One city predicate backs a profile DTO validator (400 at write) and `assertLocatable` (400 at publish). A fixture file of realistic mock profiles drives exact-output scenario tests.

**Tech Stack:** NestJS 11, TypeScript strict (nodenext), Vitest, class-validator, Prisma Next contract + migrations.

**Spec:** `docs/superpowers/specs/2026-10-31-query-search-generate-design.md`

## Global Constraints

- `QUERY_SEARCH_TOP_TECHNOLOGIES = 2`; technology sets are singles only.
- `QUERY_SEARCH_RECIPE_VERSION = 2`.
- Onsite/hybrid recipes: `locationRegion = null`, `country` and `city` set; never multiplied by region.
- Remote recipes: `country = null`, `city = null`, one per region.
- `unstated` is always treated as `remote`, even next to other arrangements. No recipe has `type = unstated`.
- Remote (or unstated) with empty `regions` searches `[GLOBAL]`; never an error.
- Error copy, verbatim: `city is required when arrangements include onsite or hybrid`.
- Steps are pure: no Nest imports except `BadRequestException` in `assertLocatable`, no DB.
- Work on branch `feat/query-search`. Claude does not push.

## Review Focus

1. `arrangements: [onsite, unstated]` → per rule 2, `unstated` becomes `remote`, so remote recipes appear too (old code dropped it). Pinned in Task 2 (`normalizeArrangements`) and Task 4.
2. `city: '   '` with onsite → treated as missing and rejected, not searched as an empty city. Pinned in Task 2 (`normalizeProfile` + `assertLocatable`) and Task 5 (DTO).
3. Two profiles in the same city with different `regions` → identical onsite hashes (the point of the change). Pinned in Task 4.
4. Duplicate regions or a technology listed under two domains → no duplicate recipes. Pinned in Task 1 (existing test kept) and Task 3 (`dedupeByHash`).
5. A builder row with `locationRegion = null` serialises through the response DTO as `null`, not dropped. Pinned in Task 3 (swagger contract spec).

(Regions empty → `GLOBAL`, ties, importance 0, messy formatting and cross-profile sharing are pinned end to end in Task 5.)

---

### Task 1: Top-2 single technology sets

**Files:**

- Modify: `apps/xjobs/src/modules/queries/sets/technology.ts`
- Test: `apps/xjobs/src/modules/queries/sets/technology.spec.ts`

**Interfaces:**

- Produces: `technologySets(skills: RankedSkill[]): Technology[][]` returning `[[a],[b]]`, `[[a]]` or `[[]]`; `QUERY_SEARCH_TOP_TECHNOLOGIES = 2`.

- [ ] **Step 1: Update the tests.** Replace `'keeps only the top 3 of 5'` with `'keeps only the top 2 of 5'` expecting `[postgresql, react]`. Replace the `technologySets` block with:
  - `'returns 2 single sets for 3 technologies'` → `[[a], [b]]`
  - `'returns 2 single sets for 2 technologies'` → `[[a], [b]]`
  - `'returns 1 set for 1 technology'` → `[[a]]`
  - `'returns one empty set for 0 technologies'` → `[[]]`
- [ ] **Step 2: Run** `npx nx test xjobs -- sets/technology` — Expected: FAIL (3 items / pair set).
- [ ] **Step 3: Implement.** Set the constant to 2; `technologySets` returns `top.map((t) => [t])`, or `[[]]` when empty. Update its doc comment.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(queries): search only the top two technologies, each alone`.

### Task 2: Normalize and location predicates

**Files:**

- Create: `apps/xjobs/src/modules/queries/steps/normalize.ts`, `steps/normalize.spec.ts`
- Create: `apps/xjobs/src/modules/queries/steps/locatable.ts`, `steps/locatable.spec.ts`
- Create: `apps/xjobs/src/modules/queries/steps/index.ts` (barrel)
- Modify: `apps/xjobs/src/modules/queries/index.ts` (export the predicates and messages)

**Interfaces:**

- Produces (normalize.ts):
  - `DEFAULT_REMOTE_REGION = Region.GLOBAL`
  - `normalizeProfile(input: QuerySearchProfileInput): QuerySearchProfileInput` — `country.trim().toUpperCase()`, `city.trim() || null`, regions deduplicated in first-seen order, empty regions → `[DEFAULT_REMOTE_REGION]`. Other fields unchanged.
  - `normalizeArrangements(arrangements: Arrangement[]): Arrangement[]` — `unstated` → `remote`, empty → `[remote]`, deduplicated in first-seen order.
- Produces (locatable.ts):
  - `CITY_REQUIRED = 'city is required when arrangements include onsite or hybrid'`
  - `isLocatable(arrangements: Arrangement[], city: string | null | undefined): boolean` — false iff some arrangement is onsite/hybrid and `city?.trim()` is empty.
  - `assertLocatable(profile: QuerySearchProfileInput): void` — throws `BadRequestException(CITY_REQUIRED)` when `!isLocatable(profile.arrangements, profile.city)`.

- [ ] **Step 1: Write failing tests.**
  - normalize: `' ma '` → `'MA'`; `'  Casablanca '` → `'Casablanca'`; `'   '` → `null`; `[EMEA, EMEA, MENA]` → `[EMEA, MENA]`; `[]` → `[GLOBAL]`; `normalizeArrangements([unstated])` → `[remote]`; `([])` → `[remote]`; `([onsite, unstated, remote])` → `[onsite, remote]`; `([hybrid])` → `[hybrid]`.
  - locatable: `isLocatable([onsite], null)` false; `([hybrid], '  ')` false; `([remote], null)` true; `([onsite], 'Paris')` true. `assertLocatable` throws `BadRequestException` with `CITY_REQUIRED` for onsite + null city and does not throw for remote + `[]` regions.
- [ ] **Step 2: Run** `npx nx test xjobs -- queries/steps` — Expected: FAIL (modules not found).
- [ ] **Step 3: Implement** both files and the barrel.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(queries): add normalize and location rule steps`.

### Task 3: Nullable `locationRegion`, recipe v2, combination steps

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma:297` (`locationRegion Region?`), then emitted `contract.json` / `contract.d.ts` / `models.ts` via the emit command
- Create: migration via `pnpm --filter @xjobs/xjobs db:migration:plan` (name it `nullable_builder_location_region`)
- Modify: `apps/xjobs/src/modules/queries/types/query-search.types.ts` (`locationRegion: Region | null`)
- Modify: `apps/xjobs/src/modules/queries/dto/query-search-builder.response.dto.ts` (`nullable: true`, `Region | null`)
- Modify: `apps/xjobs/src/modules/queries/builders/recipe.ts` (`QUERY_SEARCH_RECIPE_VERSION = 2`)
- Modify: `apps/xjobs/src/modules/queries/builders/channel.builder.ts` (`locationText`, `jobBoardFilterQuery` handle `null` region)
- Create: `apps/xjobs/src/modules/queries/steps/combinations.ts`, `steps/combinations.spec.ts`
- Test: `queries/channels/channels.spec.ts`, `queries/builders/recipe.spec.ts`, `src/swagger/contract.spec.ts`

**Interfaces:**

- Consumes: `normalizeArrangements` (Task 2), `technologySets` (Task 1).
- Produces (combinations.ts):
  - `remoteCombinations(profile: QuerySearchProfileInput, arrangements: Arrangement[], technologies: Technology[][]): QuerySearchCombination[]` — empty unless `arrangements` includes remote; else `channel × region × set`, in `Object.values(Channel)` → `regions` → sets order, `type: remote`, `country/city: null`, `experience: profile.seniority`.
  - `localCombinations(profile, arrangements, technologies): QuerySearchCombination[]` — for each onsite/hybrid in `arrangements` order: `channel × city × set` where the city list is `[profile.city]`; `locationRegion: null`, `country: profile.country`, `city`.
  - `dedupeByHash(recipes: QuerySearchRecipe[]): QuerySearchRecipe[]` — first occurrence wins, order kept.
- Channel builder behaviour: `locationText` returns `` `${city}, ${country}` `` for onsite/hybrid (and `country` when city null, kept defensive); returns `locationRegion ?? Region.GLOBAL` otherwise (defensive; remote always has a region). `jobBoardFilterQuery` remote → `locationRegion ? [locationRegion] : []`.

- [ ] **Step 1: Write failing tests.**
  - combinations: profile with regions `[EMEA, MENA]`, city `'Casablanca'`, sets `[[nestjs],[typescript]]`: `remoteCombinations(..., [remote, onsite], sets)` has length 16, every `country === null`; `localCombinations(..., [remote, onsite], sets)` has length 8, every `locationRegion === null`, `city === 'Casablanca'`, `country === 'MA'`; `localCombinations(..., [onsite, hybrid], sets)` length 16; `remoteCombinations(..., [onsite], sets)` length 0. `dedupeByHash` on `[r1, r2, r1copy]` returns `[r1, r2]`.
  - channels.spec: onsite combination with `locationRegion: null, country: 'FR', city: 'Paris'` → LinkedIn job board `params.location === 'Paris, FR'`, Greenhouse `params.locationTerms` equals `['FR', 'Paris']`.
  - recipe.spec: add `'hashes a null region'` — two combinations differing only in `locationRegion: null` vs `EMEA` get different hashes; `version` on a built recipe is `2`.
- [ ] **Step 2: Run** `npx nx test xjobs -- queries` — Expected: FAIL (missing module, type errors on `null`).
- [ ] **Step 3: Change the contract**, run `pnpm --filter @xjobs/xjobs db:emit` then `pnpm --filter @xjobs/xjobs db:migration:plan`. Expected: one new folder in `apps/xjobs/src/database/migrations/app/` whose ops drop `NOT NULL` on `query_search_builder."locationRegion"` (the IN-check stays; NULL passes it).
- [ ] **Step 4: Implement** the type, DTO, version, channel builder and `combinations.ts` changes.
- [ ] **Step 5: Run** `npx nx test xjobs` — Expected: queries specs PASS; `queries.service.spec.ts` count tests may fail until Task 4 (acceptable only there). If `src/swagger/contract.spec.ts` snapshots the OpenAPI document, update it and check the diff shows only `locationRegion` becoming nullable.
- [ ] **Step 6: Run** `npx nx typecheck xjobs` — Expected: PASS.
- [ ] **Step 7: Commit** `feat(queries): nullable builder region, recipe v2, combination steps`.

### Task 4: `expand` as a pipeline

**Files:**

- Modify: `apps/xjobs/src/modules/queries/services/queries.service.ts` (rewrite `expand`, delete `expandTechnologySets`)
- Test: `apps/xjobs/src/modules/queries/services/queries.service.spec.ts`

**Interfaces:**

- Consumes: everything in `steps/` plus `technologySets`, `toRecipe`.
- Produces: `expand(input): QuerySearchRecipe[]` with this exact body order:
  `normalizeProfile → assertLocatable → technologySets → normalizeArrangements → [...remoteCombinations, ...localCombinations] → map(toRecipe) → dedupeByHash`. `generate`, `detach`, `list`, `softDelete` unchanged.

- [ ] **Step 1: Rewrite the expand tests** using the existing fixture (regions EMEA+MENA, remote+onsite, Casablanca, nestjs/typescript/postgresql):
  - `'expands remote by region and onsite by city only'` → length 24 (16 remote + 8 onsite), 24 unique hashes.
  - `'maps unstated to remote'` → `arrangements: [unstated]` gives 16 recipes, all `type === remote`.
  - `'adds remote when unstated sits next to onsite'` → `[onsite, unstated]` gives 24 recipes, none `unstated`.
  - `'shares onsite builders across regions'` → onsite hashes for `regions: [EMEA]` equal onsite hashes for `regions: [EU, UK]`.
  - `'rejects onsite without a city'` → `city: '   '` throws `BadRequestException` with `CITY_REQUIRED`.
  - `'defaults remote to GLOBAL'` → `regions: []` gives 8 remote recipes (4 × 1 × 2), all `locationRegion === GLOBAL`, plus 8 onsite.
  - Keep: location only on onsite/hybrid (now also `locationRegion === null` there), remote hashes unchanged when city changes, country/city formatting normalisation (drop its `noCity` half), channel order.
  - Update the `generate` tests' `80` counts to `24`.
- [ ] **Step 2: Run** `npx nx test xjobs -- queries.service` — Expected: FAIL.
- [ ] **Step 3: Implement** the new `expand`.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Run** `npx nx test xjobs -- users` — Expected: PASS; fix any profile publish fixture that has onsite/hybrid without a city by giving it one.
- [ ] **Step 6: Commit** `refactor(queries): expand as a pipeline of pure steps`.

### Task 5: Generation scenarios with mock profiles

The user asked for "real strong cases" with mock data. Each scenario is a realistic profile run through the real `expand` (no mocks of the steps), asserting the **exact** output, not just counts.

**Files:**
- Create: `apps/xjobs/src/modules/queries/testing/profiles.fixture.ts`
- Create: `apps/xjobs/src/modules/queries/services/expand.scenarios.spec.ts`

**Interfaces:**
- Consumes: `QuerySearchService.expand` (Task 4), `FakeQuerySearchRepository`, `CITY_REQUIRED`.
- Produces (fixture): `MOCK_PROFILES: Record<string, QuerySearchProfileInput>` with the keys below, plus `summarize(recipes: QuerySearchRecipe[]): string[]` returning one sorted line per recipe: `` `${channel} | ${type} | ${locationRegion ?? '-'} | ${city ?? '-'}, ${country ?? '-'} | ${keyword} | ${JSON.stringify(sortKeys(params))}` ``.

**Mock profiles** (skills as `technology:importance/mastery`):

| key | position / seniority | regions | arrangements | country / city | skills |
|---|---|---|---|---|---|
| `remoteBackendMa` | backend_engineer / senior | EMEA, EU | remote | MA / Casablanca | nestjs:9/8, typescript:9/7, postgresql:6/9 |
| `onsiteFrontendParis` | frontend_engineer / mid | EUROPE | onsite | FR / Paris | react:9/8, nextjs:8/7 |
| `hybridAndRemoteDevops` | devops_engineer / staff | NORTH_AMERICA | hybrid, remote | US / Austin | kubernetes:9/9, terraform:9/9, aws:9/8 |
| `unstatedOnly` | data_engineer / unstated | APAC | unstated | SG / null | python:7/7 |
| `unstatedWithOnsite` | backend_engineer / junior | MENA | onsite, unstated | MA / Rabat | go:8/6, nodejs:5/5 |
| `noRegionsRemote` | ml_engineer / principal | *(empty)* | remote | DE / null | pytorch:9/9, python:8/9 |
| `noTechnologies` | qa_engineer / senior | EU | remote, onsite | ES / Madrid | *(none)* |
| `leadTechLead` | tech_lead / lead | UK | onsite | GB / London | typescript:9/9 |
| `tiesAndDuplicates` | backend_engineer / senior | EU, EU | remote | NL / null | go:5/5, rust:5/5, go:8/1 (second domain), java:0/9 |
| `messyLocation` | `remoteBackendMa` with arrangements onsite, country `' ma '`, city `'  Casablanca '` |
| `missingCity` | `onsiteFrontendParis` with city `'   '` |

- [ ] **Step 1: Write the scenario tests.** One `it` per scenario; expected values below are exact.
  - `remoteBackendMa` → 16 recipes (4 channels × EMEA, EU × nestjs, typescript; postgresql dropped by importance). All `type remote`, `country/city null`. LinkedIn job board keywords are exactly `senior backend engineer nestjs` and `senior backend engineer typescript`, `params` `{ location: 'EMEA'|'EU', experienceLevel: '4', workType: '2' }`. Posts keyword `hiring senior backend engineer nestjs remote`. No recipe keyword contains two technologies.
  - `onsiteFrontendParis` → 8 recipes, all `locationRegion null`, `city 'Paris'`, `country 'FR'`. Job board `params.location === 'Paris, FR'`, `workType '1'`, `experienceLevel '3'`. Posts keyword `hiring mid-level frontend engineer react on-site`. Greenhouse/Ashby `params` `{ locationTerms: ['FR', 'Paris'], remote: false }`.
  - `hybridAndRemoteDevops` → 16 = 8 remote (NORTH_AMERICA) + 8 hybrid (Austin, US). Top 2 by tie-break name: `aws` loses to `kubernetes`/`terraform` (mastery 8 < 9); keywords use `kubernetes` and `terraform` only. Hybrid job board `workType '3'`.
  - `unstatedOnly` → 4 recipes (1 technology), all `type remote`, `locationRegion APAC`, job board keyword `data engineer python` (no seniority word), no `experienceLevel` param.
  - `unstatedWithOnsite` → 16 = 8 remote (MENA) + 8 onsite (Rabat, MA); none `unstated`; keywords use `golang` and `node.js`.
  - `noRegionsRemote` → 8 recipes, all `locationRegion GLOBAL`; job board `params.location === 'GLOBAL'`; keywords `principal machine learning engineer pytorch` / `... python`.
  - `noTechnologies` → 8 = 4 remote (EU) + 4 onsite (Madrid, ES), keywords contain no technology (job board `senior qa engineer` with the title from `POSITION_TITLES[qa_engineer][0]`), `technologies: []`.
  - `leadTechLead` → 4 recipes; job board keyword exactly `tech lead typescript` (seniority word suppressed because the title already contains `lead`).
  - `tiesAndDuplicates` → 8 recipes (4 × EU once × 2); top 2 are `go` (best rank 8/1) then `rust`; `java` (importance 0) never appears; no duplicate hashes.
  - `messyLocation` → `hashes` equal to the same profile written cleanly (`'MA'`, `'Casablanca'`).
  - `missingCity` → `expand` throws `BadRequestException` with message `CITY_REQUIRED`.
  - Cross-profile sharing: `onsiteFrontendParis` with `regions: [EUROPE]` and with `regions: [EU, UK]` produce identical hash sets; `remoteBackendMa` with a different `city` produces identical hash sets.
  - Golden snapshot: `expect(summarize(service.expand(MOCK_PROFILES.hybridAndRemoteDevops))).toMatchInlineSnapshot()` — generated once, then read line by line against rules 1–4 before committing.
- [ ] **Step 2: Run** `npx nx test xjobs -- expand.scenarios` — Expected: PASS on first run (behaviour came from Tasks 1–4). Any failure is a real bug in an earlier task: fix it there, not in the expectation, unless the expectation contradicts the spec.
- [ ] **Step 3: Review the inline snapshot** that Vitest wrote: 16 lines, 8 `remote | NORTH_AMERICA`, 8 `hybrid | - | Austin, US`, no `aws`, no `unstated`.
- [ ] **Step 4: Commit** `test(queries): generation scenarios over mock profiles`.

### Task 6: Profile write validation

**Files:**

- Modify: `apps/xjobs/src/modules/users/dto/validators.ts` (add one decorator)
- Modify: `apps/xjobs/src/modules/users/dto/profile.dto.ts` (`city`)
- Test: `apps/xjobs/src/modules/users/dto/profile.dto.spec.ts`

**Interfaces:**

- Consumes: `isLocatable`, `CITY_REQUIRED` from `src/modules/queries` (Task 2).
- Produces: `IsLocatableCity(options?: ValidationOptions)` on `city`. It reads `arrangements` from `args.object`, skips (returns true) when `arrangements` is not an array, and uses `CITY_REQUIRED`. It must run when `city` is absent: put `@ValidateIf(() => true)` before `@IsOptional()` on `city`, or register the city decorator so it validates `undefined`.

- [ ] **Step 1: Write failing tests** with `errorsFor`:
  - `{ arrangements: ['onsite'], city: null }` → contains `'city'`
  - `{ arrangements: ['hybrid'], city: undefined }` → contains `'city'`
  - `{ arrangements: ['onsite'], city: 'Rabat' }` → `[]`
  - `{ arrangements: ['remote'], city: null }` → `[]`
  - `{ arrangements: ['unstated'], regions: [] }` → `[]` (remote defaults to GLOBAL)
  - Same city case on `ReplaceProfileDto`.
- [ ] **Step 2: Run** `npx nx test xjobs -- profile.dto` — Expected: FAIL.
- [ ] **Step 3: Implement** the decorators and apply them.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(users): require a city for onsite and hybrid profiles`.

### Task 7: Full verification

- [ ] **Step 1: Run** `npx nx run-many -t lint test build typecheck` — Expected: all targets succeed.
- [ ] **Step 2: Run** `npx nx e2e xjobs-e2e` — Expected: PASS (fix any e2e profile fixture that now violates the city rule).
- [ ] **Step 3: Update** the "Rules" section of `docs/superpowers/specs/2026-10-29-query-search-design.md` with a one-line pointer to the new spec, so the old expansion rules are not read as current.
- [ ] **Step 4: Commit** `docs: point query search spec at the generate revision`.
