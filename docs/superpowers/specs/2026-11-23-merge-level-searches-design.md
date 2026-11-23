# One LinkedIn search per place for every level

Date: 2026-11-23
Status: draft, awaiting owner approval
Size: small change

## Intent

The harvestapi job board runs one search per place, work type and single LinkedIn experience level (`f_E`). The search-precision spec (2026-11-14) split by level because "a job has one experience level, so split searches don't overlap". Since about 2026-11-18, LinkedIn ignores the level filter, so the four level searches of a place return largely the same rows, and each copy is billed.

Dev, 2026-11-23, ticks 09:00 and 10:00 UTC: 3,178 billed rows cost $3.29. 2,205 of them (about $2.28, 69%) were a row the same place's search had already returned for another level in the same tick. Only 924 rows were distinct. Of the 503 Europe jobs, 390 came back from two or more level searches, and 198 from all four. The $3 `COLLECTION_DAILY_BUDGET_USD` ran out after two ticks, so 11:00 and later ran nothing.

Goal _(user)_: each row is paid for once, and no job is lost.

## Goals

- A place and work type runs one harvestapi search per tick, filtered by the union of its builders' levels.
- On today's numbers, billed rows drop by about 70%, with the same distinct jobs per tick.

## Non-goals

- The remote leak: LinkedIn also ignores the workplace filter (on 11-23, 60% of remote-search rows were tagged hybrid or onsite). Work types stay separate searches, because the matcher really does reject the other types. This is a separate decision.
- The cheap*scraper and bebity trials. Both are off; they keep today's grouping *(my call)\_.
- The query recipe: builders stay one per level.

## Anti-goals

- Losing jobs: the merged search must ask for every level any member asks for, and for no level filter at all when a member has none.
- Asking for levels nobody wants. The union covers only the members' levels, so if LinkedIn starts honouring the filter again, internship and executive jobs stay out.

## Approaches

- **Merge at grouping time _(picked)_.** Drop the level from the harvestapi group key, and send the union of the members' levels. There is no recipe bump and no `db:regenerate`, builders and their claims and cursors are unchanged, and the change can be undone in code alone.
- Merge in the recipe: one builder per place and work type carrying every level. Same effect, but it needs a `QUERY_SEARCH_RECIPE_VERSION` bump and `db:regenerate` on dev, and it changes builder identity. Dropped.
- Drop the level filter entirely: same saving today, but if LinkedIn honours the filter again, we pay for internship and executive rows. Dropped.

## Design

- **Group key.** For `Channel.LINKEDIN_JOB_BOARD` only, the segment's group key (`segmentKey` → `linkedinGroupKey`) is place + work type, without the level. Trial channels keep the level in their key.
- **Actor input.** The harvestapi `experienceLevel` is the sorted, deduplicated union of the members' mapped levels. If any member has no level (an unstated seniority), the input sends no `experienceLevel`. Today `toHarvestJobSearchInput` reads the first member's params; the levels now come from all members.
- **One-search check.** `oneSearchInput` checks that members share the new level-less key, so a merged segment is still a single search.
- **Halving.** Unchanged. A group that fills its 1,000 rows is cut into member chunks, and each chunk sends the union of its own members' levels. Rows can repeat across chunks only in those capped hours, as they do today when keyword chunks overlap.
- **Segment identity.** Keys and hashes change once, at deploy. Searches always ask for the last hour, so the change loses no window. `linkedin_search_splits` keyed by the old groups (0 rows on dev today) is left alone.

## Rollout

1. Merge, then deploy the engine. Nothing to run on dev.
2. Measure the next weekday ticks on dev: the share of billed rows that the same place's search had already returned in the same tick (69% on 11-23) should be near 0, distinct jobs per tick and qualified jobs per profile should not drop, and spend per tick should drop by about the duplicate share.

## Left to the builder

- Tests: union and dedupe of levels, the no-level rule, trial channels keep their key, and a merged segment builds one input.
- How the level-less key is passed (a channel argument, or a separate function).
- Reports that group by the search key: `db:actor-compare` pairs cells by `linkedinGroupKey`, so harvestapi cells no longer pair with trial cells. Trials are off; a note in the report or its README is enough. `db:place-coverage` reads the level from builder params and keeps working.
- Whether the search-precision spec or roadmap slice 10 needs a note that the level split's premise no longer holds.
