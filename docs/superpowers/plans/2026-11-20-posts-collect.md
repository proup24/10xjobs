# Collect LinkedIn Hiring Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild LinkedIn post collection from scratch: a per-profile post search switch (allow-listed, off by default), post searches built from position, language and technologies, merged across profiles like the job board, collected hourly into raw storage under one daily budget, with the actor's silent failures detected.

**Architecture:** Post builders are ordinary `query_search_builder` rows on channel `LINKEDIN_POSTS`, made by a dedicated recipe function (not by `expand`, which covers `ACTIVE_CHANNELS` only) and attached only when the profile's switch is on and its owner is allow-listed. Each tick, `planSegments` groups post builders by `linkedin_posts|<language>|<position>|<remote|any>` and merges whole builders whose combined words fit LinkedIn post search's 5-operator limit. Each segment is one merged search and one `harvestapi/linkedin-post-search` run, whose log is checked for silent failures. Posts are stored raw; ingest links no job for them.

**Tech Stack:** NestJS engine (apps/xjobs), BullMQ, Apify, Prisma-next contract + generated migration (libs/database), Supabase Postgres, Next.js (apps/web), `@xjobs/engine-client`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-posts-collect-design.md`

## Global Constraints

- Work only in the worktree `/home/lab/apps/10xjobs/.worktrees/posts-collect`. Branch `feat/posts-collect`, created from `docs/phase-4-slice-01-collect` (which holds the spec). One PR to `main`, pushed only with `git push -u origin feat/posts-collect`. Never touch the main checkout. Never read or write `.env*` except `.env.example` files.
- Channel `LINKEDIN_POSTS` (value unchanged). Actor, exactly: `harvestapi/linkedin-post-search`. Queue `collect-linkedin-posts`, nx target `worker-linkedin-posts` (both exist).
- Actor input, exactly: `{ searchQueries: [<merged keyword>], maxPosts: 0, postedLimitDate: <window since, ISO>, sortBy: 'date', profileScraperMode: 'short' }`. Run options: `maxChargeUsd` = what's left of today's posts budget; `waitSecs: 900`.
- Search forms, exactly (terms lowercased; a term with a space or one of `.#+` is double-quoted, as `keywordTerm` in `queries/channels/linkedin_keyword.ts` does; a one-term group has no parentheses):
  - English: `hiring <(position words)> <(spellings)> remote`, only for profiles with at least one remote place.
  - French: `recrute <(position words)> <(spellings)>`, for any arrangement.
- Hiring words, exactly: `en: 'hiring'`, `fr: 'recrute'`. No other language gets post searches.
- Operator limit: a merged keyword's `OR` count, `(positionWords - 1) + (spellings - 1)`, is at most **5**, and its length is at most **500** characters.
- Position words, exactly (≤ 2 each):

| Position                  | Words                                      |
| ------------------------- | ------------------------------------------ |
| backend_engineer          | `backend`, `back end`                      |
| frontend_engineer         | `frontend`, `front end`                    |
| fullstack_engineer        | `fullstack`, `full stack`                  |
| mobile_engineer           | `mobile developer`, `mobile engineer`      |
| devops_engineer           | `devops`                                   |
| site_reliability_engineer | `sre`, `site reliability`                  |
| platform_engineer         | `platform engineer`                        |
| cloud_engineer            | `cloud engineer`                           |
| security_engineer         | `security engineer`                        |
| data_engineer             | `data engineer`                            |
| ml_engineer               | `machine learning engineer`, `ml engineer` |
| ai_engineer               | `ai engineer`, `llm engineer`              |
| qa_engineer               | `qa engineer`, `test automation`           |
| embedded_engineer         | `embedded engineer`, `embedded software`   |
| software_architect        | `software architect`                       |
| tech_lead                 | `tech lead`                                |
| engineering_manager       | `engineering manager`                      |

- Post spellings: per technology, `SEARCH_SPELLINGS` (`queries/builders/search-spellings.ts`) lowercased, plus the post-only addition `react → reactjs`. Within one technology, keep the first spelling of each group equal after deleting dots between two word characters (`node.js` ≡ `nodejs`; `.net` stays). Drop a technology when every one of its spellings contains, as a whole word, a spelling of a technology already kept (`react native` when `react` is kept).
- Builder columns for a post recipe: `channel LINKEDIN_POSTS`, `location 'any'`, `experience 'unstated'`, `type remote` (English) or `unstated` (French), `technologies` = the group's technology codes, `domain` = its first technology's, `version` = `QUERY_SEARCH_RECIPE_VERSION` (unchanged at 12; job-board hashes must not change), `params = { language, position, hiringWord, positionWords, spellings, remote }`.
- Schedule `0 * * * *`, timezone `Africa/Casablanca`. Window `{ initialHours: 24, overlapMinutes: 5, maximumHours: 24 }`. `concurrency 1`, `attempts 1`, `claimLeaseMinutes 30`. The channel is enabled on its own (not through `ACTIVE_CHANNELS`, which stays as it is).
- Env, exactly: `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS`, positive number, default **1.5**. `POST_SEARCH_USERS`: comma-separated Supabase user ids, default empty (nobody).
- A posts run with no reported cost counts at **$0.25** toward the day (until `settleCosts` re-reads it). A run is not started when less than **$0.01** of the budget is left.
- Failure strings, exactly, matched in the run log: `No available resource`, `Too many boolean operators`. A run whose log can't be read counts as failed the same way.
- Profile column, exactly: `postSearch Boolean @default(false)`. Users never get a column grant on it: only the engine writes it.
- The Prisma contract is the only schema source. Generate the migration with `pnpm --filter @xjobs/database db:migration:plan`, then set `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the migration's `to`; keep `invariants` unchanged.
- Postgres specs need `INGEST_TEST_DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:54398/ingest_test` and `PROCESSOR_TEST_DATABASE_URL=postgresql://supabase_admin:postgres@127.0.0.1:54399/processor_test` (containers `xjobs-ingest-test`, `xjobs-processor-test`; `docker.exe start …`). Apply this branch's migrations to both, and confirm each suite ran, not skipped. db-tests run against the local Supabase stack (`npx nx db-test db-tests`).
- UI only from `components/ui` and theme tokens (`apps/web/DESIGN.md`). Copy, exactly: label `Search LinkedIn posts`; description `Looks every hour for hiring posts that match this profile. English posts are searched for remote work only.`; when the profile would get no searches: `No post searches for this profile: English posts are searched for remote work only, and it has no remote places.`
- CI: `npx nx run-many -t lint test build typecheck` passes.

## Review Focus

1. **The actor reports SUCCEEDED but logged `No available resource`.** The posts it returned are stored, the run is `partial`, and the builders' cursors don't move, so the next tick searches the window again. Pinned in Task 6 (`marks a run with no available resource incomplete`) and Task 7 (`stores an incomplete run without moving cursors`).
2. **Two profiles whose merged words would exceed 5 operators.** They are split into two searches, never sent as one query the actor rejects. Pinned in Task 5 (`splits a group whose merged words exceed five operators`).
3. **The day's budget runs low mid-tick.** No run starts with less than $0.01 left, and no run's charge limit exceeds what's left. Pinned in Task 7 (`caps each posts run at the budget left` and `skips posts segments once less than a cent is left`).
4. **A user not on the allow-list calls the switch endpoint, or a profile with the switch on loses its allow-listing.** The endpoint answers 403, and `db:regenerate` attaches no post builders for them. Pinned in Task 8 (`refuses a user who is not allow-listed` and `regenerates without post builders for a user no longer listed`).
5. **The web app writes `postSearch` straight to Supabase.** Refused by column grants. Pinned in Task 1 (`refuses an owner's direct update of postSearch`).

---

### Task 0: Branch, spec and plan

- [ ] **Step 1:** `git switch -c feat/posts-collect` in the worktree; `git log --oneline -2` shows `docs(spec): phase 4 slice 01, collect LinkedIn hiring posts` on top of `origin/main`.
- [ ] **Step 2:** Commit the spec change made while planning (one run per merged search) and this plan: `docs(plan): collect LinkedIn hiring posts`.

### Task 1: `profiles.postSearch` column

**Files:**

- Modify: `libs/database/src/contract/contract.prisma` (`model Profile`, after `publishedAt`)
- Create: `libs/database/src/migrations/app/<timestamp>_profile_post_search/` (generated)
- Modify: `libs/database/src/migrations/app/refs/db.json`
- Create: `apps/db-tests/src/post-search.db.spec.ts`

**Interfaces:**

- Produces: `ProfileRow.postSearch: boolean` (and on `ProfileWithSkills`, which is built from the row).

- [ ] **Step 1: Failing db-test** `post-search.db.spec.ts`, using `seedProfile`/`createTestUser` like `profile-freeze.db.spec.ts`:
  - `defaults postSearch to false`: a seeded profile reads `postSearch === false`.
  - `refuses an owner's direct update of postSearch`: as the owner, `update({ postSearch: true })` on their own **draft** fails with code `42501`.
- [ ] **Step 2:** Run `npx nx db-test db-tests -- post-search` → FAIL (no column).
- [ ] **Step 3:** Add `postSearch Boolean @default(false)` with a comment (`// LinkedIn post search; only the engine writes it (no column grant).`), generate the migration, advance `refs/db.json`, `pnpm db:migrate` locally.
- [ ] **Step 4:** Run the db-test → PASS. Run `npx nx run-many -t typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(database): profiles.postSearch`.

### Task 2: Remove the old post code; posts ingest raw only

**Files:**

- Delete: `apps/xjobs/src/modules/queries/channels/linkedin_posts.builder.ts`, `apps/xjobs/src/modules/collectors/providers/linkedin-posts.collector.ts`, `apps/xjobs/src/modules/collectors/providers/mappers/linkedin-posts.mapper.ts`, and their specs
- Modify: `queries/channels/index.ts` (no posts builder; `CHANNEL_QUERY_BUILDERS: Record<Exclude<Channel, Channel.LINKEDIN_POSTS>, ChannelQueryBuilder>`), `queries/builders/recipe.ts` (`toRecipe` throws `Post recipes are built by postRecipes` for `LINKEDIN_POSTS`)
- Modify: `ingest/normalize/linkedin.ts` (delete `mapLinkedinPost`), `ingest/normalize/normalize.ts` (mappers: `Partial<Record<Channel, Mapper>>`; a channel without a mapper returns `{ invalid: 'normalize: <channel> is not normalized' }`)
- Modify: `ingest/repositories/raw.repository.ts`: `SaveItemResult.job: LinkOutcome | null`; `saveItem` skips `linkJobSafely` when `input.kind === 'post'`
- Modify: `ingest/services/batch-item-writer.service.ts` (a `null` job counts neither normalized nor invalid)
- Modify: `ingest/services/renormalize.service.ts` (`PASSES` leaves out `Channel.LINKEDIN_POSTS`)
- Modify: `collectors/index.ts`, `collectors/collectors.module.ts`, `collection.service.ts` (`fetch` case for posts throws `LINKEDIN_POSTS collector arrives in a later task` until Task 7), `collect/config.ts` (posts `run` temporarily `{ actor: 'harvestapi/linkedin-post-search', maxRunChargeUsd: 0 }`)
- Fix every spec that used the deleted pieces (`grep -rn "LinkedinPosts\|mapLinkedinPost\|linkedin_posts.builder" apps/xjobs/src`)

**Interfaces:**

- Produces: `SaveItemResult = { newItem: boolean; newVersion: boolean; job: LinkOutcome | null }`.

- [ ] **Step 1: Failing tests:**
  - `batch.service.spec.ts`: `stores a posts batch raw and links no job`: a `LINKEDIN_POSTS` batch with two posts reports `newItems 2, normalized 0, normalizeInvalid 0, newJobs 0` and no pending jobs.
  - `raw.postgres.spec.ts`: `saves a post without a normalized job`: after `saveItem({ kind: 'post', … })`, `raw_items` has the row with `kind 'post'` and `normalized_jobs`/`normalized_versions` have none for it.
- [ ] **Step 2:** Run `npx nx test xjobs -- batch.service raw.postgres` → FAIL.
- [ ] **Step 3:** Make the deletions and changes above.
- [ ] **Step 4:** `npx nx test xjobs` and `npx nx run-many -t lint typecheck -p xjobs` → PASS (the Postgres suites ran).
- [ ] **Step 5:** Commit `refactor(posts): remove the old post collection; store posts raw`.

### Task 3: Post search words and keyword

**Files:**

- Create: `apps/xjobs/src/modules/queries/posts/words.ts`, `keyword.ts`, `index.ts`, `words.spec.ts`, `keyword.spec.ts`

**Interfaces:**

- Produces:
  - `POST_HIRING_WORDS: Readonly<Record<'en' | 'fr', string>>`; `POST_LANGUAGES = ['en', 'fr'] as const`; `type PostLanguage`.
  - `POST_POSITION_WORDS: Readonly<Record<string, readonly string[]>>` (the table in Global Constraints; a test asserts it has every key of `POSITION_TITLES`, each with 1 or 2 words).
  - `postSpellings(technologies: readonly string[]): { technology: string; spellings: string[] }[]`: the rules in Global Constraints, in the given (rank) order.
  - `interface PostSearchWords { hiringWord: string; positionWords: string[]; spellings: string[]; remote: boolean }`
  - `postKeyword(words: PostSearchWords): string`
  - `postOperators(words: Pick<PostSearchWords, 'positionWords' | 'spellings'>): number`
  - `postKeywordFits(words: PostSearchWords): boolean` (≤ 5 operators and ≤ 500 characters)
  - `POST_MAX_OPERATORS = 5`, `POST_MAX_KEYWORD_CHARS = 500`

- [ ] **Step 1: Failing tests:**
  - `merges dot spellings and adds reactjs`: `postSpellings(['nodejs','react','nextjs','nestjs'])` → spellings `['nodejs']`, `['react','reactjs']`, `['nextjs']`, `['nestjs']`.
  - `drops react native when react is searched`: `postSpellings(['react','react_native'])` has only `react`; `postSpellings(['react_native'])` keeps `react native`.
  - `keeps a leading dot`: `.net`'s spelling stays `.net`.
  - `builds the English remote keyword`: `postKeyword({ hiringWord: 'hiring', positionWords: ['fullstack','full stack'], spellings: ['typescript','react','reactjs','nodejs','nextjs'], remote: true })` === `'hiring (fullstack OR "full stack") (typescript OR react OR reactjs OR nodejs OR nextjs) remote'`.
  - `builds the French keyword without arrangement`: the same words, `hiringWord 'recrute'`, `remote: false` → `'recrute (fullstack OR "full stack") (typescript OR react OR reactjs OR nodejs OR nextjs)'`.
  - `writes a one-term group bare`: `positionWords ['devops']`, spellings `['aws']` → `'hiring devops aws remote'`.
  - `counts operators`: 2 position words + 5 spellings → 5 and fits; + 6 spellings → 6 and does not fit.
- [ ] **Step 2:** `npx nx test xjobs -- queries/posts` → FAIL.
- [ ] **Step 3:** Implement. `postKeyword` uses `keywordTerm` for each term and keeps the given order.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat(posts): post search words and keyword`.

### Task 4: Post recipes, attach and detach

**Files:**

- Create: `apps/xjobs/src/modules/queries/posts/recipes.ts`, `recipes.spec.ts`
- Modify: `queries/services/queries.service.ts`, `queries/repositories/queries.repository.ts` (+ its fake in `queries/testing/fakes.ts`)

**Interfaces:**

- Consumes: Task 3's `postSpellings`, `postKeyword`, `postKeywordFits`, `POST_*`; `topSkills` (`queries/sets/technology.ts`); `recipeHash`, `QUERY_SEARCH_RECIPE_VERSION` (`queries/builders/recipe.ts`).
- Produces:
  - `postRecipes(input: QuerySearchProfileInput): QuerySearchRecipe[]`: per language in `['en', ...input.languages]` that is a `PostLanguage` (deduped; English only when `input.locations.remote.length > 0`), the profile's `topSkills` packed greedily in rank order into groups whose `postKeywordFits`, one recipe per group, with the columns and `params` in Global Constraints.
  - `QuerySearchService.generate(profileId: string, input: QuerySearchProfileInput, options?: { posts: boolean }): Promise<QuerySearchAttachResult>`: attaches `expand(input)` plus `postRecipes(input)` when `options.posts`.
  - `QuerySearchService.attachPosts(profileId: string, input: QuerySearchProfileInput): Promise<QuerySearchAttachResult>` and `detachChannel(profileId: string, channel: Channel): Promise<number>`.
  - `QuerySearchRepository.detachChannel(profileId: string, channel: Channel): Promise<number>`: like `detach`, only links whose builder is on `channel`.

- [ ] **Step 1: Failing tests** (`recipes.spec.ts`, with the owner's profile as a fixture: fullstack; en + fr; typescript, nodejs, react, react_native, nextjs, nestjs, aws, postgresql, all importance 5, mastery 10 for the first six and 8 for aws and postgresql; remote places plus on-site and hybrid `Morocco`):
  - `gives the owner's profile four searches`: keywords, exactly:
    - `hiring (fullstack OR "full stack") (typescript OR nodejs OR react OR reactjs OR nextjs) remote`
    - `hiring (fullstack OR "full stack") (nestjs OR aws OR postgresql) remote`
    - and the same two with `recrute` and no `remote`.
      (Order follows `topSkills`; assert against what it returns for the fixture.)
  - `searches English only for remote`: the same profile with no remote places gets only the 2 French recipes; an English-only one with no remote gets `[]`.
  - `ignores languages without hiring words`: `languages ['en','es']` gives English recipes only.
  - `keeps job-board hashes`: `expand(input)` for the fixture returns the same hashes as before this task (snapshot of the hashes from `main`).
  - In `queries.service.spec.ts`: `generate attaches post recipes only with posts: true`; `detachChannel leaves other channels attached` (repository fake).
- [ ] **Step 2:** `npx nx test xjobs -- queries` → FAIL.
- [ ] **Step 3:** Implement. In the Postgres repository, `detachChannel` reads the profile's links joined to builders on `channel`, then deletes and `adjust`s each in `queryId` order inside `this.transaction`, as `detach` does.
- [ ] **Step 4:** Tests → PASS, plus a Postgres spec in `segments.postgres.spec.ts` or the queries repository's spec: `detachChannel drops only that channel's links and counts`.
- [ ] **Step 5:** Commit `feat(posts): post recipes`.

### Task 5: Post segments

**Files:**

- Modify: `apps/xjobs/src/modules/segments/services/segments.ts`, `segments.spec.ts`
- Create: `apps/xjobs/src/modules/queries/posts/merge.ts`, `merge.spec.ts`

**Interfaces:**

- Consumes: Task 3's `postKeyword`, `postKeywordFits`, `PostSearchWords`.
- Produces:
  - `postMemberWords(queries: readonly { params: Record<string, unknown> }[]): PostSearchWords`: the first member's `hiringWord` and `remote`, the union of position words in first-seen order, and the union of spellings in first-seen order.
  - `mergedPostKeyword(queries: readonly { params: Record<string, unknown> }[]): string` = `postKeyword(postMemberWords(queries))`.
  - `postSegmentKey(params: Record<string, unknown>): string` = `linkedin_posts|<language>|<position>|<remote ? 'remote' : 'any'>`.
  - In `segments.ts`: `segmentKey` returns `postSegmentKey(params)` for `LINKEDIN_POSTS`; `planSegments` cuts a posts group with `fitChunks(members, postsFit)` (no `parts`, no `size`). `fitChunks` takes the fit check as a parameter; the job board passes its current `keywordFits`, unchanged.

- [ ] **Step 1: Failing tests:**
  - `merge.spec.ts`: `merges two members' spellings`: members with spellings `['react','reactjs']` and `['react','go']` → `hiring (fullstack OR "full stack") (react OR reactjs OR go) remote`.
  - `segments.spec.ts`:
    - `groups post builders by language, position and remote`: an English fullstack, a French fullstack and an English backend builder give 3 segments.
    - `merges post builders whose words fit`: two English fullstack builders with 3 and 2 distinct spellings → 1 segment.
    - `splits a group whose merged words exceed five operators`: two English fullstack builders with 5 spellings each, no overlap → 2 segments, each keyword with at most 5 `OR`s.
    - `leaves job-board segments unchanged`: the existing job-board cases still pass unmodified.
- [ ] **Step 2:** `npx nx test xjobs -- segments queries/posts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat(posts): merge post searches into segments`.

### Task 6: Post collector and failure check

**Files:**

- Create: `apps/xjobs/src/modules/collectors/providers/linkedin-posts.collector.ts`, `linkedin-posts.collector.spec.ts`, `providers/mappers/linkedin-posts.log.ts`, `linkedin-posts.log.spec.ts`
- Modify: `collectors/types/collector.ts`, `collectors/providers/apify/apify.provider.ts` (+ spec), `collectors/index.ts`, `collectors/collectors.module.ts`

**Interfaces:**

- Consumes: Task 5's `mergedPostKeyword`.
- Produces:
  - `SegmentSearch.maxChargeUsd?: number` (the run's charge limit; required by the posts collector, which throws `SearchNotStartedError` without it).
  - `SegmentResult.incomplete?: string`: why the results may be missing some posts; set, the run is stored but no cursor moves.
  - `LinkedinPostsRunConfig extends ActorRunConfig { waitSecs: number }` replacing `maxPostsPerQuery`; `LinkedinPostsCollector.config = { actor: 'harvestapi/linkedin-post-search', maxRunChargeUsd: 1.5, waitSecs: 900 }` (`maxRunChargeUsd` is only the ceiling for `maxChargeUsd`).
  - `ApifyActorProvider.runLog(runId: string): Promise<string | null>` (null when it can't be read).
  - `postRunFailure(log: string | null): string | null`: `'run log unavailable'` for null; `'no available resource'` when the log contains `No available resource`; `'too many boolean operators'` for `Too many boolean operators`; else null.
  - `LinkedinPostsCollector.collect(segment: SegmentSearch): Promise<SegmentResult>`: one run with the input in Global Constraints and `{ maxChargeUsd: min(segment.maxChargeUsd, config.maxRunChargeUsd), waitSecs }`; every item goes to every member (as the job-board collector does), `rank` is the 1-based dataset position, `truncatedQueryIds` is always `[]`, `capped` uses `reachedChargeCap`, `incomplete` is `postRunFailure(await runLog(runId))`.

- [ ] **Step 1: Failing tests:**
  - `linkedin-posts.log.spec.ts`: the four outcomes of `postRunFailure`, using the exact log lines from the probes, e.g. `2026-11-20T06:33:25.458Z Error scraping item#1 {"sortBy":"date","page":1,"search":"hiring … remote"}: No available resource`.
  - `linkedin-posts.collector.spec.ts` (provider fake):
    - `sends one merged search over the segment window`: input equals `{ searchQueries: ['hiring (fullstack OR "full stack") (react OR reactjs) remote'], maxPosts: 0, postedLimitDate: since.toISOString(), sortBy: 'date', profileScraperMode: 'short' }`, options `{ maxChargeUsd: 0.4, waitSecs: 900 }` for `segment.maxChargeUsd 0.4`.
    - `credits every post to every member`.
    - `marks a run with no available resource incomplete`: the fake log has that line → `incomplete === 'no available resource'`, items still returned.
    - `does not start without a charge limit`: no `maxChargeUsd` → `SearchNotStartedError`, no provider call.
  - `apify.provider.spec.ts`: `runLog returns null when the log can't be read`.
- [ ] **Step 2:** `npx nx test xjobs -- collectors` → FAIL.
- [ ] **Step 3:** Implement. `runLog` uses `this.client.log(runId).get()` and catches errors to null.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat(posts): post collector with failure check`.

### Task 7: Posts collection: schedule, budget and incomplete runs

**Files:**

- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/config.ts`, `collection.service.ts`, `apps/xjobs/src/infrastructure/jobs/tests/collection.service.spec.ts`, `apps/xjobs/src/config/environment.validation.ts`, worker schedule specs that list channels (`infrastructure/worker/tests/*.spec.ts`)

**Interfaces:**

- Consumes: Task 6's collector, `SegmentSearch.maxChargeUsd`, `SegmentResult.incomplete`.
- Produces: `channelJobsConfig[LINKEDIN_POSTS]` with the schedule, window and run in Global Constraints and `enabled: true`; env `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS`.

Behaviour, in `CollectionService`:

- `settleCosts` and `dailyBudget` cover `LINKEDIN_POSTS` too (a "capped channel" check replaces the `isLinkedinJobBoard` guards in these two). `budgetSetting(LINKEDIN_POSTS)` → `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS`. The posts null-cost charge is $0.25.
- `DailyBudget` gains `get leftUsd(): number`. Before a posts run, `collectSegment` defers the segment like a reached budget when `leftUsd < 0.01`; otherwise `buildSearch` sets `maxChargeUsd = leftUsd`. A posts fetch that throws with no cost adds `maxChargeUsd` to the budget.
- `runSegment`: when `result.incomplete` is set, `advance = []`, `run.status = 'partial'`, `run.error = result.incomplete`, and the batch is stored and enqueued as usual. Posts runs are never split or rerun (`splittable` stays job-board only).
- The job-board 60-minute tick warning stays job-board only.

- [ ] **Step 1: Failing tests** in `collection.service.spec.ts` (fakes as the existing cases use):
  - `collects posts hourly every day`: `channelJobsConfig[LINKEDIN_POSTS].schedule` is `{ pattern: '0 * * * *', timezone: 'Africa/Casablanca' }`, `enabled` true, window as in Global Constraints.
  - `caps each posts run at the budget left`: budget 1.5, $1.20 already spent today → the collector receives `maxChargeUsd` 0.3 (±1e-9).
  - `skips posts segments once less than a cent is left`: $1.495 spent → no collector call, `segmentsDeferred` 1, cursors unchanged.
  - `stores an incomplete run without moving cursors`: a result with `incomplete: 'no available resource'` and 3 items → a batch with 3 items is stored and enqueued, the run is `partial` with that error, and the members' `coveredUntil` is unchanged.
  - `counts a posts run with no cost at 25 cents`: `spentMicroUsd` is called for posts with `nullCostMicroUsd` 250000.
- [ ] **Step 2:** `npx nx test xjobs -- collection.service` → FAIL.
- [ ] **Step 3:** Implement; add the env to `collectionBudgetShape` with a comment like the others.
- [ ] **Step 4:** `npx nx test xjobs` → PASS (worker schedule specs updated to expect the posts schedule when `XJOBS_RUN_SCHEDULES=1`).
- [ ] **Step 5:** Commit `feat(posts): hourly post collection under a daily budget`.

### Task 8: The switch in the engine

**Files:**

- Create: `apps/xjobs/src/modules/users/services/post-search-access.ts` (+ spec), `apps/xjobs/src/modules/users/dto/post-search.dto.ts`
- Modify: `users/repositories/profiles.repository.ts`, `users/services/profiles.service.ts` (+ spec), `users/controllers/profiles.controller.ts` (+ spec), `users/users.module.ts`, `config/environment.validation.ts`, `scripts/regenerate-query-search.ts`

**Interfaces:**

- Consumes: Task 4's `generate(…, { posts })`, `attachPosts`, `detachChannel`, `postRecipes`.
- Produces:
  - `PostSearchAccess` (injectable; reads `POST_SEARCH_USERS`): `allows(userId: string): boolean`.
  - `ProfilesRepository.setPostSearch(userId: string, profileId: string, enabled: boolean): Promise<ProfileWithSkills | null>`.
  - `ProfilesService.postSearchStatus(userId, profileId): Promise<PostSearchView>` and `setPostSearch(userId, profileId, enabled: boolean): Promise<PostSearchView>`, where `PostSearchView = { enabled: boolean; allowed: boolean; searches: number }` (`searches` = `postRecipes(toQuerySearchInput(…)).length`).
  - Routes: `GET /api/profiles/:profileId/post-search` → `PostSearchView`; `PUT /api/profiles/:profileId/post-search` with body `{ enabled: boolean }` → `PostSearchView`. 404 for another user's profile, 403 `{ code: 'POST_SEARCH_NOT_ALLOWED' }` for a PUT by a user not listed.
  - `regeneratePublished` deps gain `postsAllowed: (userId: string) => boolean`; it calls `generate(profile.id, input, { posts: profile.postSearch && postsAllowed(profile.userId) })`.

Behaviour: `setPostSearch` stores the flag; on a published profile, turning on calls `attachPosts`, turning off calls `detachChannel(profileId, LINKEDIN_POSTS)`; on a draft it only stores it. `publish` passes `{ posts: profile.postSearch && access.allows(userId) }`.

- [ ] **Step 1: Failing tests:**
  - `post-search-access.spec.ts`: `allows only listed users` (`POST_SEARCH_USERS` with two ids, spaces trimmed); `allows nobody by default`.
  - `profiles.service.spec.ts`:
    - `refuses a user who is not allow-listed` (ForbiddenException, nothing stored).
    - `attaches post builders when turned on for a published profile`, `detaches only post builders when turned off`, `only stores the flag on a draft`.
    - `publishes with post builders when the switch is on`.
    - `regenerates without post builders for a user no longer listed`.
    - `reports how many searches the profile would get` (owner fixture → 4; English-only on-site → 0).
  - `profiles.controller.spec.ts`: both routes, and a 400 for a body without a boolean `enabled`.
- [ ] **Step 2:** `npx nx test xjobs -- users` → FAIL.
- [ ] **Step 3:** Implement; add `POST_SEARCH_USERS` to the API and worker env shapes (the script uses the same environment loader).
- [ ] **Step 4:** Tests → PASS; `npx nx e2e xjobs-e2e` still passes.
- [ ] **Step 5:** Commit `feat(posts): post search switch in the engine`.

### Task 9: The switch in the web app

**Files:**

- Modify: `libs/engine-client/src/client.ts` (+ `client.spec.ts`)
- Create: `apps/web/src/components/preferences/post-search-switch.tsx` (+ spec), a server action in `apps/web/src/app/(app)/preferences/actions.ts`
- Modify: `apps/web/src/app/(app)/preferences/profiles/[profileId]/layout.tsx`

**Interfaces:**

- Consumes: Task 8's routes.
- Produces:
  - `EngineClient.postSearchStatus(profileId: string): Promise<EngineResult<PostSearchView>>` and `setPostSearch(profileId: string, enabled: boolean): Promise<EngineResult<PostSearchView>>`, with `EngineResult` gaining `{ kind: 'forbidden' }` for 403. Same validation, headers, timeout and logging as `publishProfile`.
  - `setPostSearchAction(profileId: string, enabled: boolean): Promise<'saved' | 'forbidden' | 'failed'>`.
  - `<PostSearchSwitch profileId initial={PostSearchView} />`: `components/ui/switch` with the copy in Global Constraints; shows the no-searches line when `searches === 0`; optimistic toggle that reverts and shows an error toast (`sonner`) on failure.

Behaviour: the layout calls `postSearchStatus`; it renders the switch only when the result is `ok` and `allowed`. Any other result renders nothing.

- [ ] **Step 1: Failing tests:**
  - `client.spec.ts`: `sends GET …/api/profiles/{id}/post-search`, `sends PUT with {"enabled":true}`, `maps 403 to forbidden`.
  - `post-search-switch.spec.tsx`: `shows the label and description`, `shows the no-searches line when searches is 0`, `reverts when the action fails`.
- [ ] **Step 2:** `npx nx test engine-client web` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests → PASS; `npx nx run-many -t lint typecheck build -p web engine-client` → PASS.
- [ ] **Step 5:** Commit `feat(web): post search switch`.

### Task 10: Docs and final check

**Files:**

- Modify: `.env.example`, `deploy/engine/.env.example`, `deploy/engine/README.md` (a "LinkedIn posts" section: the budget env, `POST_SEARCH_USERS`, raise the Apify limit first, what a `partial` posts run means), `CLAUDE.md` (the `worker-linkedin-posts` line: hourly, every day; needs a profile with post search on), `docs/roadmap/phase-4-social-posts/01-collect.md` and the phase README (status: built, spec link)

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** `npx nx run-many -t lint test build typecheck` → PASS; the Postgres suites and db-tests ran.
- [ ] **Step 3:** Commit `docs(posts): post collection settings and rollout`; push `git push -u origin feat/posts-collect`; open the PR to `main` with `gh pr create`. In the body, list the spec's "Rollout check on dev" steps, plus: set `POST_SEARCH_USERS` to the owner's user id and raise the Apify limit before turning the switch on.
