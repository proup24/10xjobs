# 08: Seniority to LinkedIn level

Found 2026-11-18 on `10xjobs-dev`. The user says the map is wrong. It gets its own brainstorm and spec.

## Problem

Each profile seniority is searched as LinkedIn experience levels (`f_E`). The builder deliberately takes neighbouring levels too, because posters tag loosely (`queries/channels/linkedin_board.builder.ts`, `EXPERIENCE_LEVELS`):

| Seniority              | Levels searched today |
| ---------------------- | --------------------- |
| junior                 | internship, entry     |
| mid                    | associate, mid-senior |
| senior                 | mid-senior            |
| staff, lead, principal | mid-senior, director  |

The user's correction: **junior is entry, not internship; staff is director, not mid-senior** _(user)_.

## What dev shows (2026-11-16 12:00 to 2026-11-17 17:00 UTC, 19 ticks)

- Each level is its own search per place and work type, so internship and director are 20 of the 50 searches.
- 10 director searches: 35 jobs, 0 qualified, 2 to review.
- 10 internship searches: 17 jobs, 0 qualified.
- 11 searches returned nothing in all 19 runs. 10 of them are director or internship searches; the other is Morocco remote entry.
- They cost almost nothing, because the actor charges per row.

## Open questions

- The full map per seniority: what do mid, senior, lead and principal search?
- Staff to director only would drop the mid-senior search for staff. On LinkedIn, most staff engineer jobs are tagged mid-senior. Is that loss wanted, or does staff keep mid-senior through the senior search when a profile picks both?
- The processor already reads seniority from the description, and the matcher checks it. How much should the search narrow, given the anti-goal of missing right jobs?
- LinkedIn's AI search may ignore `f_E` anyway (see [slice 07](07-trial-linkedin-actors.md), "LinkedIn's AI search"). Measure how often a returned job's level matches the searched one before relying on the filter.
- This is a query recipe change: bump the recipe version, then run `db:regenerate`.
