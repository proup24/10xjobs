# Actor-Aware Search Queries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Each channel builder emits the query and params its platform understands best. Seniority moves out of the shared phrase. Titles become boolean OR. Place goes where each platform supports it. Google channels run daily over a 72-hour minimum window. Every published profile is regenerated to recipe version 4.

**Architecture:**

- **Channel builders** in `modules/queries/channels` produce the final `keyword` and `params`, built from shared pieces in `builders/channel.builder.ts`.
- **Collectors** in `modules/collectors` only add actor plumbing: Google `site:`/suffix/`countryCode`/`quickDateRange`, and LinkedIn `geoId`.
- **Job configs** in `infrastructure/jobs/config` set the schedule and window for each channel.
- **Regeneration** is a CLI over `ProfilesService`.

**Tech Stack:** NestJS 11, Prisma 8, BullMQ, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-actor-aware-queries-design.md`

## Global Constraints

- `QUERY_SEARCH_RECIPE_VERSION = 4`.
- Builders lowercase their own terms. `toRecipe` only trims. `OR` and `AND` stay uppercase.
- Seniority:
  - **LinkedIn job board:** the `f_E` param only, never a word in the keyword.
  - **Posts and Google:** the word from `SENIORITY_WORDS`, with `mid` and `unstated` adding nothing.
- LinkedIn posts queries stay within 500 characters and 5 boolean operators. Google queries stay within 32 words.
- `GLOBAL` maps to LinkedIn geoId `92000000`. Every other geoId is checked on linkedin.com before it is committed.
- Greenhouse and Ashby use the schedule `0 6 * * *` UTC and the window `{ initialHours: 72, overlapMinutes: 0, maximumHours: 168, minimumHours: 72 }`.

## Review Focus

1. **A technology term containing a symbol or space** (`c#`, `c++`, `.net`, `spring boot`, `ruby on rails`). It must be quoted so LinkedIn and Google don't split or drop it. Test it in Task 1.
2. **A position with a single title** (`devops engineer` has `devops`; `software_architect` has two). The clause must never be an empty `()` or a dangling `OR`. Test it in Task 1.
3. **A segment whose members have different `countryCode`s.** This shouldn't happen given the city key, but the collector must omit `countryCode` rather than pick one. Test it in Task 4.
4. **A builder still on version 3 after regeneration** because its profile was deleted mid-run. It must end up inactive and soft-deleted. Test it in Task 6.
5. **The posts query for the longest position title with the longest city name** must stay within the 500-character and 5-operator limits. Test it in Task 3.

---

### Task 1: Shared query pieces, recipe version 4, no lowercasing of operators

**Files:**

- `modules/queries/builders/channel.builder.ts`, `builders/keywords.ts`, `builders/recipe.ts`
- Tests: `builders/keywords.spec.ts`, `builders/recipe.spec.ts`

**Produces:**

- `titleClause(position: Position): string`, e.g. `("backend engineer" OR "backend developer" OR "backend software engineer")`, or `"x"` for one title.
- `technologyTerms(technologies: Technology[]): string`, space-joined, each term quoted when it contains whitespace or one of `#+.`.
- `seniorityWord(experience: Seniority): string | null`, which is null for `mid` and `unstated`.
- `keywordPhrase(combination)` stays, without seniority, used for logs only.

- [ ] Write the failing tests:
  - `titleClause` for backend (3 titles), devops (2) and a 1-title stub.
  - `technologyTerms([nestjs])` gives `nestjs`; `[csharp]` gives `"c#"`; `[spring]` gives `"spring boot"`; `[dotnet]` gives `".net"`.
  - `seniorityWord`: senior → `senior`; mid → null; unstated → null.
  - Recipe: version 4, and `toRecipe` keeps `OR` uppercase in the keyword.
- [ ] Run `npx vitest run src/modules/queries/builders` and expect FAIL. Implement, then run again and expect PASS.
- [ ] Commit: `feat(queries): shared boolean query pieces, recipe v4`

### Task 2: LinkedIn job board — boolean keyword, geoId for regions

**Files:**

- `modules/queries/channels/linkedin_board.builder.ts`, `channels/linkedin_geo.ts` (new)
- `modules/collectors/providers/apify/linkedin.job_search.collector.ts`
- Tests: `channels/channels.spec.ts`, `collectors/providers/segment-collect.spec.ts`

**Produces:**

- `LINKEDIN_REGION_GEO_IDS: Record<Region, string | null>`.
- Builder params `{ experienceLevel?, workType?, location? , geoId? }`. Remote uses `geoId`; on-site and hybrid use `location` (`city, country`).
- `linkedinJobSearchUrl` writes `geoId` when present.

- [ ] **Look up the geoIds.** On linkedin.com/jobs, for each region (EMEA, Europe, European Union, United Kingdom, North America, Latin America, APAC, Middle East, MENA, North Africa, Sub-Saharan Africa), pick the location and read `geoId` from the URL. Write each verified value into the table. Set `null` with a comment for any region LinkedIn doesn't offer.
- [ ] Write the failing tests:
  - Senior remote EMEA backend nestjs gives keyword `("backend engineer" OR "backend developer" OR "backend software engineer") AND nestjs` and params `{ experienceLevel: '4', workType: '2', geoId: <EMEA> }`.
  - On-site Casablanca gives `location: 'Casablanca, MA'` and no `geoId`.
  - A region whose geoId is null falls back to `location: 'Worldwide'`.
  - The URL contains `geoId=` and `keywords=` with the uppercase `OR`.
- [ ] Implement, run the queries and collectors tests, and commit: `feat(linkedin): boolean titles and geoIds for job board searches`

### Task 3: LinkedIn posts — seniority and place in the query

**Files:** `modules/queries/channels/linkedin_posts.builder.ts`; tests in `channels/channels.spec.ts`

**Produces:** keyword `hiring <titleClause> <technology>[ <seniority>][ <city lowercased> | remote]`. Params are `{}`, because the actor has no filters we use.

- [ ] Write the failing tests:
  - Senior remote: `hiring ("backend engineer" OR …) nestjs senior remote`.
  - Mid on-site Casablanca: `hiring (…) nestjs casablanca`.
  - Hybrid: the city, no "remote".
  - Limits: for every `Position` with the longest technology term and a 40-character city, the length is ≤ 500 and the count of `OR`/`AND`/`NOT` is ≤ 5.
- [ ] Implement, run the tests, and commit: `feat(linkedin): posts queries carry seniority and place`

### Task 4: Greenhouse and Ashby — Google queries, countryCode, truncation

**Files:**

- `modules/queries/channels/{greenhouse,ashbyhq}.builder.ts`, `builders/channel.builder.ts` (`jobBoardFilterQuery` replaced)
- `modules/collectors/providers/apify/google_search.collector.ts`
- Tests: `channels.spec.ts`, `segment-collect.spec.ts`

**Produces:**

- Builder keyword `<titleClause> <technology>[ <seniority>][ "<city>" | "remote"]`, with params `{ remote: boolean | null, countryCode?: string }` (lowercased ISO country, on-site and hybrid only).
- `boardQuery(keyword, config)` gives `site:<site> <keyword>[ <suffix>]`. The keyword is not re-quoted, and the `params.remote` handling moves to the builder.
- The Google run input includes `countryCode` when every member has the same one.
- `quickDateRange` is `h<n>` below 24 hours and `d<ceil(h/24)>` from 24 hours.
- Truncation: a member whose last page has `hasNextPage: true` and which returned `maxPagesPerQuery` pages.

- [ ] Write the failing tests:
  - Remote senior: `("backend engineer" OR …) nestjs senior "remote"`.
  - On-site: `… "casablanca"` with `countryCode: 'ma'`.
  - Word count ≤ 32 for every position.
  - Collector:
    - three on-site members sharing `ma` send `countryCode: 'ma'`; mixed members send none;
    - a 72-hour window gives `quickDateRange: 'd3'`;
    - three pages with `hasNextPage: true` on the last mark the member truncated;
    - the query has no `""` double quoting.
- [ ] Implement, run the tests, and commit: `feat(boards): actor-aware Google queries for Greenhouse and Ashby`

### Task 5: Minimum window and daily Google schedule

**Files:** `modules/segments/window.ts` (+ spec), `infrastructure/jobs/config/index.ts` (+ `tests/collection.job.spec.ts` config assertions)

**Produces:** `WindowConfig.minimumHours?: number`, so `since ≤ until − minimumHours`. The Greenhouse and Ashby configs use the values in Global Constraints.

- [ ] Write the failing tests:
  - A cursor 1 hour ago with `minimumHours: 72` gives `since = until − 72h`.
  - Without `minimumHours`, behaviour is unchanged.
  - The Greenhouse and Ashby configs have the daily schedule and the 72-hour window. The LinkedIn configs keep the hourly 24-hour window.
- [ ] Implement, run the tests, and commit: `feat(jobs): daily Google collection over a 72h minimum window`

### Task 6: Regenerate published profiles to recipe v4

**Files:**

- `modules/queries/{services/queries.service.ts,repositories/queries.repository.ts,testing/fakes.ts}`
- `modules/users/services/profiles.service.ts`
- `src/scripts/regenerate-query-search.ts` (new) and a `db:regenerate` script in `apps/xjobs/package.json`
- Tests: `queries.service.spec.ts`, `profiles.service.spec.ts`

**Produces:**

- `QuerySearchService.retireOutdated(): Promise<number>` soft-deletes inactive builders with `version < QUERY_SEARCH_RECIPE_VERSION` and returns the count.
- `ProfilesService.regeneratePublished(): Promise<{ profiles: number; retired: number }>`. For each published profile it runs `detach` then `generate`, and then calls `retireOutdated()`.
- The CLI boots a Nest application context with `ConfigModule` (`validateEnvironment`), `DatabaseModule` and `UsersModule`, runs it, and logs the counts.

- [ ] Write the failing tests:
  - With the fakes, a published profile attached to v3 builders ends up attached only to v4 builders, and the v3 builders are inactive and soft-deleted.
  - Running it again gives `retired: 0` and the same builders.
  - Draft profiles are untouched.
  - A v3 builder still active (shared with a profile that isn't published) is not retired.
- [ ] Implement, run the tests, and commit: `feat(queries): regenerate published profiles to the current recipe`

### Task 7: Docs and verification

- [ ] Add `pnpm --filter @xjobs/xjobs db:regenerate` to `CLAUDE.md` Commands with one line: "run once after a recipe version bump".
- [ ] Run `npx nx run-many -t lint test build typecheck` and expect it to be green.
- [ ] Commit: `docs: actor-aware queries and regeneration`

**Rollout order** (for the human): apply the migrations, deploy, run `db:regenerate` once, then start the channel workers.
