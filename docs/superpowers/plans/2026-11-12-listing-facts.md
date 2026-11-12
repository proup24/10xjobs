# Listing facts, combined facts and matching gaps: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The processor reads only the title and description. A deterministic step combines its facts with LinkedIn's into `job_facts`, with conflicts recorded. The matcher decides from `job_facts`, sends unsure rejections to a per-user review list, and checks the preferences it ignores today.

**Architecture:**

- **A new `facts` engine module** (`apps/xjobs/src/modules/facts`) owns:
  - the place resolver;
  - the listing facts read from `normalized_jobs`;
  - the pure `combineFacts`;
  - the `job_facts` and `job_fact_conflicts` tables.
- **The matcher builds a job's facts at the start of each match job** (building is free), then decides from them. No new queue is added: the existing match sweep picks up jobs whose facts are stale.
- **The web app** reads facts and the review state through `match_details`.

**Tech Stack:** NestJS + BullMQ engine, Prisma Next contract and migrations (`libs/database`), zod, Vitest, Next.js + Supabase (`apps/web`).

**Spec:** `docs/superpowers/specs/2026-11-12-listing-facts-design.md`. Read it before each PR.

## Global Constraints

**Scope and the processor**

- Only the LinkedIn job board is matched (`PROCESSOR_CHANNEL`). Ashby, Greenhouse and posts are unchanged.
- The processor's input is the title and the description only. No listing value, and no company name, in the prompts, the input hash, the golden set or preview.
- No `db:renormalize`. No new Apify runs. Reprocessing (`db:reprocess -- --all-in-scope`) is run by hand after deploy, never automatically.

**Combining and conflicts**

- LinkedIn is the default for matching only for `workplaceType`, `location.parsed`, employer-provided `salary`, and `expireAt`. Everything else from LinkedIn is display only.
- The description wins whenever it states a fact. Every disagreement is a conflict row.
- Seniority and contract type come from the description only. A disagreement with LinkedIn is still recorded as a conflict.
- LinkedIn's place is a `label` opening, never a location requirement and never a work-authorization requirement.

**Places**

- A place that doesn't map falls back to its country, then to no place. The listing never creates a city.
- Processor cities stay free text and are created as `proposed` when unknown. A city matching an alias or an accent-folded name is never duplicated.

**Matching**

- An `unsure` value never rejects. A failure resting on an unsure value is outcome `review`.
- A LinkedIn default counts as sure.
- Engagement, junk flags, notice period and `contractMonths` are not matched.

**Salary**

- The job's max, or its min when there's no max, is compared, converted at 8 h/day, 40 h/week, 2,080 h/year, and month = year ÷ 12.
- It fails when it's more than 10% below the profile's minimum.
- A currency outside the ISO 4217 list is dropped.
- LinkedIn periods map as `HOURLY` → `hour`, `DAILY` → `day`, `MONTHLY` → `month` and `YEARLY` → `year`. Any other period drops the LinkedIn salary.

**Web and guardrails**

- Web UI is built only from `apps/web/src/components/ui` and theme tokens (`apps/web/DESIGN.md`). There's no Rejected view in this slice.
- Mismatch reports are only logged: nothing reads them.
- Every new engine-only table has `@@rls` and no policy, plus a fixture in `apps/db-tests/src/engine-tables.db.spec.ts`.
- The scrubbed harvest fixtures contain no hiring-team names. The raw 96 items stay in gitignored `tmp/harvest-items/items.json`.

## Review Focus

1. **A job whose current extraction is still schema v2** (not reprocessed yet). It must not be matched and must not crash the sweep. It waits until reprocessed. _(Task 3.4 test `skips a job whose extraction is v2`)_
2. **A harvest item with an empty `parsed.city`, an unknown city ("Mechouar" with no alias), or an unknown region code.** It must give the country, or no place, and never create a city row. _(Task 1.2 tests)_
3. **A salary given only as a min, only as a max, monthly against a yearly profile, or in an unknown currency.** The rule must never reject on a value it can't convert. _(Task 5.2 tests)_
4. **A user's review decision after their profile changes and the job is decided again.** It applies only when the new outcome is still `review` on the same rule and field. _(Task 6.1 `match_details` db test)_
5. **A job whose `expiresAt` passes after it was matched.** It isn't decided again, and its rows and decisions stay and show as closed. _(Task 3.4 test `keeps rows of an expired job`)_

## Branches and PRs

There are six PRs, in order, each to `main`. Branch each one from `main` after the previous one has merged. If you stack branches instead, retarget the next PR to `main` before the first merges, and check ancestry (stacked-merge trap).

Each PR's last step: `npx nx run-many -t lint test build typecheck`, all green, then `git push -u origin <branch>` and `gh pr create`.

PR 1 also commits the spec and this plan.

Any PR that changes the contract runs, in order:

```bash
pnpm --filter @xjobs/database db:migration:plan --name <slug>
pnpm db:reset
pnpm db:types
pnpm db:test
```

- Rename the generated migration directory to `<YYYYMMDDTHHMM>_<slug>`.
- A hand-written `rawSql` migration is emitted with `node libs/database/src/migrations/app/<dir>/migration.ts`. It must re-add earlier invariants to `refs/db.json`; see the note in `20261111T0330_match_details_list_rows/migration.ts`.
- Postgres specs need `PROCESSOR_TEST_DATABASE_URL`, using the disposable `processor_test` recipe.

---

## PR 1: Listing location fields, the place resolver, seed data, recheck

Branch: `feat/listing-facts-places`

### Task 1.1: Store parsed city, state, geoId and employer-provided salary

**Files:**

- Modify:
  - `apps/xjobs/src/modules/ingest/normalize/record.ts`
  - `apps/xjobs/src/modules/ingest/normalize/mappers/harvest-job.mapper.ts`
  - `apps/xjobs/src/modules/ingest/repositories/jobs.writer.ts` (`fieldColumns`)
  - the Ashby, Greenhouse and other mappers that build records (null fill comes free through `emptyRecord`)
  - `libs/database/src/contract/contract.prisma` (`NormalizedJob`)
- Fixtures: `apps/xjobs/src/modules/ingest/utils/fixtures/linkedin-job-harvest.json`
- Test: `apps/xjobs/src/modules/ingest/normalize/mappers/harvest-job.mapper.spec.ts`

**Interfaces:**

- Produces:
  - `NormalizedRecord` gains `city: string | null`, `state: string | null` and `geoId: string | null`. They are added to `RECORD_FIELDS` after `regionCode`.
  - `salary` gains `providedByEmployer: boolean | null`.
  - Columns on `normalized_jobs`: `city`, `state`, `geoId` (text, nullable) and `salaryProvidedByEmployer` (boolean, nullable).
  - `NORMALIZER_VERSION = 5`.

- [ ] **Step 1: Add fixtures.**
  - Add scrubbed items from `tmp/harvest-items/items.json` to the fixture file: names in `hiringTeam` replaced with `"Jane Doe"`, profile URLs with `https://www.linkedin.com/in/example`.
  - Pick one each of:
    - `regionCode` `EU`, `EMEA` and `NAMER`
    - "California, United States" (a state only)
    - "Rueil-Malmaison" (a French suburb)
    - "La Défense"
    - an employer-provided salary with `payPeriod` `MONTHLY`, and one with `HOURLY`
    - a null `workplaceType`
  - Skip any kind the six existing fixtures already cover.
- [ ] **Step 2: Write failing mapper tests:**
  - `maps parsed city and state`: the Paris item gives `city: 'Paris'`, `state: 'Île-de-France'`.
  - `maps the location geoId`: the EU item gives `geoId: '91000000'`, `countryCode: null`, `regionCode: 'EU'`.
  - `keeps providedByEmployer on salary`: `salary.providedByEmployer === true`.
  - `cheap_scraper items get null city, state and geoId`.
- [ ] **Step 3: Run the tests.** `npx nx test xjobs -- harvest-job.mapper`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - `mapHarvestJob` reads `parsed.city`, `parsed.state` and `location.geoId` through `cleanText`, and `salary.providedByEmployer` when it's a boolean.
  - Add the contract columns, `fieldColumns` mapping and a migration (`listing_location_detail`).
  - Bump `NORMALIZER_VERSION` to 5, with a comment saying no `db:renormalize` is needed for old items.
- [ ] **Step 5: Verify.** `npx nx test xjobs -- normalize` and `pnpm db:test` pass.
- [ ] **Step 6: Commit** `feat(ingest): store LinkedIn's parsed city, state, geoId and employer-provided salary`.

### Task 1.2: Place resolver

**Files:**

- Create:
  - `apps/xjobs/src/modules/facts/places/fold.ts`
  - `apps/xjobs/src/modules/facts/places/resolver.ts`
  - `apps/xjobs/src/modules/facts/config/linkedin-places.ts`
- Test: `apps/xjobs/src/modules/facts/places/resolver.spec.ts`

**Interfaces:**

- Produces:
  - In `fold.ts`:

    ```ts
    export function foldPlaceName(name: string): string; // NFD, strip combining marks, lower case, trim, collapse spaces and hyphens to one space
    ```

  - In `resolver.ts`:

    ```ts
    export interface PlaceVocabulary {
      regions: Set<string>; // approved region codes
      countries: Set<string>; // approved country codes
      cities: Map<string, string>; // `${countryCode}|${foldPlaceName(name or alias)}` -> city id (approved and proposed)
      regionCountries: Map<string, Set<string>>; // region code -> its country codes (region_countries)
    }
    export type ResolvedPlace = { kind: 'worldwide' } | { kind: 'region'; code: string } | { kind: 'country'; code: string } | { kind: 'city'; name: string; countryCode: string; cityId: string };
    export interface ListingLocation {
      countryCode: string | null;
      regionCode: string | null;
      city: string | null;
      geoId: string | null;
    }
    export function resolveListingPlace(loc: ListingLocation, vocab: PlaceVocabulary): { place: ResolvedPlace | null; fellBack: boolean };
    export function findCity(name: string, countryCode: string, vocab: PlaceVocabulary): string | null;
    ```

  - In `linkedin-places.ts`:
    - `LINKEDIN_REGION_CODES: Record<string,string> = { EU: 'EU', EMEA: 'EMEA', NAMER: 'NORTH_AMERICA' }`
    - `LINKEDIN_REGION_GEO_IDS: Record<string, string>`:
      - `'91000000'` → `'EU'`, `'91000002'` → `'EEA'`, `'91000007'` → `'EMEA'`
      - `'91000001'` → `'MIDDLE_EAST'`, `'91000008'` → `'MENA'`, `'91000011'` → `'LATAM'`
      - `'100506914'` → `'EUROPE'`, `'103537801'` → `'AFRICA'`
      - `'92000000'` → `'WORLDWIDE'`, a sentinel that means `{ kind: 'worldwide' }`

- [ ] **Step 1: Write failing tests** (one `it` per row):

  | Input                                                  | Expected `place`                        | `fellBack` |
  | ------------------------------------------------------ | --------------------------------------- | ---------- |
  | `{regionCode:'NAMER'}`                                 | `{kind:'region', code:'NORTH_AMERICA'}` | false      |
  | `{regionCode:'XYZ', geoId:null}`                       | `null`                                  | true       |
  | `{regionCode:null, geoId:'91000002'}`                  | region `EEA`                            | false      |
  | `{countryCode:'FR', city:'Paris'}`, Paris in vocab     | `{kind:'city', cityId:<id>}`            | false      |
  | `{countryCode:'FR', city:'Rueil-Malmaison'}`           | `{kind:'country', code:'FR'}`           | true       |
  | `{countryCode:'MA', city:'Fez'}`, Fès with alias `Fez` | city Fès                                | false      |
  | `{countryCode:'MA', city:'Fes'}` (accent fold)         | city Fès                                | false      |
  | `{countryCode:'MA', city:null}`                        | country `MA`                            | false      |
  | `{countryCode:'ZZ'}` (not approved)                    | `null`                                  | true       |

  Also `foldPlaceName('Vélizy-Villacoublay') === 'velizy villacoublay'`.

- [ ] **Step 2: Run.** `npx nx test xjobs -- resolver`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files. Order: region code, then region geoId, then city, then country, then null.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(facts): add the place resolver for LinkedIn locations`.

### Task 1.3: Processor cities resolve through aliases and accents

**Files:**

- Modify:
  - `apps/xjobs/src/modules/processor/repositories/vocab.repository.ts` (`upsertCities`, `PrismaVocabRepository`)
  - the memory vocab in `apps/xjobs/src/modules/processor/testing/fakes.ts`
- Create: `apps/xjobs/src/modules/facts/places/place-vocabulary.repository.ts`
- Test: `apps/xjobs/src/modules/processor/repositories/vocab.repository.spec.ts` (memory) and `processor.postgres.spec.ts` (one case)

**Interfaces:**

- Consumes: `foldPlaceName`, `PlaceVocabulary` (Task 1.2).
- Produces:
  - `PlaceVocabularyRepository` with `load(): Promise<PlaceVocabulary>`. It builds the city keys from each city's name and every alias.
  - `upsertCities` keeps its signature. It now matches an existing city by `foldPlaceName` of its name or any alias, in the same country, before creating one.

- [ ] **Step 1: Write failing tests:**
  - `upsertCities maps "Fez" to the existing Fès`: no new row, and `occurrences` goes up by one.
  - `upsertCities maps "Fes" to Fès`.
  - `upsertCities creates a proposed city for an unknown name`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Inside the transaction, load the country's cities once per distinct country. Match in memory with `foldPlaceName` over name and aliases. Keep `nameKey = cityNameKey(name)` for new rows.
- [ ] **Step 4: Run.** `npx nx test xjobs -- vocab` passes. The postgres spec passes when `PROCESSOR_TEST_DATABASE_URL` is set.
- [ ] **Step 5: Commit** `fix(processor): match cities through aliases and accent folding`.

### Task 1.4: Moroccan seed data and city aliases in `db:vocab`

**Files:**

- Modify:
  - `libs/database/src/seeds/vocab/seed-cities.ts`
  - `apps/xjobs/src/scripts/processor-args.ts`
  - `apps/xjobs/src/scripts/vocab.ts`
  - `apps/xjobs/src/modules/processor/repositories/vocab.repository.ts`
- Test: `apps/xjobs/src/scripts/processor-args.spec.ts`, plus a seed case in `apps/db-tests`.

**Interfaces:**

- Produces:
  - `aliasCity(id: string, spelling: string): Promise<boolean>`, which appends to an approved city's `aliases`. It returns false for a missing or proposed city.
  - The CLI form `db:vocab -- cities alias <id> --as "<spelling>"`.

- [ ] **Step 1: Seed cities** (MA, `geonamesId: null`, approved through `makeCitiesSeed`):
  - `Casablanca` with aliases `Mechouar` and `Prefecture of Casablanca`
  - `Fès` with `Fez` and `Fes`
  - `Marrakech` with `Marrakesh`
  - `Salé` with `Salé El Jadida`
  - `Rabat`, `Tétouan`
  - `Tangier` with `Tanger`
  - `Agadir`, `Meknes` with `Meknès`, `Oujda`, `Mohammedia`, `Ben Guerir`
- [ ] **Step 2: Write failing tests.**
  - `parses cities alias <id> --as <spelling>` gives `{ list: 'cities', command: 'alias', id, spelling }`.
  - The seed test in `apps/db-tests`: after seeding, `cities` has Fès approved with alias `Fez`.
- [ ] **Step 3: Implement** the parser branch, `aliasCity` and the script output line.
- [ ] **Step 4: Verify.** `npx nx test xjobs -- processor-args`, then `pnpm db:reset && pnpm db:test`.
- [ ] **Step 5: Commit** `feat(vocab): seed Moroccan cities and aliases; alias cities from db:vocab`.

### Task 1.5: Recheck command for unmapped LinkedIn places

**Files:**

- Create:
  - `apps/xjobs/src/scripts/places-recheck.ts`
  - `apps/xjobs/src/modules/facts/places/recheck.ts`
- Modify: `apps/xjobs/package.json` (script `db:places`)
- Test: `apps/xjobs/src/modules/facts/places/recheck.spec.ts`

**Interfaces:**

- Consumes: `resolveListingPlace`, `PlaceVocabularyRepository.load`.
- Produces:

  ```ts
  export interface PlaceRow {
    location: string | null;
    countryCode;
    regionCode;
    city;
    geoId;
  }
  export function unmappedPlaces(rows: PlaceRow[], vocab: PlaceVocabulary): { text: string; result: 'country' | 'none'; count: number }[]; // sorted by count desc
  ```

  - The script `pnpm --filter @xjobs/xjobs db:places -- --days <n>` (default 7).
  - It reads LinkedIn job board jobs with `"lastSeenAt" >= now() - n days`, keeps only those that have any of `countryCode`, `regionCode` or `geoId` (harvest jobs), and prints a tab-separated table.

- [ ] **Step 1: Write the failing test.** `groups fallbacks by text and counts them`: two "Rueil-Malmaison" rows and one region `XYZ` give `[{text:'Rueil-Malmaison, …', result:'country', count:2}, {…, result:'none', count:1}]`. A resolved Paris row is left out.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The script follows the `reprocess-jobs.ts` pattern (plain `main()`, `createDatabaseClient`, `db.close()` in `finally`).
- [ ] **Step 4: Run.** Expected: PASS. Also run `pnpm --filter @xjobs/xjobs db:places` against the local stack and check it prints a header.
- [ ] **Step 5: Commit** `feat(facts): add db:places to list LinkedIn places that fell back`. Add a line for `db:places` to `CLAUDE.md`'s Commands.
- [ ] **Step 6: Commit the spec and this plan,** then push and open PR 1.

---

## PR 2: Processor reads the description only

Branch: `feat/processor-description-only`

### Task 2.1: Remove listing data from the processor's input and prompts

**Files:**

- Modify:
  - `apps/xjobs/src/modules/processor/models/types.ts`
  - `rules/input.ts`
  - `repositories/processor.repository.ts` (`loadJob`, delete `evidenceOf`)
  - `models/extraction.model.ts` (`postingText`)
  - `models/decision.model.ts` (`statement`)
  - `prompts/system.prompt.ts`
  - `rules/validate.ts` (`checkQuotes` haystack)
  - `services/processor.service.ts` (run log, `PreviewPosting`, `preview`)
  - `controllers/processor.controller.ts`
  - `dtos/preview.dto.ts`
  - `testing/fakes.ts`
- Tests: the existing specs named in each step.

**Interfaces:**

- Produces:
  - `PostingInput = { jobId; title: string | null; description: string; truncated: boolean }`.
  - `JobForProcessing = { id; closed; title; descriptionText }`.
  - `PreviewPosting = { title?: string; description: string }`.
  - `Evidence` is deleted.

- [ ] **Step 1: Write failing tests.**
  - `input.spec`: `inputHash ignores nothing but the title and description`: two jobs with the same title and description, but different listing columns, hash equal.
  - `extraction.model.spec` and `decision.model.spec`: `the user message has no listing metadata or company line`. Assert the message contains neither `Listing metadata` nor `Company:`.
  - `prompt.spec`: `the system prompt never mentions the listing`. Assert `SYSTEM_PROMPT` matches none of `/listing/i`, `/fromListing/`, `/company name/i`.
  - `validate.spec`: `a quote from the company name alone is not found`.
- [ ] **Step 2: Run.** `npx nx test xjobs -- processor`. Expected: these FAIL.
- [ ] **Step 3: Implement.**
  - `postingText` and `statement` render `Title:`, the truncation note, then the description.
  - In `system.prompt.ts`:
    - Rewrite the input paragraph to: "The input is one posting: its title and its description text. The description may have been cut at a paragraph boundary; judge only what you can see."
    - Drop "and never taken from the listing metadata" from the quote rule.
    - Remove `fromListing` from the openings path.
    - Delete the "Listing metadata as a last resort" bullet.
    - Delete the salary line's last sentence.
  - The DTO keeps `title?` and `description` only. The controller and service follow.
- [ ] **Step 4: Run.** `npx nx test xjobs -- processor`. Expected: PASS once Task 2.2 lands. Fix only compile errors from removed fields here.
- [ ] **Step 5: Commit** `feat(processor): read only the title and description`.

### Task 2.2: Schema v3 without listing provenance

**Files:**

- Modify:
  - `apps/xjobs/src/modules/processor/schema/extraction.ts`
  - `schema/fact.ts`
  - `schema/model-output.ts`
  - `rules/resolve-facts.ts`
  - `rules/validate.ts` (`needsReview`)
  - `rules/verify.ts`
  - `services/extraction-pipeline.service.ts:77`
  - `services/generation.service.ts:103`
  - `rules/typed-columns.ts`
  - `schema/fixture.testing.ts`
- Delete:
  - `apps/xjobs/src/modules/processor/rules/evidence.ts` and its spec
- Move:
  - `git mv apps/xjobs/src/modules/processor/config/evidence.ts apps/xjobs/src/modules/facts/config/linkedin-codes.ts`. It stays unused until Task 3.2, and loses `LINKEDIN_NO_EVIDENCE`'s warning use.

**Interfaces:**

- Produces:
  - `EXTRACTION_SCHEMA_VERSION = 3`.
  - The v3 document has no `conflicts` and no opening `fromListing`, and `decidedBy` is only `'generator'`. The `decidedBySchema = z.enum(['generator'])` field is kept so the score code is unchanged.
  - `parseStoredDocument` returns `{version:3; document} | {version:2; document: ExtractionDocumentV2} | {version:1; …}`. Keep the v2 schema as `schema/extraction-v2.ts`, a copy of today's.
  - `resolveFacts({ output, generatorModel })`: the `input` argument is removed.
  - `deriveTypedColumns(doc)` no longer expands regions to countries. The `regionCountries` parameter is removed, and no reader exists (checked).

- [ ] **Step 1: Write failing tests.**
  - `extraction.spec`:
    - `a v3 document has no conflicts key`
    - `parseStoredDocument still reads a stored v2 document as version 2`
  - `resolve-facts.spec`:
    - `an unstated seniority stays unstated`
    - `an unstated salary stays null`
  - `validate.spec`: `needsReview ignores what conflicts used to flag`.
  - `typed-columns.spec`: `a region place adds no country codes`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Delete `withIngest`, `ingestFallback`, `INGEST_FIELD`, `resolveSalary`'s listing branch and the `fromListing` branch.
  - Remove `doc.conflicts.length > 0` from `needsReview`.
  - Remove the `decidedBy !== 'ingest'` filter.
  - Make the generation log say nothing about evidence conflicts.
- [ ] **Step 4: Run.** `npx nx test xjobs`. Expected: PASS. The matcher still compiles, because it reads v2 or v3 through `parseStoredDocument` until PR 3. Make `matcher.repository.ts:95` accept `version === 3` too.
- [ ] **Step 5: Commit** `feat(processor): extraction schema v3 without listing provenance`.

### Task 2.3: Golden set and eval without evidence

**Files:**

- Modify:
  - `apps/xjobs/src/modules/processor/golden/golden.ts`
  - `golden/import.ts`
  - `golden/score.ts`
  - the golden case JSON files
  - `apps/xjobs/src/scripts/processor-eval.ts`
- Tests: `golden.spec.ts`, `score.spec.ts`

**Interfaces:**

- Produces:
  - `GoldenCase.input = { title; description }`.
  - `FactReport = { scored; accuracy }`, with `generatorShare` and `ingestShare` removed.

- [ ] **Step 1: Write failing tests.**
  - `golden.spec`: `every case input has only title and description`.
  - `score.spec`: `reports have no ingest share`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Strip `companyName` and `evidence` from every case file with a one-off node script; don't commit the script.
  - Review each case whose `evidence.location` was set and whose expected openings came only from it (case 10317 already expects `unstated`). Set the expected openings to the description-only answer, and list the changed case ids in the commit body.
- [ ] **Step 4: Run.** `npx nx test xjobs -- golden score`. Expected: PASS. Don't run `processor:eval` (OpenRouter spend). The PR description says it's to be run after merge.
- [ ] **Step 5: Commit** `test(processor): golden set without listing evidence`. Update `apps/xjobs/src/modules/processor/README.md` (drop "evidence conflicts"). Then push and open PR 2. The PR body says: after deploy, run `db:reprocess -- --all-in-scope` by hand (about 60 jobs, about $0.50 on dev).

---

## PR 3: Combined facts; the matcher and the matches page read them

Branch: `feat/job-facts`

### Task 3.1: `job_facts` and `job_fact_conflicts` tables

**Files:**

- Modify:
  - `libs/database/src/contract/contract.prisma`
  - `apps/db-tests/src/engine-tables.db.spec.ts`
- Create: the migration `<ts>_job_facts`

**Interfaces:**

- Produces:
  - `JobFacts` (`job_facts`):
    - `jobId Uuid @id`, FK to `NormalizedJob`, cascade
    - `extractionId Uuid`, FK to `JobExtraction`, restrict
    - `factsVersion Int`
    - `factsHash String` (sha256 of the canonical `facts` JSON)
    - `facts Jsonb`
    - `closed Boolean`
    - `builtAt TimestamptzJsDate(3)`
    - `+Timestamps`
    - `@@rls`
  - `JobFactConflict` (`job_fact_conflicts`):
    - `id Uuid @id @onCreate(uuid(7))`
    - `jobId`, FK cascade
    - `extractionId`
    - `field String`
    - `listingValue Jsonb`
    - `descriptionValue Jsonb`
    - `quote String`
    - `winner String` with `@@check winner IN ('description','listing')`
    - `createdAt`
    - `@@index([jobId])`, `@@index([field])`
    - `@@rls`

- [ ] **Step 1: Write failing db tests.** Add fixtures for both tables to `engine-tables.db.spec.ts`, asserting an authenticated user can't read or write them.
- [ ] **Step 2: Run.** `pnpm db:test`. Expected: FAIL (no tables).
- [ ] **Step 3: Implement.** Edit the contract, then the migration commands from the constraints.
- [ ] **Step 4: Run.** `pnpm db:test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(database): add job_facts and job_fact_conflicts`.

### Task 3.2: Listing facts and `combineFacts`

**Files:**

- Create:
  - `apps/xjobs/src/modules/facts/schema/facts.ts`
  - `apps/xjobs/src/modules/facts/rules/listing.ts`
  - `apps/xjobs/src/modules/facts/rules/combine.ts`
  - `apps/xjobs/src/modules/facts/rules/currency.ts`
  - `apps/xjobs/src/modules/facts/config/facts.config.ts`
- Use: `apps/xjobs/src/modules/facts/config/linkedin-codes.ts` (moved in Task 2.2)
- Tests:
  - `apps/xjobs/src/modules/facts/rules/listing.spec.ts`
  - `apps/xjobs/src/modules/facts/rules/combine.spec.ts`

**Interfaces:**

- Consumes:
  - `ExtractionDocument` (v3) from `processor/schema/extraction.ts`
  - `resolveListingPlace` and `PlaceVocabulary` (Task 1.2)
- Produces:
  - In `facts.config.ts`: `FACTS_VERSION = 1`.
  - In `currency.ts`: `ISO_4217: ReadonlySet<string>` (active codes) and `cleanCurrency(code: string | null): string | null`.
  - In `facts.ts`:

    ```ts
    export type FactSource = 'description' | 'linkedin';
    export interface SourcedFact<T> {
      value: T | null;
      confidence: 'sure' | 'unsure';
      source: FactSource;
      quote: string;
    }
    export interface FactOpening {
      arrangements: string[];
      places: ResolvedPlaceOrCity[];
      placeStrictness: PlaceStrictness;
      timezones: Timezone[];
      quote: string;
      confidence: 'sure' | 'unsure';
      source: FactSource;
    }
    // ResolvedPlaceOrCity: the processor's place union, with city { name, countryCode | null, cityId | null }
    export interface JobFactsDocument {
      version: number;
      position;
      isSoftwareEngineeringRole;
      seniority;
      yearsRequired;
      contractType;
      requiredLanguages;
      workAuthorization;
      techStack: SourcedFact<…>; // same value types as ExtractionDocument, source always 'description'
      arrangement: SourcedFact<string>;
      openings: FactOpening[];
      salary: SourcedFact<{
        min: number | null;
        max: number | null;
        currency: string | null;
        period: 'hour' | 'day' | 'month' | 'year';
      }>;
      closed: boolean;
    }
    export const jobFactsDocumentSchema: z.ZodType<JobFactsDocument>;
    ```

  - In `listing.ts`:

    ```ts
    export interface ListingRow {
      workplaceType: 'remote' | 'hybrid' | 'onsite' | null;
      countryCode;
      regionCode;
      city;
      geoId;
      location: string | null;
      salaryMin;
      salaryMax;
      salaryCurrency;
      salaryPeriod: string | null;
      salaryProvidedByEmployer: boolean | null;
      experienceLevel: string | null;
      employmentType: string | null;
      expiresAt: Date | null;
    }
    export interface ListingFacts {
      arrangement: string | null;
      place: ResolvedPlace | null;
      locationText: string | null;
      salary: { min; max; currency: string | null; period } | null;
      experienceLevel: string | null;
      contractText: string | null;
      expiresAt: Date | null;
    }
    export function listingFacts(row: ListingRow, vocab: PlaceVocabulary): ListingFacts;
    ```

  - In `combine.ts`:

    ```ts
    export interface FactConflict {
      field: 'arrangement' | 'places' | 'salary' | 'seniority' | 'contractType';
      listingValue: unknown;
      descriptionValue: unknown;
      quote: string;
      winner: 'description' | 'listing';
    }
    export function combineFacts(args: { extraction: ExtractionDocument; listing: ListingFacts; now: Date }): { facts: JobFactsDocument; conflicts: FactConflict[] };
    ```

- [ ] **Step 1: Write the failing `listing.spec`:**
  - `maps MONTHLY to month and keeps an employer salary`
  - `drops a salary not provided by the employer`
  - `drops a salary with an unknown period`
  - `drops an unknown currency but keeps the amounts`
  - `an on_site item is onsite` (mapped in ingest; assert it passes through)
- [ ] **Step 2: Write the failing `combine.spec`,** one `it` per spec rule:
  - `description arrangement wins and a disagreement is a conflict`: description `hybrid`, listing `onsite` gives arrangement `hybrid`, source `description`, and one conflict `{field:'arrangement', winner:'description'}`.
  - `listing fills an unstated arrangement`: description openings `[{arrangements:['unstated'], places:[]}]`, listing `remote` + US. The openings become `[{arrangements:['remote'], places:[{kind:'country', code:'US'}], placeStrictness:'label', source:'linkedin', confidence:'sure', timezones:[]}]`, and arrangement is `remote` with source `linkedin`.
  - `listing supplies only the place when the description states the arrangement`.
  - `a description place elsewhere is a conflict, not a second opening`: description city Paris (FR), listing city Lyon (FR). The openings stay Paris only, with a `places` conflict.
  - `a description place inside the listing country is no conflict`: Paris against FR.
  - `the listing opening is skipped when the description has a time zone`.
  - `seniority is never filled from the listing`: description `unstated`, listing `Mid-Senior level` gives `unstated`, no conflict.
  - `seniority junior against Mid-Senior level is a conflict, senior is not`.
  - `contract type is never filled from the listing, but contract against Full-time is a conflict`.
  - `salary: listing fills a null description salary; both stated and not overlapping is a conflict`.
  - `closed when expiresAt is before now`.
  - `the result parses with jobFactsDocumentSchema`.
- [ ] **Step 3: Run.** `npx nx test xjobs -- facts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Arrangement disagreement: the listing arrangement isn't in the union of the description's stated (non-`unstated`) opening arrangements.
  - Place overlap uses the hierarchy (same city id; city inside a country; country inside a region via `vocab.regionCountries`); `combineFacts` takes the `PlaceVocabulary` as an extra arg `vocab`.
  - Seniority and contract sets come from `linkedin-codes.ts`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(facts): combine description and listing facts with conflicts`.

### Task 3.3: Facts repository and build service

**Files:**

- Create:
  - `apps/xjobs/src/modules/facts/repositories/facts.repository.ts` (abstract + Prisma)
  - `apps/xjobs/src/modules/facts/services/facts.service.ts`
  - `apps/xjobs/src/modules/facts/facts.module.ts`
  - `apps/xjobs/src/modules/facts/index.ts`
  - `apps/xjobs/src/modules/facts/testing/memory-facts.repository.ts`
- Tests:
  - `apps/xjobs/src/modules/facts/services/facts.service.spec.ts`
  - `apps/xjobs/src/modules/facts/repositories/facts.postgres.spec.ts`

**Interfaces:**

- Produces:

  ```ts
  export abstract class FactsRepository {
    abstract loadInputs(jobId: string): Promise<{
      extractionId: string;
      extraction: unknown;
      schemaVersion: number;
      listing: ListingRow;
    } | null>;
    abstract current(jobId: string): Promise<{ factsHash: string; factsVersion: number } | null>;
    abstract save(row: { jobId; extractionId; factsVersion; factsHash; facts: JobFactsDocument; closed: boolean; conflicts: FactConflict[] }): Promise<void>; // upsert facts; replace the job's conflicts in the same transaction
    abstract markStale(where: { countryCode: string }): Promise<number>; // sets builtAt = '-infinity'
  }
  export type BuildResult = { status: 'built'; changed: boolean; facts: JobFactsDocument; factsHash: string; extractionId: string } | { status: 'skipped'; reason: 'no_extraction' | 'old_schema' };
  @Injectable()
  export class FactsService {
    build(jobId: string): Promise<BuildResult>;
  }
  ```

  `FactsService` uses `PlaceVocabularyRepository.load()`, cached for 10 minutes like the matcher's context, and an injectable clock (`FACTS_CLOCK`).

- [ ] **Step 1: Write the failing service tests** (memory repo):
  - `builds from a v3 extraction and saves conflicts`
  - `skips a job whose extraction is v2` gives `{status:'skipped', reason:'old_schema'}`
  - `changed is false when the facts hash is unchanged`
  - `rebuild replaces the job's conflicts`
- [ ] **Step 2: Write the failing postgres spec** (`describe.skipIf(!PROCESSOR_TEST_DATABASE_URL)`): `save then current round-trips`, and `conflicts are replaced, not appended`.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - `loadInputs` joins `normalized_jobs j` and `job_extractions e ON e.id = j."currentExtractionId"`.
  - The hash is sha256 of canonical (key-sorted) JSON, reusing the helper `rules/input.ts` uses (export it if it's private).
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(facts): build and store job facts`.

### Task 3.4: The matcher decides from job facts

**Files:**

- Modify:
  - `apps/xjobs/src/modules/matcher/rules/types.ts`
  - `rules/position.ts`, `seniority.ts`, `location.ts`, `stack.ts`, `decide.ts`
  - `rules/fixtures.testing.ts`
  - `repositories/matcher.repository.ts`
  - `services/matcher.service.ts`
  - `config/matcher.config.ts`
  - `testing/memory-matcher.repository.ts`
  - `apps/xjobs/src/infrastructure/jobs/steps/match/processor.ts`
  - `apps/xjobs/src/infrastructure/jobs/steps/match/queue.service.ts`
  - `apps/xjobs/src/infrastructure/worker/worker.module.ts` (import `FactsModule`)
  - `libs/database/src/contract/contract.prisma` (`JobMatch.factsHash String?`)
  - a migration

**Interfaces:**

- Consumes: `FactsService.build`, `JobFactsDocument`.
- Produces:
  - `MatchJob = { jobId; extractionId; factsHash: string; needsReview: boolean; facts: JobFactsDocument }`.
  - The rules take `JobFactsDocument` where they took `ExtractionDocument`. Field paths are the same: `facts.seniority.value`, `facts.openings`, and so on.
  - `StoredMatch` gains `factsHash`.
  - `MATCHER_VERSION = 2`.
  - Stale row: no row with the same `factsHash` and `matcherVersion >= MATCHER_VERSION`.
  - `listStaleJobs(limit)` returns candidates with stale facts, or a stale row for any published profile. Facts are stale when:
    - there are no `job_facts`;
    - `f."extractionId" <> j."currentExtractionId"`;
    - `f."factsVersion" < FACTS_VERSION`;
    - `j."updatedAt" > f."builtAt"`; or
    - `NOT f.closed AND j."expiresAt" <= now()`.

    A candidate is active, kind `job`, LinkedIn job board, `processed`, with `lastSeenAt` within 30 days and extraction schema version 3.

  - `matchJob(jobId, {force})`:
    1. `facts.build(jobId)`.
    2. If skipped, return `not_matchable`.
    3. If `facts.closed`, return `{status:'closed'}` and keep the rows.
    4. Otherwise decide every stale profile, or every profile when forced.
  - `MatchQueue.enqueue(jobId, {force: true})` uses the BullMQ id `` `${jobId}:force` ``, so a waiting non-forced job doesn't swallow it.

- [ ] **Step 1: Write failing tests.**
  - The rule specs switch their fixture to `factsDoc(edit)`, a `JobFactsDocument` built from `combineFacts` over `fixtureDocument()` with an empty listing. Existing assertions are unchanged.
  - `matcher.service.spec`:
    - `builds facts before deciding`
    - `skips a job whose extraction is v2`
    - `keeps rows of an expired job` (returns `closed`, `upserts` empty, rows kept)
  - `queue.service.spec`: `a forced enqueue is not deduplicated against a waiting job`.
  - `matcher.postgres.spec`: `a facts change makes rows stale`.
- [ ] **Step 2: Run.** `npx nx test xjobs -- matcher match`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `loadMatchableJob` is replaced by `FactsService.build`, plus `needsReview` read from the extraction.
  - The sweep stays `deleteInactive`, then `listStaleJobs(200)`.
- [ ] **Step 4: Run.** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(matcher): decide from job facts`.

### Task 3.5: `match_details` reads job facts; the page shows each fact's source

**Files:**

- Create: the migration `<ts>_match_details_job_facts`. It's function-only and copies `20261111T0330_match_details_list_rows`, re-adding its invariant.
- Modify:
  - `apps/web/src/lib/matches/facts.ts`
  - `apps/web/src/components/matches/match-detail.tsx`
  - `apps/web/src/components/matches/test-fixtures.ts`
- Tests:
  - `apps/db-tests/src/match-details.db.spec.ts` (create it, or extend the existing one)
  - `apps/web/src/lib/matches/facts.spec.ts`
  - `apps/web/src/components/matches/match-detail.spec.tsx`

**Interfaces:**

- Produces:
  - `match_details` joins `job_facts f ON f."jobId" = m."jobId"` and builds `facts` from `f.facts`, with the same keys and the same label lookups as today. Each fact gains `"source"`.
  - It adds a return column `conflicts jsonb`: an array of `{field, listingValue, descriptionValue, winner}` from `job_fact_conflicts`, null when `p_details = false`.
  - In the web: `FactLines` values become `{ text: string; source: 'description' | 'linkedin' } | null`, and `factLines(row)` returns that.

- [ ] **Step 1: Write failing tests.**
  - db: `match_details returns facts from job_facts with their source`, and `returns conflicts for a job`.
  - web:
    - `factLines marks a LinkedIn arrangement`
    - `MatchDetail shows "From LinkedIn" next to a LinkedIn fact`
    - `MatchDetail lists a conflict under its fact`: the text "LinkedIn says onsite".
- [ ] **Step 2: Run.** `pnpm db:test` and `npx nx test web`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Render the source as a muted `Badge` from `components/ui/badge`, text "From LinkedIn", for LinkedIn facts only.
  - Render conflicts as a muted line under the fact.
  - Then `pnpm db:types`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(matches): read facts from job_facts and show their source`. Then push and open PR 3. The PR body says: after deploy, the sweep rebuilds facts for every processed job with a v3 extraction. Check on dev that no Casablanca job shows Worldwide.

---

## PR 4: The `review` outcome and measures

Branch: `feat/match-review-outcome`

### Task 4.1: Checks carry `unsure`; `decide` returns `review`

**Files:**

- Modify:
  - `apps/xjobs/src/modules/matcher/rules/types.ts`
  - `rules/decide.ts`
  - `rules/position.ts`, `seniority.ts`, `location.ts`, `stack.ts`
  - `repositories/matcher.repository.ts` (`upsertMatches`)
  - `libs/database/src/contract/contract.prisma` (`JobMatch`)
  - a migration
- Tests: each rule spec and `decide.spec.ts`

**Interfaces:**

- Produces:
  - `Check` gains `unsure: boolean`: true when the check's outcome rests on an unsure value.
  - `Decision.outcome: 'qualified' | 'rejected' | 'review'`.
  - `Decision` gains `review: { rule: RuleName; field: string } | null`: the first unsure failing check, in rule order.
  - On `JobMatch`:
    - the outcome check widens to `('qualified','rejected','review')`;
    - new columns `reviewRule String?` and `reviewField String?`;
    - a check that both are set exactly when `outcome = 'review'`.
  - `MATCHER_VERSION = 3`.

What sets `unsure` on a failing check:

| Rule      | Unsure when                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| position  | `position.confidence` or `isSoftwareEngineeringRole.confidence` is unsure (the one that decided)                                          |
| seniority | `seniority.confidence` is unsure (field `seniority`), or the years fallback decided and `yearsRequired` is unsure (field `yearsRequired`) |
| location  | any failing opening is unsure (field `openings`)                                                                                          |
| stack     | any main or must requirement that decided the failure is unsure (field `techStack`)                                                       |

- [ ] **Step 1: Write failing tests.**
  - `decide.spec`:
    - `a sure fail rejects`
    - `an unsure fail with no sure fail is review, with rule and field`
    - `a sure fail beats an unsure fail`
    - `an unsure pass stays qualified and unverified`
    - `a LinkedIn opening counts as sure` (source `linkedin`, confidence `sure`, no overlap gives rejected)
  - One test per rule for `unsure: true` on a failure.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement,** including the contract change and migration, then `pnpm db:types`.
- [ ] **Step 4: Run.** `npx nx test xjobs` and `pnpm db:test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(matcher): send unsure rejections to review`.

### Task 4.2: Outcome shares

**Files:**

- Create:
  - `apps/xjobs/src/scripts/match-shares.ts`
  - `apps/xjobs/src/modules/matcher/services/shares.ts`
- Modify: `apps/xjobs/package.json` (`db:match-shares`), `CLAUDE.md` (Commands)
- Test: `apps/xjobs/src/modules/matcher/services/shares.spec.ts`

**Interfaces:**

- Produces:

  ```ts
  export function outcomeShares(rows: { outcome: string; reviewRule: string | null; reviewField: string | null }[]): {
    total: number;
    byOutcome: Record<string, number>;
    reviewByRule: Record<string, number>;
    reviewByField: Record<string, number>;
  }; // shares in 0..1
  ```

  The script `pnpm --filter @xjobs/xjobs db:match-shares -- --days <n>` (default 7) reads `job_matches` decided in the window and prints percentages.

- [ ] **Step 1: Write the failing test.** `counts shares per outcome, review rule and field`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(matcher): report outcome and review shares`. Then push and open PR 4.

---

## PR 5: New rules, exchange rates, posting language, re-matching

Branch: `feat/match-new-rules`

### Task 5.1: Exchange rates

**Files:**

- Contract: `ExchangeRate` (`exchange_rates`), with `currency String @id`, `perUsd Decimal`, `fetchedAt` and `@@rls`. Add an `engine-tables` fixture.
- Create:
  - `apps/xjobs/src/modules/rates/` with `rates.repository.ts`, `rates.service.ts`, `rates.module.ts`, `config/rates.config.ts`
  - `apps/xjobs/src/infrastructure/jobs/steps/rates/` with `queue.service.ts` and `processor.ts`
- Modify:
  - `apps/xjobs/src/infrastructure/worker/scheduler.ts` (`syncRatesRefreshScheduler`, daily at 03:00 UTC, only with `RUN_SCHEDULES`)
  - `match.service.ts` (start the rates worker inside the match worker)
- Tests: `rates.service.spec.ts`, and a step processor spec

**Interfaces:**

- Produces:
  - `RATES_SOURCE_URL`: the builder confirms a free, keyless source covering MAD, EUR, USD and GBP. The suggestion is `https://open.er-api.com/v6/latest/USD`.
  - `RatesService.refresh(): Promise<{ updated: number }>`. It fetches the source, keeps the rows for currencies in `ISO_4217`, and upserts them. On a fetch error it logs a warning and keeps the old rows.
  - `RatesRepository.all(): Promise<Map<string, number>>` (per-USD rates).

- [ ] **Step 1: Write failing tests.**
  - `refresh upserts parsed rates` (fetch stubbed)
  - `a failed fetch keeps the last rates and does not throw`
  - `ignores codes outside ISO 4217`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Write the contract, migration and the `db:types` and `db:test` updates.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(rates): store daily exchange rates`.

### Task 5.2: Salary and currency rules

**Files:**

- Create:
  - `apps/xjobs/src/modules/matcher/rules/salary.ts`
  - `apps/xjobs/src/modules/matcher/rules/convert.ts`
- Tests: `rules/salary.spec.ts`, `rules/convert.spec.ts`

**Interfaces:**

- Consumes: `MatchContext.rates: Map<string, number>` (added to `MatchContext` and `loadContext`).
- Produces:
  - `HOURS_PER_YEAR = 2080`, `HOURS_PER_DAY = 8`, `MONTHS_PER_YEAR = 12`, `SALARY_MARGIN = 0.1` in `matcher.config.ts`.
  - `convertPay(amount: number, from: {currency: string; period: Period}, to: {currency: string; period: Period}, rates: Map<string, number>): number | null`.
  - `checkSalary(facts, profile, rates): Check` (rule `salary`) and `checkCurrency(facts, profile): Check` (rule `currency`).
  - `RuleName` gains `'salary' | 'currency'`.
  - `MatchProfile` gains `salaryMin`, `salaryCurrency`, `salaryPeriod`, `acceptsAnyCurrency` and `acceptedCurrencies`, loaded in `listPublishedProfiles`.

- [ ] **Step 1: Write the failing `convert.spec`:**
  - `50 USD per hour is 104000 USD per year`
  - `a month is a year over 12`
  - `converts EUR to MAD through USD rates`
  - `an unknown currency is null`
- [ ] **Step 2: Write the failing `salary.spec`:**
  - `pass at or above the minimum`
  - `fail more than 10% below`
  - `unknown within the margin`
  - `uses max, else min`
  - `unknown with no salary`
  - `unknown when it can't convert`
  - `unknown when the profile has no minimum`
  - `an unsure salary failure is unsure`
  - currency:
    - `fail when the currency is not accepted`
    - `pass when any is accepted`
    - `unknown when no currency is stated`
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement,** and wire both rules into `decide` after `stack`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(matcher): match salary and accepted currencies`.

### Task 5.3: Contract type, required languages, work authorization rules

**Files:**

- Create:
  - `apps/xjobs/src/modules/matcher/rules/contract.ts`
  - `apps/xjobs/src/modules/matcher/rules/languages.ts`
  - `apps/xjobs/src/modules/matcher/rules/work-authorization.ts`
- Modify:
  - `rules/types.ts`, `rules/decide.ts`
  - `repositories/matcher.repository.ts` (`listPublishedProfiles` loads `contractTypes`, `languages` and the user's eligibility; `work_authorizations` is read by `userId`)
- Tests: one spec per rule

**Interfaces:**

- Produces:
  - `RuleName` gains `'contractType' | 'languages' | 'workAuthorization'`.
  - `MatchProfile` gains:
    - `contractTypes: string[]`
    - `languages: { lang: string; level: 'native' | 'fluent' | 'working' }[]`
    - `eligibility: { authorizations: { kind: string; place: string }[]; residenceCountry: string | null; acceptsSponsorship: boolean | null }`
  - `checkContractType(facts, profile)`, `checkRequiredLanguages(facts, profile)` and `checkWorkAuthorization(facts, profile, idx: PlaceIndex)`.

- [ ] **Step 1: Write the failing tests:**
  - **contract:**
    - `pass when in the list`
    - `fail when not`
    - `unknown when unstated`
    - `an unsure contract failure is unsure`
  - **languages:**
    - `fail when a required language is missing`
    - `fail when held below the required level` (working against fluent)
    - `pass at or above`
    - `unknown when none required`
    - `an unsure requirement failure is unsure`
  - **work authorization:** one test per row of the spec table:
    - `citizenship meets work-permit`
    - `residenceCountry meets residency`
    - `a work permit does not meet citizenship`
    - `a region authorization covers a country requirement` (EU work-permit against FR)
    - `unmet with sponsorship yes and acceptsSponsorship true passes`
    - `unmet with sponsorship unstated fails`
    - `acceptsSponsorship null counts as no`
    - `citizenship can't be sponsored`
    - `no requirements is unknown`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Wire the rules into `decide` after `currency`. The order of checks is `position, seniority, location, stack, salary, currency, contractType, languages, postingLanguage, workAuthorization`. Update the `Decision.checks` doc comment.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(matcher): match contract type, required languages and work authorization`.

### Task 5.4: Posting language

**Files:**

- Create:
  - `apps/xjobs/src/modules/facts/rules/posting-language.ts`
  - `apps/xjobs/src/modules/matcher/rules/posting-language.ts`
- Modify:
  - `apps/xjobs/package.json` (add the detector dependency)
  - `facts/schema/facts.ts` (add `postingLanguages`)
  - `facts/rules/combine.ts` (fill it from a new `combineFacts` arg `descriptionText: string | null`, which `FactsRepository.loadInputs` returns from `normalized_jobs.descriptionText`)
  - `facts.config.ts` (`FACTS_VERSION = 2`)
- Tests:
  - `facts/rules/posting-language.spec.ts`
  - `matcher/rules/posting-language.spec.ts`

**Interfaces:**

- Produces:
  - `detectPostingLanguages(text: string): { codes: string[]; confident: boolean }`. Codes are ISO 639-1. A language is kept when its paragraphs make up at least 25% of the characters. `confident` is false when the text is under 200 characters, or no paragraph is detected with confidence.
    - Suggested: `franc` per paragraph, with `minLength: 50` and its 639-3 codes mapped to 639-1 by a small table for the languages in the `languages` vocab.
    - The builder may pick another maintained detector, keeping these tests.
  - `JobFactsDocument.postingLanguages: { codes: string[]; confident: boolean }`.
  - `checkPostingLanguage(facts, profile): Check` (rule `postingLanguage`).
    - fail when `confident` and none of `codes` is among the profile's languages, at any level;
    - unknown when not `confident`;
    - never `unsure`.

- [ ] **Step 1: Write failing tests:**
  - `detects an English posting`
  - `detects a Spanish posting`
  - `a French posting with one English line is French only`
  - `a bilingual French and English posting gives both`
  - `a short text is not confident`
  - rule:
    - `Spanish posting rejects a profile without Spanish`
    - `bilingual passes with English`
    - `not confident is unknown`

  Use short real-looking paragraphs written in the spec file, not harvest items.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement and wire.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(matcher): reject postings written in a language the user doesn't speak`.

### Task 5.5: Re-match on profile, eligibility and city changes

**Files:**

- Contract:
  - `User.eligibilityVersion Int @default(0)`
  - `JobMatch.profileUpdatedAt TimestamptzJsDate(3)?`
  - `JobMatch.eligibilityVersion Int?`
- Migration: a `rawSql` trigger `bump_eligibility_version`:
  - `AFTER INSERT OR UPDATE OR DELETE ON work_authorizations FOR EACH ROW` bumps `users."eligibilityVersion"` for `COALESCE(NEW."userId", OLD."userId")`;
  - a `BEFORE UPDATE OF "residenceCountry", "acceptsSponsorship" ON users` trigger bumps it on the row;
  - `SECURITY DEFINER SET search_path = ''`, with `REVOKE EXECUTE` as in `20261105T2049_user_eligibility_and_work_authorizations`.
- Modify:
  - `matcher.repository.ts` (stale row adds `m."profileUpdatedAt" < p."updatedAt"` and `m."eligibilityVersion" < u."eligibilityVersion"`; `upsertMatches` writes both)
  - `MATCHER_VERSION = 4`
  - `apps/xjobs/src/scripts/vocab.ts` (after a city approve or alias, call `FactsRepository.markStale({countryCode})`)
- Tests:
  - `apps/db-tests/src/eligibility-version.db.spec.ts`
  - `matcher.postgres.spec.ts`
  - `vocab` script spec

- [ ] **Step 1: Write failing tests.**
  - db:
    - `inserting, updating or deleting a work authorization bumps eligibilityVersion`
    - `changing residenceCountry bumps it`
    - `changing another users column does not`
  - matcher:
    - `a profile edit makes its rows stale`
    - `an eligibility bump makes the user's rows stale`
  - vocab: `approving a city marks facts stale in its country`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Then `pnpm db:types`.
- [ ] **Step 4: Run.** `npx nx test xjobs` and `pnpm db:test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(matcher): re-match after profile, eligibility and city changes`. Then push and open PR 5.

---

## PR 6: Review list, per-user decisions, mismatch reports

Branch: `feat/review-list`

### Task 6.1: `match_reviews`, `fact_reports` and the review-aware `match_details`

**Files:**

- Contract:
  - `MatchReview` (`match_reviews`):
    - `id`, `userId`, `profileId`
    - `matchId`, FK to `JobMatch`, cascade
    - `jobId`
    - `choice String`, checked `IN ('qualified','rejected')`
    - `rule String`, `field String`
    - `note String?`
    - `+Timestamps`
    - `@@index([matchId, createdAt])`
    - `policy_all match_reviews_owner`, on `"userId" = auth.uid()`
  - `FactReport` (`fact_reports`):
    - `id`, `userId`, `jobId`
    - `extractionId Uuid?`
    - `field String`
    - `processorValue Jsonb?`, `quote String?`
    - `listingValue Jsonb?`
    - `proposedValue String`
    - `note String?`
    - `createdAt`
    - `policy_insert` and `policy_select` on `"userId" = auth.uid()`
- Migration: the function `<ts>_match_details_review`, built from Task 3.5's.
  - **Effective outcome:** when `m.outcome = 'review'` and the latest `match_reviews` row for `m.id` has `rule = m."reviewRule"` and `field = m."reviewField"`, that row's `choice` is the effective outcome; otherwise it's `m.outcome`.
  - `p_outcome` filters on the effective outcome.
  - New return columns: `reviewRule`, `reviewField`, `reviewChoice`.
- Tests: `apps/db-tests/src/match-reviews.db.spec.ts`

**Interfaces:**

- Produces: `match_details(p_outcome => 'review')` returns review rows that have no applicable decision. `'qualified'` also includes review rows the user moved to Matches.

- [ ] **Step 1: Write failing db tests:**
  - `a review row appears under review`
  - `after a qualified decision it appears under qualified`
  - `after a rejected decision it appears under neither`
  - `a decision for another rule or field does not apply` (Review Focus 4)
  - `a user can't read another user's reviews or reports`
  - `a user can insert a report but not update it`
- [ ] **Step 2: Run.** `pnpm db:test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Then `pnpm db:types`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(database): review decisions and fact reports`.

### Task 6.2: Review tab and decisions in the web app

**Files:**

- Modify:
  - `apps/web/src/lib/matches/view-state.ts` (`ViewState.list: 'matches' | 'review'`, param `list`, default `'matches'`)
  - `apps/web/src/lib/matches/load.ts` (`loadMatches(supabase, {since, outcome})`)
  - `apps/web/src/app/(app)/page.tsx`
  - `apps/web/src/components/matches/matches-view.tsx`
  - `match-filters.tsx` (a `Tabs` with `aria-label="List"`: "Matches (n)" and "Review (n)")
  - `match-detail.tsx`
- Create:
  - `apps/web/src/app/(app)/actions.ts` with `decideReviewAction(input: unknown): Promise<SaveResult>`
  - `apps/web/src/lib/matches/review.ts` with `saveReview(supabase, userId, input): Promise<SaveResult>`. The zod input is `{ matchId: uuid; choice: 'qualified' | 'rejected'; note?: string ≤ 500 }`. It reads the match's `profileId`, `jobId`, `reviewRule` and `reviewField`, then inserts.
- Tests:
  - `apps/web/src/lib/matches/review.spec.ts`
  - `view-state.spec.ts`
  - `match-detail.spec.tsx`
  - `app/(app)/actions.spec.ts`

- [ ] **Step 1: Write failing tests:**
  - `readViewState reads list=review and defaults to matches`
  - `saveReview inserts the match's rule and field`
  - `saveReview rejects a match that is not in review`
  - `MatchDetail on a review row shows the rule, the unsure fact's quote and the LinkedIn value`
  - `clicking Move to matches calls onDecide with qualified`
  - `Reject calls onDecide with rejected and shows a toast`
- [ ] **Step 2: Run.** `npx nx test web`. Expected: FAIL.
- [ ] **Step 3: Implement** with `Tabs`, `Button`, `confirm-dialog` (for Reject) and `sonner` toasts. Copy:
  - the section heading "Why it's in review";
  - the buttons "Move to matches" and "Reject";
  - the confirm text "Reject this job? It will leave your review list.";
  - the toast "Moved to matches" / "Rejected".

  Use `router.refresh()` after a decision. Check the page at 360 px.

- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(matches): review list with per-user decisions`.

### Task 6.3: Report a mismatch

**Files:**

- Create:
  - `apps/web/src/lib/matches/report.ts` with `saveReport(supabase, userId, input): Promise<SaveResult>`. The zod input is `{ jobId: uuid; field: one of the FactLines keys plus 'techStack' | 'requiredLanguages' | 'workAuthorization'; proposedValue: string 1..200; note?: string ≤ 500 }`. It copies `processorValue`, `quote`, `listingValue` and `extractionId` from the job's `match_details` row server-side, so the client can't forge them.
  - `apps/web/src/components/matches/report-dialog.tsx`
- Modify:
  - `match-detail.tsx` (a "Report a mismatch" button per fact row, which opens the dialog)
  - `app/(app)/actions.ts` (`reportMismatchAction`)
- Tests: `report.spec.ts`, `report-dialog.spec.tsx`

- [ ] **Step 1: Write failing tests:**
  - `saveReport inserts the processor and LinkedIn values from the row`
  - `saveReport refuses an empty proposed value`
  - `the dialog submits field, proposed value and note`
  - `a report shows a "Thanks, reported" toast`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with `Dialog`, `Field`, `Input`, `Textarea` and `Button` from `components/ui`.
- [ ] **Step 4: Run.** `npx nx test web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(matches): report a wrong fact`. Then run the full CI command, push and open PR 6.

---

## After the last merge (by hand, on dev)

1. `pnpm --filter @xjobs/xjobs db:reprocess -- --all-in-scope` (about 60 processed jobs).
2. Wait for the match sweep. Then run `db:match-shares -- --days 7`, and check that no Casablanca job shows Worldwide.
3. When Apify collection resumes, run `db:places -- --days 7`, then alias or approve with `db:vocab`.
4. The pending cheap_scraper backlog (3,988 jobs, about $33) stays a separate decision.
