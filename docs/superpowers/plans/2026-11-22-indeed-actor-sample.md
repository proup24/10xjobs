# Indeed actor sample Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paid, capped, maintainer-only script, `db:indeed-sample`. It runs four Indeed actors on the same searches, saves their raw items, and prints the comparison that decides Phase 5's go/no-go and the actor pick. After that, one maintainer run and the written report.

**Architecture:** It follows `db:split-check`. The pure logic lives in `src/scripts/indeed-sample/` and is unit tested:

- actor specs and input builders
- item readers
- the search plan and reservation
- the report

The database reads are in `queries.ts`. `src/scripts/indeed-sample.ts` wires the CLI, `--dry-run`, the paid path (the only code that builds an Apify client) and `--from <folder>` replays.

**Tech Stack:** TypeScript (strict, nodenext), tsx, Vitest, `apify-client`, the engine's database client (`createDatabaseClient`, `raw.sql`).

**Spec:** `docs/superpowers/specs/2026-11-22-indeed-actor-sample-design.md`

## Global Constraints

- **Actors:** `valig/indeed-jobs-scraper`, `kaix/indeed-scraper`, `memo23/apify-indeed-cheerio-ppr`, `curious_coder/indeed-scraper`.
- **Rows per run:** 100 on valig, kaix and curious_coder. 50 on memo23, probes included.
- **Cap:** the reserved total must be ≤ **$1.50** (`TOTAL_CAP_USD = 1.5`). Otherwise the paid path refuses before any Apify call.
- **Reservation per run:** start fee + rows × the sum of every per-row event the input turns on, rounded **up** to the next cent. That amount is Apify's `maxTotalChargeUsd` for the run.
- **Prices** are read live from `https://api.apify.com/v2/acts/<user>~<name>` and use the **FREE** tier's price (the highest), so the reservation is never too low.
- **Window:** the last 24 hours on every actor, sorted by date where the actor allows it.
- **Relevant job:** the title matches `ENGINEERING_TITLE` (`src/scripts/linkedin-region-test/logic.ts`) **and** the title or description mentions at least one spelling of the compared LinkedIn group.
- **Full description:** ≥ 500 characters after `htmlToPlainText`, and not ending in `…` or `...`.
- **Gate:** the actor passes when
  - ≥ 95% of its rows have a `jk` and a full description, **and**
  - its cost per relevant job is ≤ **2×** harvestapi's, on US remote and Morocco on-site combined (sum of cost ÷ sum of relevant jobs, on each side).
- **Filter trusted:** after striking lost jobs by hand, the lost relevant jobs are ≤ **2%** of the unfiltered search's relevant jobs.
- **Database:** nothing is written. A remote database needs `XJOBS_ALLOW_REMOTE_DB=1` (`captureRemoteOptIn` / `assertLocalDatabase` from `@xjobs/database/env`, as `post-sample.ts` does).
- **Raw items** go to `tmp/indeed-sample/<ISO timestamp>/` at the repo root (gitignored). Nothing from a run is committed except `docs/actors/indeed-actor-sample.md`.
- **`--dry-run`** exits before `APIFY_TOKEN` is read.

## Review Focus

1. **An actor returns 0 rows, or fewer than asked, for a search** (Morocco on-site is likely thin). The report must show 0 / n rows and a cost per relevant job of `null`, not divide by zero. The gate must treat an actor with 0 relevant jobs on the gate places as failing, with the reason "no relevant jobs". Test in Task 4.
2. **A price changed, or an event is missing from Apify's actor endpoint.** The reservation must throw, naming the actor and event, rather than reserve $0 for it. Test in Task 2.
3. **A run fails, times out or hits its charge limit midway.** The saved items of the finished runs stay. The script stops and prints the spend so far, and `--from` on that folder still builds a report, with the missing runs listed as `notRun`. Tests in Task 4 (report with missing runs) and Task 5 (stop). The entry point keeps spend printed on throw.
4. **No harvestapi day qualifies for the baseline** (collection cut short, or costs not final). The dry run prints `baselineDay: null` with the reason, and the paid path refuses. Test in Task 3.
5. **The same `jk` appears twice in one run, or across plain and real searches.** Distinct counts and overlap count it once, by `jk`. Rows without a `jk` count toward rows but never toward distinct jobs or overlap. Test in Task 4.

---

## File Structure

Every file below sits under `apps/xjobs/src/scripts/indeed-sample/` unless the path says otherwise.

| File                                               | Responsibility                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `actors.ts`                                        | `ActorSpec` per actor: name, rows, charged events, `buildInput(search)`, `readItem(raw)` → `SampleJob`       |
| `actors.spec.ts` + `fixtures/<actor>.json`         | Input builder and reader tests, using each README's example output item                                      |
| `plan.ts`                                          | The search list, the plan (actor × search), prices → reservation, the cap check                              |
| `plan.spec.ts`                                     |                                                                                                              |
| `baseline.ts`                                      | Pure: picks the baseline day from run rows, and computes harvestapi's cost per relevant job                  |
| `baseline.spec.ts`                                 |                                                                                                              |
| `report.ts`                                        | Pure: relevance, field coverage, distinct jobs and overlap, probes, boolean check, the gate                  |
| `report.spec.ts`                                   |                                                                                                              |
| `queries.ts`                                       | DB reads: place groups and keywords, the profile's plain keyword, baseline runs and jobs, dev overlap lookup |
| `apps/xjobs/src/scripts/indeed-sample.ts`          | Entry: args, dry run, paid path, saving, `--from`                                                            |
| `apps/xjobs/package.json`                          | `db:indeed-sample` script line                                                                               |
| `CLAUDE.md`                                        | Command line                                                                                                 |
| `docs/actors/indeed-actor-sample.md`               | Written report, pick, preference → search map (Task 7)                                                       |
| `docs/roadmap/phase-5-indeed/{README,01,03,04}.md` | Status and answered questions (Task 7)                                                                       |

---

### Task 1: Actor specs, input builders and item readers

**Files:**

- Create: `actors.ts`
- Create: `fixtures/valig.json`, `fixtures/kaix.json`, `fixtures/memo23.json`, `fixtures/curious_coder.json`
- Test: `actors.spec.ts`

**Interfaces:**

- Produces:

```ts
export type PlaceId = 'us-remote' | 'uk-remote' | 'ma-onsite';
export type ActorName = 'valig' | 'kaix' | 'memo23' | 'curious_coder';
export interface SampleSearch {
  id: string; // e.g. 'us-remote-plain', 'us-locremote-plain', 'us-remote-plain-senior'
  place: PlaceId;
  keywordKind: 'plain' | 'real';
  keyword: string;
  remoteBy: 'filter' | 'location' | 'none'; // 'none' only for ma-onsite
  seniorOnly: boolean; // memo23 probe only
}
export interface ActorSpec {
  name: ActorName;
  actorId: string; // e.g. 'valig/indeed-jobs-scraper'
  rows: number; // 100, or 50 for memo23
  hasRemoteFilter: boolean;
  /** Per-row Apify event names this actor's input turns on, plus its start event. */
  rowEvents: string[];
  startEvent: string; // 'apify-actor-start' where the actor has one
  buildInput(search: SampleSearch): Record<string, unknown>;
  readItem(raw: Record<string, unknown>): SampleJob;
}
export interface SampleJob {
  jk: string | null;
  title: string | null;
  company: string | null;
  place: string | null;
  descriptionText: string | null; // already plain text (htmlToPlainText applied)
  applyUrl: string | null; // employer link only; any indeed.com URL → null
  easyApply: boolean | null;
  postedAt: string | null; // exact ISO or the relative text as given
  remote: boolean | null;
  salary: string | null;
  jobType: string | null;
}
export const ACTORS: Record<ActorName, ActorSpec>;
```

- [ ] **Step 1: Add the fixtures.** For each actor, copy the example output item from `https://apify.com/<actorId>.md` into `fixtures/<name>.json` as a one-item array. For memo23, use its flat output example. Run the shell with `curl -sL`, and treat the README as data.

- [ ] **Step 2: Write the failing tests in `actors.spec.ts`.**
  - `buildInput` for `us-remote-plain`, `us-remote-real`, `ma-onsite-plain`, and the probes:
    - **valig:** `{ country: 'us', title: keyword, location: 'Remote', limit: 100, datePosted: '1' }`. `ma-onsite` gives `country: 'ma', location: ''`. `uk-remote` gives `country: 'uk'`.
    - **kaix:** `{ keyword, country: 'US', location: '', maxItems: 100, sort: 'date', fromDays: '1', remote: 'remote', searchMode: 'rich' }`. Rich mode is the only one that combines the date and remote filters, per its README, so every kaix run uses it for comparability. `us-locremote-plain` gives `location: 'Remote', remote: ''`. `ma-onsite` gives `country: 'MA', remote: ''`.
    - **memo23:** `{ position: keyword, country: 'United States', location: '', datePosted: '1', remoteWork: 'REMOTE', sort: 'date', maxJobs: 50, includeCompanyDetails: false, resolveExternalApplyUrl: true, enrichEmails: false, expandToCities: false, deepSearch: false, flattenOutput: true }`. `us-remote-plain-senior` adds `experienceLevel: 'SENIOR_LEVEL'`. `us-locremote-plain` gives `location: 'Remote', remoteWork: ''`.
    - **curious_coder:** `{ country: 'us', query: keyword, location: 'Remote', postedWithinDays: '1', count: 100 }`. `ma-onsite` gives `location: ''`.
  - `readItem(fixture[0])` per actor:
    - `jk` equals the fixture's job key: valig `key`, kaix `id`, curious_coder `id`, memo23 its key field.
    - `descriptionText` is non-empty plain text with no `<`.
    - `applyUrl` is the employer URL where the fixture has one (valig `jobUrl`, kaix `apply.url`).
  - `readItem` returns `applyUrl: null` when the only link is on `indeed.com` (for example misceres' `applystart` style URL put into the reader's apply field).
  - `readItem({})` returns every field `null`, and doesn't throw.

- [ ] **Step 3: Run the tests and check they fail.** `npx vitest run --config apps/xjobs/vitest.config.mts apps/xjobs/src/scripts/indeed-sample/actors.spec.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `actors.ts`.**
  - Readers are defensive: try the fixture's field first, then obvious alternates, and never throw. Use `htmlToPlainText` and `cleanText` from `src/modules/ingest/normalize/text.ts`.
  - `rowEvents`: memo23 `['apify-default-dataset-item', 'additional-data']`. The other three use `['apify-default-dataset-item']`.
  - `startEvent`: `'apify-actor-start'` for all four.

- [ ] **Step 5: Run the tests and check they pass.** Same command. Expected: PASS.

- [ ] **Step 6: Commit.** `git add apps/xjobs/src/scripts/indeed-sample && git commit -m "feat(scripts): Indeed sample actor inputs and readers"`

---

### Task 2: The search plan, prices and the reservation

**Files:**

- Create: `plan.ts`
- Test: `plan.spec.ts`

**Interfaces:**

- Consumes: `ACTORS`, `SampleSearch`, `ActorName` (Task 1).
- Produces:

```ts
export const TOTAL_CAP_USD = 1.5;
export interface Keywords {
  plain: string;
  real: Record<PlaceId, string>;
}
export function sampleSearches(k: Keywords): SampleSearch[]; // the 6 core searches
export interface PlannedRun {
  actor: ActorName;
  search: SampleSearch;
  input: Record<string, unknown>;
  reservedUsd: number;
}
export type EventPrices = Record<string, number>; // event name → USD, FREE tier
export function parseEventPrices(actJson: unknown): EventPrices;
export function reserveUsd(spec: ActorSpec, prices: EventPrices): number;
export function buildPlan(k: Keywords, prices: Record<ActorName, EventPrices>): { runs: PlannedRun[]; reservedUsd: number; capUsd: number; fits: boolean };
```

- [ ] **Step 1: Write the failing tests in `plan.spec.ts`.**
  - `sampleSearches` returns the 6 ids `us-remote-plain`, `us-remote-real`, `uk-remote-plain`, `uk-remote-real`, `ma-onsite-plain`, `ma-onsite-real`. The `ma-*` searches have `remoteBy: 'none'`.
  - `buildPlan` gives the runs per actor:
    - valig 6, curious_coder 6, using `remoteBy: 'location'`
    - kaix 7: the core searches with `remoteBy: 'filter'` on remote places, plus `us-locremote-plain`
    - memo23 8: core, plus `us-locremote-plain`, plus `us-remote-plain-senior` with `seniorOnly: true`
    - 27 runs in total
  - `parseEventPrices` reads `data.pricingInfos[last].pricingPerEvent.actorChargeEvents`. It takes `eventPriceUsd` when present, else `eventTieredPricingUsd.FREE.tieredEventPriceUsd`. Use the 2026-11-22 memo23 shape as the fixture: `apify-default-dataset-item` tiered 0.00149, `additional-data` 0.001, `apify-actor-start` 0.007.
  - With those memo23 prices, `reserveUsd(memo23)` is `0.14` (50 × 0.00249 + 0.007 = 0.1315, rounded up to the cent).
  - `reserveUsd` throws `/memo23.*additional-data/` when `additional-data` is missing from the prices (Review Focus 2).
  - With the 2026-11-22 prices (valig 0.0001 + 0.001, kaix 0.00005 + 0.00001, curious_coder 0.0001 + 0.0001), `buildPlan` reserves ≤ 1.5 and `fits` is true. Doubling every price makes `fits` false.

- [ ] **Step 2: Run the tests and check they fail.** `npx vitest run --config apps/xjobs/vitest.config.mts apps/xjobs/src/scripts/indeed-sample/plan.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `plan.ts`.** Round up with `Math.ceil(x * 100 - 1e-9) / 100`, so float noise doesn't add a cent.

- [ ] **Step 4: Run the tests and check they pass.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(scripts): Indeed sample plan and reservation"`

---

### Task 3: Baseline (pure)

**Files:**

- Create: `baseline.ts`
- Test: `baseline.spec.ts`

**Interfaces:**

- Consumes: `isRelevant` (Task 4 defines it in `report.ts`). To keep the tasks in order, define `isRelevant(job: { title: string | null; descriptionText: string | null }, spellings: readonly string[]): boolean` **here** in `baseline.ts`, and have `report.ts` import it.
  - It lowercases, and a spelling matches as a whole word. Reuse `mentions` from `src/scripts/spellings/logic.ts` if it's exported, else export it from there.
- Produces:

```ts
export const PLACE_GROUPS: Record<PlaceId, { location: string; type: 'remote' | 'onsite' }> = { 'us-remote': { location: 'united states', type: 'remote' }, 'uk-remote': { location: 'europe', type: 'remote' }, 'ma-onsite': { location: 'morocco', type: 'onsite' } };
export const GATE_PLACES: PlaceId[] = ['us-remote', 'ma-onsite'];
export interface BaselineRun {
  place: PlaceId;
  startedAt: Date;
  status: string;
  capped: boolean;
  costMicroUsd: number | null;
  costFinal: boolean;
}
export function pickBaselineDay(runs: BaselineRun[], today: string): { day: string | null; reason?: string };
export interface BaselineJob {
  place: PlaceId;
  jobId: string;
  title: string | null;
  descriptionText: string | null;
}
export function baselineCost(runs: BaselineRun[], jobs: BaselineJob[], spellings: Record<PlaceId, string[]>): Record<PlaceId, { costUsd: number; relevant: number; perRelevantUsd: number | null }>;
```

- [ ] **Step 1: Write the failing tests in `baseline.spec.ts`.**
  - `pickBaselineDay` uses Morocco days, through `moroccoDay` from `src/scripts/actor-compare/report.ts`, over the 7 days before `today`. `today` itself is excluded.
  - It returns the latest day where, for every place in `PLACE_GROUPS`, all runs that day have `status === 'succeeded'`, `!capped` and `costFinal`. That place's run count must also be ≥ 90% of its highest daily count in those 7 days.
  - A day with one `costFinal: false` run is skipped. A day with half the usual runs is skipped.
  - With no qualifying day, it returns `{ day: null, reason: /no full day/ }` (Review Focus 4).
  - `baselineCost` sums `costMicroUsd / 1e6` per place, and counts the distinct `jobId`s that are `isRelevant` under that place's spellings. Zero relevant jobs give `perRelevantUsd: null`.
  - `isRelevant`:
    - `{ title: 'Senior Backend Engineer', descriptionText: 'We use TypeScript' }` with `['typescript']` → true
    - `{ title: 'Sales Manager', … 'typescript' }` → false
    - `{ title: 'Développeur Full Stack', descriptionText: 'node.js' }` with `['node.js']` → true

- [ ] **Step 2: Run the tests and check they fail.** Expected: FAIL.

- [ ] **Step 3: Implement `baseline.ts`.**

- [ ] **Step 4: Run the tests and check they pass.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(scripts): Indeed sample harvestapi baseline"`

---

### Task 4: The report (pure)

**Files:**

- Create: `report.ts`
- Test: `report.spec.ts`

**Interfaces:**

- Consumes: `SampleJob`, `ActorName`, `PlaceId` (Task 1); `PlannedRun` (Task 2); `isRelevant`, `GATE_PLACES`, `baselineCost` output (Task 3).
- Produces:

```ts
export interface RunResult {
  actor: ActorName;
  searchId: string;
  place: PlaceId;
  costUsd: number | null;
  jobs: SampleJob[];
}
export interface DevLookup {
  strongKeys: Set<string>;
  titleCompany: Set<string>;
} // `${lower title}|${lower company}`
export function isFullDescription(text: string | null): boolean;
export function buildReport(input: { planned: PlannedRun[]; results: RunResult[]; spellings: Record<PlaceId, string[]>; baseline: Record<PlaceId, { costUsd: number; relevant: number; perRelevantUsd: number | null }>; dev: DevLookup; strongKeyOf: (applyUrl: string) => string | null }): SampleReport;
```

`SampleReport` holds:

- `perActor[actor]`:
  - `runs`: rows, distinct and cost per search
  - `notRun`: search ids
  - `distinct`, `costUsd`, `costPer1000`, `relevantByPlace`, `costPerRelevantGate`
  - `coverage`: the share of rows per field (`jk`, `fullDescription`, `employerApplyLink`, `easyApplyFlag`, `postedTime`, `company`, `place`, `remoteFlag`, `salary`, `jobType`)
  - `devOverlap: { proven, likely }`
  - `gate: { pass: boolean; reasons: string[] }`
- `overlap`: for each actor pair, the count of shared distinct `jk`s
- `probes`:
  - `remoteFilter[actor]` and `seniorFilter.memo23`, each `{ onlyFiltered, onlyUnfiltered, both, lost: {title, company, jk}[], lostShare }`
- `boolean[actor][place]`: `{ plainRelevantShare, realRelevantShare }`
- `baseline`, and `pickOrder`: the passing actors ranked by
  1. relevant jobs on all places
  2. probes passing at ≤ 2% lost
  3. employer link coverage
  4. cost

`lostShare` is computed **before** any hand strike-off. The written report applies the strike-off.

- [ ] **Step 1: Write the failing tests in `report.spec.ts`,** using small in-test `SampleJob` arrays.
  - **Distinct and overlap** (Review Focus 5): a `jk` repeated within a run, and across the `-plain` and `-real` runs, counts once. A row with `jk: null` adds to rows but not to `distinct` or `overlap`.
  - **Coverage** for `jk` and `fullDescription`:
    - `isFullDescription('x'.repeat(499))` → false
    - `'x'.repeat(500)` → true
    - `'x'.repeat(600) + '…'` → false
  - **Gate** fails with `'jk or description under 95%'` when 10 of 100 rows lack a description.
  - **Gate cost:** `costPerRelevantGate = (cost us-remote + cost ma-onsite runs) / (relevant on those places)`, where "relevant" means distinct relevant jobs, deduped across that actor's runs for the place. The baseline gate is `(us cost + ma cost) / (us relevant + ma relevant)`.
    - An actor at 2.0× passes, at 2.01× fails.
    - Zero relevant jobs on the gate places fails with `'no relevant jobs'` and `costPerRelevantGate: null` (Review Focus 1).
  - **A missing run** (planned, no result) appears in `notRun`, and the report still builds (Review Focus 3).
  - **Probe:** unfiltered relevant `{a,b,c,…}` (50), filtered missing one → `lostShare 0.02`, `lost` lists it.
  - **Dev overlap:** an `applyUrl` whose `strongKeyOf` key is in `dev.strongKeys` counts as proven. A title + company pair in `dev.titleCompany` with no proven key counts as likely.
  - **Apply link:** an `employerApplyLink` is never a gate reason.

- [ ] **Step 2: Run the tests and check they fail.** Expected: FAIL.

- [ ] **Step 3: Implement `report.ts`.**

- [ ] **Step 4: Run the tests and check they pass.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(scripts): Indeed sample report and gate"`

---

### Task 5: Database reads and the entry script

**Files:**

- Create: `queries.ts`
- Create: `apps/xjobs/src/scripts/indeed-sample.ts`
- Modify: `apps/xjobs/package.json`: add `"db:indeed-sample": "tsx --conditions=@xjobs/source --tsconfig tsconfig.app.json src/scripts/indeed-sample.ts"` next to `db:split-check`
- Modify: `CLAUDE.md`: a line after `db:split-check`'s:
  ``- `pnpm --filter @xjobs/xjobs db:indeed-sample -- --profile <id> [--dry-run | --from <folder>]`: PAID, maintainer-only one-off Phase 5 slice 01 sample of four Indeed actors (27 runs, at most $1.50 reserved), with harvestapi's dev baseline; raw items saved under `tmp/indeed-sample/`. Run `--dry-run` first; `--from` rebuilds the report from a saved folder without Apify; remote needs `XJOBS_ALLOW_REMOTE_DB=1`.``
- Test: `apps/xjobs/src/scripts/indeed-sample/args.spec.ts` (args parsing lives in `args.ts`)

**Interfaces:**

- Consumes: everything from Tasks 1 to 4; `mergedLinkedinKeyword`, `linkedinMemberWords` (`linkedin-job-board.mapper.ts`); `segmentKey` (`src/modules/segments`); `mapLinkedinJob` (`src/modules/ingest/normalize/mappers/linkedin-job.mapper.ts`, with `{ scrapedAt }`); `jobKey` / `isStrongJobKey` (`job-key.ts`, called as `jobKey(Channel.LINKEDIN_JOB_BOARD, 'x', emptyRecord({ kind: 'job', postingUrl: null, applyUrl }))` to get an `ats:` or `url:` key, else null).
- Produces, in `queries.ts`:
  - `loadPlaceGroups(db): Record<PlaceId, { realKeyword: string; otherKeywords: string[]; spellings: string[]; segmentKeys: string[] }>`. Active `LINKEDIN_JOB_BOARD` builders for each `PLACE_GROUPS` location and type, grouped by `segmentKey`. The `realKeyword` is the first segment's `mergedLinkedinKeyword`, in segment key order. `spellings` is the union over every segment of the place.
  - `loadPlainKeyword(db, profileId): string`. The first sorted role word of the profile's active LinkedIn builders, plus the `tech_tags` code of its highest-importance `profile_skills` row, ties broken by mastery and then code.
  - `loadBaselineRuns(db, segmentKeys, since): BaselineRun[]`, for batch actor `harvestapi/linkedin-job-search`.
  - `loadBaselineJobs(db, place, segmentKeys, day): BaselineJob[]`. Sightings of that day's batches → raw item versions → `mapLinkedinJob` for the title and `descriptionText`.
  - `loadDevLookup(db, keys: string[], pairs: string[]): DevLookup`, over `normalized_jobs` (`jobKey`, `lower(title)`, `lower("companyName")`) where `"mergedIntoId" IS NULL`.
- Produces, in `args.ts`: `parseSampleArgs(argv): { profile: string; dryRun: boolean; from?: string }`. `--profile` is required unless `--from` is given. `--dry-run` and `--from` together are refused.

- [ ] **Step 1: Write the failing `args.spec.ts`.**
  - It drops a literal `--`.
  - With no `--profile` and no `--from`, it throws `/--profile/`.
  - `--dry-run --from x` throws.

- [ ] **Step 2: Run it and check it fails, then implement `args.ts` and check it passes.** `npx vitest run --config apps/xjobs/vitest.config.mts apps/xjobs/src/scripts/indeed-sample/args.spec.ts`

- [ ] **Step 3: Implement `queries.ts`.** Keep the `raw.sql` + `.returnsRow` style used in `split-check.ts` and `actor-compare/queries.ts`.

- [ ] **Step 4: Implement `indeed-sample.ts`.** Its order:
  1. `captureRemoteOptIn` and `assertLocalDatabase`.
  2. Load the place groups, the plain keyword, the baseline runs (the last 8 days), the baseline day, the baseline jobs and the cost.
  3. Fetch the prices for the four actors with global `fetch`. This is public, with no token.
  4. `buildPlan`.
  5. **`--dry-run`:** print JSON `{ dryRun: true, keywords, otherKeywords, baselineDay, baselineReason?, baseline, runs: [{actor, searchId, input, reservedUsd}], reservedUsd, capUsd, fits }` and return.
  6. **Otherwise,** refuse when `!fits` or `baselineDay === null`.
  7. Create `tmp/indeed-sample/<new Date().toISOString()>/` (from the repo root, resolved from `import.meta.dirname`) and write `plan.json` (the dry-run object).
  8. **Paid path,** the only `ApifyClient` construction: for each planned run, in order:
     - `actor(actorId).start(input, { maxTotalChargeUsd: reservedUsd })`, then `waitForFinish({ waitSecs: 900 })`.
     - Write `<actor>/<searchId>.json` as `{ runId, status, usageTotalUsd, items }`.
     - On a status other than `SUCCEEDED`, print `{ stoppedAt, spentUsd }` and stop the loop, keeping the files.
  9. After the loop, wait 5 minutes, then re-read each run's `usageTotalUsd` (late charges, as the trial channels do) and rewrite the cost in its file.
  10. Build the report from the folder, exactly as `--from` does: read each `<actor>/<searchId>.json`, run `readItem`, then `buildReport`. Call `loadDevLookup` with the strong keys and title + company pairs. Write `report.json` and print it.
  - **`--from <folder>`** skips steps 3 to 9. It reads `plan.json` for keywords, the plan and the baseline, so a replay matches the original run.

- [ ] **Step 5: Check the dry run against the local database.** `DATABASE_URL=<local> pnpm --filter @xjobs/xjobs db:indeed-sample -- --profile <a local published profile id> --dry-run`. Expected: JSON with 27 runs, `reservedUsd` ≤ 1.5 and `fits: true`. `baselineDay` may be null locally, and the reason is printed. No Apify token is needed.

- [ ] **Step 6: Run the CI checks.** `npx nx run-many -t lint test build typecheck`. Expected: all green.

- [ ] **Step 7: Commit and open the PR.**
  - `git add -A apps/xjobs CLAUDE.md && git commit -m "feat(scripts): db:indeed-sample, Phase 5 slice 01"`
  - `git push -u origin docs/indeed-actor-sample`
  - `gh pr create --base main`. The body states that it's paid, maintainer-only, has a $1.50 cap and must be dry-run first.

---

### Task 6: The maintainer run (after the PR is reviewed; needs the user)

- [ ] **Step 1:** Ask the user to run it, or to OK running it against dev:
      `! XJOBS_ALLOW_REMOTE_DB=1 DATABASE_URL=<dev> pnpm --filter @xjobs/xjobs db:indeed-sample -- --profile <owner profile id> --dry-run`
      Check that it shows 27 runs, a non-null `baselineDay`, `reservedUsd` ≤ 1.5 and `fits: true`. Read each actor's input before going on.
- [ ] **Step 2:** On the user's yes, run the same command without `--dry-run`, with `APIFY_TOKEN` set. Expected: `report.json` written, and the spend is printed.
- [ ] **Step 3:** If a reader got a field wrong (for example a 0% `jk` from a renamed field), fix `readItem` and its fixture test. Then replay with `--from tmp/indeed-sample/<ts>`, which needs no Apify call, and commit the fix.

---

### Task 7: The written report and the roadmap

**Files:**

- Create: `docs/actors/indeed-actor-sample.md`
- Modify:
  - `docs/roadmap/phase-5-indeed/README.md`: the slice table status
  - `docs/roadmap/phase-5-indeed/01-actor-sample.md`: status, findings and answered open questions
  - `docs/roadmap/phase-5-indeed/03-collect.md` and `04-ingest-process-match.md`: their open questions now answered (keyword syntax, remote per site, rows per search, start fees, the redirect)

- [ ] **Step 1: Read every `lost` job in `report.json`'s probes and strike off the ones the matcher would reject anyway.** Record each one with its reason. Recompute the share, and mark the filter **trusted** if it's ≤ 2%, else **not trusted (measured)**.
- [ ] **Step 2: Write `docs/actors/indeed-actor-sample.md`:**
  - the date, the run folder name, the spend
  - the per-actor tables (volume, cost, coverage, overlap, dev overlap)
  - the boolean result
  - the probes after strike-off
  - the baseline and the gate per actor
  - the pick and its reasons, or the stop and why
  - **The preference → search map**: one row each for keyword, places, arrangement, seniority, time window, contract type and engagement, salary, languages, time zone and notice period. The columns are LinkedIn (harvestapi), valig, kaix, memo23 and curious_coder. Each cell is _trusted_, _not trusted (measured)_, _not offered_ or _matcher only_, with the input name.
- [ ] **Step 3: Update the roadmap files listed above.** If no actor passes, the phase README says Phase 5 stops at slice 01, with the numbers.
- [ ] **Step 4: Commit and push.** `git add docs && git commit -m "docs(actors): Indeed actor sample results and pick" && git push -u origin docs/indeed-actor-sample` (the same PR, before merge, or a follow-up branch if it already merged).
