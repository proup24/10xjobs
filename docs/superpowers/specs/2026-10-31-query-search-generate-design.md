# Query search `generate`: leaner expansion

Status: draft, 2026-10-31. Revises the expansion rules of
[2026-10-29-query-search-design.md](2026-10-29-query-search-design.md).

## Intent

`QuerySearchService.generate(profileId, input)` turns a published profile into
the shared, reusable search recipes each channel collects with. It is one of the
engine's core functions: it decides what jobs are ever seen. It must stay
low-complexity, readable as a short pipeline of named steps, while holding the
business rules below.

Today it over-generates:

- Technologies expand to `[a] [b] [c] [a,b] [a,b,c]`. The 2- and 3-tech
  combinations are narrow, noisy keywords and multiply the recipe count.
- Onsite and hybrid recipes are multiplied by every profile region, even though
  they are pinned to one city. Region is part of the hash, so the same
  "onsite, Paris" search becomes one builder per region and is not shared
  between profiles with different regions.
- `unstated` arrangement produces its own recipes.
- An onsite/hybrid profile without a city silently falls back to country-wide.

## Goals

- Keyword sets: the top 2 technologies, each alone. No combinations.
- Onsite/hybrid searches are tied to the profile city and multiplied only by
  channel and technology, never by region.
- `unstated` is searched as remote.
- Onsite/hybrid without a city is rejected, not guessed.
- `generate` reads as a pipeline; each step is its own pure, unit-tested
  function.
- More sharing of builders between profiles (less duplication).

## Non-goals

- Multiple cities per profile. Designed for (one loop away), not built.
- Changing channel query formats, the repository, attach/detach, or ingest.
- Migrating builders already attached to published profiles.

## Anti-goals

- Missing the right jobs: no rule here may drop a search the profile asked for
  without a visible error.
- Silent location guesses (country fallback) for place-bound work.

## Rules (decided with the user)

1. **Technologies.** Rank skills by importance desc, mastery desc, technology
   name asc; drop importance 0; count a technology once at its best rank. Keep
   the top 2. Sets are `[a]`, `[b]`. One technology gives `[[a]]`; none gives
   `[[]]` (a position-only search).
2. **Arrangements.** `unstated` maps to `remote`; duplicates are removed. After
   this step no recipe has `type = unstated`.
3. **Remote.** One recipe per `channel × region × technology set`. `country` and
   `city` are null.
4. **Onsite / hybrid.** One recipe per `channel × arrangement × technology set`,
   in the profile's city. Never multiplied by region. `country` and `city` are
   set; `locationRegion` is null. Example: senior backend engineer, Paris,
   onsite, top two TypeScript and NestJS → on each channel
   `senior backend engineer typescript` @ Paris and
   `senior backend engineer nestjs` @ Paris.
5. **City required.** If `arrangements` contains `onsite` or `hybrid` and `city`
   is empty after trimming, the profile is invalid.
6. **Region required for remote** (Claude's call, mirroring rule 5). If the
   normalized arrangements contain `remote` (including from `unstated`) and
   `regions` is empty, the profile is invalid with
   `regions is required when arrangements include remote or unstated`. No
   silent default to `GLOBAL`: the user picks it explicitly if they mean it.

Worked count: 4 channels, 2 regions, remote + onsite, 2 technologies →
remote 4×2×2 = 16, onsite 4×1×2 = 8, total 24 (was 4×2×2×5 = 80).

## Shape

`generate` stays `attach(profileId, expand(input))`. `expand` becomes a pipeline
of pure functions (plain data in, plain data out, no Nest or DB), one file each
under `apps/xjobs/src/modules/queries/steps/` with a co-located spec:

```ts
expand(input: QuerySearchProfileInput): QuerySearchRecipe[] {
  const profile = normalizeProfile(input);                  // trim + uppercase country, trim city → null if empty
  assertLocatable(profile);                                 // rules 5 and 6
  const technologies = technologySets(profile.skills);      // rule 1
  const arrangements = normalizeArrangements(profile.arrangements); // rule 2
  const combinations = [
    ...remoteCombinations(profile, arrangements, technologies), // rule 3
    ...localCombinations(profile, arrangements, technologies),  // rule 4
  ];
  return dedupeByHash(combinations.map(toRecipe));
}
```

- `technologySets` stays in `sets/technology.ts`;
  `QUERY_SEARCH_TOP_TECHNOLOGIES` becomes 2 and the combination pushes are
  removed.
- The private `expandTechnologySets` method is deleted.
- `toRecipe` and the channel builders are unchanged in behaviour.
- `localCombinations` loops over a city list of one, so multiple cities later
  is a type change plus a loop source, not a redesign.

## City and region validation

One predicate per rule (`isLocatable(arrangements, city)`, `hasRemoteRegion(arrangements, regions)`),
lives in the queries module and is used in two places:

- **Profile create/replace (400).** A class-level validator on
  `ProfileFieldsDto` (same pattern as `IsGreaterOrEqual` in
  `users/dto/validators.ts`) fails with
  `city is required when arrangements include onsite or hybrid` (and the rule 6 message for regions).
- **`assertLocatable` in `expand`.** Throws a `BadRequestException` with the
  same messages, as a safety net for profiles saved before this rule (publish
  then fails cleanly before anything is attached).

## Schema

- `QuerySearchBuilder.locationRegion` becomes nullable (`Region?`) in
  `contract.prisma`, with a migration. `QuerySearchCombination.locationRegion`
  becomes `Region | null`.
- `recipeHash` already hashes `locationRegion`; `null` hashes as `null`.
- `QUERY_SEARCH_RECIPE_VERSION` goes to 2. Builders created under v1 stay
  attached to the profiles that use them; new publishes produce v2 hashes.

## Channel builders

- `locationText`: for onsite/hybrid returns `city, country` (city is now
  guaranteed). For remote returns `locationRegion`.
- `jobBoardFilterQuery`: remote uses `[locationRegion]`, onsite/hybrid uses
  `[country, city]`. The `unstated` branches (`remote: null`, LinkedIn null
  work type) become unreachable; they are left in place as defensive code.
- LinkedIn job board: `params.location` is the city text for onsite/hybrid.

## Tests

- `sets/technology.spec.ts`: top 2 only; sets are singles.
- One spec per step in `steps/`.
- `queries.service.spec.ts`: the worked count above; onsite not multiplied by
  region; two profiles in the same city with different regions produce the same
  onsite hashes; `unstated` → remote recipes; missing city throws.
- `channels.spec.ts`: null `locationRegion` for onsite/hybrid.
- Profile DTO spec: onsite/hybrid without city is a 400; remote or unstated with no regions is a 400; remote without city is
  fine.
- Repository/Postgres spec: a builder row with null `locationRegion` round-trips.

## Left to the builder

- Exact file names inside `steps/` and whether `dedupeByHash` lives there or in
  `utils/`.
- Wording of test names and the migration name.
