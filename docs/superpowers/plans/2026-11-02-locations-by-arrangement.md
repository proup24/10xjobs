# Locations by Arrangement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace a profile's `regions` and `arrangements` with `locations: { remote, hybrid, onsite }`. Each entry is plain location text, and query generation searches every arrangement in exactly its listed locations.

**Architecture:**

- The location text is normalized once:
  - **Display form:** trimmed, whitespace collapsed. Stored on the profile.
  - **Canonical key:** the display form lowercased. Stored on builders, hashed, and searched.
- Combinations become `arrangement × channel × location × technology set`.
- Every channel builder reads only `combination.location`.
- Builders carry one `location` column instead of `locationRegion` / `country` / `city`.
- The local DB is dropped and rebuilt; no data conversion.

**Tech Stack:** NestJS, TypeScript (strict, nodenext), class-validator, Prisma Next contract + migrations (`@prisma/orm-postgres`), Vitest, Nx.

**Spec:** `docs/superpowers/specs/2026-11-02-locations-by-arrangement-design.md`

## Global Constraints

- **Profile field:**
  - Shape: `locations: { remote: string[]; hybrid: string[]; onsite: string[] }`, all three keys required, no other keys.
  - Each location: a string, non-blank after trimming, at most 100 characters.
  - Each list: at most 20 locations.
- **All-empty message (exact):** `locations must list at least one place in remote, hybrid or onsite`.
- **Normalized forms:**
  - Display form: `text.trim().replace(/\s+/g, ' ')`.
  - Canonical key: the display form `.toLowerCase()`.
  - Dedupe within a list by canonical key; keep the first spelling.
- **Worldwide:** the canonical key `worldwide` is never added to a keyword (LinkedIn posts, Ashby/Greenhouse). LinkedIn job board still passes it as `location`.
- **Recipe version:** `QUERY_SEARCH_RECIPE_VERSION` goes from 5 to 6.
- **Removed fields:** `regions` and `arrangements` are removed from profile DTOs. Sending either is a 400 (`forbidNonWhitelisted` is already global).
- **Unchanged fields:** the profile's `country` stays required and `city` optional. Neither affects search any more.
- **Out of scope:** the processor, its vocab, golden set, and the `Region` / `Arrangement` TS enums. Don't touch them.
- **Typecheck between tasks:** Task 1 changes DB row types, so `nx typecheck` fails until Task 5 lands. Each task verifies with its own Vitest files. Task 6 runs full CI.
- **Guardrails:**
  - Never read `.env*` or `private/`.
  - Never `git push`.
  - Dropping the local DB needs the user's go-ahead at that step.

## Review Focus

1. **Same place, different spelling:** `"Paris,  France"` in one profile and `"paris, france"` in another must share one builder, with the same hash. Pinned in Task 2 (`toRecipe` hash test).
2. **Location appears in two arrangements:** `"France"` in both `hybrid` and `onsite` gives two builders, with different `type`, and they land in two segments. Pinned in Tasks 2 and 4.
3. **Worldwide in another case:** a remote location typed `"WorldWide"` must not leak `"worldwide"` into a Google or posts keyword. Pinned in Task 3.
4. **Whitespace-only entry:** `"   "` is rejected by the DTO, not silently stored as `""`. Pinned in Task 5.
5. **Every arrangement empty except one:** `{ remote: [], hybrid: [], onsite: ["Casablanca, Morocco"] }` is valid, and publishing it creates only onsite builders. Pinned in Task 2 (`expand` test).

---

### Task 1: Contract, migration, local DB rebuild

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma`. In `model Profile` (around line 237), drop `regions` and `arrangements` and add `locations Jsonb`. In `model QuerySearchBuilder` (around line 293), drop `locationRegion`, `country` and `city` and add `location String`.
- Generated: `apps/xjobs/src/database/contract.json`, `contract.d.ts`, `migrations/app/<timestamp>_locations_by_arrangement/*`, `migrations/snapshots/*`.

**Interfaces:**

- Produces: `ProfileRow.locations` (Jsonb, typed as the contract's JSON type) and `QuerySearchBuilderRow.location: string`. `ProfileRow.regions/arrangements` and `QuerySearchBuilderRow.locationRegion/country/city` no longer exist.

- [ ] **Step 1:** Edit `contract.prisma` as above.
  - Keep the comment style: a one-line `//` comment above `locations` saying `{ remote, hybrid, onsite } lists of location text in display form`, and above `location` saying `Canonical (lowercased) location text the channels search`.
  - Leave `enum Region` in place, because the processor's TS side and the contract can keep it. If `db:migration:plan` reports it unused, that's fine.
- [ ] **Step 2:** Run `pnpm --filter @xjobs/xjobs db:migration:plan`.
  - Expected: a new migration directory whose `migration.ts` drops `profiles.regions` and `profiles.arrangements` (with the `profiles_arrangements_*` checks), adds `profiles.locations jsonb NOT NULL`, drops the three builder columns, and adds `location text NOT NULL`.
  - Rename the directory suffix to `_locations_by_arrangement` if the tool lets you name it. Otherwise keep the generated name.
- [ ] **Step 3: Stop and ask the user to confirm the local DB reset.** Then drop and recreate the local dev database the way they choose, and run:
  ```bash
  pnpm --filter @xjobs/xjobs db:init   # or db:migrate on an empty DB
  pnpm --filter @xjobs/xjobs db:seed
  pnpm --filter @xjobs/xjobs db:verify
  ```
  Expected: `db:verify` reports the DB matches the contract.
- [ ] **Step 4: Commit**
  ```bash
  git add apps/xjobs/src/database
  git commit -m "feat(db): profile locations by arrangement; one builder location column"
  ```

---

### Task 2: Queries core: types, normalization, combinations, recipe

**Files:**

- Modify:
  - `apps/xjobs/src/modules/queries/types/query-search.types.ts`
  - `steps/normalize.ts`
  - `steps/combinations.ts`
  - `steps/index.ts`
  - `index.ts`
  - `services/queries.service.ts`
  - `builders/recipe.ts`
  - `testing/profiles.fixture.ts`
- Delete: `steps/locatable.ts`, `steps/locatable.spec.ts`.
- Create: `steps/locations.ts` (empty check).
- Test:
  - `steps/normalize.spec.ts`
  - `steps/combinations.spec.ts`
  - `steps/locations.spec.ts`
  - `builders/recipe.spec.ts`
  - `services/queries.service.spec.ts`
  - `services/expand.scenarios.spec.ts`
  - `steps/skills.spec.ts` (fixture shape only)

**Interfaces:**

- Produces (in `types/query-search.types.ts`, exported from `src/modules/queries`):
  ```ts
  export const LOCATION_ARRANGEMENTS = [Arrangement.remote, Arrangement.hybrid, Arrangement.onsite] as const;
  export type LocationArrangement = (typeof LOCATION_ARRANGEMENTS)[number];
  export type LocationsByArrangement = Record<LocationArrangement, string[]>;
  ```

  - `QuerySearchProfileInput` = `{ position; locations: LocationsByArrangement; seniority; skills }`, with no `regions`, `arrangements`, `country` or `city`.
  - `QuerySearchCombination` replaces `locationRegion`, `country` and `city` with `location: string` (the canonical key).
- Produces (`steps/normalize.ts`, exported from `src/modules/queries`):
  - `displayLocation(text: string): string`
  - `locationKey(text: string): string`
  - `normalizeLocations(locations: LocationsByArrangement): LocationsByArrangement` returns display forms, deduped by key, first spelling kept.
  - `normalizeProfile(input)` applies `normalizeLocations`.
  - Delete `canonicalCity`, `DEFAULT_REMOTE_REGION` and `normalizeArrangements`.
- Produces (`steps/locations.ts`, exported from `src/modules/queries`):
  - `LOCATIONS_REQUIRED` (the exact all-empty message)
  - `hasLocation(locations: LocationsByArrangement): boolean`
  - `assertHasLocations(profile: QuerySearchProfileInput): void`, which throws `BadRequestException(LOCATIONS_REQUIRED)`.
- Produces (`steps/combinations.ts`): `locationCombinations(profile: QuerySearchProfileInput, technologies: TechnologySet[]): QuerySearchCombination[]`. It replaces `remoteCombinations` and `localCombinations`.
- `src/modules/queries/index.ts` stops exporting `CITY_REQUIRED` / `isLocatable`.

- [ ] **Step 1: Rewrite the fixture.** In `testing/profiles.fixture.ts`, every profile uses `locations` instead of `regions` / `arrangements` / `country` / `city`. Map the old cases as follows:
  - Remote-only profiles get `remote: ['EMEA']`-style text.
  - `onsiteFrontendParis` gets `onsite: ['Paris, France']`.
  - `hybridAndRemoteDevops` gets `hybrid` + `remote`.
  - Drop `missingCity` and `unstatedWithOnsite`.
  - Add `onsiteOnlyCasablanca`: `{ remote: [], hybrid: [], onsite: ['Casablanca, Morocco'] }`.
  - Add `noLocations`: all empty.
- [ ] **Step 2: Write failing tests.**
  - `normalize.spec.ts`, replacing the city/region/arrangement cases:
    ```ts
    expect(displayLocation('  Paris,   France ')).toBe('Paris, France');
    expect(locationKey(' Paris,  FRANCE')).toBe('paris, france');
    expect(normalizeLocations({ remote: ['Europe', 'europe ', 'Morocco'], hybrid: [], onsite: [] })).toEqual({ remote: ['Europe', 'Morocco'], hybrid: [], onsite: [] });
    // no default: all-empty stays all-empty
    expect(normalizeProfile(noLocations).locations).toEqual({ remote: [], hybrid: [], onsite: [] });
    ```
  - `locations.spec.ts`:
    - `hasLocation` is false for all-empty and true when only `onsite` has one.
    - `assertHasLocations(noLocations)` throws `BadRequestException` with message `LOCATIONS_REQUIRED`.
  - `combinations.spec.ts`:
    - For `{ remote: ['Europe'], hybrid: ['France'], onsite: ['France'] }` and 1 technology set, there are `3 × channels` combinations.
    - Each has `location` equal to the key (`'europe'`, `'france'`) and `type` equal to its arrangement.
    - No combination has a `locationRegion`, `country` or `city` property.
  - `recipe.spec.ts`:
    - `toRecipe` of two combinations differing only in location spelling (after `locationKey`) gives equal `hash`.
    - The hash changes when `type` differs for the same location.
    - `QUERY_SEARCH_RECIPE_VERSION === 6`.
  - `queries.service.spec.ts` / `expand.scenarios.spec.ts`:
    - `expand(onsiteOnlyCasablanca)` returns only `type: onsite` recipes with `location: 'casablanca, morocco'`.
    - `expand(noLocations)` throws with `LOCATIONS_REQUIRED`.
    - Delete the city-required scenarios.
- [ ] **Step 3:** Run `npx vitest run apps/xjobs/src/modules/queries/steps apps/xjobs/src/modules/queries/builders/recipe.spec.ts apps/xjobs/src/modules/queries/services`. Expected: FAIL (missing exports).
- [ ] **Step 4: Implement the interfaces above.**
  - `locationCombinations` iterates `LOCATION_ARRANGEMENTS`, then `Object.values(Channel)`, then `locations[arrangement]`, then technology sets, emitting `location: locationKey(text)`.
  - `QuerySearchService.expand` order: `normalizeProfile`, `assertHasLocations`, `assertHasSkills`, `technologySets`, `locationCombinations`, `toRecipe`, `dedupeByHash`. Drop the `console.debug` arrangement count; keep a debug line if wanted.
  - `recipeHash`'s canonical object: replace `locationRegion, country, city` with `location`.
  - Set the version to `6`.
  - Update `steps/index.ts` and `index.ts` exports to match.
- [ ] **Step 5:** Run the same Vitest command. Expected: PASS.
- [ ] **Step 6: Commit**
  ```bash
  git add apps/xjobs/src/modules/queries
  git commit -m "feat(queries): expand profiles by locations per arrangement"
  ```

---

### Task 3: Channel builders and Google provider

**Files:**

- Modify:
  - `apps/xjobs/src/modules/queries/channels/linkedin_geo.ts`
  - `linkedin_board.builder.ts`
  - `linkedin_posts.builder.ts`
  - `builders/channel.builder.ts`
  - `apps/xjobs/src/modules/collectors/providers/apify/google-search.provider.ts`
- Test:
  - `channels/channels.spec.ts`
  - `apps/xjobs/src/modules/collectors/providers/segment-collect.spec.ts`

**Interfaces:**

- Consumes: `QuerySearchCombination.location` (Task 2).
- Produces (`linkedin_geo.ts`):
  - `LINKEDIN_GEO_IDS: Record<string, string>`, keyed by canonical location key, starting `{}`.
  - `WORLDWIDE = 'worldwide'`.
  - `isWorldwide(location: string): boolean`, which compares `locationKey(location) === WORLDWIDE`.
  - Delete `LINKEDIN_REGIONS`, `LINKEDIN_CITY_GEO_IDS`, `countryName` and `linkedinPlace`.
- `locationText(combination)` returns `combination.location`.
- `GoogleJobsSearchProvider`: delete `sharedCountry` and the `countryCode` spread. Nothing sets `params.countryCode` any more.

- [ ] **Step 1: Write failing tests** in `channels.spec.ts`. Replace region/city cases with one table, using a helper `combo(type, location)`.

  **LinkedIn job board:**
  - `onsite`, `'europe'` gives `params.location === 'europe'`, `workType === '1'`, and no `geoId`.
  - With `LINKEDIN_GEO_IDS['paris, france'] = '123'` set for the test (restore after), `hybrid`, `'paris, france'` gives `geoId === '123'`.

  **LinkedIn posts:**
  - `remote`, `'morocco'` gives a keyword ending `remote morocco`.
  - `remote`, `'worldwide'` gives a keyword ending `remote`.
  - `onsite`, `'europe'` gives a keyword ending `europe`.

  **Ashby / Greenhouse:**
  - `remote`, `'morocco'` gives a keyword ending `"remote" "morocco"` and `params` equal to `{ remote: true }`.
  - `onsite`, `'paris, france'` gives a keyword ending `"paris, france"` and `params` equal to `{ remote: false }` (no `countryCode`).
  - `remote`, `'worldwide'` gives a keyword ending `"remote"`.

  **Review Focus 3:** a combination with `location: locationKey('WorldWide')` behaves like `'worldwide'` for posts and Google.

  **`segment-collect.spec.ts`:** replace the `countryCode` cases with one that asserts the actor input never has a `countryCode` property.

- [ ] **Step 2:** Run `npx vitest run apps/xjobs/src/modules/queries/channels apps/xjobs/src/modules/collectors/providers/segment-collect.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **LinkedIn board:** `params.location = combination.location`; `geoId` from `LINKEDIN_GEO_IDS[combination.location]`. `experienceLevel` and `workType` are unchanged.
  - **Posts:** `placeWord` returns the parts `['remote' if remote, location unless worldwide]`.
  - **`jobBoardQuery`:** the keyword parts end `['"remote"' if remote, `"${location}"` unless worldwide]`; `params = { remote: type === remote }` (unstated is gone from combinations). Remove the `placeBound` branches.
  - Update doc comments that mention region, city or country.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add apps/xjobs/src/modules/queries/channels apps/xjobs/src/modules/queries/builders/channel.builder.ts apps/xjobs/src/modules/collectors
  git commit -m "feat(queries): channels search the location text"
  ```

---

### Task 4: Segments key on location

**Files:**

- Modify: `apps/xjobs/src/modules/segments/services/segments.ts:24-41`
- Test: `apps/xjobs/src/modules/segments/services/segments.spec.ts`

**Interfaces:**

- Consumes: `QuerySearchBuilderRow.location` (Task 1).
- `placeOf(builder)`: LinkedIn job board keeps `linkedinSearchPlace`; every other channel returns `builder.location`. No branching on `type`.

- [ ] **Step 1: Write failing tests** (update the builder factory to set `location` instead of the old columns):
  - Two Greenhouse `onsite` builders with `location: 'europe'` share one segment.
  - The same location as `onsite` and `hybrid` gives two segments (Review Focus 2).
  - A LinkedIn job board builder with `params.location: 'emea'` and one with `params.geoId: '91000000'` key on `search:emea` and `search:91000000` respectively.
- [ ] **Step 2:** Run `npx vitest run apps/xjobs/src/modules/segments`. Expected: FAIL.
- [ ] **Step 3:** Implement `placeOf` as above and update its doc comment.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add apps/xjobs/src/modules/segments
  git commit -m "feat(segments): group builders by location"
  ```

---

### Task 5: Profile API, service and builder response

**Files:**

- Create: `apps/xjobs/src/modules/users/dto/locations.dto.ts`
- Modify:
  - `dto/profile.dto.ts`
  - `dto/profile.response.dto.ts`
  - `dto/validators.ts` (delete `IsLocatableCity`, `cityNeedsValidation`, and the queries import they use)
  - `types/profile.types.ts`
  - `services/profiles.service.ts`
  - `apps/xjobs/src/modules/queries/dto/query-search-builder.response.dto.ts`
- Test:
  - `dto/profile.dto.spec.ts`
  - `services/profiles.service.spec.ts`
  - `services/resume.service.spec.ts`
  - `apps/xjobs/src/swagger/contract.spec.ts`
  - `apps/xjobs/src/infrastructure/jobs/tests/collection.service.spec.ts`
  - `apps/xjobs/src/modules/ingest/repositories/raw.postgres.spec.ts` (fixture shape only)

**Interfaces:**

- Consumes: `LocationsByArrangement`, `normalizeLocations`, `hasLocation`, `LOCATIONS_REQUIRED` from `src/modules/queries` (Task 2).
- Produces `LocationsDto implements LocationsByArrangement`. Each of `remote`, `hybrid` and `onsite` has:
  - `@IsArray()`
  - `@ArrayMaxSize(20)`
  - `@IsString({ each: true })`
  - `@MaxLength(100, { each: true })`
  - `@Matches(/\S/, { each: true, message: '$property entries must not be blank' })`
  - `@ApiProperty({ type: [String], example: [...] })`, with examples `['Europe', 'Morocco']`, `['France']` and `['Paris, France']`
- Produces the `HasLocation()` decorator in `validators.ts`: valid when `value` is not an object (left to the nested validators) or `hasLocation(value)` is true; message `LOCATIONS_REQUIRED`.
- `ProfileFieldsDto.locations`:
  - Decorators: `@ValidateNested() @Type(() => LocationsDto) @IsObject() @HasLocation()`.
  - Remove `regions` and `arrangements`.
  - `city` becomes plain optional: `@IsOptional() @IsString() @MaxLength(100)`, with the description `Where the person lives; does not affect search`.
- `ProfileInput` / `ProfileFields`: `locations: LocationsByArrangement`, without `regions` / `arrangements`.
- `ProfileResponseDto`: `locations: LocationsDto`, with `regions` and `arrangements` removed.
- `ProfilesService`:
  - `create` and `replace` store `normalizeLocations(data.locations)`.
  - `toQuerySearchInput` maps `locations: profile.locations as LocationsByArrangement` and drops `regions`, `arrangements`, `country` and `city`.
  - `toProfileView` casts `locations` the same way.
- `QuerySearchBuilderResponseDto`: `@ApiProperty({ example: 'paris, france', description: 'Canonical (lowercased) location text the channels search' }) location!: string`, replacing the three old properties.

- [ ] **Step 1: Write failing tests.**
  - **`profile.dto.spec.ts`:** replace the `profile city rule` block with a `profile locations` block:
    - Accepts `{ remote: ['Europe'], hybrid: [], onsite: [] }`.
    - Rejects all-empty with `LOCATIONS_REQUIRED`.
    - Rejects a missing `onsite` key.
    - Rejects an extra `anywhere` key (validate with `{ whitelist: true, forbidNonWhitelisted: true }`, as the app does).
    - Rejects `[42]`.
    - Rejects `['   ']` (Review Focus 4).
    - Rejects a 101-character entry.
    - Rejects 21 entries.
    - Rejects a body that still has `arrangements` or `regions`.
    - Accepts onsite with no profile `city`.
    - Applies to `ReplaceProfileDto` too.
  - **`profiles.service.spec.ts`:**
    - `create` with `remote: ['Europe', 'europe ']` stores `remote: ['Europe']`.
    - `toQuerySearchInput` returns `locations` and no `country`/`city`.
    - Update existing fixtures to the new shape.
  - **`contract.spec.ts`:** replace the `locationRegion` nullable test with `documents a query search builder location as a string`. It checks that `builder.properties['location'].type === 'string'` and that `locationRegion` is absent.
  - **`collection.service.spec.ts`, `raw.postgres.spec.ts`, `resume.service.spec.ts`:** update builder/profile fixtures to `location` / `locations`.
- [ ] **Step 2:** Run `npx vitest run apps/xjobs/src/modules/users apps/xjobs/src/swagger apps/xjobs/src/infrastructure/jobs apps/xjobs/src/modules/ingest`. Expected: FAIL. Postgres-backed specs need the local DB from Task 1 running.
- [ ] **Step 3:** Implement the interfaces above.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5:** Run `npx nx typecheck xjobs`. Expected: PASS. This is the first task where it must, so fix any remaining reference to the removed fields that grep finds:
  ```bash
  grep -rn "locationRegion\|\.arrangements\|regions:\|CITY_REQUIRED\|linkedinPlace" apps/xjobs/src --include='*.ts' | grep -v "migrations/\|contract.d.ts\|/processor/\|seeds/"
  ```
  Expected: no matches.
- [ ] **Step 6: Commit**
  ```bash
  git add apps/xjobs/src
  git commit -m "feat(users): profile locations grouped by arrangement"
  ```

---

### Task 6: E2E and full CI

**Files:**

- Modify: `apps/xjobs-e2e/src/xjobs/users.spec.ts` (profile fixture, around lines 10-17)

- [ ] **Step 1: Update the e2e fixture.**
  - Replace `regions: [...]` and `arrangements: ['remote']` with `locations: { remote: ['EMEA', 'North Africa'], hybrid: [], onsite: [] }`.
  - Add one case: a profile created with `onsite: ['Paris, France']` and no `city` returns 201, and its `locations` round-trips unchanged.
  - Add one case: an all-empty `locations` returns 400 with `LOCATIONS_REQUIRED` in the message.
- [ ] **Step 2:** Run `npx nx e2e xjobs-e2e`. Expected: PASS.
- [ ] **Step 3:** Run `npx nx run-many -t lint test build typecheck`. Expected: all targets succeed.
- [ ] **Step 4: Commit**
  ```bash
  git add apps/xjobs-e2e
  git commit -m "test(e2e): profile locations by arrangement"
  ```
- [ ] **Step 5:** Tell the user the branch is ready to push. Draft a PR description that includes the local reset steps (drop the dev DB, then `db:init`, `db:seed`, and re-create profiles), and note it's stacked on `feat/processor`.
