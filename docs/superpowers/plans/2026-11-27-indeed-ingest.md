# Indeed Ingest, Process and Match Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** valig's Indeed items are normalized, processed and matched like LinkedIn listings, shown with an "Indeed" label, and the Search Indeed switch opens to every user.

**Architecture:** One per-actor mapper (`indeed-job.mapper.ts`) fills the shared `NormalizedRecord`. The `INDEED` placeholders in source key, normalize and job key get real cases. `INDEED` joins `PROCESSOR_CHANNELS`, which by itself widens the prefilter, processor and matcher scope (`linkedInJobIds`, `hasLinkedInSourceSql`). Small text changes neutralize the "LinkedIn" listing wording, and five board markers join `trackingParams`.

**Tech Stack:** TypeScript (nodenext, strict), NestJS, Vitest, zod, Next.js (web).

**Spec:** [docs/superpowers/specs/2026-11-27-indeed-ingest-design.md](../specs/2026-11-27-indeed-ingest-design.md)

**Branch and PR:** work in a new worktree on `feat/indeed-ingest`, branched from `docs/indeed-ingest-spec` (it holds the spec and this plan), and open **one PR** to `main` containing the spec, the plan and the code. Run each `nx`/`vitest` command from the worktree root after `pnpm install`.

## Global Constraints

- `NORMALIZER_VERSION` = 11, with a doc line: "Version 11 maps Indeed (valig) items and drops the board markers `lever-source`, `iis`, `iisn`, `indeed-apply-token`, `postedDate` from apply-URL keys; run `db:renormalize`, then `db:recheck-skips`."
- An employer link on an Indeed host (`indeed.com` or any `*.indeed.com`) is never an `applyUrl` and never a proof key.
- The remote/hybrid tag comes from `employerAttributes` only: `DSQF7` → `'remote'`, `PAXZC` → `'hybrid'`, both → `'remote'`, else `null`. Never `'onsite'`.
- Listing wording: `"Listing: <parts>"`, `"Listing"` when no part, `"The listing says <X>"`. The stored fact-source value `'linkedin'` stays. No `MATCHER_VERSION` bump.
- `CHANNEL_LABELS.INDEED = 'Indeed'`, with no actor label.
- Indeed's switch: `available: true`.
- No prompt or matcher rule changes, and no title pre-filter.

## Review Focus

1. **Remote place text.** valig's `location.city` is `"Remote"` on remote listings. Stored as a city, the place resolver would try to find a city called Remote. Expected: `city` is null when it is `/^remote$/i`, while `location` text keeps "Remote, US" (Task 3 test `drops a "Remote" city`).
2. **An Indeed country host as `jobUrl`** (`http://ma.indeed.com/job/…`, http, country subdomain). Expected: `applyUrl` null and key `indeed-job:<jk>` (Task 3 test `keeps an Indeed-hosted jobUrl out of applyUrl`, Task 4 test `falls back to indeed-job for an Indeed-hosted link`).
3. **Inferred remote tag only** (`DSQF7` in `attributes`, not in `employerAttributes`). Expected: `workplaceType` null (Task 3 test `ignores a remote tag the employer did not set`).
4. **A `baseSalary` block with no numbers** (min and max null, `unitOfWork` null, present on every row). Expected: `salary` null, not an empty salary (Task 3 test `has no salary when baseSalary has no numbers`).
5. **A repeat row whose only change is employer ratings or image URLs.** Expected: the same content hash, so no new raw version (Task 5 test `ignores employer ratings and images in an Indeed item's hash`).

---

### Task 1: Board markers dropped from apply-URL keys

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/config/normalize.ts` (`trackingParams`)
- Modify: `apps/xjobs/src/modules/ingest/normalize/record.ts` (`NORMALIZER_VERSION` and its doc comment)
- Test: `apps/xjobs/src/modules/ingest/normalize/job-key.spec.ts`

**Interfaces:**

- Produces: `canonicalApplyUrl` drops `lever-source`, `iis`, `iisn`, `indeed-apply-token`, `postedDate`. `NORMALIZER_VERSION === 11`.

- [ ] **Step 1: Write the failing test** in the `jobKey` describe:

```ts
it('unifies one posting seen through LinkedIn and Indeed board markers', () => {
  const key = (applyUrl: string) => jobKey(Channel.LINKEDIN_JOB_BOARD, 'id:1', { ...board, applyUrl });
  const base = 'https://jobs.lever.co/acme/1234-5678';
  expect(key(`${base}?lever-source=LinkedIn`)).toBe(key(`${base}?lever-source=Indeed`));
  expect(key(`${base}?iis=Indeed&iisn=Indeed&indeed-apply-token=abc`)).toBe(key(base));
  expect(key(`https://acme.bamboohr.com/careers/25?source=indeed&postedDate=2026-11-23`)).toBe(key('https://acme.bamboohr.com/careers/25'));
});
```

(`board` is the spec file's existing LinkedIn record fixture; reuse whatever the neighbouring tests use.)

- [ ] **Step 2: Run** `npx vitest run apps/xjobs/src/modules/ingest/normalize/job-key.spec.ts`. Expected: the new test FAILS.
- [ ] **Step 3: Add** `'lever-source'`, `'iis'`, `'iisn'`, `'indeed-apply-token'`, `'postedDate'` to `trackingParams`, set `NORMALIZER_VERSION = 11` and add the doc line from Global Constraints.
- [ ] **Step 4: Run** the same spec plus `npx nx test xjobs`. Expected: all PASS. Update any test that pins `NORMALIZER_VERSION` to 10.
- [ ] **Step 5: Check for other board markers:** list the query keys of `jobUrl` across the sample items (`../../tmp/indeed-sample/*/valig/items.json` in the main checkout, read-only). Add only those whose value names a board (`indeed`, `linkedin`) and which are never the posting id. Note any additions in the commit message.
- [ ] **Step 6: Commit** `feat(ingest): drop board markers from apply URL keys`.

### Task 2: Indeed source key

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/utils/source-key.ts` (`case Channel.INDEED`)
- Test: `apps/xjobs/src/modules/ingest/utils/source-key.spec.ts`

**Interfaces:**

- Produces: `sourceKey(Channel.INDEED, payload)` → `{ key: 'jk:<key>' }` or `{ invalid: 'no Indeed job key' }`.

- [ ] **Step 1: Write failing tests** in a new `describe('Indeed')`:
  - `uses the Indeed job key`: `{ key: ' 5e5dafc2a80c214d ' }` → `{ key: 'jk:5e5dafc2a80c214d' }`.
  - `refuses an item without a job key`: `{ url: 'https://www.indeed.com/viewjob?jk=1' }` → `{ invalid: 'no Indeed job key' }`. A key of `''` gives the same.
- [ ] **Step 2: Run** `npx vitest run apps/xjobs/src/modules/ingest/utils/source-key.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with the file's existing `idText` (or `cleanText`) helper.
- [ ] **Step 4: Run** the same spec. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ingest): Indeed source key`.

### Task 3: valig mapper

**Files:**

- Create: `apps/xjobs/src/modules/ingest/normalize/mappers/indeed-job.mapper.ts`
- Create: `apps/xjobs/src/modules/ingest/utils/fixtures/indeed-valig.json`: 3 items trimmed from the sample. (1) Remote, employer-tagged `DSQF7`, Workday link with `source=Indeed`, YEAR salary. (2) Morocco on-site with no tags, an `http://ma.indeed.com/job/…` jobUrl, French `jobTypes`. (3) Hybrid `PAXZC`, HOUR salary. Keep only the fields valig returns, with descriptions shortened.
- Create: `apps/xjobs/src/modules/ingest/normalize/mappers/indeed-job.mapper.spec.ts`
- Modify: `apps/xjobs/src/modules/ingest/normalize/normalize.ts` (`[Channel.INDEED]: mapIndeedJob`)

**Interfaces:**

- Consumes: `emptyRecord`, `cleanText`, `datePart`, `htmlToPlainText`, `objectAt` (`../text`), `httpUrl` (`../linkedin`), `NormalizeContext`.
- Produces: `export function mapIndeedJob(payload: Record<string, unknown>, ctx: NormalizeContext): NormalizedRecord` and `export function isIndeedHost(url: URL): boolean` (true for `indeed.com` and `*.indeed.com`).

Field rules: the spec's mapper table, plus these settled points:

- `state` = `location.admin1Code` and `regionCode` = null. `regionCode` is LinkedIn's region code (EMEA, APAC) in `resolveListingPlace`, not a state.
- `city` is null when it is `/^remote$/i`.
- `location` text = `[city, admin1Code, countryName]` non-blank parts joined with `", "` (city kept even when "Remote"). Null when none.
- `companyUrl`, `applyUrl` and `postingUrl` go through `httpUrl` (an empty string is null). `postingUrl` is upgraded to `https:`, and when missing is built as `https://www.indeed.com/viewjob?jk=<key>`.
- `postedAt` is `datePublished` else `dateOnIndeed`, as `new Date(x).toISOString()` when valid. `publishedAt` is its `datePart`.
- The salary period map is `YEAR→YEARLY`, `MONTH→MONTHLY`, `DAY→DAILY`, `HOUR→HOURLY`. An other non-null unit passes through as is. `providedByEmployer: true`.

- [ ] **Step 1: Write failing tests**, through `normalize(Channel.INDEED, item, { scrapedAt })` so the zod check runs too:
  - `maps a remote valig item` (fixture 1). Expect `title`, `companyName`, `countryCode: 'US'`, `state`, `city`, `workplaceType: 'remote'`, `salary: { text: null, min, max, currency: 'USD', period: 'YEARLY', providedByEmployer: true }`, `postedAt` from `datePublished`, `contractType: 'Full-time'`, `experienceLevel: null`, `descriptionText` non-empty, `applyUrl` = the Workday URL, `postingUrl` = `https://www.indeed.com/viewjob?jk=…`, `closed: false`.
  - `keeps an Indeed-hosted jobUrl out of applyUrl` (fixture 2): `applyUrl: null`, `workplaceType: null`, `contractType: 'Temps plein'`, `countryCode: 'MA'`.
  - `maps the employer's hybrid tag and an hourly salary` (fixture 3): `workplaceType: 'hybrid'`, `period: 'HOURLY'`.
  - `ignores a remote tag the employer did not set`: fixture 1 with `DSQF7` moved from `employerAttributes` to only `attributes` → `workplaceType: null`.
  - `drops a "Remote" city`: `location: { city: 'Remote', countryCode: 'US', countryName: 'United States' }` → `city: null`, `location: 'Remote, United States'`.
  - `has no salary when baseSalary has no numbers`: `baseSalary: { min: null, max: null, unitOfWork: null, currencyCode: null }` → `salary: null`.
  - `falls back to dateOnIndeed and to the HTML description`: no `datePublished`, `description: { text: null, html: '<p>Build <b>APIs</b></p>' }` → `postedAt` from `dateOnIndeed`, `descriptionText: 'Build APIs'`.
  - `builds the posting URL from the job key when url is missing`.
  - `isIndeedHost`: true for `www.indeed.com`, `ma.indeed.com`, `indeed.com`; false for `notindeed.com` and `indeed.com.evil.io`.
- [ ] **Step 2: Run** `npx vitest run apps/xjobs/src/modules/ingest/normalize/mappers/indeed-job.mapper.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `mapIndeedJob` and `isIndeedHost`, and register the mapper in `normalize.ts`, replacing the throwing placeholder.
- [ ] **Step 4: Run** the spec, then the replay check: a throwaway script (not committed) runs `normalize(Channel.INDEED, …)` on every sample item in the main checkout's `tmp/indeed-sample/*/valig/items.json`. Expected: 0 invalid out of 267, and `workplaceType: 'remote'` on 136 of the 260 distinct jobs (the employer-tagged count in the spec).
- [ ] **Step 5: Salary spot-check:** open five salaried sample jobs' `url` pages (web fetch). If any shown salary is marked as an Indeed estimate, or doesn't match `baseSalary`, change `providedByEmployer` to `null` and its test. If Indeed refuses automated fetches, list the five URLs under "Owner checks" in the PR body and keep `true`.
- [ ] **Step 6: Commit** `feat(ingest): map valig Indeed items`.

### Task 4: Indeed job key and merge order

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/normalize/job-key.ts` (`case Channel.INDEED`, and the `jobKey` doc comment)
- Modify: `apps/xjobs/src/modules/ingest/normalize/merge.ts` (comment above `precedence` only; `INDEED` stays `2.5`)
- Test: `apps/xjobs/src/modules/ingest/normalize/job-key.spec.ts`, `merge.spec.ts`

**Interfaces:**

- Consumes: `mapIndeedJob` (Task 3) for fixtures. `sourceKey` gives `jk:<key>` (Task 2), and `sourceId` already strips a 3-character prefix only for `id:`.
- Produces: `jobKey(Channel.INDEED, 'jk:<key>', record)` → `applyUrlKey(record.applyUrl)` ?? `indeed-job:<key>`.

- [ ] **Step 1: Write failing tests:**
  - `joins an Indeed job to harvestapi's job for the same Workday link`: the same `applyUrl` (Indeed's copy with `source=Indeed`) gives an equal key for `LINKEDIN_JOB_BOARD` and `INDEED`, and it starts with `url:`.
  - `keys an Indeed job with a Greenhouse link by its posting`: starts with `ats:greenhouse/`.
  - `falls back to indeed-job for an Indeed-hosted link`: the record from fixture 2 → `indeed-job:<key>`.
  - `falls back to indeed-job for a link with no identifier`: `applyUrl: 'https://acme.com/careers'` → `indeed-job:<key>`.
  - In `merge.spec.ts`, `takes harvestapi's fields over Indeed's on a joined job`: `mergeSources` with one source of each channel and different titles → harvestapi's title.
- [ ] **Step 2: Run** both specs. Expected: the job-key tests FAIL (the case throws). The merge test may already pass, which is fine: it pins the order.
- [ ] **Step 3: Implement.** Make `sourceId` strip `jk:` as well as `id:`. In `merge.ts`, the comment states Indeed ranks below harvestapi and above posts, and that its place against the trial actors can't matter, because a trial actor always keys by LinkedIn id and never shares a job with Indeed.
- [ ] **Step 4: Run** both specs. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ingest): Indeed job key`.

### Task 5: Ingest, process and match Indeed batches

**Files:**

- Modify: `apps/xjobs/src/modules/ingest/config/channels.ts` (Indeed `volatileKeys`; `INGEST_WAITING_CHANNELS = []` with its doc "Collected and stored, not yet ingested: none today; a new channel can wait here until its ingest lands.")
- Modify: `apps/xjobs/src/modules/processor/config/processor.config.ts` (`PROCESSOR_CHANNELS` adds `Channel.INDEED`, doc comment names it)
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/ingest/processor.ts` (`onPending` nudges `INDEED` at listing priority)
- Modify: `apps/xjobs/src/modules/processor/repositories/processor.repository.ts`: doc comments of `linkedInJobIds` and `hasLinkedInSourceSql` say "LinkedIn job board or Indeed". The names stay.
- Docs: `apps/xjobs/src/modules/processor/README.md` (trigger and scope sections name Indeed), `apps/xjobs/src/modules/collectors/README.md` (drop "Until Indeed ingest exists… wait unprocessed"), `CLAUDE.md` (the `indeed` worker line drops "and its batches wait unprocessed until slice 04"; the `db:places` and `db:spellings` lines say "LinkedIn and Indeed" jobs, since both reports follow the processor scope; `db:archive-actor` gets "(also `valig/indeed-jobs-scraper`)" once Step 6 passes).
- Test: `apps/xjobs/src/infrastructure/jobs/tests/ingest.processor.spec.ts`, `apps/xjobs/src/modules/ingest/utils/content-hash.spec.ts`, `apps/xjobs/src/modules/processor/repositories/processor.postgres.spec.ts`

**Interfaces:**

- Consumes: Tasks 2–4 (an Indeed item ingests end to end).
- Produces: `channelIngestConfig[Channel.INDEED].volatileKeys = ['employer.ratingsCount', 'employer.ratingsValue', 'employer.logoUrl', 'employer.headerImageUrl', 'employer.ceoPhotoUrl']`.

- [ ] **Step 1: Write failing tests:**
  - `ingest.processor.spec.ts`: `sends the pending jobs of an Indeed batch to the processor`, in the shape of the trial-channel test. `processQueue.enqueue` is called with `(jobId)` and no `'post'` priority.
  - `content-hash.spec.ts`: `ignores employer ratings and images in an Indeed item's hash`. Two items differ only in `employer.ratingsCount` and `employer.logoUrl` → equal hash under Indeed's config. A different `title` → a different hash.
  - `processor.postgres.spec.ts`: `claims an Indeed-only job`, in the shape of the existing cheap-channel claim test, with `job({ channels: [Channel.INDEED] })`.
- [ ] **Step 2: Run** `npx vitest run apps/xjobs/src/infrastructure/jobs/tests/ingest.processor.spec.ts apps/xjobs/src/modules/ingest/utils/content-hash.spec.ts`. Expected: FAIL. The Postgres spec needs `PROCESSOR_TEST_DATABASE_URL` (recipe in the processor README). If none is available locally, it runs in CI.
- [ ] **Step 3: Implement** the config, nudge and scope changes listed under Files.
- [ ] **Step 4: Check repeat rows:** compare items with the same `key` across the stored 2026-11-27 18:00 and 21:00 Indeed batches (read via the local stack, or the batch files if downloaded). Any further field that differs without a job change joins `volatileKeys`, with a test line.
- [ ] **Step 5: Run** `npx nx test xjobs` and `npx nx typecheck xjobs`. Expected: PASS. A test that asserted Indeed waits (collection's `enqueueBatch` skip, `listStalePending` exclusion) is changed to assert Indeed batches are now enqueued and swept.
- [ ] **Step 6: Check `db:archive-actor` locally:** on the local stack, ingest one Indeed batch from the fixture (or run the raw Postgres spec helper), then `pnpm --filter @xjobs/xjobs db:archive-actor -- --actor valig/indeed-jobs-scraper --dry-run`. Expected: it counts the Indeed-only jobs and changes nothing. If it needs code, stop and report it instead of building it.
- [ ] **Step 7: Commit** `feat: ingest, process and match Indeed batches`.

### Task 6: Neutral listing wording

**Files:**

- Modify: `apps/xjobs/src/modules/facts/rules/combine.ts` (`listingQuote`)
- Modify: `apps/web/src/lib/matches/facts.ts` (`conflictLines` and its doc comment)
- Test: `apps/xjobs/src/modules/facts/rules/combine.spec.ts`, `apps/web/src/lib/matches/facts.spec.ts`, `apps/web/src/components/matches/match-detail.spec.tsx`

**Interfaces:**

- Produces: `listingQuote('remote', 'Paris, France')` → `'Listing: remote, Paris, France'`; with no part → `'Listing'`. `conflictLines` → `'The listing says <X>'`.

- [ ] **Step 1: Update the tests first:** every `'LinkedIn: …'` expectation in `combine.spec.ts` becomes `'Listing: …'`, and `expect.stringContaining('LinkedIn')` becomes `'Listing'`. Every `'LinkedIn says …'` in the two web specs becomes `'The listing says …'`.
- [ ] **Step 2: Run** `npx vitest run apps/xjobs/src/modules/facts/rules/combine.spec.ts` and `npx nx test web`. Expected: FAIL on the changed lines.
- [ ] **Step 3: Implement** both text changes. Then `grep -rn "LinkedIn says\|'LinkedIn: \|LinkedIn listing" apps/xjobs/src apps/web/src apps/db-tests/src` and update any remaining live code or fixture. Migration files are history: leave them.
- [ ] **Step 4: Run** `npx nx test xjobs` and `npx nx test web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(facts): neutral listing wording`.

### Task 7: Indeed source label and the open switch

**Files:**

- Modify: `apps/web/src/lib/matches/sources.ts` (`CHANNEL_LABELS.INDEED = 'Indeed'`)
- Modify: `apps/xjobs/src/modules/queries/switches.ts` (Indeed `available: true`, and the `available` doc no longer says the Indeed rollout sets it)
- Test: `apps/web/src/lib/matches/sources.spec.ts`, `apps/web/src/lib/matches/group.spec.ts`, `apps/xjobs/src/modules/queries/switches.spec.ts`

- [ ] **Step 1: Write failing tests:**
  - `sources.spec.ts`: `labels Indeed with no actor`: `channelBadges(['INDEED', 'LINKEDIN_JOB_BOARD'])` → `['LinkedIn · harvestapi', 'Indeed']`; `sourceText(['INDEED'])` → `'Indeed'`.
  - `group.spec.ts`: `offers Indeed as a source and filters by it`: a job with `channels: ['INDEED']` appears in `sourceOptions` as `{ value: 'INDEED', label: 'Indeed' }` and passes the `source: 'INDEED'` filter, and a LinkedIn-only job doesn't.
  - `switches.spec.ts`: the first test becomes `lists posts (unavailable) and indeed (available)`, with `available: true` for indeed.
- [ ] **Step 2: Run** `npx nx test web` and `npx vitest run apps/xjobs/src/modules/queries/switches.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both changes. Check that the preferences page shows the switch when `available` is true (`apps/web/src/components/preferences/search-switch.tsx` and its spec). If a web test asserts the Indeed switch is hidden, update it.
- [ ] **Step 4: Run** `npx nx run-many -t lint test build typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Indeed source label, Indeed switch available to every user`.

### Task 8: Roadmap, PR and rollout steps

**Files:**

- Modify: `docs/roadmap/phase-5-indeed/04-ingest-process-match.md` (Status: Built, with spec and plan links; open questions answered: no pre-filter, `db:archive-actor` result from Task 5)
- Modify: `docs/roadmap/phase-5-indeed/README.md` (slice 04 row: Built with links)
- Modify: `docs/roadmap/phase-5-indeed/03-collect.md` (drop "The Indeed switch stays unavailable until slice 04" and "Batches wait unprocessed until slice 04")

- [ ] **Step 1: Update the three docs.**
- [ ] **Step 2: Commit** `docs(roadmap): Phase 5 slice 04 built`.
- [ ] **Step 3: Push** with `git push -u origin feat/indeed-ingest` and open the PR to `main` with `gh pr create`. The body carries the spec's "Rollout on dev" steps 1–6 as a checklist, the `db:renormalize` and `db:recheck-skips` commands with `XJOBS_ALLOW_REMOTE_DB=1`, "Owner checks" (the salary URLs if Task 3 Step 5 couldn't fetch them), and the risk that the shared $0.50 Indeed cap may refuse later ticks once other users turn Indeed on.
- [ ] **Step 4: Watch CI** until green. A `database` or `e2e` job failing at Supabase start (port in use) gets a rerun of the failed job.
