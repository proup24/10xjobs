# Profile seniorities

## Intent

Today a profile has one `seniority`. Every query search recipe the profile generates carries that one level as its `experience`, so a senior engineer who would also take staff or lead roles is only ever searched as senior. The staff and lead jobs they want are never collected.

The change: `seniority` becomes `seniorities`, the set of levels the profile is open to. Query generation runs one search per seniority in the set. Seniority becomes one more axis of the combination product, so the recipe count multiplies by N instead of 1.

```json
"seniorities": ["senior", "staff", "lead"]
```

## Goals

- A profile states every seniority level it is open to.
- Query generation produces one search per `arrangement × channel × location × technology set × seniority`.
- Profiles that share a level still share that level's recipes (hash dedup is unchanged).

## Non-goals

- **The processor.** Job extraction keeps its single `seniority` fact, the Jev `seniority` choice question, the typed column and the golden set as they are. Making a job's seniority a set (jobs can also be open to several levels) is a separate, later change. _(User's decision: "forget about the processor step for the moment.")_
- **Matching profile seniorities against job seniority.** That belongs to the qualify step, which isn't built yet.
- **Combining levels into one search.** LinkedIn's `f_E` filter accepts several comma-joined codes, but the user chose one query per seniority. Each recipe keeps exactly one `experience`.

## Anti-goals

- **Missing the right jobs.** Every level in the set must produce its own searches. None is dropped or merged silently.
- **Searching nothing.** An empty set is rejected, not defaulted.
- **Duplicate recipes.** Duplicate levels in a request must never produce duplicate searches.

## Decided by the user

- The profile field is a set of seniorities: `seniorities`.
- Each seniority in the set gets its own query. The multiplier goes from 1 to N.
- The processor is out of scope for this change.

## Design

### API (`ProfileFieldsDto` in `modules/users/dto/profile.dto.ts`, response DTO)

- `seniority` is removed from the create, replace and response DTOs. A request that still sends it gets a 400 (`forbidNonWhitelisted` is already on globally). No alias is kept _(my call: the web app doesn't exist yet, so nothing depends on the old name)_.
- `seniorities` is required, with the same validators as `engagements`: `@IsArray()`, `@ArrayNotEmpty()`, `@ArrayUnique()`, `@IsEnum(Seniority, { each: true })`, and `@ApiProperty({ enum: Seniority, enumName: 'Seniority', isArray: true })`.
- Allowed values are every `Seniority` value, `unstated` included, as today _(my call: keeps current behavior. A profile with `unstated` in its set gets an extra search with no seniority word or filter. Restricting this to real levels is a one-line change if wanted.)_
- The list size is bounded by the enum (7 values) and `@ArrayUnique()`, so no separate cap is needed.
- Order carries no meaning. The service stores the set sorted in `Seniority` enum order, so equal sets are stored the same way _(my call)_.

### Storage

- **`profiles`** (`contract.prisma`): replace `seniority Seniority` with `seniorities Seniority[]`. Add a check `profiles_seniorities_nonempty`: `cardinality("seniorities") > 0`, matching `languages` and `engagements`.
- **`query_search_builders`:** unchanged. `experience Seniority` stays a single value.
- **Migration:** one new migration in `apps/xjobs/src/database/migrations/app/`, planned from the updated contract with `db:migration:plan`. Existing migrations are not edited. Regenerate `contract.json` / `contract.d.ts` the way earlier migrations did.
- **Existing data:** not converted. Same approach as the locations change: the app isn't deployed and the only database is local dev, so the local database is dropped and rebuilt (`db:init` / `db:migrate`, `db:seed`), and profiles are re-created through the API _(my call, following the precedent in `2026-11-02-locations-by-arrangement-design.md`. If the migration tool easily supports a data step, `seniorities = ARRAY[seniority]` is the conversion, and the builder may use it instead.)_ Document the reset steps in the PR description.

### Types and service

- **`ProfileInput` / `ProfileFields`** (`modules/users/types/profile.types.ts`): `seniorities: Seniority[]` replaces `seniority`.
- **`profiles.service.ts`:** create, replace and `toProfileView` read and write `seniorities`. `toQuerySearchInput` passes `seniorities`.
- **`QuerySearchProfileInput`** (`modules/queries/types/query-search.types.ts`): `seniorities: Seniority[]` replaces `seniority`.
- **`QuerySearchCombination`:** unchanged. `experience: Seniority` stays single.

### Query generation (`modules/queries`)

- **Combinations** (`steps/combinations.ts`): `locationCombinations` adds a seniority loop. For each arrangement, channel, location, technology set and seniority, it emits one combination with `experience = seniority`. The count becomes `channels × Σ(locations per arrangement) × technology sets × seniorities`. Update the doc comment.
- **Normalize:** `normalizeProfile` (today it only normalizes locations) also dedupes `seniorities` in enum order (a defensive backstop for the DTO's `@ArrayUnique()`). An empty set throws `BadRequestException`, which backs the DTO rule.
- **Identical searches run once** _(added after the final review)_: levels can build the same search. `staff`, `lead` and `principal` share LinkedIn's `f_E=4,5` with a title-free keyword, and `mid` and `unstated` add no seniority word. After `dedupeByHash`, `expand` runs `dedupeBySearch`, which keeps the first recipe of each distinct `(channel, type, location, technologies, domain, keyword, params)`. That is the lowest level in enum order.
- **Channel builders, keywords, `seniorityWord`, LinkedIn `EXPERIENCE_LEVELS`:** unchanged. They already work on one `combination.experience`.
- **Recipe version:** `QUERY_SEARCH_RECIPE_VERSION` stays at 9. A recipe's content and hash are the same as before. A profile simply links to more of them. No `db:regenerate` is needed.
- **Linking:** unchanged. `QueriesService` maps combinations to recipes, runs `dedupeByHash`, and passes the result to `builders.attach(profileId, …)`. Delete calls `detach`. Published profiles are frozen, so a set only changes on drafts, before linking.

### Segments

Unchanged. `segmentKey` is `channel|domain|type|place` and doesn't include `experience`. Builders that differ only in seniority land in the same group and are cut into segments of at most `SEGMENT_SIZE`, and each one is still its own search. More seniorities mean more builders per group, so more segments, and nothing merges.

### Tests

- **DTO** (`profile.dto.spec.ts`): a valid set; an empty array, a duplicate, an unknown value and a non-array each rejected; sending `seniority` rejected.
- **Combinations** (`combinations.spec.ts`): with two seniorities, every other axis yields one combination per seniority with the right `experience`, and the count doubles.
- **Normalize:** dedupe and enum ordering; an empty set throws.
- **Service:** create and replace round-trip `seniorities`. `toQuerySearchInput` passes the set.
- **Scenario** (`expand.scenarios.spec.ts`): a profile with `[senior, staff]` produces the senior and staff recipes per channel. A second profile with `[staff]` shares the staff recipes (same hashes).
- **Updates:** `queries/testing/profiles.fixture.ts`, every spec that builds a profile with `seniority` (users, queries, `resume.service.spec.ts`), and `apps/xjobs-e2e/src/xjobs/users.spec.ts`.
- Processor specs that mention seniority are about job extraction and are not touched.

## Left to the builder

- Whether enum-order sorting lives in the service or in `normalizeProfile`, as long as stored and generated sets are deduped and ordered.
- Exact wording of validation messages.
- Whether to convert existing rows in the migration or rely on the local reset (see Storage).
