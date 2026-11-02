# Locations grouped by arrangement

## Intent

Today a profile has two separate lists: `arrangements` (remote, hybrid, onsite, unstated) and `regions` (EMEA, EUROPE, GLOBAL…). Regions only apply to remote searches. Onsite and hybrid searches ignore regions and are tied to the profile's own city, and a profile without a city cannot pick onsite or hybrid at all.

That misses jobs people actually want, like "onsite anywhere in Europe" or "hybrid in Germany or the Netherlands". It also forces anyone who wants onsite work to search only where they live.

The change: `regions` and `arrangements` are replaced by one field, `locations`. It holds a list of location texts per arrangement. A location is plain text naming a place ("Europe", "Morocco", "Paris, France"), and it goes straight into each channel's search. The engine doesn't distinguish regions, countries and cities. The "onsite and hybrid need the profile city" rule goes away.

```json
"locations": {
  "remote": ["Europe", "Morocco"],
  "hybrid": ["France"],
  "onsite": ["Paris, France", "Middle East"]
}
```

## Goals

- A profile states, per arrangement, every location it wants to be searched in.
- Query generation produces one search per `channel × arrangement × location × technology set`.
- No hidden coupling between onsite/hybrid and the profile's own city.
- Verified LinkedIn geoIds can still pin a location exactly, keyed by its text.

## Non-goals

- **Checking that a location is a real place.** The web app (Phase 1) only lets users pick from valid locations. The engine trusts the text beyond basic shape checks.
- **Changing the processor.** It never read profile regions or arrangements. Its own vocabularies (`regions`, `countries`, `cities`, arrangements including `unstated`) are unchanged.
- **Matching or qualifying jobs against the profile's locations.** That belongs to the qualify step, which isn't built yet.
- **Verifying new geoIds.** The lookup starts with whatever is verified today.

## Anti-goals

- **Silently searching nowhere.** A profile with all three lists empty is rejected, not defaulted.
- **Duplicate builders from formatting differences.** "paris, france" and "Paris, France" must be one search.
- **Unbounded search volume.** The number of locations per arrangement is capped.

## Decided by the user

- The field is `locations: { remote: string[], hybrid: string[], onsite: string[] }`, and each entry is plain text with no type.
- The `arrangements` field is removed. A non-empty list means that arrangement is wanted; an empty list means it isn't.
- A profile whose three lists are all empty is rejected (400).
- An onsite or hybrid location is searched as given ("Europe" means anywhere in Europe), not tied to the profile's city.
- Locations are passed to the channels as their location parameter or keyword.
- The verified-geoId lookup stays, keyed by location text.
- The frontend forces users to pick valid locations; the engine doesn't keep a list of places.
- Existing data is not converted. The local dev database is dropped and rebuilt, because the app isn't deployed.

## Design

### API (`ProfileFieldsDto`, response DTO)

- `regions` and `arrangements` are removed from the create, replace and response DTOs. A request that still sends either gets a 400 (`forbidNonWhitelisted` is already on globally).
- `locations` is a required object with exactly the keys `remote`, `hybrid`, `onsite`, and unknown keys are rejected. Each key holds a required array of strings, which may be empty.
- Each location is a string that is non-blank after trimming, at most 100 characters.
- Each list holds at most 20 locations _(my call: bounds fan-out; easy to raise)_.
- If all three lists are empty, return 400 with the message `locations must list at least one place in remote, hybrid or onsite`.
- Duplicates inside one list are removed during normalization, not rejected (see the canonical key below).
- The profile's own `country` and `city` stay as where the person lives. `country` stays required. `city` stays optional and no longer depends on anything. The `IsLocatableCity` / `cityNeedsValidation` validators and `CITY_REQUIRED` are deleted _(my call: residence matters later for qualify and work authorization; it just stops driving search)_.

### Location text and its canonical key

- **Display form:** trimmed, inner whitespace collapsed to single spaces. The profile stores this form, in the order given, with duplicates removed (the first spelling is kept).
- **Canonical key:** the display form lowercased. It is used for dedupe, for the builder's `location` column and recipe hash, for the geoId lookup, and for segment keys. Every channel searches with the canonical form _(my call: LinkedIn's location box and Google are both case-insensitive, and one lowercase form is what keeps profiles that typed different capitalizations on one shared builder)_.
- `canonicalCity` in `queries/steps/normalize.ts` is replaced by this (`displayLocation` and `locationKey`, or similar).

### Storage

- **`profiles`:**
  - Add `locations jsonb NOT NULL`, holding `{ remote, hybrid, onsite }` in display form, all three keys always present.
  - Drop `regions` and `arrangements`, along with the three `arrangements` check constraints and any `regions` checks.
- **`query_search_builders`:**
  - Replace `locationRegion`, `country` and `city` with one `location text NOT NULL`, which holds the canonical key.
  - Arrangement stays in its existing `type` column.
- **No data conversion** (user's decision: the app isn't deployed, and the only database is local dev). Add one new schema-only migration in `apps/xjobs/src/database/migrations/app/`, planned from the updated contract with `db:migration:plan`. Existing migrations are not edited.
- **Local reset:** before applying it, drop the local database. Then run `db:init` / `db:migrate` and `db:seed` from scratch, then re-create profiles through the API. Adding `NOT NULL` columns would fail on a non-empty table anyway, so the reset is the expected path, not a workaround. Document the reset steps in the PR description.
- Update `contract.prisma`, and regenerate `contract.json` / `contract.d.ts` the same way earlier migrations did.

### Types

```ts
type LocationsByArrangement = Record<'remote' | 'hybrid' | 'onsite', string[]>;
```

- **`ProfileInput` / `ProfileFields`:** `locations: LocationsByArrangement`, with no `regions` and no `arrangements`.
- **`QuerySearchProfileInput`:** same change. Drop `country` / `city` from it if nothing in queries still reads them.
- **`QuerySearchCombination`:** replace `locationRegion`, `country` and `city` with `location: string` (the canonical key). Update `recipeHash`'s canonical object to match.
- **Builder response DTO:** update to match.

### Query generation (`modules/queries`)

- **Normalize:**
  - `normalizeProfile` normalizes each list to display form and dedupes it by canonical key.
  - It no longer adds the `GLOBAL` default.
  - `normalizeArrangements`, `PLACE_BOUND`, `locatable.ts` and `assertLocatable` are deleted.
- **Empty check:** a new assertion throws `BadRequestException` when all three lists are empty after normalization. It backs the same rule as the DTO 400.
- **Combinations:**
  - `remoteCombinations` and `localCombinations` become one function.
  - For each arrangement key, for each channel, for each location, for each technology set, it emits a combination with `type = arrangement` and `location = canonical key`.
- **Bypass:** `DEFAULT_REMOTE_REGION`, `LINKEDIN_REGIONS` and `linkedinPlace` are no longer used by query generation. Delete them unless something else still needs them.
- **Geo lookup:** `LINKEDIN_CITY_GEO_IDS` becomes `LINKEDIN_GEO_IDS: Record<string, string>`, keyed by the canonical location key, for any kind of place. It starts empty, as it is today.
- **"Worldwide":** the canonical key `worldwide` means "no place restriction". This is the only special-cased location _(my call: adding "worldwide" to a keyword search would cut results to posts that literally say it)_.
- **Channel builders:** all three build from `location` alone and never branch on place kind.
  - **LinkedIn job board:**
    - `params.location` = the location.
    - `params.geoId` = `LINKEDIN_GEO_IDS[location]` when present.
    - `workType` and `experienceLevel` stay as they are.
  - **LinkedIn posts:** the keyword is `hiring`, then the title clause, technologies and seniority word, then `remote` for remote, then the location, unless it is `worldwide`.
  - **Ashby / Greenhouse (`jobBoardQuery`):**
    - The keyword adds `"remote"` for remote as today, then the quoted location unless it is `worldwide`.
    - `params.remote` stays from the arrangement.
    - `params.countryCode` is dropped, because there's no country to derive and it only set which country Google searches from, never which results it returned. Check that `google-search.provider.ts` (`sharedCountry`) handles its absence.
  - **`locationText`:** returns the location.
- **Recipe version:** bump `QUERY_SEARCH_RECIPE_VERSION` from 5 to 6, since the recipe shape changes. After the local reset there are no old builders, so `db:regenerate` isn't needed for this change.

### Segments (`modules/segments/services/segments.ts`)

- `placeOf` stops branching on arrangement.
- LinkedIn job board keeps its search-place key (`geoId` else `location` param).
- Other channels key on `builder.location`.
- Arrangement is already in the segment key, so onsite and remote in the same location stay in separate segments.

### Tests

- **DTO:**
  - Valid object.
  - Missing key, unknown key, non-string entry, blank entry, entry over 100 characters, more than 20 entries: each rejected.
  - All lists empty: rejected.
  - Sending `regions` or `arrangements`: rejected.
- **Normalization:**
  - Whitespace collapse.
  - Dedupe across capitalization, keeping the first spelling.
  - No default location.
- **Combinations:** for each arrangement, the right `type` and `location`; the count equals `channels × locations × technology sets`.
- **Builders**, per channel:
  - Onsite "Europe", hybrid "Paris, France", remote "Morocco" and remote "Worldwide".
  - A geoId present in the lookup.
- **Segments:**
  - Onsite builders in the same location share a segment.
  - The same location across arrangements does not.
  - Capitalization doesn't split segments.
- **Migration:** on a fresh database, `db:migrate` then `db:verify` pass, and a profile created through the API round-trips `locations` unchanged. The e2e suite covers this if it already creates profiles.
- **Updates:** update `profiles.fixture.ts` and every spec that relies on `regions`, `arrangements`, `locationRegion`/`country`/`city` on builders, or the city rule. Remove `locatable.spec.ts`.

## Left to the builder

- File layout, and the validator style (a custom class-validator decorator or a nested DTO), as long as 400 messages name the bad path, for example `locations.onsite[1]`.
- Exact wording of validation messages other than the all-empty one.
- Whether `QuerySearchProfileInput` still needs `country` / `city`.
- Whether the old `LINKEDIN_REGIONS` table is deleted outright or kept for reference.
