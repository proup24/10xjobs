# Search Precision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LinkedIn job board searches use every technology of a profile, written as `(role words) AND (technology spellings)`, run on the LinkedIn places that actually cover each preference place, and shared across users. A full search splits in the same tick, and collection has a daily spend cap.

**Architecture:**

- **Builder generation (`modules/queries`) expands each profile wish** into one builder per search place × work type × single LinkedIn experience level. The builder carries its role words and spellings in `params`.
- **Search identity.** Because every builder belongs to exactly one search place, type and level, the existing per-builder claims and cursors keep working unchanged. Spec §6's per-search coverage becomes unnecessary.
- **Segments (`modules/segments`) group LinkedIn builders** by place, type and level, ignoring the keyword. The collector merges the members' terms into one keyword.
- **Collection (`infrastructure/jobs/steps/collect`) handles full searches and spend.** It splits a full search in the same tick, remembers the split in a small engine-only table, and stops at a daily spend cap.

**Tech Stack:** NestJS 11, TypeScript strict (nodenext), Vitest, the Prisma contract in `libs/database` with Supabase Postgres, Apify (`harvestapi/linkedin-job-search`).

**Spec:** `docs/superpowers/specs/2026-11-14-search-precision-design.md`. The evidence is in `docs/actors/linkedin-region-test.md`.

## Global Constraints

- **Scope:** LinkedIn job board only. LinkedIn posts, Ashby and Greenhouse builders and segments are unchanged (`ACTIVE_CHANNELS` lists only `LINKEDIN_JOB_BOARD`).
- **Keyword syntax:** `OR` and `AND` uppercase; multi-word terms and terms with a symbol (`.`, `#`, `+`) quoted; terms lowercased, deduped and sorted.
- **Role words:** English always, plus each `profiles.languages[].lang` that has a column, whatever the `level`.
- **Not used:** `functionIds` or `industryIds`, and repeat copies of a search.
- **Folding:** no fold across LinkedIn regions beyond `LINKEDIN_SEARCH_MAP`.
- **Row limits:** a search starts at 100 rows (`maxRowsPerSearch`), with a $0.25 charge cap; the row ceiling is 1,000.
- **Spend cap:** `COLLECTION_DAILY_BUDGET_USD`, default 3, LinkedIn job board only, counted from Morocco midnight (`Africa/Casablanca`). A run with no reported cost counts at its charge cap.
- **Schedule:** unchanged, `0 9-21 * * 1-5` in `Africa/Casablanca`, `postedLimit: '1h'`.
- **Recipe:** `QUERY_SEARCH_RECIPE_VERSION` goes from 11 to 12, once, in Task 4.
- **Migrations:** after `db:migration:plan`, advance `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the new migration's `to`, or it silently never applies.
- **Guardrails:** never read `.env*` or `private/`. Paid Apify runs are made by the maintainer only.

## Review Focus

1. **A preference place with no search place** (APAC, an unpinned country) must fail only its own segment, logged with the place, while the profile's other places still collect. Test: Task 3, `searchPlaces` returns the location itself; Task 6, `segmentKey` gives `unresolved:`.
2. **Two profiles with the same technologies but different languages** must not share a builder: different role words give a different hash. Test: Task 4, "languages change the recipe hash".
3. **A merged keyword over `LINKEDIN_KEYWORD_MAX_CHARS`** must be cut into several segments, never sent as one oversized string. A single builder whose own keyword is over the limit still runs alone. Test: Task 6, "cuts a group whose merged keyword is too long".
4. **The spend cap reached mid-tick** stops later segments in that tick, and same-tick split reruns too, and logs one line. Test: Task 9, "stops a split rerun once the cap is reached".
5. **A split must not be undone on the tick right after it was made,** even if that tick's chunks come back small. Test: Task 8, "keeps a split made under an hour ago".

---

## PR A: the live check (go/no-go)

### Task 1: Final keyword check

**Files:**

- Modify: `apps/xjobs/src/scripts/linkedin-region-test.ts`
- Modify: `apps/xjobs/src/scripts/linkedin-region-test/logic.ts`
- Test: `apps/xjobs/src/scripts/linkedin-region-test/logic.spec.ts`
- Modify: `docs/actors/linkedin-region-test.md` (a new "10. Final check" section, after the maintainer's run)

**Interfaces:**

- Produces, as values copied into Tasks 2–5:
  - the role words per language;
  - the spellings per technology;
  - `LINKEDIN_KEYWORD_MAX_CHARS`;
  - jobs per hour for the dev profile's searches.

- [ ] **Step 1: Write the failing test.** In `logic.spec.ts`, `campaignOf('final')` returns `{ capUsd: 1, spendFile: 'tmp/linkedin-final-check-spend.json' }`, and `campaignOf('region')` returns `{ capUsd: 2, spendFile: 'tmp/linkedin-region-test-spend.json' }`.
- [ ] **Step 2: Run it.** Run `cd apps/xjobs && npx vitest run src/scripts/linkedin-region-test`. Expected: FAIL, `campaignOf` is not defined.
- [ ] **Step 3: Implement.**
  - Add `campaignOf(name: 'region' | 'final')` in `logic.ts`, and a `--campaign` flag in the script (default `region`) that picks the cap and spend file. The `final` section requires `--campaign final`.
  - Add a `final` section. Every run carries real filters:
    - places: Europe remote with `experienceLevel: ['mid-senior']`; Morocco with `workplaceType: ['hybrid','office']` and `experienceLevel: ['associate','mid-senior']`;
    - window: `postedLimit: 'week'` for totals; `24h` with 40 rows for samples.
  - Runs:
    - (a) role words: narrow vs extended, each AND the stack, as samples on both places;
    - (b) each candidate spelling of `nodejs`, `nextjs` and `nestjs` alone (`nodejs`, `"node.js"`, `"node js"`, `nextjs`, `"next.js"`, `"next js"`, `nestjs`, `"nest.js"`), then each technology's spellings OR'd, as totals;
    - (c) keyword length: the full dev keyword padded with extra technologies to about 400, 800, 1,200 and 1,600 characters, as totals (a run that errors or returns 0 marks the limit);
    - (d) real volume: the dev profile's actual searches (Europe remote mid-senior; Morocco hybrid and onsite, associate and mid-senior) over `24h`, as totals.
  - Report sections in the same style as `keywords`: for (a), engineering titles kept and lost, using `judgePair` as `keywordsReport` does.
  - The narrow role list is today's `ROLE_WORDS`. The extended list is `engineer, developer, engineering, architect, ingénieur, développeur, architecte, programmer, "tech lead", "technical lead", devops, sre`.
- [ ] **Step 4: Run the tests and a dry run.** Run `npx vitest run src/scripts/linkedin-region-test`, then `pnpm -s apify:linkedin-region-test -- --dry-run --sections final --campaign final`. Expected: tests PASS; `budget.fits` is true and `reservedThisInvocationUsd` ≤ 1.
- [ ] **Step 5: Commit.** `feat(scripts): final keyword check for slice 04`.
- [ ] **Step 6: The maintainer runs it.** Ask the maintainer to approve the $1 and run `! cd /home/lab/apps/10xjobs/apps/xjobs && pnpm -s apify:linkedin-region-test -- --sections final --campaign final --concurrency 4 > tmp/linkedin-final-check.json`.
- [ ] **Step 7: Record and gate.**
  - Write the findings into section 10 of the results doc.
  - **Stop and go back to the user** if either holds:
    - `(…) AND (…)` with filters returns 0 or errors;
    - the length limit is under the dev profile's full keyword (about 260 characters).
  - Otherwise, record the values Tasks 2–5 use, and commit `docs(actors): final keyword check results`.

## PR B: keywords and builders

### Task 2: Role words and spellings

**Files:**

- Create: `apps/xjobs/src/modules/queries/builders/role-words.ts`
- Create: `apps/xjobs/src/modules/queries/builders/search-spellings.ts`
- Modify: `apps/xjobs/src/modules/queries/builders/index.ts` (exports)
- Test: `apps/xjobs/src/modules/queries/builders/role-words.spec.ts`, `search-spellings.spec.ts`

**Interfaces:**

- Produces:
  - `type RoleFamily = 'engineer' | 'devops' | 'architect' | 'tech_lead' | 'engineering_manager'`
  - `POSITION_ROLE_FAMILY: Readonly<Record<string, RoleFamily>>`, covering every key of `POSITION_TITLES`: `devops_engineer` and `site_reliability_engineer` map to `devops`; `software_architect` to `architect`; `tech_lead` to `tech_lead`; `engineering_manager` to `engineering_manager`; every other position to `engineer`.
  - `ROLE_WORDS: Readonly<Record<RoleFamily, Readonly<Partial<Record<string, readonly string[]>>>>>`, keyed by ISO 639-1 code (`en`, `fr`, `es`, `de`). Values are the spec's table, extended by Task 1. `devops` includes all of `engineer`, plus `devops` and `sre` in `en`.
  - `roleWords(position: string, languages: readonly string[]): string[]`: English plus each listed language with a column; lowercased, deduped, sorted. It throws on a position with no family.
  - `SEARCH_SPELLINGS: Readonly<Record<string, readonly string[]>>`. Task 1's values for `nodejs`, `nextjs` and `nestjs`; every other key of `TECHNOLOGY_TERMS` gets a single spelling, its `TECHNOLOGY_TERMS` value (with `LINKEDIN_TERMS` dropped).
  - `searchSpellings(technology: string): string[]`: the entry, else `[TECHNOLOGY_TERMS[technology]]`; lowercased. It throws for a non-searchable technology.

- [ ] **Step 1: Write the failing tests.**
  - `roleWords('fullstack_engineer', ['en','fr'])` contains `engineer`, `developer`, `ingénieur` and `développeur`, and no `desarrollador`.
  - `roleWords('fullstack_engineer', ['es'])` contains `engineer` and `desarrollador`, and no `ingénieur`.
  - `roleWords('software_architect', ['fr'])` contains `architect` and `architecte`.
  - `roleWords('backend_engineer', ['ja'])` equals `roleWords('backend_engineer', [])`.
  - The output is sorted and deduped.
  - Every `POSITION_TITLES` key has a family.
  - `searchSpellings('nodejs')` contains `node.js`, and `searchSpellings('golang')` throws.
  - Every `SEARCH_SPELLINGS` key is in `TECHNOLOGY_TERMS`.
- [ ] **Step 2: Run them.** `npx nx test xjobs -- role-words search-spellings`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement both files** with the interfaces above.
- [ ] **Step 4: Run them.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(queries): role words by position and language, and search spellings`.

### Task 3: The LinkedIn keyword and the search map

**Files:**

- Create: `apps/xjobs/src/modules/queries/channels/linkedin_keyword.ts`
- Create: `apps/xjobs/src/modules/queries/channels/linkedin_search_map.ts`
- Modify: `apps/xjobs/src/modules/queries/channels/linkedin_geo.ts` (add the geoIds Task 1 pinned: APAC, Asia (excluding the GCC), Israel `101620260`, Türkiye `102105699`, each with its date)
- Test: `apps/xjobs/src/modules/queries/channels/linkedin_keyword.spec.ts`, `linkedin_search_map.spec.ts`

**Interfaces:**

- Produces:
  - `LINKEDIN_KEYWORD_MAX_CHARS: number`, from Task 1.
  - `keywordTerm(term: string): string`: lowercased; quoted when it contains a space or one of `.#+`.
  - `linkedinKeyword(roleWords: readonly string[], spellings: readonly string[]): string`. It returns `(<roles joined by ' OR '>) AND (<spellings joined by ' OR '>)`, each side deduped and sorted after `keywordTerm`; a side with one term keeps its parentheses. It throws when either side is empty.
  - `LINKEDIN_SEARCH_MAP: Readonly<Record<string, readonly string[]>>`, keyed by `locationKey` of the preference label, with values that are keys of `LINKEDIN_GEO_IDS`:
    - `europe`, `european union`, `european economic area`, `uk`, `united kingdom` and `dach` → `['europe']`;
    - `emea` → `['africa','europe','middle east']`;
    - `north africa` → `['africa']`;
    - `sub-saharan africa` → `['africa']`;
    - `north america` → `['canada','united states']`;
    - `americas` → `['canada','latin america','united states']`;
    - `gcc` → its six countries;
    - APAC and Asia (excluding the GCC) as Task 1 decided.
  - `SEARCH_MAP_CHECKED = '2026-11-14'`, with a comment linking `docs/actors/linkedin-region-test.md`.
  - `searchPlaces(location: string): string[]`. Rules, in order, with sorted output:
    1. the map entry;
    2. else `[key]` when `LINKEDIN_GEO_IDS` has `key = locationKey(location)`;
    3. else, for `"<city>, <country>"`, `[countryKey]` when the country is pinned;
    4. else `[key]` unchanged, so collection fails loudly for that place.

- [ ] **Step 1: Write the failing tests.**
  - `linkedinKeyword(['developer','engineer'], ['react','node.js','next js'])` equals `(developer OR engineer) AND ("next js" OR "node.js" OR react)`.
  - The order of the inputs doesn't change the output.
  - An empty side throws.
  - `searchPlaces('EMEA')` equals `['africa','europe','middle east']`.
  - `searchPlaces('European Union')` equals `['europe']`.
  - `searchPlaces('Casablanca, Morocco')` equals `['morocco']`.
  - `searchPlaces('Atlantis')` equals `['atlantis']`.
  - Every value in `LINKEDIN_SEARCH_MAP` is a key of `LINKEDIN_GEO_IDS`.
  - Every region label in `libs/database/src/seeds/vocab/seed-data.ts` resolves to at least one `LINKEDIN_GEO_IDS` key, except `Global`.
- [ ] **Step 2: Run them.** `npx nx test xjobs -- linkedin_keyword linkedin_search_map`. Expected: FAIL.
- [ ] **Step 3: Implement** both files and the geoId additions.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(queries): LinkedIn keyword builder and search map`.

### Task 4: LinkedIn builders: every technology, search places, single levels, recipe 12

**Files:**

- Modify: `apps/xjobs/src/modules/queries/types/query-search.types.ts`
- Modify: `apps/xjobs/src/modules/queries/sets/technology.ts`
- Modify: `apps/xjobs/src/modules/queries/steps/combinations.ts`
- Modify: `apps/xjobs/src/modules/queries/services/queries.service.ts`
- Modify: `apps/xjobs/src/modules/queries/channels/linkedin_board.builder.ts`
- Modify: `apps/xjobs/src/modules/queries/builders/recipe.ts` (version 12)
- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts` (`toQuerySearchInput` passes the languages)
- Test: `channels/channels.spec.ts`, `steps/combinations.spec.ts`, `sets/technology.spec.ts`, `services/expand.scenarios.spec.ts`, `services/queries.service.spec.ts`, and the users spec that covers `toQuerySearchInput`

**Interfaces:**

- Consumes: `roleWords`, `searchSpellings` (Task 2); `linkedinKeyword`, `searchPlaces` (Task 3).
- Produces:
  - `QuerySearchProfileInput.languages: string[]`, the ISO codes from `profiles.languages[].lang`.
  - `QuerySearchCombination.languages: string[]`.
  - `QuerySearchCombination.experienceLevel?: string`, one LinkedIn `f_E` code, set for the LinkedIn job board only.
  - `technologySets(skills: RankedSkill[], channel: Channel): TechnologySet[]`. For `LINKEDIN_JOB_BOARD`: one set holding every `topTechnologies(skills)`, with the domain of the first top skill. Other channels: as today.
  - `linkedinLevels(seniority: string): string[]`: `EXPERIENCE_LEVELS[seniority]` split on `,`; `[]` for unstated.
  - LinkedIn job board builder `params`: `{ location, geoId?, workType, experienceLevel, roleWords: string[], spellings: string[] }`.
    - `experienceLevel` is one code;
    - `location` is a search-place key;
    - `keyword` is `linkedinKeyword(roleWords, spellings)`;
    - `spellings` is the union of `searchSpellings` over the builder's technologies.
  - `QUERY_SEARCH_RECIPE_VERSION = 12`.

- [ ] **Step 1: Write the failing tests.**
  - `technology.spec`: 8 techs rated 5/5 give one LinkedIn set with all 8.
  - `combinations.spec`: a profile with remote `EMEA` and seniorities `mid` and `senior` gives LinkedIn combinations for `africa`, `europe` and `middle east`, each with `experienceLevel` `3` and `4`. After `dedupeBySearch`, there are 6 recipes.
  - `channels.spec`: the dev-profile combination gives `params.roleWords` with `ingénieur` for `languages: ['en','fr']`, `params.spellings` containing `node.js`, `params.experienceLevel === '4'`, and `keyword === linkedinKeyword(params.roleWords, params.spellings)`.
  - `queries.service.spec`, "languages change the recipe hash": the same profile with `['en']` and with `['en','es']` gives different hashes.
  - `expand.scenarios.spec`: update the expected counts. The dev profile (16 places, mid and senior) gives one builder per distinct search place × work type × level.
  - users spec: `toQuerySearchInput` maps `languages: [{lang:'fr',level:'fluent'}]` to `['fr']`.
- [ ] **Step 2: Run them.** `npx nx test xjobs -- queries users`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `locationCombinations`, for `LINKEDIN_JOB_BOARD`: expand each location text into `searchPlaces(text)`, and each seniority into `linkedinLevels(seniority)`, one combination each.
  - `LinkedinJobBoardBuilder.build` reads `experienceLevel`, `roleWords(position, languages)` and the spellings.
  - Bump the recipe version. Remove `LINKEDIN_TERMS` and `linkedinTerm` from `linkedin_board.builder.ts`, and update the scripts that import them (`linkedin-plan-test/logic.ts`, `linkedin-source-parity.ts`) to inline their old values.
- [ ] **Step 4: Run them.** `npx nx test xjobs` and `npx nx typecheck xjobs`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(queries): LinkedIn builders search every tech by role word, search place and single level (recipe 12)`.

## PR C: shared searches, splits and the spend cap

### Task 5: Group LinkedIn builders by search, not keyword

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/providers/mappers/linkedin-job-board.mapper.ts`
- Modify: `apps/xjobs/src/modules/segments/services/segments.ts`
- Test: `mappers/linkedin-job-board.mapper.spec.ts`, `segments/services/segments.spec.ts`

**Interfaces:**

- Consumes: `linkedinKeyword`, `LINKEDIN_KEYWORD_MAX_CHARS` (Task 3).
- Produces:
  - `linkedinGroupKey(params: Record<string, unknown>): string`: canonical JSON of `{ place: { geoId }, experienceLevel, workplaceType }`, the existing `linkedinSearchKey` without the keyword. It throws like `linkedinGeoId` for an unknown place.
  - `mergedLinkedinKeyword(queries: readonly { params: Record<string, unknown> }[]): string`: `linkedinKeyword` over the union of the members' `params.roleWords` and `params.spellings`.
  - `segmentKey` for `LINKEDIN_JOB_BOARD`: `${channel}|${type}|group:${linkedinGroupKey(params)}`, without the domain. On a throw: `${channel}|${type}|unresolved:${id}`.
  - `buildSegments(builders, size = SEGMENT_SIZE, parts: ReadonlyMap<string, number> = new Map())`:
    - LinkedIn job board groups are cut into `parts.get(key) ?? 1` chunks, by hash order, as evenly as possible;
    - then any chunk whose `mergedLinkedinKeyword` is over `LINKEDIN_KEYWORD_MAX_CHARS` is halved until it fits or holds one member;
    - `size` doesn't apply to the LinkedIn job board;
    - other channels: as today.
  - `linkedinSearchKey` is removed. Its callers move to `linkedinGroupKey`.

- [ ] **Step 1: Write the failing tests.**
  - "groups LinkedIn builders of one search whatever their keyword": two builders with the same geoId, level and work type, but different `roleWords` and `spellings`, give one segment.
  - "keeps levels and work types apart".
  - "ignores domain for the LinkedIn job board".
  - "cuts a group into `parts` chunks, stable by hash".
  - "cuts a group whose merged keyword is too long": 30 builders with distinct spellings give segments whose merged keyword fits.
  - "keeps a single over-long builder alone".
  - Keep the existing tests: unresolved place, same output for any input order, and member cursors kept.
  - Mapper: `mergedLinkedinKeyword` of two queries equals `linkedinKeyword` of the unions.
- [ ] **Step 2: Run them.** `npx nx test xjobs -- segments linkedin-job-board.mapper`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(segments): share LinkedIn searches across builders by place, type and level`.

### Task 6: The collector runs a merged search with a row limit

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/types/collector.ts`
- Modify: `apps/xjobs/src/modules/collectors/providers/linkedin-job-board.collector.ts`
- Modify: `apps/xjobs/src/modules/collectors/providers/mappers/linkedin-job-board.mapper.ts` (`toHarvestJobSearchInput` keeps its signature)
- Test: `linkedin-job-board.collector.spec.ts`

**Interfaces:**

- Consumes: `linkedinGroupKey` and `mergedLinkedinKeyword` (Task 5).
- Produces:
  - `SegmentSearch.maxItems?: number`; the LinkedIn collector uses it in place of `maxRowsPerSearch` when set.
  - `LinkedinJobBoardRunConfig.maxRowsCeiling: number` (1000) in `LinkedinJobBoardCollector.config`.
  - The charge cap scales with rows: `maxRunChargeUsd * rows / maxRowsPerSearch`.
  - The collector refuses a segment whose members have more than one `linkedinGroupKey`. The actor's `jobTitles` is `[mergedLinkedinKeyword(queries)]`.

- [ ] **Step 1: Write the failing tests.**
  - Two members with different spellings send one `jobTitles` entry equal to the merged keyword.
  - Members with different levels throw.
  - `maxItems: 1000` sends `maxItems: 1000` and a charge cap of $2.50.
  - `truncatedQueryIds` lists every member when 100 rows come back.
- [ ] **Step 2: Run them.** `npx nx test xjobs -- linkedin-job-board.collector`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(collectors): run a shared LinkedIn search with its members' merged keyword`.

### Task 7: Split state table

**Files:**

- Modify: `libs/database/src/contract/contract.prisma`. Add `LinkedinSearchSplit`, mapped `linkedin_search_splits`: `groupKey String @id`, `parts Int`, `splitAt TimestamptzJsDate(3)`, `+Timestamps`, `@@check("parts" >= 1)`, `@@rls` with no policies (engine-only).
- Create: the migration from `pnpm --filter @xjobs/database db:migration:plan`, and advance `libs/database/src/migrations/app/refs/db.json` `"hash"`.
- Create: `apps/xjobs/src/modules/segments/repositories/splits.repository.ts`
- Modify: `apps/xjobs/src/modules/segments/segments.module.ts`, `index.ts`
- Test: `apps/xjobs/src/modules/segments/repositories/splits.postgres.spec.ts` (the disposable `processor_test` database, as `segments.postgres.spec.ts` uses), and a fake in `segments/testing/fakes.ts`

**Interfaces:**

- Produces:
  - `abstract class LinkedinSearchSplitsRepository`:
    - `parts(): Promise<Map<string, { parts: number; splitAt: Date }>>`
    - `setParts(groupKey: string, parts: number, splitAt: Date): Promise<void>`: upsert; `parts` of 1 deletes the row.
  - `PrismaLinkedinSearchSplitsRepository`, and `FakeLinkedinSearchSplitsRepository` in `testing/fakes.ts`.

- [ ] **Step 1: Write the failing Postgres test.** `setParts('k', 4, t)` then `parts()` gives `k → {4, t}`; `setParts('k', 1, t)` removes it.
- [ ] **Step 2: Run it.** Use the `processor_test` recipe: `npx nx test xjobs -- splits.postgres`. Expected: FAIL, no table.
- [ ] **Step 3: Implement.** Plan the migration, advance the ref hash, apply it with `pnpm db:migrate` (local) and to `processor_test`, then write the repository.
- [ ] **Step 4: Run it.** Expected: PASS. Also query `linkedin_search_splits` directly to confirm the table exists.
- [ ] **Step 5: Commit.** `feat(database): linkedin_search_splits for remembered search splits`.

### Task 8: Split a full search in the same tick

**Files:**

- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts`
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/types.ts` (`SegmentOutcome` gains `truncated: boolean`)
- Create: `apps/xjobs/src/infrastructure/jobs/steps/collect/splits.ts` (pure rules)
- Test: `collect/splits.spec.ts`, `collect/collection.service.spec.ts`

**Interfaces:**

- Consumes: `buildSegments(…, parts)` (Task 5), `SegmentSearch.maxItems` and `maxRowsCeiling` (Task 6), `LinkedinSearchSplitsRepository` (Task 7).
- Produces:
  - `halve(segment: SearchSegment): [SearchSegment, SearchSegment]`: members by hash order, first half rounded up; each half's `hash` comes from `segmentHash`.
  - `nextParts(current: { parts: number; splitAt: Date } | undefined, tick: { groupKey: string; chunks: number; maxReturned: number; rowLimit: number }, now: Date): number | null`. It returns the parts to store, or `null` for no change:
    - `chunks` when a split happened in this tick and `chunks > (current?.parts ?? 1)`;
    - `max(1, floor(parts / 2))` when every chunk returned under 25% of `rowLimit` and `now - splitAt ≥ 1 hour`;
    - else `null`.

The collection flow, for `LINKEDIN_JOB_BOARD` only:

1. `collect` reads `splits.parts()` once per tick and passes `parts` to `buildSegments`.
2. After `runSegment` stores a run whose `truncatedQueryIds` is non-empty, it does three things:
   - **cursors:** stores the batch without advancing them (pass `[]` as `advance`, as a capped run does);
   - **more than one member:** `halve` the segment and run each half at once;
   - **one member:** rerun it with `maxItems: maxRowsCeiling` once. If that is still full, advance the cursors and log `${key} is full at ${maxRowsCeiling} rows; older postings in this hour are lost`. The actor only ever asks for the past hour, so holding the cursor wouldn't recover them. This replaces spec §6's last bullet.
3. At the end of the tick, it calls `nextParts` per group key and `setParts` when the result isn't null.

- [ ] **Step 1: Write the failing tests.**
  - `splits.spec`:
    - `halve` of 5 members gives 3 and 2;
    - `nextParts(undefined, {chunks: 2, …})` is 2;
    - "keeps a split made under an hour ago": `nextParts({parts: 4, splitAt: now − 30 min}, {chunks: 4, maxReturned: 3, rowLimit: 100}, now)` is null;
    - the same with `splitAt: now − 2 h` is 2.
  - `collection.service.spec`, with fakes:
    - a full 2-member segment runs three times (full, then each half), and only the halves advance cursors;
    - a full single member reruns with `maxItems: 1000`;
    - `setParts` is called with 2 for that group.
- [ ] **Step 2: Run them.** `npx nx test xjobs -- collect`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(collect): split a full LinkedIn search in the same tick and remember it`.

### Task 9: Daily spend cap

**Files:**

- Modify: `apps/xjobs/src/config/environment.validation.ts`. Add `COLLECTION_DAILY_BUDGET_USD`, a positive number, default 3.
- Modify: `apps/xjobs/src/modules/segments/repositories/segments.repository.ts`
- Create: `apps/xjobs/src/infrastructure/jobs/steps/collect/spend.ts`
- Modify: `collection.service.ts`, `.env.example` (document the variable)
- Test: `collect/spend.spec.ts`, `collection.service.spec.ts`, `segments.postgres.spec.ts`, `config/validation.spec.ts`

**Interfaces:**

- Produces:
  - `moroccoDayStart(now: Date): Date`: the instant of 00:00 in `Africa/Casablanca` on `now`'s local date, using `Intl.DateTimeFormat` offsets. It must handle the Ramadan offset change.
  - `SearchSegmentsRepository.spentMicroUsd(channel: Channel, since: Date, nullCostMicroUsd: number): Promise<number>`: the sum of `costMicroUsd` over runs with `startedAt ≥ since`, a null cost counting as `nullCostMicroUsd`.
  - `CollectionService` checks `spent < budget` before every LinkedIn job board run, split reruns included. When the cap is reached, it skips the rest of the tick and logs once: `${channel} daily budget $${budget} reached ($${spent} since ${dayStart}); collection resumes tomorrow`.

- [ ] **Step 1: Write the failing tests.**
  - `moroccoDayStart(new Date('2026-11-14T10:00:00Z'))` is `2026-11-13T23:00:00Z` (UTC+1).
  - A date inside Ramadan 2026 (`2026-02-25T10:00:00Z`) gives `2026-02-25T00:00:00Z` (UTC+0).
  - `23:30Z` on the 14th gives the 15th's start.
  - Postgres: `spentMicroUsd` sums two runs, counts a null cost at the given amount, and ignores a run before `since`.
  - Service: "stops a split rerun once the cap is reached" (with fake costs pushing the total over during a split); at the cap, no run starts; under the cap, runs proceed.
  - Validation: the default is 3; `0` and negatives are refused.
- [ ] **Step 2: Run them.** `npx nx test xjobs -- spend collect validation segments.postgres`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS. Then `npx nx run-many -t lint test build typecheck` and expect PASS.
- [ ] **Step 5: Commit.** `feat(collect): daily spend cap for LinkedIn job board collection`.

## PR D: spellings script and rollout

### Task 10: `db:spellings`

**Files:**

- Create: `apps/xjobs/src/scripts/spellings.ts`, `apps/xjobs/src/scripts/spellings/logic.ts`
- Modify: `apps/xjobs/package.json` (`"db:spellings"` in the same `tsx` form as `db:vocab`), `CLAUDE.md` (a Commands line)
- Test: `apps/xjobs/src/scripts/spellings/logic.spec.ts`

**Interfaces:**

- Consumes: `SEARCH_SPELLINGS`, `ROLE_WORDS`, `roleWords` (Task 2).
- Produces, all pure, in `logic.ts`:
  - `spellingShares(texts: readonly string[], technology: string, candidates: readonly string[]): { spelling: string; share: number }[]`: case-insensitive, word-bounded; `share` is the fraction of texts that mention the technology in any candidate form.
  - `suggestSpellings(shares, known: readonly string[], threshold = 0.1): string[]`: unknown spellings at or above the threshold.
  - `roleWordGaps(jobs: readonly { title: string; languages: string[]; position: string }[]): { title: string }[]`: engineering-titled jobs with no role word of their languages.
  - `unusedSpellings(jobs: readonly { text: string }[], spellings: readonly string[]): string[]`: spellings that are the only match in no job.
- The script is read-only against the database. It reads processed LinkedIn jobs from the last `--days` days (default 7), with their titles and descriptions, and prints a JSON report. Candidate forms per technology: `SEARCH_SPELLINGS`, plus its `tech_tags.aliases`, plus case and punctuation variants (`nodejs`, `node.js`, `node js`).
- `--check-totals` makes paid 3-row runs (cap $0.10 per invocation) for each suggestion's LinkedIn total. It is off by default.

- [ ] **Step 1: Write the failing tests.**
  - `spellingShares` on `['Node.js dev', 'NodeJS', 'node js']` gives shares of about 0.33 each.
  - `suggestSpellings` drops known spellings and keeps one at 0.2.
  - `roleWordGaps` flags "Solutions Architect" for an `engineer` family with `['en']`.
- [ ] **Step 2: Run them.** `npx nx test xjobs -- spellings`. Expected: FAIL.
- [ ] **Step 3: Implement** the logic and the script.
- [ ] **Step 4: Run them, plus a local smoke run.** `DATABASE_URL=<local> pnpm --filter @xjobs/xjobs db:spellings -- --days 7` prints a report (empty on a fresh database). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(scripts): db:spellings suggests search spellings and role words`.

### Task 11: Rollout on dev

**Files:**

- Modify: `docs/roadmap/phase-3-find-quality/README.md` (04's status), `docs/roadmap/phase-3-find-quality/04-search-precision.md` (a link to the spec)
- Modify: `docs/superpowers/specs/2026-11-09-shared-linkedin-searches-design.md` (status line: superseded for Tasks 4–9 by the 2026-11-14 spec)

- [ ] **Step 1: Docs.** Update the three files above. Commit `docs(roadmap): slice 04 status and superseded planner`.
- [ ] **Step 2: Open the PRs** with `git push -u origin <branch>` and `gh pr create` to `main`, one per PR (A–D) after its tasks. Retarget stacked PRs to `main` before merging.
- [ ] **Step 3: After merge, on dev.** The maintainer applies the migration to `10xjobs-dev`. Then `pnpm --filter @xjobs/xjobs db:regenerate`. Expected: the dev profile's 128 version-11 builders are retired, and version-12 builders exist for every search place × type × level.
- [ ] **Step 4: Hosted engine.** The maintainer puts the new `APIFY_TOKEN` and, optionally, `COLLECTION_DAILY_BUDGET_USD` on the hosted engine and redeploys. Expected: a tick logs the per-segment summary and `costUsd`.
- [ ] **Step 5: After a week.** Run `db:analyze`, `db:spellings` and `db:match-shares`. Report:
  - the share of processed jobs that aren't engineering roles (target under 15%);
  - daily spend against the cap;
  - full searches and splits;
  - suggested spellings and role words.

  The user decides then on a pre-processor title filter.
