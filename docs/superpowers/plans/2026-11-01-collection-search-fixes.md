# Collection search fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LinkedIn job board searches name the right place, run once per distinct URL and record LinkedIn's match totals; Google board discovery stops hitting page caps; company profiles and keyword/seniority changes are adopted only after measurement.

**Architecture:** Pure query and segment functions change (`modules/queries`, `modules/segments`); the LinkedIn collector dedupes start URLs and reads the run's `SEARCH_TOTALS` record through the Apify provider; segment runs store it. A human-run probe script measures before the measured changes (Tasks 6–8) are made. Scripts open their dependencies by hand, since `tsx` emits no decorator metadata.

**Tech Stack:** NestJS, TypeScript strict (nodenext), Prisma Next contract, apify-client, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-01-collection-search-fixes-design.md`

## Global Constraints

- No test calls Apify, LinkedIn or Google. Paid runs happen only in the human-run probe and in the scheduled workers.
- Batch file format stays version 1.
- `QUERY_SEARCH_RECIPE_VERSION` goes 4 → 5 in Task 2, and only once in this plan (Tasks 2 and 7 share it if Task 7 lands before release; otherwise Task 7 bumps to 6).
- Google `maxPagesPerQuery`: 10 for Ashby and Greenhouse.
- Adoption rule for measured changes (Tasks 7, 8): variant total > current total, and ≥ 16 of a 20-job sample of the extra results are relevant.
- Unit tests: `npx vitest run --config apps/xjobs/vitest.config.mts <paths>`; CI: `npx nx run-many -t lint test build typecheck`.

## Review Focus

1. A country code `Intl.DisplayNames` does not know (e.g. `XK`, a typo) must fall back to the code, never `undefined` in the URL (test in Task 2).
2. Two builders with the same URL in one segment must both get every item and both be marked truncated when the URL is (test in Task 3).
3. A run whose key-value store has no `SEARCH_TOTALS` record (LinkedIn did not expose it) must still succeed and store `null` (test in Task 4).
4. Changing the LinkedIn segment key must not reset cursors: builders keep `coveredUntil`, so the first run after the change searches only the uncovered window (test in Task 3).
5. A `geoId` present in params must win over location text in the segment key and in the URL, so a verified region never splits into two segments (test in Task 3).

---

### Task 1: Scripts build their services by hand (`db:regenerate` works)

**Files:**

- Modify: `apps/xjobs/src/scripts/regenerate-query-search.ts`
- Create: `apps/xjobs/src/modules/users/services/regenerate.ts`
- Test: `apps/xjobs/src/modules/users/services/regenerate.spec.ts`

**Interfaces:**

- Produces: `regeneratePublished(deps: { profiles: Pick<ProfilesRepository, 'listPublished'>; querySearch: Pick<QuerySearchService, 'detach' | 'generate' | 'retireOutdated'> }): Promise<{ profiles: number; retired: number }>`. `ProfilesService.regeneratePublished()` delegates to it.

- [ ] **Step 1: Failing test** `regenerates every published profile, then retires outdated builders`: with fakes, two published profiles → `detach` and `generate` called once each in order, `retireOutdated` once after both; returns `{ profiles: 2, retired: <fake value> }`.
- [ ] **Step 2: Run** `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/users/services/regenerate.spec.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `regenerate.ts`; `ProfilesService.regeneratePublished` calls it with its own deps. The script follows `scripts/renormalize-jobs.ts`: `loadDatabaseEnvironment()`, `createDatabaseClient`, then `new PrismaProfilesRepository({ db } as DatabaseService)` and `new QuerySearchService(new PrismaQuerySearchRepository({ db } as DatabaseService))`. Header comment says why (tsx, no decorator metadata).
- [ ] **Step 4: Run** the test — PASS. Then run the script against the disposable test DB: `XJOBS_SKIP_ENV_FILES=1 DATABASE_URL=postgresql://postgres:test@127.0.0.1:55432/ingest_test pnpm --filter @xjobs/xjobs db:regenerate` — expect `Regenerated 0 published profiles; retired 0 outdated builders`.
- [ ] **Step 5: Commit** `fix(scripts): db:regenerate builds its services without Nest injection`

### Task 2: LinkedIn place-bound locations name the country

**Files:**

- Modify: `apps/xjobs/src/modules/queries/channels/linkedin_board.builder.ts`, `apps/xjobs/src/modules/queries/channels/linkedin_geo.ts`, `apps/xjobs/src/modules/queries/builders/recipe.ts` (version 5)
- Test: `apps/xjobs/src/modules/queries/channels/channels.spec.ts`

**Interfaces:**

- Produces (`linkedin_geo.ts`): `countryName(iso: string): string` (English name via `Intl.DisplayNames(['en'], { type: 'region' })`, the code itself when unknown); `LINKEDIN_CITY_GEO_IDS: Record<string, string>` keyed `"<ISO>|<City>"` (empty until the human fills it); `linkedinPlace(country: string, city: string | null): { location: string; geoId: string | null }`.
- `LinkedinJobBoardBuilder.build` uses `linkedinPlace` for onsite/hybrid: `location = "<City>, <Country name>"` (or the country name), `geoId` when the table has one.

- [ ] **Step 1: Failing tests:** `Casablanca` + `MA` onsite → `params.location === 'Casablanca, Morocco'`, no `geoId`; country only → `'Morocco'`; `countryName('XK')` and `countryName('ZZ')` return a string with no `undefined` (Review Focus 1); with `LINKEDIN_CITY_GEO_IDS['MA|Casablanca'] = '123'` stubbed → `params.geoId === '123'`; remote unchanged (`Worldwide`, `EMEA`); `QUERY_SEARCH_RECIPE_VERSION === 5`.
- [ ] **Step 2: Run** `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/queries` — expect FAIL.
- [ ] **Step 3: Implement.** Google builders keep `locationText`/`countryCode` unchanged.
- [ ] **Step 4: Run** — PASS, including existing recipe hash tests updated for version 5.
- [ ] **Step 5: Commit** `fix(queries): LinkedIn city searches name the country, not its ISO code`
- [ ] **Step 6 (human):** after merge, `pnpm --filter @xjobs/xjobs db:regenerate` on the dev database.

### Task 3: One LinkedIn search per distinct URL

**Files:**

- Modify: `apps/xjobs/src/modules/segments/services/segments.ts`, `apps/xjobs/src/modules/collectors/providers/linkedin-job-board.collector.ts`
- Test: `apps/xjobs/src/modules/segments/services/segments.spec.ts`, `apps/xjobs/src/modules/collectors/providers/segment-collect.spec.ts`

**Interfaces:**

- `placeOf(builder)` for `LINKEDIN_JOB_BOARD` returns `search:<params.geoId ?? params.location>`; other channels unchanged.
- `LinkedinJobBoardCollector.collect` sends each distinct canonical URL once in `startUrls`; `attribute` (already fan-out) gives every builder with that URL the same items; `truncatedQueryIds` lists every builder whose URL is truncated.

- [ ] **Step 1: Failing tests:**
  - segments: an EMEA-region builder and a MENA-region builder, both `params.location: 'EMEA'`, same domain/type → one segment; builders with `geoId: '91000007'` and different location text → one segment (Review Focus 5); a Google-channel builder's key unchanged.
  - collector (fake `ApifyActorProvider`): two builders with the same keyword+params → `startUrls` has 1 entry; the fake returns 3 items echoing that URL → both builders get 3 items; with `maxRowsPerUrl` reached both are in `truncatedQueryIds` (Review Focus 2).
  - window: builders keep their `coveredUntil` when regrouped → `segmentWindow` of the merged segment starts at the oldest member cursor minus overlap, not the initial look-back (Review Focus 4).
- [ ] **Step 2: Run** `npx vitest run --config apps/xjobs/vitest.config.mts src/modules/segments src/modules/collectors` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `fix(collect): one LinkedIn search per distinct URL`

### Task 4: Store LinkedIn's match totals per run

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/providers/apify/apify.provider.ts` (`run` also returns `keyValueStoreId`; new `record(storeId: string, key: string): Promise<unknown | null>`, null for a missing record), `apps/xjobs/src/modules/collectors/types/collector.ts` (`SegmentResult.searchTotals: unknown | null`), `linkedin-job-board.collector.ts`, `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts`, `apps/xjobs/src/database/contract.prisma` (`SearchSegmentRun.searchTotals Jsonb?`, migration planned with `--from <latest migration dir>`), `apps/xjobs/src/modules/segments/repositories/segments.repository.ts`
- Test: `apify.provider.spec.ts`, `segment-collect.spec.ts`, `apps/xjobs/src/infrastructure/jobs/tests/collection.service.spec.ts`

**Interfaces:**

- Consumes: Task 3's collector.
- Produces: segment runs carry `searchTotals` (the record untouched); other channels return `null`.

- [ ] **Step 1: Failing tests:** provider `record` returns the value and `null` on a 404; collector reads `SEARCH_TOTALS` from the run's store into `searchTotals`; missing record → run succeeds with `searchTotals: null` (Review Focus 3); collection service passes it to `recordCollectedRun`.
- [ ] **Step 2: Run** the three spec files — FAIL.
- [ ] **Step 3: Implement**, plan the migration (`pnpm db:migration:plan --from <latest migration dir> --name segment_run_search_totals`, creates one nullable column only), apply to `ingest_test`.
- [ ] **Step 4: Run** the specs and the Postgres suite — PASS.
- [ ] **Step 5: Commit** `feat(collect): store LinkedIn search totals with each segment run`

### Task 5: Google board discovery reads 10 pages

**Files:** Modify `apps/xjobs/src/infrastructure/jobs/steps/collect/config.ts`; Test: `apps/xjobs/src/infrastructure/jobs/tests/collection.service.spec.ts` (or the existing config spec).

- [ ] **Step 1: Failing test** `board discovery reads up to 10 Google pages`: `channelJobsConfig[ASHBY].run.maxPagesPerQuery === 10` and the same for `GREEN_HOUSE`.
- [ ] **Step 2: Run** — FAIL. **Step 3:** change both to 10 with a comment (10 results per page since Sept 2025). **Step 4:** PASS. **Step 5: Commit** `fix(collect): read 10 Google pages per board query`

### Task 6: Probe script, then the human measurement checkpoint

**Files:** Create `apps/xjobs/src/scripts/probe-linkedin-search.ts`; Modify `apps/xjobs/package.json` (`"apify:probe-linkedin": "tsx --tsconfig tsconfig.app.json src/scripts/probe-linkedin-search.ts"`).

**Interfaces:** `pnpm apify:probe-linkedin -- --url <url> [--url <url>…] [--rows 5] [--company-profile]` — one actor run (`maxRowsPerUrl: rows`, `companyProfile` as flagged, `maxTotalChargeUsd: 0.05`), prints JSON `{ costUsd, searchTotals, sampleItemKeys, sampleCompany }`. Reads only `APIFY_TOKEN` (env); builds `ApifyClient` directly.

- [ ] **Step 1:** Implement (no test: a paid, human-run script). Typecheck passes.
- [ ] **Step 2: Commit** `feat(scripts): probe a LinkedIn job search through the actor`
- [ ] **Step 3 (human, ~$0.05):** run it with (a) the current Casablanca URL and the Task 2 URL; (b) the current Worldwide remote URL; (c) the Task 7 variant URL; (d) the Task 8 `f_E=3,4` URL — all with `--rows 5 --company-profile`. Paste the output.
- [ ] **Step 4 (human, in a browser):** for each region in `linkedin_geo.ts` and for `Casablanca, Morocco`, pick the place in LinkedIn's job search and read `geoId` from the URL. Paste the list.
- [ ] **Step 5 (executor):** with the pasted output: fill `geoId`s (`linkedin_geo.ts`, `LINKEDIN_CITY_GEO_IDS`); implement `searchTotalsByUrl(record: unknown): Map<string, number>` for the observed shape and write each builder's `total` into `perQuery` (test with the pasted record as fixture); record the measurements for Tasks 7–9 in the spec. Commit `feat(collect): per-query LinkedIn totals and verified geoIds`.

### Task 7: Keyword variants (only if Task 6 measurements pass the adoption rule)

**Files:** Modify `apps/xjobs/src/modules/queries/builders/keywords.ts` (a LinkedIn-only `LINKEDIN_TITLE_VARIANTS` and `LINKEDIN_TECHNOLOGY_VARIANTS`), `linkedin_board.builder.ts`; Test: `channels.spec.ts`.

Candidate variants measured in Task 6: backend titles add `"back end engineer"`, `"back-end engineer"`, `"back end developer"`, `"node.js developer"` (for node.js sets); technologies ORed as `("node.js" OR nodejs)`, `(golang OR "go developer")`. Google keeps `TECHNOLOGY_TERMS`.

- [ ] **Step 1: Failing test:** the backend + node.js builder's keyword equals the adopted string exactly (copied from the measurement record).
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS); recipe version per Global Constraints.
- [ ] **Step 5: Commit** `feat(queries): LinkedIn title and technology variants`. Skip the task, with a note in the spec, if the rule fails.

### Task 8: Seniority filter widening (only if Task 6 measurements pass the adoption rule)

**Files:** `linkedin_board.builder.ts` (`EXPERIENCE_LEVELS`: senior/staff/lead/principal → `'3,4'`); Test: `channels.spec.ts`.

- [ ] **Step 1: Failing test:** senior combination → `params.experienceLevel === '3,4'` and the URL has `f_E=3%2C4`. **Steps 2–5** as Task 7. Skip with a note if the rule fails.

### Task 9: Company profiles on LinkedIn jobs

**Files:** `config.ts` (a `companyProfile: true` run option, typed in `LinkedinJobBoardRunConfig`), `linkedin-job-board.collector.ts`, `apps/xjobs/src/modules/ingest/config/channels.ts` (volatile company fields from the Task 6 sample: counts such as followers and employee counts, signed logo URLs); Test: `segment-collect.spec.ts`, `utils/content-hash.spec.ts`.

- [ ] **Step 1: Failing tests:** the collector sends `companyProfile: true` when configured; two payloads differing only in the volatile company fields hash equal; a changed company website hashes differently.
- [ ] **Steps 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(collect): LinkedIn jobs carry their company profile`. Ingest normalizer is unchanged; using the company facts is a later design.
