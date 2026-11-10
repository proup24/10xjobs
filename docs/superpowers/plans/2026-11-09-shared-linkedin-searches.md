# Shared LinkedIn Searches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one Apify run per LinkedIn job board builder with a planner that merges every published profile's builders into the fewest searches that still find every job, splits searches that come back full, caps daily spend at $3, and runs hourly 08:00–23:00 Morocco time.

**Architecture:** Builders stay one tech × one seniority × one place × one arrangement, so cursors and claims don't change. They also carry a structured place ref in `params.place`. A pure planner (`modules/segments/services/linkedin-plan.ts`) turns the active builders, the approved folds, the place index and the split state into `SearchSegment`s, each with a `PlannedSearch` (OR'd keywords, merged filters, row limit, charge cap). `CollectionService` uses the planner for the LinkedIn job board and `buildSegments` for every other channel. After a full run it records a split and moves cursors only to the oldest returned `publishedAt`. Before each run it checks the Morocco-day spend.

**Tech Stack:** NestJS, Prisma Next contract and migrations, BullMQ job schedulers, Apify client, Vitest, Next.js + zod (setup).

**Spec:** `docs/superpowers/specs/2026-11-09-shared-linkedin-searches-design.md`

## Global Constraints

- LinkedIn job board only. LinkedIn posts, Ashby and Greenhouse keep their top-2 rule, their segments and their schedule (`0 8-22 * * 1-5` UTC).
- Schedule for the LinkedIn job board: `0 8-23 * * *`, timezone `Africa/Casablanca` (16 ticks).
- Spend cap: `COLLECTION_DAILY_BUDGET_USD`, default `3`. It's counted from the start of the current `Africa/Casablanca` calendar day over `search_segment_runs.costMicroUsd` for the LinkedIn job board. A run with no reported cost counts at its charge cap.
- Base sizing: 100 rows and $0.25 per replaced distinct search, up to `LINKEDIN_ROW_CEILING` (from the test; default 1000 until the test says otherwise).
- A fold happens only along an entry of `LINKEDIN_APPROVED_FOLDS`, never transitively, and only into a place an active builder wants with the same arrangement.
- `f_E` is dropped when the merged set covers `1,2,3,4,5` or a member has none. `f_WT` is dropped when it covers `1,2,3` or a member has none.
- A split never happens before the next tick, and a split is never undone on the tick right after it.
- `QUERY_SEARCH_RECIPE_VERSION` goes 11 → 12.
- The Worldwide option is refused for profiles in setup, in the DTO and in `assert_places`. Jobs can still be `worldwide`, and the matcher is unchanged.
- Remove the star. Setup writes every tech at `DEFAULT_IMPORTANCE`. `importance` stays in the schema.
- `.env*` and `private/` are off-limits to Claude. The maintainer runs every paid or remote-DB script.

## Review Focus

1. **A full search whose experience or work-type filter was dropped** (a member had none) can't be split on that dimension without losing jobs that don't state it. The split must skip to the next dimension, or to the ceiling. It's tested in Task 6 (`does not split a dropped filter`).
2. **A builder whose place has no ref** (published before recipe 12, or a label with no code) must still be searched, unfolded, as its own place group, never dropped. It's tested in Task 6 (`builder without a place ref is searched unfolded`).
3. **A full run whose items carry no parseable `publishedAt`, or one in the future,** must not move cursors at all. It's tested in Task 7 (`full run without usable publishedAt keeps cursors`).
4. **A tick that crosses Morocco midnight, or a Ramadan DST shift,** must reset the spend at local midnight, not UTC midnight. It's tested in Task 8 (`moroccoDayStart`).
5. **A saved setup draft that still holds a Worldwide row** must load with that row dropped, not throw the whole draft away. It's tested in Task 3 (`parseDraft drops worldwide rows`).

---

## File map

- `apps/xjobs/src/scripts/linkedin-plan-test.ts` (new) + `apps/xjobs/package.json` script `apify:linkedin-plan-test`: the gate test.
- `docs/actors/linkedin-plan-test.md` (new): the test note.
- `apps/xjobs/src/modules/queries/channels/linkedin_geo.ts`: geoIds, `LINKEDIN_APPROVED_FOLDS`, `placeRef`.
- `apps/xjobs/src/modules/queries/channels/linkedin_board.builder.ts`: `LINKEDIN_KEYWORD_MAX_CHARS`, `orKeywords`, `params.place`.
- `apps/xjobs/src/modules/queries/sets/technology.ts`, `steps/combinations.ts`, `types/query-search.types.ts`, `builders/recipe.ts`: every tech for LinkedIn job board, the place ref, version 12.
- `apps/xjobs/src/modules/users/services/place-labels.ts`, `services/profiles.service.ts`, `dto/validators.ts`, `dto/locations.dto.ts`: the place refs and refusing Worldwide.
- `apps/xjobs/src/modules/segments/services/linkedin-plan.ts` (new): the planner.
- `apps/xjobs/src/modules/segments/repositories/splits.repository.ts` (new): split state.
- `apps/xjobs/src/modules/segments/repositories/segments.repository.ts`: `advance` with a time, `spentSince`, `chargeCapMicroUsd`.
- `apps/xjobs/src/modules/collectors/providers/linkedin-job-board.collector.ts`, `mappers/linkedin-job-board.mapper.ts`, `types/collector.ts`: run a `PlannedSearch`.
- `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts`, `config.ts`, `budget.ts` (new): wiring, the cap and the schedule.
- `libs/database/src/contract/contract.prisma` + two migrations.
- `apps/web/src/lib/setup/answers.ts`, `mapping.ts`, `components/setup/place-rows.tsx`, `tech-rows.tsx`, `review.tsx`, `job-form.tsx` + specs.

---

### Task 1: The live test (go/no-go gate)

**Files:**

- Create: `apps/xjobs/src/scripts/linkedin-plan-test.ts`
- Create: `docs/actors/linkedin-plan-test.md`
- Modify: `apps/xjobs/package.json` (add `"apify:linkedin-plan-test"`, same `tsx` form as `apify:probe-linkedin`)

**Interfaces:**

- Produces: the note, which later tasks read for `LINKEDIN_OR_FORMAT`, `LINKEDIN_KEYWORD_MAX_CHARS`, geoIds, `LINKEDIN_APPROVED_FOLDS`, `LINKEDIN_ROW_CEILING` and `memoryMbytes`.

- [ ] **Step 1: Write the script.** Follow `probe-linkedin-search.ts` (direct `ApifyClient`, `../environment`, `APIFY_TOKEN`). Track a running total across runs and abort before any run that would push the total past `TOTAL_BUDGET_USD = 1`. A gitignored spend file also caps every invocation together at `CAMPAIGN_BUDGET_USD = 2` (main run plus ceiling run), pending the maintainer's approval. Every run uses `maxTotalChargeUsd` and runs at `memory: 1024` (a failed run counts as a memory failure in the report). Use `linkedinJobSearchUrl` for URLs, with `f_TPR` = 7 days. Sections, each printed as one JSON block:
  1. `places`: read the distinct `location` and `type` of active LinkedIn job board builders from the DB (via `createDatabaseClient(toDatabaseConfig(loadDatabaseEnvironment()))` as in `regenerate-query-search.ts`, read-only), so the maintainer's real places are the ones tested.
  2. `or`: for keyword sets `["nestjs","next js"]` in three forms (`nestjs OR "next js"`, `nestjs OR (next js)`, `nestjs OR next js`), at 25 rows, EMEA: items, `SEARCH_TOTALS`, and how many items mention each term in title or description. Then the single-term searches for comparison. The form whose total is about the sum of the singles wins.
  3. `length`: OR'd keyword strings of 100, 200, 400 and 800 chars (from `TECHNOLOGY_TERMS`). Record whether `SEARCH_TOTALS` stays non-zero and what `searchString` echoes back.
  4. `containment`: for each candidate pair, run child and parent with the same keyword and `f_TPR` window at 50 rows, and print the child job ids missing from the parent. A pair's parents are only places that contain it, by `region_countries`: a city's country, and every region (except Global) whose countries include all of the child's, so regions pair with regions too (Europe → EMEA, North Africa → EMEA). Regions are named by code and searched by label (`LATAM` as "Latin America"). Pairs run in this order, so a budget stop loses the least useful: into EMEA (regions first), cities into their country, into Latin America, then the rest; `--pairs 'Casablanca>Morocco,Europe>EMEA'` runs only the named ones. Dates are by day (the actor gives midnight UTC). A pair passes only when nothing is missing. When the parent came back full, misses dated on or before its oldest day (one day of slack) or undated are a `row-limit-cut`, and a full parent with a `row-limit-cut` or `fail` is rerun at 200 rows. Misses from the window's first day are `window-edge`. Neither is a fail or a pass.
  5. `ceiling`: one broad search (`software engineer`, EMEA, 7 days) with `maxItems` 1200 at 1024 MB (the memory production would use; going lower saves at most $0.0025), printing the items returned.
  6. `publishedAt`: from all items, the share with a parseable `publishedAt`, and the share with a non-midnight time.
- [ ] **Step 2: Write the note template** `docs/actors/linkedin-plan-test.md` with one heading per section above, plus `Gate verdict`, `Approved pairs (checked <date>)` and `Pinned geoIds` tables, left blank.
- [ ] **Step 3: Typecheck.** Run: `npx nx typecheck xjobs`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(xjobs): LinkedIn plan live test script and note template`.
- [ ] **Step 5: Hand off to the maintainer.** Ask them to run `! pnpm --filter @xjobs/xjobs apify:linkedin-plan-test > private/linkedin-plan-test.json`, then paste the output (Claude can't read `private/`).
- [ ] **Step 6: Fill in the note** from the output, then commit `docs: LinkedIn plan test results`.
- [ ] **Step 7: GATE.** If no OR form works, or EMEA has no pinned geoId or fails containment for the profile's countries: **stop and go back to design.** Otherwise continue. A low ceiling is not a stop.

---

### Task 2: The engine refuses Worldwide

**Files:**

- Modify: `apps/xjobs/src/modules/users/dto/validators.ts` (`isPlace`, `IsPlace` message), `dto/locations.dto.ts` (ApiProperty oneOf and example)
- Create: `libs/database/src/migrations/app/<stamp>_profile_places_no_worldwide/` (same-hash data migration like `20261108T1236_replace_profile_skills_lock`)
- Test: `apps/xjobs/src/modules/users/dto/profile.dto.spec.ts`, `libs/database` db-tests for `assert_places`

- [ ] **Step 1: Failing tests.** In `profile.dto.spec.ts`, assert that `{ kind: 'worldwide' }` in `remote` fails validation, with a message that no longer lists worldwide. In the db-tests, assert that inserting a profile with `remote: [{kind:'worldwide'}]` raises `check_violation` with `profiles.locations: worldwide is not allowed in a profile`.
- [ ] **Step 2: Run them.** Run: `npx nx test xjobs -- profile.dto` and `pnpm db:test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Drop the `worldwide` case from `isPlace`. Add a migration with two `rawSql` ops (`operationClass: 'data'`, invariants `profile-places-no-worldwide` and `profile-places-strip-worldwide`, then re-add both to `../refs/db.json` as the note in the 1236 migration says):
  1. Strip worldwide from existing profiles, before the function changes: `UPDATE public.profiles SET locations = <each arrangement filtered of {"kind":"worldwide"}> WHERE jsonb_path_exists(locations, '$.*[*] ? (@.kind == "worldwide")') AND jsonb_path_exists(<filtered>, '$.*[*]')`. A profile whose only place is worldwide is left alone (it would break `profiles_locations_nonempty`) and is listed by a `RAISE NOTICE`.
  2. `CREATE OR REPLACE FUNCTION public.assert_places`, copied from `20261105T2208` with the `{"kind": "worldwide"}` branch removed. Add, before the shape loop: `IF jsonb_path_exists(places, '$.*[*] ? (@.kind == "worldwide")') THEN RAISE ... MESSAGE = format('%s: worldwide is not allowed in a profile', field)`. Update the GLOBAL message to `'%s: %L is not allowed in a profile'`.
- [ ] **Step 4: Run.** Run: `pnpm db:migrate && pnpm db:test && npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: profiles refuse worldwide places`.

---

### Task 3: Setup drops Worldwide and the star

**Files:**

- Modify: `apps/web/src/lib/setup/answers.ts`, `lib/setup/mapping.ts`, `components/setup/place-rows.tsx`, `components/setup/tech-rows.tsx`, `components/setup/review.tsx`, `components/setup/job-form.tsx`
- Test: the matching `*.spec.ts(x)`, including `answers.spec.ts`, `mapping.spec.ts`, `place-rows.spec.tsx`, `tech-rows.spec.tsx`, `review.spec.tsx`

**Interfaces:**

- Produces: `TechAnswer = { code: string; rating: 1|2|3|4|5|null }` and `Place` without `worldwide`.

- [ ] **Step 1: Failing tests.**
  - `place-rows.spec`: there's no "Worldwide" option.
  - `tech-rows.spec`: there's no star toggle (`queryByRole('button', { name: /search for/i })` is null).
  - `review.spec`: a tech reads `NestJS 5/5`, never `, searched`.
  - `mapping.spec`: `jobSkills` gives `importance: DEFAULT_IMPORTANCE` for every tech, and `readPlaces` skips a stored worldwide entry.
  - `answers.spec`: `parseDraft drops worldwide rows`, so a draft with `terms.places = [worldwide row, EMEA row]` parses to just the EMEA row, and a `starred` key in a stored tech is ignored, not an error. The GLOBAL message becomes `Pick the regions you want instead`.
- [ ] **Step 2: Run.** Run: `npx nx test web`. Expected: those FAIL.
- [ ] **Step 3: Implement.** Remove `MAX_STARRED`, `starred`, `STARRED_IMPORTANCE`, the star rules in `jobSchema`, the star UI and its error path, and the worldwide literal in `placeSchema`, `placeKey`, `placeJson`, the options, `worldwideRemote`/`covered` and the worldwide rule in `termsSchema`. In `draftSchema`, `terms.places` is wrapped in `z.preprocess` that drops rows whose `place.kind === 'worldwide'`. Drafts keep `version: 1`. `readTechs` no longer computes stars.
- [ ] **Step 4: Run.** Run: `npx nx run-many -t lint test typecheck -p web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): setup drops worldwide and the search star`.

---

### Task 4: LinkedIn builders carry every tech and a place ref

**Files:**

- Modify: `apps/xjobs/src/modules/queries/sets/technology.ts`, `steps/combinations.ts`, `types/query-search.types.ts`, `services/queries.service.ts`, `channels/linkedin_board.builder.ts`, `channels/linkedin_geo.ts`, `builders/recipe.ts`
- Modify: `apps/xjobs/src/modules/users/services/place-labels.ts`, `services/profiles.service.ts` (`toQuerySearchInput`)
- Test: `sets/technology.spec.ts`, `steps/combinations.spec.ts`, `channels/channels.spec.ts`, `services/expand.scenarios.spec.ts`, `users/services/place-labels` spec

**Interfaces:**

- Produces:
  - `type PlaceRef = string` with the format `region:<CODE>` | `country:<CC>` | `city:<lowercase uuid>`, plus `placeRef(place: Place): PlaceRef` and `parsePlaceRef(ref: string): { kind: 'region'|'country'|'city'; code: string } | null` in `linkedin_geo.ts`.
  - `QuerySearchProfileInput.placeRefs?: Record<string, PlaceRef>`, keyed by `locationKey(text)`.
  - `QuerySearchCombination.place?: PlaceRef`.
  - `technologySets(skills, channel: Channel): TechnologySet[]`: every searchable tech for `LINKEDIN_JOB_BOARD`, the top 2 otherwise.
  - LinkedIn job board `params.place: PlaceRef` when known.
  - `QUERY_SEARCH_RECIPE_VERSION = 12`.

- [ ] **Step 1: Failing tests.**
  - `technology.spec`: six techs rated 5/5 give six sets for the LinkedIn job board and the two alphabetical first for LinkedIn posts. Importance 0 and non-searchable techs are dropped for both.
  - `place-labels` spec: `placeRefs` maps `'emea'→'region:EMEA'`, `'morocco'→'country:MA'` and `'casablanca, morocco'→'city:<id>'`.
  - `channels.spec`: a combination with `place: 'country:MA'` gives `params.place === 'country:MA'`, and one without gives no `place` key.
  - `expand.scenarios.spec`: update the expected builder counts.
- [ ] **Step 2: Run.** Run: `npx nx test xjobs -- queries users`. Expected: FAIL.
- [ ] **Step 3: Implement.** `locationCombinations` computes technology sets per channel and sets `place: profile.placeRefs?.[locationKey(text)]`. `normalizeProfile` passes `placeRefs` through. `toQuerySearchInput` adds `placeRefs` from a new `placeRefsByText(places, labels)` in `place-labels.ts`. Bump the recipe version.
- [ ] **Step 4: Run.** Run: `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(xjobs): LinkedIn job board builders search every tech and carry a place ref`.

---

### Task 5: OR keywords, pinned geoIds and approved folds

**Files:**

- Modify: `apps/xjobs/src/modules/queries/channels/linkedin_geo.ts`, `channels/linkedin_board.builder.ts`
- Test: `channels/channels.spec.ts`, new `channels/linkedin_geo.spec.ts`

**Interfaces:**

- Produces:
  - `LINKEDIN_APPROVED_FOLDS: readonly { child: PlaceRef; parent: PlaceRef; checked: string }[]`, with `checked` as `YYYY-MM-DD`, copied from the note.
  - `isApprovedFold(child: PlaceRef, parent: PlaceRef): boolean`.
  - `orKeywords(terms: readonly string[]): string`: sorted, deduped, multi-word terms grouped in the form the note confirmed, joined with `OR`.
  - `LINKEDIN_KEYWORD_MAX_CHARS: number`, from the note.
  - New geoIds added to `LINKEDIN_GEO_IDS` for every place pinned in the note.

- [ ] **Step 1: Failing tests.**
  - `orKeywords(['next js','nestjs'])` gives the confirmed form, for example `nestjs OR "next js"`.
  - A single term comes back unchanged.
  - `isApprovedFold` is false for a chain (`country:MA→region:NORTH_AFRICA` and `region:NORTH_AFRICA→region:EMEA` don't give `country:MA→region:EMEA` unless listed).
  - Every approved fold is a real nesting in seed data: load `region_countries` and cities from `libs/database/src/seeds/vocab/seed-data.ts`, then check that the child's countries ⊆ the parent's countries.
- [ ] **Step 2: Run, implement, run.** Run: `npx nx test xjobs -- linkedin_geo channels`. Expected: FAIL, then PASS.
- [ ] **Step 3: Commit** `feat(xjobs): LinkedIn OR keywords and approved place folds`.

---

### Task 6: The planner

**Files:**

- Create: `apps/xjobs/src/modules/segments/services/linkedin-plan.ts`
- Create: `apps/xjobs/src/modules/segments/services/linkedin-plan.spec.ts`, `services/linkedin-plan.fixtures.ts`
- Modify: `apps/xjobs/src/modules/segments/index.ts`, `services/segments.ts` (`SearchSegment.plan?: PlannedSearch`)

**Interfaces:**

- Consumes: `PlaceRef`, `parsePlaceRef`, `isApprovedFold`, `orKeywords`, `LINKEDIN_KEYWORD_MAX_CHARS` (Tasks 4 and 5). `PlaceIndex` comes from `modules/matcher/rules/places.ts`. `LINKEDIN_GEO_IDS` and `linkedinTerm`.
- Produces:

```ts
export interface PlannedSearch {
  /** Stable identity: place|f_E|f_WT|keywords; split state keys on it. */
  signature: string;
  /** Signatures of the searches this one was split from, outermost first. */
  ancestors: string[];
  keyword: string; // orKeywords(...)
  params: Record<string, unknown>; // location, geoId?, experienceLevel?, workType?
  rowLimit: number;
  maxChargeUsd: number;
  /** True when no further split exists, so a full run is logged for review. */
  atCeiling: boolean;
}
export interface SplitState {
  signature: string;
  lastFullAt: Date;
}
export interface PlanInput {
  builders: readonly QuerySearchBuilderRow[];
  places: PlaceIndex;
  splits: readonly SplitState[];
  now: Date;
  isApprovedFold?: (child: string, parent: string) => boolean; // default: the real list
}
export const LINKEDIN_ROW_CEILING: number; // from the note
export const SPLIT_HOLD_DAYS = 7;
export function planLinkedinSearches(input: PlanInput): SearchSegment[];
```

- [ ] **Step 1: Write the fixtures and failing tests.** Fixtures build `QuerySearchBuilderRow`s through the real `LinkedinJobBoardBuilder` + `toRecipe`, so params match production. Use the place index from seed-data. Tests:
  - `the dev profile alone gives 5 searches`: the note's places, folds approved as in the spec example, give exactly S1–S5 with the spec's places, `f_WT` (`2` for S1–S4, `1,3` for S5), no `f_E` (it covers 1–5) and the six terms OR'd.
  - `user B folds remote Europe into EMEA and adds a Paris onsite search`.
  - `user C onsite Casablanca folds into S5` (Casablanca → Morocco approved).
  - `an unapproved pair doesn't fold`.
  - `never folds into a place nobody wants with that arrangement` (EMEA is wanted remote only, so an onsite Morocco builder stays Morocco).
  - `two non-nesting ancestors: more countries wins, then alphabetical`.
  - `filters are dropped when covered or when a member has none`.
  - `stable whatever the input order`: shuffle 10 times and get equal output.
  - `row limit is 100 × distinct replaced searches, capped at LINKEDIN_ROW_CEILING`, and the charge cap is $0.25 × the same.
  - `pre-splits keywords longer than LINKEDIN_KEYWORD_MAX_CHARS` into halves of the sorted set.
  - `a split signature halves keywords, then experience, then work type, then ceiling`: each level comes from adding the child's signature to `splits`, and `ancestors` lists the parents.
  - `does not split a dropped filter`: experience dropped, so the split goes from single keyword straight to work type, then to ceiling with `atCeiling: true`.
  - `a split older than SPLIT_HOLD_DAYS is undone`, and one 1 hour old is kept.
  - `builder without a place ref is searched unfolded`, grouped by its `location`.
  - Every planned segment's `members` are exactly the builders it covers, and every input builder lands in exactly one segment.
- [ ] **Step 2: Run.** Run: `npx nx test xjobs -- linkedin-plan`. Expected: FAIL (no module).
- [ ] **Step 3: Implement `planLinkedinSearches`.** Follow spec steps 1–5:
  - Fold each builder's ref to the broadest approved, wanted (same `type`) ancestor. Use the country count from `places` to break ties, then the code.
  - Group by folded ref (or `location:<text>` without a ref). The group's place params come from the ancestor builder's own `params` (`location`, `geoId`).
  - Merge `linkedinTerm`s (the builder `keyword`), `experienceLevel` and `workType` code sets.
  - Apply active splits recursively, always partitioning **members** (never codes), so each builder lands in exactly one child and its cursor and claim stay single: keywords first (members split by their term into the two halves of the sorted term set); then, for a single-term search, experience when its `f_E` is explicit and members hold ≥ 2 distinct `experienceLevel` values (halves of the sorted distinct values); then work type the same way; else `rowLimit = LINKEDIN_ROW_CEILING`, `atCeiling: true`. Each child's filters are recomputed from its own members with the same drop rules.
  - Signatures are `[placeKey, fE ?? '*', fWT ?? '*', keywords sorted joined by '|'].join('#')`.
  - `segmentKey` = `linkedin_job_board|plan|<signature>`. The hash uses `segmentHash`.
  - Also export `narrowPlan(plan: PlannedSearch, members: readonly QuerySearchBuilderRow[]): PlannedSearch`. It keeps the same signature, ancestors and place, and it recomputes the keywords, filters and sizing from `members` (used in Task 8 after a claim).

- [ ] **Step 4: Run.** Run: `npx nx test xjobs -- linkedin-plan`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(xjobs): plan shared LinkedIn job board searches`.

---

### Task 7: Split state, full runs and cursors

**Files:**

- Modify: `libs/database/src/contract/contract.prisma`: add `model LinkedinSearchSplit { signature String @id; lastFullAt TimestamptzJsDate(3); createdAt …; @@map("linkedin_search_splits") @@rls }` (engine-only: RLS on, no policies) and `SearchSegmentRun.chargeCapMicroUsd Int?`.
- Create: the generated migration.
- Create: `apps/xjobs/src/modules/segments/repositories/splits.repository.ts` (+ `.postgres.spec.ts` next to `segments.postgres.spec.ts`), and a fake in `segments/testing/fakes.ts`.
- Modify: `segments.repository.ts`: `recordCollectedRun(run, batch, advance: { ids: string[]; until: Date })`. Update `segments.module.ts`.
- Create: `apps/xjobs/src/modules/collectors/utils/oldest-published.ts` (+ spec).

**Interfaces:**

- Produces:
  - `abstract class LinkedinSearchSplitsRepository { list(): Promise<SplitState[]>; recordFull(signatures: string[], at: Date): Promise<void> }`. The upsert sets `lastFullAt = at`.
  - `oldestPublishedAt(items: readonly RawCollectedItem[], until: Date): Date | null`: the minimum parseable `payload.publishedAt` that is ≤ `until`. It's null if any item lacks one, since then the oldest can't be trusted.
  - `NewSegmentRun.chargeCapMicroUsd: number | null`.

- [ ] **Step 1: Failing tests.**
  - `oldestPublishedAt` returns the minimum, gives null when an item has no or a bad date, and ignores nothing silently.
  - `full run without usable publishedAt keeps cursors`.
  - The postgres spec checks that `recordFull` upserts and `list` returns all splits.
  - `recordCollectedRun` with `{ ids, until }` moves cursors to `until` and never back.
- [ ] **Step 2: Contract and migration.** Run: `pnpm --filter @xjobs/database db:migration:plan`, then `pnpm db:migrate`. Expected: a new migration dir, and the migration succeeds locally.
- [ ] **Step 3: Implement**, then update the callers of `recordCollectedRun` to pass `{ ids, until: run.windowEnd }` (behaviour unchanged for now).
- [ ] **Step 4: Run.** Run: `npx nx test xjobs && npx nx e2e xjobs-e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: LinkedIn search split state and per-run charge cap`.

---

### Task 8: Wire the planner, the cap and the schedule into collection

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/types/collector.ts`: `SegmentSearch.plan?: PlannedSearch`, and `LinkedinJobBoardRunConfig.memoryMbytes?: number`.
- Modify: `apps/xjobs/src/modules/collectors/providers/linkedin-job-board.collector.ts`: when `segment.plan` is set, run its `keyword`/`params` with `maxItems = plan.rowLimit`, `maxChargeUsd = plan.maxChargeUsd`, memory from config. Full = `items.length >= plan.rowLimit`. Remove the "one search" throw for planned segments.
- Create: `apps/xjobs/src/infrastructure/jobs/steps/collect/budget.ts`: `moroccoDayStart(now: Date): Date` (via `Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' })` and the zone offset at that instant), plus `dailyBudgetUsd(env = process.env): number` (`COLLECTION_DAILY_BUDGET_USD`, default 3, invalid → 3 with a warning).
- Modify: `segments.repository.ts`: `spentSince(channel, since): Promise<number>` (USD), the sum of `coalesce(costMicroUsd, chargeCapMicroUsd, 0)`.
- Modify: `config.ts`: LinkedIn job board `schedule: { pattern: '0 8-23 * * *', timezone: 'Africa/Casablanca' }`. `run.memoryMbytes = 1024` only if the note confirmed 1 GB.
- Modify: `collection.service.ts`.
- Modify: `apps/xjobs/.env.example`: add `COLLECTION_DAILY_BUDGET_USD=3`.
- Test: `infrastructure/jobs/tests/collection.service.spec.ts`, `budget.spec.ts`, `collectors/providers/segment-collect.spec.ts`, `worker/tests/scheduler.spec.ts`.

- [ ] **Step 1: Failing tests.**
  - `moroccoDayStart`: 23:30 local and 00:30 local fall on different days, and a date during Ramadan (UTC+0) and one outside it (UTC+1) both give local midnight.
  - In `collection.service.spec`:
    - The LinkedIn job board uses `planLinkedinSearches`, so 128 builders in the dev shape give 5 runs. Other channels still use `buildSegments`.
    - At the cap: no run, one log line.
    - Under the cap: it runs.
    - A cap reached mid-tick stops the remaining searches.
    - A run with null cost counts at `chargeCapMicroUsd`.
    - A full run calls `recordFull([...ancestors, signature])` and advances members only to `oldestPublishedAt`.
    - A non-full run advances to `windowEnd`.
    - A capped run advances nothing.
    - An `atCeiling` full run logs a warning naming the signature.
  - `a new member's window looks back to its initial hours`: one member is never collected while the others are recent, and the window starts at `until - 24h`.
  - The scheduler spec checks the new pattern and timezone. LinkedIn posts is unchanged.
- [ ] **Step 2: Run.** Run: `npx nx test xjobs -- collection budget scheduler segment-collect`. Expected: FAIL.
- [ ] **Step 3: Implement in `collection.service.ts`.**
  - For `Channel.LINKEDIN_JOB_BOARD`: load `splits.list()` and the `PlaceIndex`. Inject `MatcherRepository.loadContext().places`, or extract a `PlacesRepository` if that drags the matcher in. Then call `planLinkedinSearches`.
  - Before each segment, check `spentSince(channel, moroccoDayStart(now)) >= dailyBudgetUsd()`. If it's reached, log `linkedin_job_board daily budget $X reached ($Y spent); skipping N searches until the next Morocco day` once, then count the rest as skipped.
  - In `runSegment`, after `narrow`, re-derive the plan for the owned members (same signature and ancestors; keywords and filters from the owned members only) via an exported `narrowPlan(plan, members)` from `linkedin-plan.ts`.
  - Record `chargeCapMicroUsd`.
  - Advance with `{ ids, until }`: capped means `[]`. Full means `oldestPublishedAt(items, windowEnd)` (null means `[]`), followed by `recordFull`. Otherwise use `windowEnd`.
- [ ] **Step 4: Run.** Run: `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(xjobs): collect the LinkedIn job board through the shared search plan with a daily budget`.

---

### Task 9: Roll out on dev

- [ ] **Step 1: Docs.**
  - Update `apps/xjobs/src/modules/collectors/README.md` and `docs/redis-jobs.md` with the plan, splits, cap and schedule.
  - In `docs/superpowers/specs/2026-11-08-guided-setup-design.md`, line 71, add a "superseded by 2026-11-09 shared LinkedIn searches" note.
  - Add `COLLECTION_DAILY_BUDGET_USD` to `docs/production.md`.
- [ ] **Step 2: Verify.** Run: `npx nx run-many -t lint test build typecheck && npx nx e2e xjobs-e2e`. Expected: all PASS.
- [ ] **Step 3: Commit** `docs: shared LinkedIn searches rollout`.
- [ ] **Step 4: Maintainer runbook (in the PR body).** On dev: `XJOBS_ALLOW_REMOTE_DB=1 pnpm db:migrate` (strips worldwide), then `pnpm --filter @xjobs/xjobs db:regenerate` (recipe 12). Restart the LinkedIn job board worker, so the scheduler upserts the new cron. After the first tick, check that the log says `segments=5` (or the note's number), and check the spend.
