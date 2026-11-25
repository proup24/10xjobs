# Indeed Collect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `INDEED` channel that collects Indeed jobs through `valig/indeed-jobs-scraper`, hourly on weekdays, for published profiles with the Indeed switch on, under its own daily cap. Batches are stored and wait for slice 04's ingest.

**Architecture:** Indeed builders are ordinary `query_search_builder` rows on channel `INDEED`, made by `indeedRecipes` (like `postRecipes`, not by `expand`) and attached only through the Indeed switch. A profile's search input now carries its places' country codes and the `indeed_markets` rows, so the recipes stay a pure function. `planSegments` groups Indeed builders by `INDEED|<site>|<location>` and merges their LinkedIn-style words into the fewest keywords that fit. Each segment is one valig run over the last 1, 3 or 7 days, at most 1,000 rows, charged from what's left of the Indeed daily budget.

**Tech Stack:** NestJS engine (`apps/xjobs`), BullMQ, Apify, Prisma Next contract and migrations (`libs/database`), Supabase Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-25-indeed-collect-design.md`

## Global Constraints

- Work in a new worktree `.worktrees/indeed-collect` on branch `feat/indeed-collect`, from `origin/main` once PR #135 has merged (it holds the spec). If #135 is still open, branch from `origin/main` and cherry-pick the spec and plan commits. Never stack on `docs/indeed-sample-verdict`. Push only with `git push -u origin feat/indeed-collect`. Never touch the main checkout. Never read `.env*` except `.env.example`.
- Channel value `INDEED`. Actor, exactly: `valig/indeed-jobs-scraper`. Queue `collect-indeed`, nx target `worker-indeed`, `WORKER_CHANNEL=INDEED`.
- Actor input, exactly: `{ country: <site>, title: <merged keyword>, location: <location>, limit: 1000, datePosted: '1' | '3' | '7' }`. No other fields.
- `INDEED` is **not** in `ACTIVE_CHANNELS` and not in `TRIAL_CHANNELS`. `isLinkedinJobBoard(INDEED)` is false.
- The Indeed switch: `channel: Channel.INDEED`, `recipes: indeedRecipes`, **`available: false`** (slice 04 flips it).
- Schedule `0 9-21 * * 1-5` in `Africa/Casablanca`. Window `{ initialHours: 24, overlapMinutes: 0, maximumHours: 72 }`, `resumeHours: 24`, concurrency 1, attempts 1.
- Run config: `maxRowsPerSearch: 1000`, `maxRunChargeUsd: 0.11` (1,000 rows plus a start), `waitSecs: 900`.
- Budget env `COLLECTION_DAILY_BUDGET_USD_INDEED`, positive number, default `1`. A run's charge limit is `min(leftUsd, 0.11)`. No run starts when `leftUsd < 0.001`.
- Main remote markets, exactly: `us`, `br`, `pl`, `uk`, `ca`. `remoteLocation` defaults to `Remote` on every row.
- Role words added to `ENGINEER_WORDS`, exactly: `pt: ['engenheiro', 'desenvolvedor', 'programador', 'arquiteto']`, `pl: ['programista', 'inżynier', 'architekt']`. Also `architect.pt: ['arquiteto']`, `architect.pl: ['architekt']`, `tech_lead.pt: ['líder técnico']`.
- `QUERY_SEARCH_RECIPE_VERSION` goes from 14 to 15.
- Ingest leaves every `INDEED` batch `pending`: never enqueued, never swept, never failed.

## Review Focus

1. **A profile with the switch on but only region places and no remote** (for example on-site in `Europe`) gets zero Indeed recipes. Attaching zero recipes must succeed, and search sync must not throw `NoSearches`, because the board recipes are still there. Pinned in Task 5 (`builds nothing for a profile with only region places`).
2. **An empty `indeed_markets` table** (a fresh test database, or an engine running before the migration) makes `indeedRecipes` return `[]`, never throw. Pinned in Task 5 (`builds nothing without market rows`).
3. **The daily budget almost spent**: with $0.05 left, a run's charge limit is $0.05. A charge-capped run stores what it got and leaves its cursors, and with under $0.001 left no run starts. Pinned in Task 8.
4. **Two profiles on the same site and location** share one run, and a merged keyword over the limit splits into two runs, never one oversized one. Pinned in Task 6.
5. **The Monday catch-up**: the first run after Friday 21:00 covers 60 hours and asks `datePosted: '3'`. A window clipped at 72 hours still asks `'3'` and logs the clip. Pinned in Task 7.

---

### Task 1: Migration: `INDEED` and `indeed_markets`

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (`enum Channel` at line 72; new model `IndeedMarket` near `Country` at line 756)
- Modify: `libs/database/src/enums/channel.enum.ts` (add `INDEED = 'INDEED'`; leave `ACTIVE_CHANNELS` and `TRIAL_CHANNELS` alone)
- Create: `libs/database/src/migrations/app/<timestamp>_indeed_markets/migration.ts` (planned with `pnpm --filter @xjobs/database db:migration:plan`, then edited)
- Modify: `libs/database/src/migrations/app/refs/db.json`, `libs/database/src/supabase/database.types.ts` (regenerated)
- Test: `apps/db-tests/src/indeed-markets.db.spec.ts` (same setup as `search-switches.db.spec.ts`)

**Interfaces:**

- Produces table `public.indeed_markets`: `site text PRIMARY KEY`, `"countryCode" text NOT NULL UNIQUE` (ISO 3166-1 alpha-2, uppercase; no FK, since `countries` holds only vocabulary rows), `"mainRemote" boolean NOT NULL DEFAULT false`, `"remoteLocation" text NOT NULL DEFAULT 'Remote'`. RLS on, no policies (`@@rls` with no policy blocks, like the other engine-only tables).
- Produces the `Channel` value `INDEED` in the contract and the TS enum.
- Seed rows, one `rawSql` insert in the migration with `ON CONFLICT (site) DO NOTHING`: `site` is each of valig's codes, `countryCode` is `upper(site)` except `uk` → `GB`, `mainRemote` true only for `us br pl uk ca`. valig's codes, exactly: `ar au at bh be br ca cl cn co cr cz dk ec eg fi fr de gr hk hu in id ie il it jp kw lu my mx ma nl nz ng no om pk pa pe ph pl pt qa ro sa sg za kr es se ch tw th tr ua ae uk us uy ve vn` (62).

- [ ] **Step 1: Write the failing db-tests**
  - `seeds 62 markets with five main remote ones`: `count(*) = 62`, and `site` where `mainRemote` is `{br, ca, pl, uk, us}`.
  - `maps uk to GB`: the `uk` row has `countryCode = 'GB'`; the `ma` row has `'MA'`.
  - `authenticated users cannot read markets`: a select as an authenticated user returns 0 rows or a permission error.
  - `a channel column accepts INDEED`: insert a `query_search_builder` row with `channel = 'INDEED'` as the service role and it succeeds.
- [ ] **Step 2: Run and expect FAIL:** `pnpm db:test`, with the missing-table error.
- [ ] **Step 3: Edit the contract and plan the migration.** Advance the `db` ref hash and re-add every earlier invariant (see the NOTE in the paused-searches migration), plus `indeed-markets-seed` for the seed op. Run `pnpm db:reset` and `pnpm db:types`. If `db:migrate` runs out of memory (#124), split the seed into a second migration.
- [ ] **Step 4: Run and expect PASS:** `pnpm db:test`, then `npx nx typecheck xjobs`. It will fail on every exhaustive `switch` and `Record<Channel, …>`. That's expected and Task 2 fixes it, so commit anyway.
- [ ] **Step 5: Commit:** `feat(database): INDEED channel and indeed_markets`

### Task 2: `INDEED` in every channel site; Indeed batches wait for slice 04

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/config/channels.ts` (`channelIngestConfig`, new `INGEST_WAITING_CHANNELS`)
- Modify: `apps/xjobs/src/modules/ingest/normalize/normalize.ts:27`, `merge.ts:28` (`precedence`), `job-key.ts:105`, `apps/xjobs/src/modules/ingest/utils/source-key.ts:139`
- Modify: `apps/xjobs/src/modules/ingest/repositories/raw.repository.ts:202` (`listStalePending`)
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts:718` (`enqueueBatch`)
- Modify: `apps/xjobs/src/modules/queries/channels/index.ts` (`CHANNEL_QUERY_BUILDERS` type excludes `INDEED` too), `apps/xjobs/src/modules/queries/builders/recipe.ts` (`toRecipe` throws for `INDEED`: "Indeed recipes are built by indeedRecipes")
- Test: `apps/xjobs/src/modules/ingest/repositories/*.postgres.spec.ts` (the existing raw repository spec), `apps/xjobs/src/infrastructure/jobs/tests/collection.service.spec.ts`

**Interfaces:**

- Produces `INGEST_WAITING_CHANNELS: readonly Channel[] = [Channel.INDEED]`, with the comment "Collected and stored, not ingested until Phase 5 slice 04."
- `channelIngestConfig[INDEED] = { kind: 'job', volatileKeys: [] }`. `precedence[INDEED] = 2.5`. The `normalize`, `jobKey` and `sourceKey` cases throw `new Error('Indeed ingest lands in Phase 5 slice 04')` (`sourceKey` returns `{ invalid: … }` with that text). They're unreachable while the channel is waiting.
- The collection fetch `switch` gets its `INDEED` case in Task 7. Until then, add a case that throws "not wired", so the build compiles.

- [ ] **Step 1: Write the failing tests**
  - Raw repository (Postgres): `listStalePending skips waiting channels`: a stale pending `INDEED` batch and a stale pending `LINKEDIN_JOB_BOARD` batch → only the LinkedIn id.
  - Collection service: `stores an Indeed batch without enqueueing it`: after a successful `INDEED` segment, `ingestQueue.enqueue` is not called and the batch is saved `pending`.
- [ ] **Step 2: Run and expect FAIL:** `pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/modules/ingest src/infrastructure/jobs/tests/collection.service.spec.ts`
- [ ] **Step 3: Implement** the cases, the waiting list, `channel NOT IN waiting` in `listStalePending`, and an early return in `enqueueBatch` when the batch's channel is waiting. Pass the channel in; it's known at the call site at line 667.
- [ ] **Step 4: Run and expect PASS**, plus `npx nx typecheck xjobs` green.
- [ ] **Step 5: Commit:** `feat(engine): INDEED channel sites; Indeed batches wait for ingest`

### Task 3: Portuguese and Polish role words

**Files:**

- Modify: `apps/xjobs/src/modules/queries/builders/role-words.ts` (values in Global Constraints)
- Modify: `apps/xjobs/src/modules/queries/builders/recipe.ts:6` (`QUERY_SEARCH_RECIPE_VERSION = 15`)
- Test: `apps/xjobs/src/modules/queries/builders/role-words.spec.ts`

- [ ] **Step 1: Write the failing tests:** `adds Portuguese words for a profile listing pt`: `roleWords('backend_engineer', ['pt'])` contains `desenvolvedor`, `engenheiro`, `programador`, `arquiteto`. `adds Polish words for pl`: contains `programista`, `inżynier`, `architekt`. `adds nothing for en only`: equals the English list.
- [ ] **Step 2: Run and expect FAIL:** `pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/modules/queries/builders/role-words.spec.ts`
- [ ] **Step 3: Add the columns and bump the version.** Fix any recipe-hash snapshot the bump breaks.
- [ ] **Step 4: Run and expect PASS:** `npx nx test xjobs`
- [ ] **Step 5: Commit:** `feat(queries): Portuguese and Polish role words`

### Task 4: Places' countries and the markets in the search input

**Files:**

- Modify: `apps/xjobs/src/modules/queries/types/query-search.types.ts` (`QuerySearchProfileInput`)
- Create: `apps/xjobs/src/modules/queries/indeed/markets.ts` (type `IndeedMarket`)
- Modify: `apps/xjobs/src/modules/users/repositories/profiles.repository.ts` (abstract + Prisma `indeedMarkets()`), `apps/xjobs/src/modules/users/testing/fakes.ts`
- Modify: `apps/xjobs/src/modules/users/services/profiles.service.ts` (`toQuerySearchInput` at line 99, new `searchInputFor`, call sites at lines 221, 325, 471), `apps/xjobs/src/modules/users/services/profile-search-sync.ts:48`
- Test: `apps/xjobs/src/modules/users/services/profiles.service.spec.ts`, `apps/xjobs/src/modules/users/repositories/profiles.postgres.spec.ts`

**Interfaces:**

- `type IndeedMarket = { site: string; countryCode: string; mainRemote: boolean; remoteLocation: string }`
- `type PlaceCountry = { countryCode: string; city: string | null }`
- `QuerySearchProfileInput` gains `placeCountries?: Record<LocationArrangement, PlaceCountry[]>` and `indeedMarkets?: readonly IndeedMarket[]`. Absent means none, so existing fixtures stay valid.
- `ProfilesRepository.indeedMarkets(): Promise<IndeedMarket[]>` reads every row, ordered by `site`.
- `toQuerySearchInput(profile, labels, markets: readonly IndeedMarket[] = [])`: a `country` place maps to `{ countryCode: code, city: null }`, and a `city` place to `{ countryCode: labels.cities.get(id).countryCode, city: labels.cities.get(id).name }`. Regions and worldwide are left out.
- `searchInputFor(profiles: Pick<ProfilesRepository, 'placeLabels' | 'indeedMarkets'>, profile): Promise<QuerySearchProfileInput>` loads labels and markets in parallel. Every call site that did `toQuerySearchInput(profile, await labelsFor(…))` uses it. Regenerate's injectable `toInput` takes `(profile, labels, markets)`.

- [ ] **Step 1: Write the failing tests**
  - `toQuerySearchInput maps countries and cities per arrangement`: remote `[country MA, region EMEA]`, on-site `[city c1 (Casablanca, MA)]` → `placeCountries.remote = [{ countryCode: 'MA', city: null }]`, `onsite = [{ countryCode: 'MA', city: 'Casablanca' }]`, `hybrid = []`.
  - `carries the markets given`: `indeedMarkets` equals the list passed.
  - Postgres: `indeedMarkets reads the seeded rows`: 62 rows, the `us` row `{ countryCode: 'US', mainRemote: true, remoteLocation: 'Remote' }`.
- [ ] **Step 2: Run and expect FAIL:** `pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/modules/users`
- [ ] **Step 3: Implement**, and replace the call sites.
- [ ] **Step 4: Run and expect PASS:** `npx nx test xjobs`
- [ ] **Step 5: Commit:** `feat(users): search input carries place countries and Indeed markets`

### Task 5: `indeedRecipes` and the switch

**Files:**

- Create: `apps/xjobs/src/modules/queries/indeed/recipes.ts`, `apps/xjobs/src/modules/queries/indeed/index.ts`
- Modify: `apps/xjobs/src/modules/queries/switches.ts` (the `indeed` entry; drop the "joins in slice 03" comments)
- Test: `apps/xjobs/src/modules/queries/indeed/recipes.spec.ts`, `apps/xjobs/src/modules/queries/switches.spec.ts`

**Interfaces:**

- Consumes `IndeedMarket` and `PlaceCountry` (Task 4), `roleWords` (Task 3), `topSkills` and `packLinkedinTechnologies` (`queries/sets/technology.ts`), `searchSpellings`, `linkedinKeyword`, `recipeHash`, `QUERY_SEARCH_RECIPE_VERSION`.
- Produces `indeedPlaces(input): IndeedPlace[]`, with `type IndeedPlace = { site: string; location: string; type: Arrangement }`:
  1. If `locations.remote` isn't empty: each `mainRemote` market as `{ site, location: remoteLocation, type: remote }`.
  2. Each `placeCountries[arrangement]` entry whose `countryCode` has a market: skip it when the arrangement is `remote` and the market is `mainRemote`. Otherwise, a country (and a remote city) adds its site to the whole-site set, and an on-site or hybrid city adds `(site, city)`.
  3. Each whole-site site as `{ site, location: '', type: unstated }`, and each city whose site isn't in the whole-site set as `{ site, location: city, type: unstated }`.
  4. Deduped and sorted by `site`, then `location`.
- Produces `indeedRecipes(input): QuerySearchRecipe[]`: for each place × each technology set from `packLinkedinTechnologies(topSkills(skills), roles)`, one recipe. Its fields are `channel: INDEED`, `position`, `location: \`${site}:${location || '\*'}\``lowercased,`experience: 'unstated'`, `type`, `technologies`, `domain`, `languages`, `version`, `keyword: linkedinKeyword(roles, spellings)`, `params: { site, location, roleWords, spellings }`, and `hash: recipeHash(…)`. It returns `[]` when there are no roles, no skills or no markets.

- [ ] **Step 1: Write the failing tests** (the markets fixture is `us br pl uk ca` main, plus `ma` and `fr`)
  - `searches every main market remote for a profile wanting remote`: remote `[EMEA region]` → sites `br ca pl uk us`, each with location `Remote` and type `remote`.
  - `searches a named remote country's whole site`: remote `[MA]` → the five, plus `{ ma, '', unstated }`.
  - `adds nothing for a main market named only for remote`: remote `[US]` → exactly the five.
  - `one search per country whatever its arrangements`: remote `[MA]`, on-site `[MA]`, hybrid `[MA]` → one `ma` whole-site search.
  - `searches a city on its country's site`: on-site `[Paris, FR]` and no remote → exactly `{ fr, 'Paris', unstated }`.
  - `drops a city whose country has a whole-site search`: on-site `[Casablanca, MA]`, hybrid `[MA]` → only `{ ma, '' }`.
  - `builds nothing for a profile with only region places` (Review Focus 1): on-site `[Europe]`, no remote → `[]`.
  - `builds nothing without market rows` (Review Focus 2): `indeedMarkets` absent → `[]`.
  - `two profiles with the same words share recipe hashes`.
  - `recipes carry no seniority`: the keyword doesn't contain `senior`; `experience` is `'unstated'`.
  - Switch spec: `the indeed switch is INDEED's and stays unavailable`.
- [ ] **Step 2: Run and expect FAIL:** `pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/modules/queries`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and expect PASS**, plus `npx nx test xjobs`. The slice 02 switch paths (attach, detach, regenerate, publish-drafts) now attach real Indeed builders. Their existing specs must stay green.
- [ ] **Step 5: Commit:** `feat(queries): Indeed recipes behind the Indeed switch`

### Task 6: Indeed segments

**Files:**

- Modify: `apps/xjobs/src/modules/segments/services/segments.ts` (`segmentKey` at line 67, the chunking branch at line 239)
- Test: `apps/xjobs/src/modules/segments/services/segments.spec.ts`

**Interfaces:**

- `segmentKey` for `INDEED`: `['INDEED', params.site, params.location].join('|')`, with no domain and no type.
- Chunks for `INDEED`: `fitChunks(members.map((m) => [m]), keywordFits)`, with the same `keywordFits` as harvestapi.

- [ ] **Step 1: Write the failing tests:** `merges two profiles' Indeed builders on one site and location into one segment`. `splits a group whose merged keyword is too long into two segments` (Review Focus 4). `keeps different locations on one site apart` (`us|Remote` and `us|`).
- [ ] **Step 2: Run and expect FAIL:** `pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/modules/segments`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and expect PASS.**
- [ ] **Step 5: Commit:** `feat(segments): Indeed segments by site and location`

### Task 7: The Indeed collector

**Files:**

- Create: `apps/xjobs/src/modules/collectors/providers/indeed.collector.ts`, `apps/xjobs/src/modules/collectors/providers/mappers/indeed-input.ts`
- Modify: `apps/xjobs/src/modules/collectors/types/collector.ts` (`IndeedRunConfig`), `collectors.module.ts`, `index.ts` (export)
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts` (`fetch` case at line 762, replacing Task 2's placeholder; inject `IndeedCollector`)
- Test: `apps/xjobs/src/modules/collectors/providers/indeed.collector.spec.ts`, `mappers/indeed-input.spec.ts`

**Interfaces:**

- `interface IndeedRunConfig extends ActorRunConfig { maxRowsPerSearch: number; waitSecs: number }`, and `IndeedCollector.config = { actor: 'valig/indeed-jobs-scraper', maxRunChargeUsd: 0.11, maxRowsPerSearch: 1000, waitSecs: 900 }`.
- `indeedDatePosted(since: Date, until: Date): '1' | '3' | '7'`: up to 24 hours → `'1'`, up to 72 → `'3'`, else `'7'`.
- `toIndeedInput(segment: SegmentSearch, rows: number): { country; title; location; limit; datePosted }`: `site` and `location` from the first query's params, `title` is `mergedLinkedinKeyword(segment.queries)`.
- `IndeedCollector.collect(segment)`: throws `SearchNotStartedError` without `maxChargeUsd`. It runs with `min(segment.maxChargeUsd, 0.11)`, gives every item to every member (rank `i + 1`, as the posts collector does), and sets `capped` with `reachedChargeCap`. When `items.length >= maxRowsPerSearch`, `truncatedQueryIds` is every member id, logged as a warning: `INDEED segment <key> returned 1000 rows, its row cap; jobs past it are lost`.

- [ ] **Step 1: Write the failing tests**
  - Mapper: `asks one day for an hourly window`. `asks three days for a 60-hour window` (Review Focus 5). `asks three days at the 72-hour maximum`. `sends exactly the five fields`, with `limit: 1000`, `country: 'us'`, `location: 'Remote'`.
  - Collector (fake `ApifyActorProvider`): `passes the smaller charge limit` ($0.05 left → `maxChargeUsd: 0.05`). `refuses to start without a charge limit`. `marks every member truncated at 1000 rows`. `not truncated at 999`. `shares every item with every member`.
- [ ] **Step 2: Run and expect FAIL:** `pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/modules/collectors`
- [ ] **Step 3: Implement**, and wire the `fetch` case.
- [ ] **Step 4: Run and expect PASS.**
- [ ] **Step 5: Commit:** `feat(collectors): Indeed collector on valig`

### Task 8: Schedule, budget and worker

**Files:**

- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/config.ts` (`channelJobsConfig[INDEED]` and its `satisfies` entry)
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts` (`hasDailyBudget`, `budgetSetting`, `nullCostMicroUsd`, `runCapMicroUsd`, the min-left check at line 320, the charge limit in `buildSearch` at line 587)
- Modify: `apps/xjobs/src/config/environment.validation.ts` (after `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS`), `.env.example` (commented `# COLLECTION_DAILY_BUDGET_USD_INDEED=1`)
- Modify: `apps/xjobs/package.json` (target `worker-indeed`, copied from `worker-linkedin-posts` with `WORKER_CHANNEL: INDEED`)
- Test: `apps/xjobs/src/infrastructure/jobs/tests/collection.service.spec.ts`, the collect config spec if there is one

**Interfaces:**

- `channelJobsConfig[INDEED]`: `queueName: 'collect-indeed'`, the values in Global Constraints, `enabled: true` (with the comment "Switch-only, like posts: on by itself, under COLLECTION_DAILY_BUDGET_USD_INDEED"), `run: IndeedCollector.config`.
- Budget, generalising the posts path to a `chargesFromBudget(channel)` predicate (`LINKEDIN_POSTS` or `INDEED`): the run's charge limit is what's left of the day, capped at `run.maxRunChargeUsd`. The minimum left to start is `INDEED_MIN_LEFT_USD = 0.001`. A run with no reported cost counts as its charge limit.

- [ ] **Step 1: Write the failing tests**
  - `reads COLLECTION_DAILY_BUDGET_USD_INDEED for Indeed`.
  - `charges an Indeed run what is left, at most 0.11` ($0.05 left → 0.05; $0.80 left → 0.11).
  - `starts no Indeed run under $0.001 left`: the segment is deferred, no Apify call, cursors unchanged (Review Focus 3).
  - `a charge-capped Indeed run stores its items and keeps its cursors`.
  - `collectsNow(INDEED)` is true with no trial channels set.
- [ ] **Step 2: Run and expect FAIL:** `pnpm exec vitest run --config apps/xjobs/vitest.config.mts src/infrastructure/jobs/tests/collection.service.spec.ts`
- [ ] **Step 3: Implement.** Check that `worker-all` starts the Indeed collection by itself (it iterates `channelJobsConfig` with `collectsNow`). If it doesn't, add it there.
- [ ] **Step 4: Run and expect PASS:** `npx nx test xjobs`
- [ ] **Step 5: Commit:** `feat(collect): hourly Indeed collection under its own budget`

### Task 9: Docs, full CI and the PR

**Files:**

- Modify: root `CLAUDE.md` (Commands: add `indeed` to the `worker-<channel>` list, with the note that it needs a published profile with the Indeed switch on, and that until slice 04 its batches wait unprocessed)
- Modify: `apps/xjobs/src/modules/collectors/README.md` (Indeed in the channel list; batches wait for ingest)
- Modify: `docs/roadmap/phase-5-indeed/03-collect.md` and `README.md` (slice 03 status "Built (spec, plan)", with links)

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run CI locally:** `npx nx run-many -t lint test build typecheck` all green, and `pnpm db:test` passes.
- [ ] **Step 3: Commit:** `docs: Indeed collection`, then `git push -u origin feat/indeed-collect` and `gh pr create --base main`. The PR body carries the spec's Rollout check on dev, adjusted as follows: run `db:regenerate` after deploy (recipe version 15); set the owner's `indeedSearch = true` with SQL; set `COLLECTION_DAILY_BUDGET_USD_INDEED=1` on the hosted engine; check whether the hosted engine runs `worker-all` (then nothing to add) or per-channel workers (then add `worker-indeed`); then the first-weekday checks, including Brazil, Poland and Canada with `Remote`.
