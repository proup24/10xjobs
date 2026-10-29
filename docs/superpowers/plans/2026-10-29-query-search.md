# Query Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publishing a profile generates every deterministic, deduplicated search recipe (query search builder) it needs, per channel, in a new `query_search` module (folder `query-search/`).

**Architecture:** One contract change and migration: `Channel` and `ProfileState` enums, `profiles.state`/`publishedAt`, `profile_skills.importance`, and a `query_search_builder` table. A new `query_search` module (folder `query-search/`) holds pure keyword and builder code (`builders/`), a service that expands a plain profile input into recipes and inserts the missing ones, and a read-only list endpoint. `UsersModule` imports `QuerySearchModule`. `ProfilesService.publish` calls `QuerySearchService.generate`, then sets the state.

**Tech Stack:** NestJS 11, Prisma 8 (`@prisma/orm-postgres` rc.21), class-validator, Vitest, `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-10-29-query-search-design.md`

## Global Constraints

- Every table has `id Uuid @id @onCreate(uuid(7))`, `+Timestamps`, `workspaceId` → `workspaces` with `onDelete: Cascade`. Every repository read and write filters by `workspaceId`.
- `Channel` values, verbatim: `LINKEDIN_JOB_BOARD`, `LINKEDIN_POSTS`, `GREEN_HOUSE`, `ASHBY`. `ProfileState`: `draft`, `published`. Both are `@@type("pg/text@1")` enums, mirrored in `src/common/enums/` and added to `enums.spec.ts`.
- `importance` is 0–10 (`@@check`), default 5. `0` excludes a technology from searches.
- `QUERY_SEARCH_RECIPE_VERSION = 1`, `QUERY_SEARCH_TOP_TECHNOLOGIES = 3`.
- Hash: hex SHA-256 of `JSON.stringify` of an object built in exactly this key order: `version, channel, locationRegion, country, city, experience, technologies, type, keywords, params`. `params` keys are sorted recursively before stringifying. `workspaceId` is not hashed. Unique key `(workspaceId, hash)`.
- Query search builders are never updated or deleted by this code.
- Never edit `contract.json` / `contract.d.ts` by hand. Re-emit with `cd apps/xjobs && npx prisma contract emit`. Before writing queries or the migration, read the Prisma 8 references under `node_modules/.pnpm/@prisma+orm-postgres@8.0.0-rc.21*/node_modules/@prisma/orm-postgres/skills/prisma-8/references/` (`contract.md`, `queries.md`, `queries-postgres.md`, `migrations.md`).
- Do not read or write `.env*` (except `.env.example`) or `private/`. Do not `git push`.

## Review Focus

1. **Duplicate technology across domains.** A stack with `typescript` under backend (importance 9) and frontend (importance 4) counts `typescript` once, at 9, and never yields `[typescript, typescript]`. Covered in Task 3.
2. **Concurrent publish race.** If the insert of a hash throws a unique violation (`sqlState 23505`), it counts as `existing`, not a 500. Covered in Task 5.
3. **Unstated mixed with real values.** `arrangements: [remote, unstated]` expands only `remote`. `[unstated]` alone expands `unstated`, and its params carry no work-type filter. `seniority: unstated` adds no level word. Covered in Tasks 4 and 5.
4. **Remote vs on-site location.** `remote` rows have `country = null, city = null`. `onsite`/`hybrid` rows carry the profile's country and city (city `null` when unset), so two profiles that differ only in city produce different on-site hashes but the same remote hashes. Covered in Task 5.
5. **Publish when the profile is missing, or with an empty stack.** Publishing a user without a profile is a 404 and inserts nothing. A profile whose skills all have importance 0 still publishes, with one empty-set row per combination. Covered in Tasks 3 and 8.

---

### Task 1: Contract, migration and enums

**Files:**

- Modify: `apps/xjobs/src/database/contract.prisma`, `apps/xjobs/src/database/models.ts`, `apps/xjobs/src/database/index.ts`
- Regenerate: `apps/xjobs/src/database/contract.json`, `contract.d.ts`
- Create: `apps/xjobs/src/database/migrations/app/<timestamp>_query_search/` (planned by the CLI)
- Create: `apps/xjobs/src/common/enums/channel.enum.ts`, `profile-state.enum.ts`
- Modify: `apps/xjobs/src/common/enums/index.ts`, `enums.spec.ts`

**Interfaces:**

- Produces: TS enums `Channel` and `ProfileState` (same style as `region.enum.ts`, with a one-line doc comment), exported from `src/common/enums`.
- Produces: `QuerySearchBuilderRow` type in `models.ts` (`Row<Models.public_QuerySearchBuilder>`), exported from `src/database`. `ProfileRow` gains `state` and `publishedAt`. `ProfileSkillRow` gains `importance`.
- Produces: ORM collection `db.orm.public.QuerySearchBuilder`.

- [ ] **Step 1: Extend the enum-drift test.** Add `['Channel', Channel]` and `['ProfileState', ProfileState]` to the `it.each` table in `enums.spec.ts`. Run `npx nx test xjobs`. Expected: FAIL (imports missing).
- [ ] **Step 2: Contract.** Add the enums `Channel` and `ProfileState`. On `Profile` add `state ProfileState @default(draft)` and `publishedAt TimestamptzJsDate(3)?`. On `ProfileSkill` add `importance Int @default(5)` and `@@check(expression: sql\`importance BETWEEN 0 AND 10\`, name: "profile_skills_importance_range")`. Add `model QuerySearchBuilder` (`@@map("query_search_builder")`) with `workspaceId`+ relation,`channel Channel`, `locationRegion Region`, `country String?`, `city String?`, `experience Seniority`, `technologies Technology[]`, `type Arrangement`, `keywords String[]`, `version Int`, `params`as jsonb (see`contract.md`for the jsonb scalar),`hash String`, `+Timestamps`, `@@unique([workspaceId, hash])`, `@@index([workspaceId, channel])`, and a back-relation on `Workspace`. Add a one-line comment above the model in the style of the others: `// A shared, immutable search recipe for one channel. Deduplicated by hash.`
- [ ] **Step 3: Emit.** Run `cd apps/xjobs && npx prisma contract emit`. Expected: exit 0, and `contract.d.ts` mentions `public_QuerySearchBuilder` and `ProfileState`.
- [ ] **Step 4: Add the TS enums** and `QuerySearchBuilderRow`. Run `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Plan the migration.** Run `cd apps/xjobs && npx prisma migration plan --name query search builders`. Expected: a new directory under `migrations/app/` whose ops add the two columns on `profiles` (existing rows get `draft`), `importance` with default 5 and its check on `profile_skills`, and create `query_search_builder` with its unique and index.
- [ ] **Step 6: Apply locally, if a database is reachable.** Run `cd apps/xjobs && npx prisma db migrate && npx prisma db verify`. Expected: both exit 0. If no database is running, say so in the handoff and continue.
- [ ] **Step 7: Typecheck and commit.** Run `npx nx run xjobs:typecheck`. Expected: PASS. Commit `feat(db): add query_search_builder, profile state and skill importance to the contract`.

### Task 2: Keyword mapping

**Files:**

- Create: `apps/xjobs/src/modules/query-search/builders/keywords.ts`, `keywords.spec.ts`

**Interfaces:**

- Produces: `POSITION_TITLES: Record<Position, readonly string[]>` (1–3 lowercase phrases, first is the canonical title), `SENIORITY_WORDS: Record<Seniority, string | null>` (`unstated` → `null`), `ARRANGEMENT_WORDS: Record<Arrangement, string | null>` (`remote`, `hybrid`, `on-site`, `unstated` → `null`), `TECHNOLOGY_TERMS: Record<Technology, string>`.

- [ ] **Step 1: Write the tests:**
  - every `Object.values(Position)` has a non-empty entry in `POSITION_TITLES`, and every phrase equals its lowercased, trimmed form;
  - `POSITION_TITLES.backend_engineer` contains `'backend engineer'`, and `POSITION_TITLES.site_reliability_engineer` contains `'sre'`;
  - every `Object.values(Technology)` has a non-empty term; `TECHNOLOGY_TERMS.nodejs === 'node.js'`, `.csharp === 'c#'`, `.react_native === 'react native'`, `.github_actions === 'github actions'`;
  - `SENIORITY_WORDS.unstated === null`, `SENIORITY_WORDS.senior === 'senior'`, `ARRANGEMENT_WORDS.onsite === 'on-site'`, `ARRANGEMENT_WORDS.unstated === null`.
- [ ] **Step 2: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 3: Implement `keywords.ts`.** Typing the records as `Record<Enum, …>` makes a missing entry a compile error as well.
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(query-search): add the enum keyword mapping`.

### Task 3: Technology sets

**Files:**

- Create: `apps/xjobs/src/modules/query-search/builders/technology-sets.ts`, `technology-sets.spec.ts`
- Create: `apps/xjobs/src/modules/query-search/types/query-search.types.ts`, `types/index.ts`

**Interfaces:**

- Produces, in `query-search.types.ts`:
  - `RankedSkill = { technology: Technology; importance: number; preference: number; mastery: number }`
  - `QuerySearchProfileInput = { positions: Position[]; regions: Region[]; arrangements: Arrangement[]; seniority: Seniority; country: string; city: string | null; skills: RankedSkill[] }`
  - `QuerySearchCombination = { channel: Channel; position: Position; locationRegion: Region; country: string | null; city: string | null; experience: Seniority; type: Arrangement; technologies: Technology[] }`
  - `ChannelQuery = { keywords: string[]; params: Record<string, unknown> }`
  - `QuerySearchRecipe = QuerySearchCombination & ChannelQuery & { version: number; hash: string }`. `position` is used to build keywords and is not stored as a column.
- Produces, in `technology-sets.ts`: `QUERY_SEARCH_TOP_TECHNOLOGIES = 3`, `topTechnologies(skills: RankedSkill[]): Technology[]`, `technologySets(skills: RankedSkill[]): Technology[][]`.

`topTechnologies`: drop importance 0, keep each technology once with its highest-ranked entry, sort by importance desc, preference desc, mastery desc, technology name asc, take 3. `technologySets` for top `[T1, T2, T3]` returns `[[T1], [T2], [T3], [T1, T2], [T1, T2, T3]]`. For 2 it returns `[[T1], [T2], [T1, T2]]`, for 1 `[[T1]]`, for 0 `[[]]`.

- [ ] **Step 1: Write the tests:**
  - `topTechnologies` orders `[go imp 5 pref 9, rust imp 8 pref 1, nestjs imp 8 pref 3]` as `['nestjs', 'rust', 'go']`;
  - full ties break by name: `[{rust,5,5,5},{go,5,5,5}]` → `['go','rust']`;
  - importance 0 is dropped; a technology under two domains counts once, at its highest importance (Review Focus 1);
  - only the top 3 are kept out of 5;
  - `technologySets` returns exactly 5, 3, 1 and `[[]]` sets for 3, 2, 1 and 0 qualifying skills, in the order above.
- [ ] **Step 2: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(query-search): rank technologies into search sets`.

### Task 4: Channel builders and recipe hash

**Files:**

- Create in `apps/xjobs/src/modules/query-search/builders/`: `channel-query.builder.ts`, `linkedin-job-board.builder.ts`, `linkedin-posts.builder.ts`, `job-board-filter.builder.ts` (Greenhouse and Ashby), `index.ts` (registry), `recipe.ts`, and a spec per file (`builders.spec.ts` for the three builders, `recipe.spec.ts`)

**Interfaces:**

- Consumes: Task 2 mapping, Task 3 types.
- Produces:
  - `interface ChannelQueryBuilder { readonly channel: Channel; build(combination: QuerySearchCombination): ChannelQuery }`
  - `CHANNEL_QUERY_BUILDERS: Record<Channel, ChannelQueryBuilder>`, with `GREEN_HOUSE` and `ASHBY` both mapped to `JobBoardFilterBuilder` instances constructed with their channel.
  - `QUERY_SEARCH_RECIPE_VERSION = 1`, `recipeHash(recipe: Omit<QuerySearchRecipe, 'hash' | 'position'>): string`, `toRecipe(combination: QuerySearchCombination): QuerySearchRecipe` (runs the channel's builder, lowercases and sorts keywords, then hashes).

Keyword phrase for a combination = `[seniorityWord, titlePhrase, ...technologyTerms]`, joined by spaces, with nulls skipped, and one phrase per title phrase. LinkedIn posts prefix `hiring` and append the arrangement word when it isn't null. Params per builder (key names are the builder's choice, see the spec's _Left to the builder_):

- `LINKEDIN_JOB_BOARD`: an experience-level code from seniority (omitted for `unstated`), a work-type code from the arrangement (omitted for `unstated`), and a location string: the region for `remote` and `unstated`, otherwise `city, country` or `country`.
- `LINKEDIN_POSTS`: the same location string.
- `GREEN_HOUSE` / `ASHBY`: `locationTerms: string[]` (region name for remote, country and city otherwise) and `remote: boolean | null` (`null` for `unstated`).

- [ ] **Step 1: Write the builder tests** (`builders.spec.ts`), with a base combination of `backend_engineer`, `EMEA`, `senior`, `remote`, `[nestjs, typescript]`:
  - job board keywords include `'senior backend engineer nestjs typescript'`;
  - posts keywords include `'hiring senior backend engineer nestjs typescript remote'`;
  - with `seniority: unstated` no keyword starts with a space or contains `'unstated'`, and the job board params have no experience-level key;
  - with `type: unstated` the job board params have no work-type key and filter `remote` is `null`;
  - with `type: onsite, country: 'MA', city: 'Casablanca'` the job board location is `'Casablanca, MA'` and the filter `locationTerms` contain `'MA'` and `'Casablanca'`;
  - every `Channel` has an entry in `CHANNEL_QUERY_BUILDERS` whose `.channel` equals its key.
- [ ] **Step 2: Write the recipe tests** (`recipe.spec.ts`):
  - `toRecipe(c).hash === toRecipe(structuredClone(c)).hash`, and the hash matches `/^[0-9a-f]{64}$/`;
  - changing any one of channel, region, country, city, experience, type, or the order of technologies changes the hash;
  - `recipeHash` gives the same result for params `{a:1,b:{d:1,c:2}}` and `{b:{c:2,d:1},a:1}`;
  - `toRecipe(c).version === 1` and its keywords are sorted.
- [ ] **Step 3: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 4: Implement** the builders, the registry and `recipe.ts` (`createHash('sha256')` from `node:crypto`).
- [ ] **Step 5: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(query-search): build per-channel queries and hash recipes`.

### Task 5: Query search repository and generation service

**Files:**

- Create: `apps/xjobs/src/modules/query-search/repositories/query-search.repository.ts`, `services/query-search.service.ts`, `services/query-search.service.spec.ts`, `testing/fakes.ts`

**Interfaces:**

- Consumes: `QuerySearchBuilderRow`, `isUniqueViolation` from `src/database`; Task 3 and 4 exports.
- Produces:
  - `abstract class QuerySearchRepository { findHashes(workspaceId: string, hashes: string[]): Promise<Set<string>>; create(workspaceId: string, recipe: QuerySearchRecipe): Promise<QuerySearchBuilderRow>; list(workspaceId: string, channel?: Channel): Promise<QuerySearchBuilderRow[]> }` and `PrismaQuerySearchRepository`. `create` stores every recipe field except `position`. `list` orders by `createdAt`.
  - `FakeQuerySearchRepository` (holds `rows`, throws `{ sqlState: '23505' }` on a duplicate `(workspaceId, hash)`).
  - `QuerySearchService.expand(input: QuerySearchProfileInput): QuerySearchRecipe[]` (pure, deduplicated by hash) and `QuerySearchService.generate(workspaceId: string, input: QuerySearchProfileInput): Promise<{ created: number; existing: number }>`, plus `list(workspaceId: string, channel?: Channel): Promise<QuerySearchBuilderRow[]>`, which calls `WorkspacesService.getOrThrow(workspaceId)` first (404 for an unknown workspace). Constructor: `(query search builders: QuerySearchRepository, workspaces: WorkspacesService)`. Tests build it with `new WorkspacesService(new FakeWorkspacesRepository())` from `src/modules/workspaces/testing/fakes`, after creating a workspace.

`expand`: arrangements = input arrangements without `unstated` if any real value remains, otherwise `[unstated]`. Cross product: every `Channel` × positions × regions × arrangements × `technologySets(skills)`. `country`/`city` are set only when the arrangement is `onsite` or `hybrid`. Each combination goes through `toRecipe`. `generate`: `findHashes` for all recipe hashes, `create` the missing ones in order, and count a `create` that throws `isUniqueViolation` as `existing`. Rethrow any other error.

- [ ] **Step 1: Write the tests** (`query-search.service.spec.ts`), with a profile of positions `[backend_engineer, platform_engineer]`, regions `[EMEA, MENA]`, arrangements `[remote, onsite]`, `senior`, `MA`/`Casablanca`, skills nestjs 9, typescript 8, postgresql 7:
  - `expand` returns 160 recipes with 160 distinct hashes;
  - `generate` twice: first `{ created: 160, existing: 0 }`, then `{ created: 0, existing: 160 }`, and the fake holds 160 rows;
  - a second profile identical except one extra position `ml_engineer` gives `{ created: 80, existing: 160 }`;
  - the same profile in workspace `ws2` creates 160 (scoped per workspace);
  - `arrangements: [remote, unstated]` expands no `unstated` rows; `[unstated]` expands only `unstated`;
  - every `remote` recipe has `country === null && city === null`; every `onsite` recipe has `country === 'MA' && city === 'Casablanca'`; changing only `city` leaves every remote hash the same (Review Focus 4);
  - a fake whose `create` throws `{ sqlState: '23505' }` once yields `existing` +1 and no error (Review Focus 2); a fake whose `create` throws `new Error('boom')` makes `generate` reject with it.
- [ ] **Step 2: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 3: Implement** the repository, fake and service. `findHashes` uses one `where` with an `in` filter on `hash` (see `queries.md`).
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(query-search): expand profiles into deduplicated query search builders`.

### Task 6: Query search list endpoint and module

**Files:**

- Create: `apps/xjobs/src/modules/query-search/controllers/query-search.controller.ts`, `dto/query-search-builder.response.dto.ts`, `dto/list-query-search.query.dto.ts`, `query-search.module.ts`, `index.ts`
- Modify: `apps/xjobs/src/app/app.module.ts`, `apps/xjobs/src/swagger/contract.spec.ts` (add `QuerySearchController` to the controllers list)

**Interfaces:**

- Consumes: `QuerySearchService`, `WorkspacesService.getOrThrow` (404 for an unknown workspace).
- Produces: `QuerySearchModule` (imports `WorkspacesModule`, exports `QuerySearchService`), `index.ts` exporting `QuerySearchModule`, `QuerySearchService` and the `QuerySearchProfileInput`/`RankedSkill` types. `GET /api/workspaces/:workspaceId/query-search?channel=` → `QuerySearchBuilderRow[]`.

- [ ] **Step 1: Write the test.** In `query-search.service.spec.ts` add: `list('ws', Channel.ASHBY)` returns only Ashby rows, and `list('ws')` returns all of them. The existing swagger contract test checks the envelope on the new controller once it's registered.
- [ ] **Step 2: Run** `npx nx test xjobs`. Expected: FAIL (the contract spec can't import the controller).
- [ ] **Step 3: Implement.** The controller follows `workspaces.controller.ts`: `@ApiTags('query-search')`, class-level `@ApiErrorResponses(UNAUTHORIZED, INTERNAL_SERVER_ERROR)`, `@ApiSuccessResponse(QuerySearchBuilderResponseDto, { isArray: true })`, `@ApiErrorResponses(BAD_REQUEST, NOT_FOUND)`, `ParseUUIDPipe`. The query DTO has an optional `@IsEnum(Channel) channel`. Register `QuerySearchModule` in `AppModule`.
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(query-search): list a workspace's query search builders`.

### Task 7: Skill importance in the profile API

**Files:**

- Modify: `apps/xjobs/src/modules/users/dto/skill.dto.ts`, `types/profile.types.ts`, `services/profiles.service.ts`, `services/profiles.service.spec.ts`, `testing/fakes.ts`, `dto/profile.response.dto.ts`

**Interfaces:**

- Produces: `SkillInput` gains `importance: number`. The view's `techStack` items gain `importance`. `toProfileView` sorts by importance desc, then preference desc, then mastery desc.

- [ ] **Step 1: Write the tests** in `profiles.service.spec.ts`: an upsert without `importance` stores 5; a stack `[go imp 9 pref 1, rust imp 2 pref 9]` comes back as `['go', 'rust']`. Update the existing `skill()` helper and its assertions to include `importance`.
- [ ] **Step 2: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `SkillDto`, `importance` is optional (`@IsOptional() @IsInt() @Min(0) @Max(10)`, `@ApiPropertyOptional({ default: 5, description: 'How much this technology should drive searches; 0 never' })`). The service defaults it to 5 when it maps `techStack`. Update the `techStack` description in the response DTO to the new order.
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(profiles): rate tech stack importance`.

### Task 8: Publish and unpublish

**Files:**

- Modify: `apps/xjobs/src/modules/users/repositories/profiles.repository.ts`, `services/profiles.service.ts`, `services/profiles.service.spec.ts`, `controllers/profiles.controller.ts`, `dto/profile.response.dto.ts`, `types/profile.types.ts`, `testing/fakes.ts`, `users.module.ts`
- Create: `apps/xjobs/src/modules/users/dto/publish-profile.response.dto.ts`

**Interfaces:**

- Consumes: `QuerySearchService.generate`, `QuerySearchProfileInput` from `src/modules/query-search`.
- Produces:
  - `ProfilesRepository.setState(workspaceId: string, profileId: string, state: ProfileState, publishedAt: Date | null): Promise<ProfileWithSkills>`
  - `ProfilesService.publish(workspaceId, userId): Promise<ProfileView & { querySearches: { created: number; existing: number } }>` and `unpublish(workspaceId, userId): Promise<ProfileView>`
  - `toQuerySearchInput(profile: ProfileWithSkills): QuerySearchProfileInput` in `profiles.service.ts`
  - `POST …/profile/publish` and `POST …/profile/unpublish`, both `@HttpCode(200)`.

`ProfilesService` gains `QuerySearchService` as a constructor dependency, and `UsersModule` imports `QuerySearchModule`. `ProfileView` gains `state` and `publishedAt` (they come through from the row; add them to `ProfileResponseDto`). `PUT` does not touch `state`.

- [ ] **Step 1: Write the tests** in `profiles.service.spec.ts`, wiring a real `QuerySearchService` over `FakeQuerySearchRepository`:
  - a new profile has `state: 'draft'` and `publishedAt: null`;
  - `publish` returns `state: 'published'`, a `publishedAt` Date, and `querySearches.created > 0`; publishing again returns `created: 0`, the same `existing` count, and `state: 'published'`;
  - `unpublish` returns `state: 'draft'`, `publishedAt: null`, and the query search builder fake still holds every row;
  - `upsert` on a published profile keeps `state: 'published'`;
  - `publish` for a user without a profile throws `NotFoundException`, and the query search builder fake has 0 rows (Review Focus 5);
  - a profile whose skills all have importance 0 publishes, and every created query search builder has `technologies: []` (Review Focus 5);
  - when `generate` rejects, `publish` rejects and the profile stays `draft`.
- [ ] **Step 2: Run** `npx nx test xjobs`. Expected: FAIL.
- [ ] **Step 3: Implement** the repository method (Prisma and fake), the service methods (generate first, then `setState`), the response DTO (`PublishProfileResponseDto` extends `ProfileResponseDto` with `querySearches: { created, existing }`), and the two controller routes with `@ApiSuccessResponse` and `@ApiErrorResponses(BAD_REQUEST, NOT_FOUND)`.
- [ ] **Step 4: Run** `npx nx test xjobs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(profiles): publish profiles and generate their query search builders`.

### Task 9: Full check

- [ ] **Step 1: Run CI locally.** `npx nx run-many -t lint test build typecheck`. Expected: every target passes.
- [ ] **Step 2: Smoke test, if a database is reachable.** Start `npx nx serve xjobs`, then PUT a profile, POST `…/profile/publish` twice and GET `…/query-search?channel=ASHBY` with Basic auth. Expected: the second publish reports `created: 0`, and the list holds only Ashby rows. If no database is running, say so in the handoff.
- [ ] **Step 3: Commit** any lint fixes as `chore: lint`.
