# Seniority levels and paid repeats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search the LinkedIn levels each seniority's jobs are really tagged with, stop paying twice per tick for the same rows, fold MENA into Middle East and Africa, and add two reports: place coverage, and a paid split check.

**Architecture:** Query changes (level map, MENA, recipe bump) live in `modules/queries`. The row-limit change goes through the three LinkedIn job-board collectors and `CollectionService.collectSegment`: one row limit of 1,000, halving only for full multi-member groups. Two new `db:*` scripts follow the `scripts/<name>.ts` + `scripts/<name>/logic.ts` pattern (pure logic tested, SQL and Apify at the edge), like `db:spellings`.

**Tech Stack:** NestJS 11, TypeScript strict (nodenext), Vitest, Prisma Next raw SQL (`db.query(raw.sql…)`), `apify-client`.

**Spec:** `docs/superpowers/specs/2026-11-20-seniority-levels-and-paid-repeats-design.md`

## Global Constraints

- Work in a worktree branched from `main` (`feat/slice-08-search-cost`); never `git switch` the main checkout. One PR to `main`.
- LinkedIn codes: 1 internship, 2 entry, 3 associate, 4 mid-senior, 5 director.
- Level map: junior `2`; mid `3,4`; senior `4`; staff `4`; lead `4,5`; principal `4,5`; unstated none.
- `QUERY_SEARCH_RECIPE_VERSION` 12 → 13.
- `LINKEDIN_SEARCH_MAP.mena = ['africa', 'middle east']`; `mena` stays in `LINKEDIN_GEO_IDS`.
- Row limit per run: `maxRowsPerSearch: 1000` for harvestapi, cheap_scraper, bebity; `maxRowsCeiling` removed.
- Run charge caps: harvestapi `maxRunChargeUsd: 1.10`; cheap_scraper and bebity `1.50`.
- Full = returned rows ≥ row limit. harvestapi's `totalElements` rule and its warning go; `searchTotals` is still returned and stored.
- Split "runs small" threshold stays `SMALL_SHARE = 0.25` of the row limit (250 rows).
- `db:split-check`: 3 runs, 150 rows each, $0.16 cap each, refuses above $0.50 reserved, `postedLimit: '24h'`, pass at coverage ≥ 0.95, default group = most rows in last 24 h among groups under 120.
- `db:place-coverage`: default `--days 7`, `--actor harvestapi/linkedin-job-search`; credit by `collection_batches.actor`.
- No migration. No processor, matcher or web changes.
- CI: `npx nx run-many -t lint test build typecheck` green.

## Review Focus

1. **A full run whose claim narrowed it to one member** (the segment had two, one was skipped as in-flight). Expected: treated as a one-member full run, so cursors move and the warning is logged, never held with no half to run. Test in Task 2.
2. **A remembered split whose searches now return 200 rows.** Expected: halved once it is over 90 minutes old, because 200 < 250. Test in Task 2.
3. **A MENA-only profile.** Expected: builds Africa and Middle East searches, not a MENA search; a profile with EMEA and MENA builds no duplicate. Test in Task 1.
4. **One job seen by the same place under two work types** (Europe remote and Europe hybrid). Expected: counts as "only this place" in both rows, since no other place found it. Test in Task 3.
5. **`db:split-check` on a one-member group with fewer than 2 spellings.** Expected: a clear refusal before any Apify call. Test in Task 4.

---

### Task 1: Level map, MENA, recipe 13

**Files:**

- Modify: `apps/xjobs/src/modules/queries/channels/linkedin_board.builder.ts:8-23` (map and its comment)
- Modify: `apps/xjobs/src/modules/queries/channels/linkedin_search_map.ts` (add `mena`)
- Modify: `apps/xjobs/src/modules/queries/builders/recipe.ts:5` (version 13)
- Modify: `apps/xjobs/src/modules/queries/steps/combinations.ts` (`dedupeBySearch` comment: staff now shares `4` with senior, lead and principal share `4,5`)
- Test: `apps/xjobs/src/modules/queries/channels/channels.spec.ts`, `.../channels/linkedin_search_map.spec.ts`, `.../builders/recipe.spec.ts`, `.../services/queries.service.spec.ts`

**Interfaces:**

- Produces: `linkedinLevels(seniority: string): string[]` (unchanged signature, new values); `searchPlaces('MENA')` → `['africa', 'middle east']`.

- [ ] **Step 1: Write the failing tests**

In `channels.spec.ts`, replace the body of `linkedinLevels › splits a seniority into single f_E levels`:

```ts
expect(linkedinLevels(Seniority.junior)).toEqual(['2']);
expect(linkedinLevels(Seniority.mid)).toEqual(['3', '4']);
expect(linkedinLevels(Seniority.senior)).toEqual(['4']);
expect(linkedinLevels(Seniority.staff)).toEqual(['4']);
expect(linkedinLevels(Seniority.lead)).toEqual(['4', '5']);
expect(linkedinLevels(Seniority.principal)).toEqual(['4', '5']);
```

In `linkedin_search_map.spec.ts`, add `it('searches MENA as Africa and the Middle East')`: `expect(searchPlaces('MENA')).toEqual(['africa', 'middle east'])`.
In `recipe.spec.ts`, change the version test to 13 and refresh the pinned digests (the comment says they change only with the version).
In `queries.service.spec.ts › expands each arrangement by its own locations`, MENA now adds no LinkedIn place beyond EMEA's: per LinkedIn job-board channel 4 places (africa, europe, middle east, morocco), so 12 in all and 39 recipes. Update the comment and counts. Add `it('searches a MENA-only profile as Africa and the Middle East')`: a remote-only MENA profile's LinkedIn job-board recipes have locations exactly `['africa', 'middle east']` per channel and none `mena`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx nx test xjobs -- channels.spec linkedin_search_map.spec recipe.spec queries.service.spec`
Expected: FAIL on the level values, MENA, version 12 and the counts.

- [ ] **Step 3: Implement** the map values, the `mena` map entry, version 13 and the two comments.

- [ ] **Step 4: Run the tests and fix any other spec that pinned the old levels or MENA**

Run: `npx nx test xjobs`
Expected: PASS. Fix only expectations that encode the old map (for example combinations or dedupe counts for junior or staff); don't loosen unrelated assertions.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(queries): seniority levels from LinkedIn tags, MENA as Africa and Middle East (recipe 13)"
```

---

### Task 2: Every run at 1,000 rows; halve only multi-member groups

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/types/collector.ts` (drop `SegmentSearch.maxItems`, `LinkedinJobBoardRunConfig.maxRowsCeiling`; update the `maxRowsPerSearch` doc)
- Modify: `apps/xjobs/src/modules/collectors/providers/linkedin-job-board.collector.ts`, `...-cheap.collector.ts`, `...-bebity.collector.ts` (configs; rows = `config.maxRowsPerSearch`; cap = `config.maxRunChargeUsd`)
- Delete: `runChargeCapUsd` from `apps/xjobs/src/modules/collectors/utils/linkedin-board-run.ts` and its export in `modules/collectors/index.ts`
- Modify: `apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts` (`collectSegment`, `RunOptions`, `runSegment`, `chargeCapMicroUsd`, `buildSearch`)
- Modify: `apps/xjobs/src/scripts/actor-compare/queries.ts` (`ceilingRows` reads `maxRowsPerSearch`), `.../actor-compare/report.ts` comments
- Test: `collection.service.spec.ts`, `segment-collect.spec.ts`, `linkedin-job-board-cheap.collector.spec.ts`, `linkedin-job-board-bebity.collector.spec.ts`, `linkedin-job-board.mapper.spec.ts`, `splits.spec.ts`, `actor-compare/report.spec.ts`

**Interfaces:**

- Produces: `chargeCapMicroUsd(channel: Channel): number` = `round(boardRun(channel).maxRunChargeUsd × 1e6)`; `RunOptions` = `{ holdIfFull: boolean; budget?: DailyBudget }`; `collectSegment(channel, segment, until, summary, group, budget)` (no `maxItems`).

Behaviour of `collectSegment` for a LinkedIn job-board run that comes back full, judged on the members the run actually searched (`outcome.searched`):

- more than one member: cursors held, `halve`, each half through `collectSegment` (at 1,000 rows), `group.split = true` (as today);
- one member: cursors move, warn `${segment.key} is full at ${rowLimit} rows; older postings in this hour are lost`, record `maxReturned`.
  `runSegment` therefore holds cursors only when `full && options.holdIfFull && owned.members.length > 1`; `collectSegment` passes `holdIfFull: isLinkedinJobBoard(channel)`.

- [ ] **Step 1: Write the failing tests**

`segment-collect.spec.ts` (harvestapi collector):

- `it('asks for 1000 rows with a $1.10 cap')`: the actor input's `maxItems` is 1000 and the run option `maxChargeUsd` is 1.10.
- `it('is full only at its row limit, whatever LinkedIn reports in total')`: 52 items with `_meta.pagination.totalElements: 400` → `truncatedQueryIds` empty, `searchTotals` still the pagination object, no warning logged. Remove the tests of the `totalElements` rule.

Cheap and bebity specs: config assertions become `maxRowsPerSearch: 1000`, `maxRunChargeUsd: 1.5`, no `maxRowsCeiling`; the input asks 1000 rows with cap 1.5.

`collection.service.spec.ts › LinkedIn search splits`:

- Keep and adapt: `runs a full 2-member search again as two halves, and only the halves move cursors` (fake returns 1000 rows for the merged run); `halves a full half again until it fits`; `keeps cursors when a half fails…`; `starts no half once stopping…`; budget-stops-a-split; stale-split tests.
- Replace `reruns a full single member once with maxItems at the ceiling` and `moves the cursors of a member still full at the ceiling…` with `it('moves the cursors of a full single member, runs nothing more, and says once that postings are lost')`: one run only, cursors advanced, one warning containing `full at 1000 rows`.
- Replace `leaves cursors of a full search when its single-member ceiling rerun is skipped` with Review Focus 1: `it('treats a full run narrowed to one member by its claim as a single member')`: a 2-member segment, one member skipped as in-flight, the run full → one run, cursors of the claimed member moved, warning logged.
- Review Focus 2, `it('halves a remembered split over 90 minutes old once its searches return under 250 rows')`: remembered parts 2, `splitAt` 2 h ago, every search returns 200 rows → `setParts(key, 1, …)`.
- Line ~1586 `splits a full result, then reruns one member at 1000 rows` → `splits a full result into halves of 1000 rows each` (every search the fake sees asks 1000 rows).
- Budget: `it('counts a run with no reported cost at the $1.10 cap')`.

`actor-compare/report.spec.ts`: a run of 1000 rows is `atCeiling`; 100 rows is not.

- [ ] **Step 2: Run to verify they fail**

Run: `npx nx test xjobs -- collection.service.spec segment-collect.spec cheap.collector.spec bebity.collector.spec report.spec`
Expected: FAIL (old limits, rerun at ceiling, totalElements rule).

- [ ] **Step 3: Implement** the configs, type removals and `collectSegment`/`runSegment` behaviour above. `nextParts` needs no change: `rememberSplits` already passes `rowLimit = maxRowsPerSearch`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx nx run-many -t test typecheck -p xjobs`
Expected: PASS; no reference left to `maxRowsCeiling`, `runChargeCapUsd` or `SegmentSearch.maxItems` (`grep -rn 'maxRowsCeiling\|runChargeCapUsd' apps/xjobs/src` prints nothing).

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(collect): every LinkedIn run at 1000 rows; halve only full multi-member groups"
```

---

### Task 3: `db:place-coverage`

**Files:**

- Create: `apps/xjobs/src/scripts/place-coverage/logic.ts`, `.../place-coverage/logic.spec.ts`
- Create: `apps/xjobs/src/scripts/place-coverage.ts` (args, SQL, print)
- Modify: `apps/xjobs/package.json` (`"db:place-coverage": "tsx --conditions=@xjobs/source --tsconfig tsconfig.app.json src/scripts/place-coverage.ts"`)
- Modify: `CLAUDE.md` Commands (one line after `db:actor-compare`)

**Interfaces:**

- Produces, in `logic.ts`:

  ```ts
  type Outcome = 'qualified' | 'review' | 'rejected';
  interface Sighting {
    jobId: string;
    place: string;
    type: string;
    level: string | null;
  }
  interface PlaceRun {
    place: string;
    type: string;
    level: string | null;
    costMicroUsd: number | null;
  }
  interface CoverageRow {
    place: string;
    type: string;
    level?: string | null;
    runs: number;
    costUsd: number;
    jobs: number;
    onlyHere: number;
    onlyHereOutcomes: Record<Outcome | 'none', number>;
  }
  function bestOutcome(outcomes: readonly string[]): Outcome | 'none'; // qualified > review > rejected > none
  function placeCoverage(sightings: Sighting[], runs: PlaceRun[], outcomes: ReadonlyMap<string, Outcome | 'none'>, by: 'type' | 'level'): CoverageRow[]; // sorted by onlyHere desc
  ```

  "Only here" = the job's set of distinct `place` values is exactly `{row.place}`. A run with a null cost counts as 0 in `costUsd`.

- [ ] **Step 1: Write the failing tests** in `logic.spec.ts`:
  - `bestOutcome(['rejected','qualified'])` → `'qualified'`; `[]` → `'none'`.
  - Two places sharing a job: neither counts it as only here; each counts its own.
  - Review Focus 4: one job in Europe remote and Europe hybrid → `onlyHere` 1 in both rows.
  - `by: 'level'` groups on `level`, and the null level is its own row.
  - Runs and cost add up per row; a null cost adds 0.

- [ ] **Step 2: Run to verify they fail**: `npx nx test xjobs -- place-coverage` → FAIL (module missing).

- [ ] **Step 3: Implement `logic.ts`**, then `place-coverage.ts`. Args via `parseArgs` (`--days`, positive integer, default 7; `--actor`, default `harvestapi/linkedin-job-search`). Three SELECTs over the window (`observedAt`/`startedAt` ≥ now − days):
  - sightings: `raw_item_sightings` ⨝ `collection_batches` (on `batchId`, `actor = $actor`) ⨝ `query_search_builder` (on `queryId`; `location`, `type`, `params->>'experienceLevel'`) ⨝ `normalized_job_sources` (on `rawItemId`, giving `jobId`);
  - runs: `search_segment_runs` ⨝ `collection_batches` (on `segmentRunId`, actor) ⨝ `query_search_builder` on `"queryIds"[1]`;
  - outcomes: `job_matches` `jobId, outcome` for those jobs.
    Print two tables (by type, by level) with the header `Place coverage: last N days, <actor>` and dollars to 3 decimals.

- [ ] **Step 4: Run the tests**: `npx nx test xjobs -- place-coverage` → PASS. Smoke-run locally: `DATABASE_URL=<local> pnpm --filter @xjobs/xjobs db:place-coverage -- --days 7` prints both tables, or empty tables on an empty local DB.

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/scripts/place-coverage* apps/xjobs/package.json CLAUDE.md
git commit -m "feat(scripts): db:place-coverage reports what each search place finds alone"
```

---

### Task 4: `db:split-check`

**Files:**

- Create: `apps/xjobs/src/scripts/split-check/logic.ts`, `.../split-check/logic.spec.ts`
- Create: `apps/xjobs/src/scripts/split-check.ts` (args, SQL, the only Apify code)
- Modify: `apps/xjobs/package.json` (`db:split-check`), `CLAUDE.md` Commands (one line, saying it is paid, maintainer-only, `--dry-run` first)

**Interfaces:**

- Consumes: `segmentKey` (`src/modules/segments`), `mergedLinkedinKeyword`, `toHarvestJobSearchInput` (`.../mappers/linkedin-job-board.mapper`), `linkedinKeyword` (`src/modules/queries/channels/linkedin_keyword`).
- Produces, in `logic.ts`:

  ```ts
  const RUN_ROWS = 150,
    RUN_CAP_USD = 0.16,
    TOTAL_CAP_USD = 0.5,
    PASS_SHARE = 0.95,
    MAX_GROUP_ROWS = 120;
  interface GroupCandidate {
    key: string;
    rows24h: number;
    members: { id: string; hash: string; params: Record<string, unknown> }[];
  }
  function pickGroup(groups: GroupCandidate[], key?: string): GroupCandidate; // by key, else most rows24h under 120; throws if none
  function halfKeywords(group: GroupCandidate): { merged: string; halves: [string, string]; by: 'members' | 'spellings' };
  function checkPlan(): { runs: 3; rows: 150; reservedUsd: number; fits: boolean };
  function coverage(merged: ReadonlySet<string>, a: ReadonlySet<string>, b: ReadonlySet<string>): { merged: number; covered: number; share: number; halvesOnly: number; pass: boolean };
  function inconclusive(mergedRows: number): string | null; // 'full' at ≥150, 'empty' at 0, else null
  ```

  `halfKeywords`: with ≥ 2 members, sort by `hash`, first half rounded up (as `halve`), each half through `mergedLinkedinKeyword`. With one member, the member's sorted `spellings`, split the same way, each with its `roleWords` through `linkedinKeyword`. Throws `'cannot halve: one member with fewer than 2 spellings'`.

- [ ] **Step 1: Write the failing tests** in `logic.spec.ts`:
  - `pickGroup`: the named key wins; by default 90 rows beats 30, and 200 is skipped (over 120); none left → throws.
  - `halfKeywords`: 3 members → halves of 2 and 1 in hash order, `by: 'members'`; 1 member with spellings `['go','java','rust']` → halves equal to `linkedinKeyword(roleWords, ['go','java'])` and `linkedinKeyword(roleWords, ['rust'])`, `by: 'spellings'`; Review Focus 5: 1 member with 1 spelling throws the message above.
  - `checkPlan().reservedUsd` is 0.48 and `fits` is true.
  - `coverage`: merged {a,b,c,d}, halves {a,b} and {c,x} → covered 3, share 0.75, halvesOnly 1, pass false; 19 of 20 → pass true.
  - `inconclusive(150)` → `'full'`, `(0)` → `'empty'`, `(80)` → null.

- [ ] **Step 2: Run to verify they fail**: `npx nx test xjobs -- split-check` → FAIL.

- [ ] **Step 3: Implement `logic.ts`, then `split-check.ts`.** Read active `LINKEDIN_JOB_BOARD` builders (`isActive`, not `isDeleted`), group with `segmentKey`, and take `rows24h` = sum of `search_segment_runs.fetched` per `segmentKey` over 24 h. `--dry-run` prints the group, three keywords and the reserved spend, then exits before reading `APIFY_TOKEN`. Paid path: refuse unless `fits`; each run uses `{ ...toHarvestJobSearchInput(keyword, members[0].params, RUN_ROWS), postedLimit: '24h' }` with `maxTotalChargeUsd: RUN_CAP_USD`; run the merged search first and stop with the `inconclusive` reason if any; job ids from each item's `id`. Print JSON `{ group, by, keywords, coverage, costUsd }`.

- [ ] **Step 4: Run the tests**: `npx nx test xjobs -- split-check` → PASS. Run `--dry-run` against the local DB → prints a plan or "no group" without an Apify call.

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/scripts/split-check* apps/xjobs/package.json CLAUDE.md
git commit -m "feat(scripts): db:split-check pays three runs to test halving coverage"
```

---

### Task 5: Roadmap and CI

**Files:**

- Modify: `docs/roadmap/phase-3-find-quality/08-seniority-levels.md`: a "Decided" note at the top linking the spec, with each open question answered in a line (map; ceiling start with halving kept; MENA; repeats across ticks deferred).
- Modify: `docs/roadmap/phase-3-find-quality/07-trial-linkedin-actors.md` "Reposts" bullet, or the phase README: the repost-quality item (a repost of a job never seen before arrives as new).

- [ ] **Step 1: Edit both docs.**
- [ ] **Step 2: Run CI locally**: `npx nx run-many -t lint test build typecheck` → all green.
- [ ] **Step 3: Commit, push, open the PR**

```bash
git commit -am "docs(roadmap): slice 08 decisions and the repost item"
git push -u origin feat/slice-08-search-cost
gh pr create --base main --title "Slice 08: seniority levels, 1000-row runs, MENA, place and split checks"
```

The PR body lists the spec's "Rollout on dev" steps as checkboxes: deploy; `db:regenerate`; the tick checks; `db:place-coverage`; `db:split-check -- --dry-run`, then the paid run.
