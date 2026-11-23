# One LinkedIn search per place for every level: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The harvestapi LinkedIn job board runs one search per place and work type, filtered by the union of its builders' experience levels, instead of one search per level.

**Architecture:** Builders stay one per level. Only grouping changes: for `Channel.LINKEDIN_JOB_BOARD`, the segment key drops the level, so builders that differ only by level join one segment. The collector then sends the sorted union of the members' levels, or no level filter when any member has none. The trial channels (cheap_scraper, bebity) keep the level in their key and their one-level input.

**Tech Stack:** NestJS engine (`apps/xjobs`), TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-merge-level-searches-design.md`

## Global Constraints

- Only `Channel.LINKEDIN_JOB_BOARD` (harvestapi) changes. `LINKEDIN_JOB_BOARD_CHEAP` and `LINKEDIN_JOB_BOARD_BEBITY` keep today's key and input.
- No `QUERY_SEARCH_RECIPE_VERSION` bump and no change to builders, their hashes, claims or cursors.
- The merged search asks for every level any member asks for, and for no `experienceLevel` at all when any member has none.
- Work types stay separate searches.
- Halving (`parts`, `evenChunks`, `fitChunks`, `halve`) keeps its shape, but for harvestapi it cuts between keyword units, never inside one, so one keyword's levels never run twice (owner, 2026-11-23); trials and every other channel are unchanged.

## Review Focus

1. A member with no level (unstated seniority) next to members with levels: the merged input must omit `experienceLevel`, not send the other members' levels. Pinned in Task 1 (`mergedExperienceLevel`) and Task 2 (collector).
2. A group halved for the row cap: each chunk sends only its own members' levels. Pinned in Task 2 (collector test on a two-member chunk).
3. Trial channels: a cheap_scraper segment whose members differ by level must still be refused ("one search"), and trial keys keep the level. Pinned in Task 2.
4. Codes in an unusual order or repeated (`'4'` and `'4'`, `'5'` before `'3'`): the union is deduplicated and sorted, so the segment key and input are stable whatever the member order. Pinned in Task 1.
5. Different work types or places at the same level must still never merge. Pinned in Task 2 (the replaced segments test and the existing collector refusal test).

---

### Task 1: Level-less group key and merged levels in the harvestapi mapper

**Files:**

- Modify: `apps/xjobs/src/modules/collectors/providers/mappers/linkedin-job-board.mapper.ts`
- Test: `apps/xjobs/src/modules/collectors/providers/mappers/linkedin-job-board.mapper.spec.ts`

**Interfaces:**

- Produces:
  - `harvestGroupKey(params: Record<string, unknown>): string`: canonical JSON of `{ place: { geoId }, workplaceType? }`, the same shape as `linkedinGroupKey` without `experienceLevel`. Throws as `linkedinGeoId` does for a place with no geoId.
  - `mergedExperienceLevel(queries: readonly { params: Record<string, unknown> }[]): string | undefined`: the members' `f_E` codes (each `params.experienceLevel`, comma-split, trimmed), deduplicated, sorted ascending, comma-joined. Returns `undefined` when `queries` is empty or any member's `experienceLevel` is missing or not a non-empty string.
  - `linkedinGroupKey` keeps its exact behaviour (trials and `db:actor-compare` use it).

- [ ] **Step 1: Write the failing tests** in `linkedin-job-board.mapper.spec.ts`

```ts
describe('harvestGroupKey', () => {
  it('is the group key without the level', () => {
    const params = { location: 'Germany', experienceLevel: '4', workType: '2' };
    expect(harvestGroupKey(params)).toBe(linkedinGroupKey({ location: 'Germany', workType: '2' }));
  });
  it('is equal across levels and differs across work types', () => {
    const a = harvestGroupKey({ location: 'Germany', experienceLevel: '2' });
    expect(a).toBe(harvestGroupKey({ location: 'Germany', experienceLevel: '5' }));
    expect(a).not.toBe(harvestGroupKey({ location: 'Germany', workType: '3' }));
  });
});

describe('mergedExperienceLevel', () => {
  const q = (experienceLevel?: string) => ({
    params: experienceLevel === undefined ? {} : { experienceLevel },
  });
  it('is the sorted, deduplicated union of the members codes', () => {
    expect(mergedExperienceLevel([q('5'), q('3'), q('4'), q('4')])).toBe('3,4,5');
    expect(mergedExperienceLevel([q('4,5'), q('2')])).toBe('2,4,5');
  });
  it('is undefined when any member has no level', () => {
    expect(mergedExperienceLevel([q('4'), q()])).toBeUndefined();
    expect(mergedExperienceLevel([q('4'), q('')])).toBeUndefined();
  });
  it('is undefined for no members', () => {
    expect(mergedExperienceLevel([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `cd apps/xjobs && npx vitest run src/modules/collectors/providers/mappers/linkedin-job-board.mapper.spec.ts`
Expected: FAIL, `harvestGroupKey` / `mergedExperienceLevel` not exported.

- [ ] **Step 3: Implement both functions** in `linkedin-job-board.mapper.ts`. Share one private key builder with `linkedinGroupKey` (a flag for whether the level goes in) so the two keys can't drift apart. Give each a doc comment saying why harvestapi drops the level (LinkedIn has ignored `f_E` since about 2026-11-18; see the spec).

- [ ] **Step 4: Run the tests and check that they pass**

Same command. Expected: PASS, including the existing `linkedinGroupKey` tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/xjobs/src/modules/collectors/providers/mappers/linkedin-job-board.mapper.ts apps/xjobs/src/modules/collectors/providers/mappers/linkedin-job-board.mapper.spec.ts
git commit -m "feat(collect): harvestapi group key without the level, and merged levels"
```

---

### Task 2: Group and run harvestapi builders across levels

**Files:**

- Modify: `apps/xjobs/src/modules/segments/services/segments.ts` (`linkedinJobBoardKey`, ~line 41)
- Modify: `apps/xjobs/src/modules/collectors/utils/linkedin-board-run.ts` (`oneSearchInput`)
- Modify: `apps/xjobs/src/modules/collectors/providers/linkedin-job-board.collector.ts` (`input`, ~line 40)
- Modify: `apps/xjobs/src/scripts/actor-compare/` README or the report's header comment (one note)
- Modify: `docs/roadmap/phase-3-find-quality/10-search-yield.md` (one note)
- Test: `apps/xjobs/src/modules/segments/services/segments.spec.ts`, `apps/xjobs/src/modules/collectors/providers/segment-collect.spec.ts`

**Interfaces:**

- Consumes: `harvestGroupKey`, `mergedExperienceLevel` from Task 1.
- Produces:
  - `segmentKey` for `Channel.LINKEDIN_JOB_BOARD` is `${channel}|${type}|group:${harvestGroupKey(params)}`. Trial channels keep `linkedinGroupKey`. The `|unresolved:<id>` fallback is unchanged for all.
  - `oneSearchInput<T>(segment, build, key: (params: Record<string, unknown>) => string = linkedinGroupKey): T`: the members must share `key(params)`. The harvestapi collector passes `harvestGroupKey`; the cheap and bebity collectors pass nothing.
  - The harvestapi collector builds its input from `{ ...first.params, experienceLevel: mergedExperienceLevel(segment.queries) }` (an `undefined` level is dropped by `mapCodes`, so no filter is sent).

- [ ] **Step 1: Update and add the segment tests** in `segments.spec.ts`
  - Replace `keeps levels and work types apart` with `merges levels of one place and work type, and keeps work types and places apart`: the same four builders (no level, level `'4'`, work type `'2'`, France) now give **3** segments, and the Germany onsite segment holds the no-level and level-4 builders.
  - Replace `keeps user C Morocco onsite levels apart from other segments` with `merges user C Morocco onsite levels into one segment, apart from Europe`: 2 segments, the Morocco one with both `casa` members.
  - Add `keeps levels apart for the trial channels`: two `LINKEDIN_JOB_BOARD_CHEAP` builders at `'4'` and `'5'`, same place, give 2 segments.
  - Keep `keys the trial channel apart from the LinkedIn job board, by the same group`, but change its last assertions: `main` is `LINKEDIN_JOB_BOARD|onsite|group:${harvestGroupKey(params)}`, and the trial key still uses `linkedinGroupKey(params)`.

- [ ] **Step 2: Update and add the collector tests** in `segment-collect.spec.ts` (`describe('LinkedIn job board segment')`)
  - Replace `refuses members with different experience levels` with `runs members with different experience levels as one search for both`: members at `'4'` and `'5'` (Germany) give exactly one `run` call, whose input has `experienceLevel: ['mid-senior', 'director']`.
  - Add `sends no level when a member has none`: members at `'4'` and no level give an input with no `experienceLevel` key.
  - Keep the existing `refuses a segment whose members run different searches` test (members at `workType` none and `'2'`): different work types must still reject with `/one search/`.
  - Add `cheap_scraper still refuses members with different experience levels`: the same two members (`'4'` and `'5'`, Germany) in a `Channel.LINKEDIN_JOB_BOARD_CHEAP` segment, collected with `LinkedinJobBoardCheapCollector`, reject with `/one search/`, and `run` is never called (no trial spec has this test today).

- [ ] **Step 3: Run the tests and check that they fail**

Run: `cd apps/xjobs && npx vitest run src/modules/segments/services/segments.spec.ts src/modules/collectors/providers/segment-collect.spec.ts`
Expected: FAIL on the new and replaced tests (segments still split by level; the collector still refuses).

- [ ] **Step 4: Implement** the three code changes listed under Interfaces → Produces. In `segments.ts`, update the `SearchSegment.key` and `linkedinJobBoardKey` comments to say harvestapi groups without the level. In the collector, update the class comment the same way.

- [ ] **Step 5: Run the tests and check that they pass**

Run: `cd apps/xjobs && npx vitest run src/modules/segments src/modules/collectors`
Expected: PASS. In particular, `runs its one search and gives every member every item` still passes: its members have no level, so the input equals `toHarvestJobSearchInput(keyword, queries[0].params, 1000)`.

- [ ] **Step 6: Add the two notes**
  - `db:actor-compare` (its README, or the header comment of `scripts/actor-compare/queries.ts` if there is no README): from this change, a harvestapi run covers every level of its place and work type, while cells are still keyed per level, so harvestapi-vs-trial pairs from 2026-11-23 on aren't comparable per level. Trials are off.
  - Roadmap slice 10 (`10-search-yield.md`), under its findings: one line saying LinkedIn has ignored `f_E` since about 2026-11-18, and that harvestapi now runs one search per place and work type (link to the spec).

- [ ] **Step 7: Run what CI runs**

Run: `npx nx run-many -t lint test build typecheck`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/xjobs/src/modules/segments apps/xjobs/src/modules/collectors apps/xjobs/src/scripts/actor-compare docs/roadmap/phase-3-find-quality/10-search-yield.md
git commit -m "feat(collect): one harvestapi search per place and work type for every level"
```

---

## After merge (owner)

Deploy the engine; there is nothing to run on dev. Then, on the next weekday ticks, measure what the spec's Rollout lists: the share of same-place, same-tick repeat rows (69% on 11-23) should be near 0, distinct jobs per tick and qualified jobs per profile should not drop, and spend per tick should fall by about the duplicate share. Put the numbers in the PR.
