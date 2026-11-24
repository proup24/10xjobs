# Slice 11: weekday checks for last week's builds

Date: 2026-11-24
Status: draft, awaiting approval
Slice: [11 Monday checks](../../roadmap/phase-3-find-quality/11-monday-checks.md)

## Intent

Several builds from last week shipped to `10xjobs-dev` and could only be confirmed on a weekday, because LinkedIn job-board collection runs Monday to Friday. This is a one-time check of those builds: run each check once, write down the result, and then close each build or open a fix for it. It adds no tooling and nothing that recurs.

## Why the day moves to Tuesday 2026-11-24

Monday 2026-11-23 was not a full day:

- 09:00 and 10:00 UTC ran on the old code ($3.29). The $3 daily budget then stopped the job board until 15:00.
- 15:00 to 19:00 ran on PR 125's merged level searches, 19 runs a tick.
- 20:00 and 21:00 ran nothing. Post search (hourly, every day) also ran nothing from 20:00 on 11-23 to 09:00 on 11-24, which points at the engine being down or stuck, not at a budget.
- Pausing (PR 124) only starts pausing around 14:04 UTC on 11-24.

So the checks are judged on **Tuesday 2026-11-24** _(my call; the owner agreed to the checks)_. Checks that need only the post-deploy ticks can use 11-23 15:00 to 19:00 if Tuesday is cut short. A check with too little data says so and is not counted as a pass.

## Goals

- A recorded result for each build below: pass, fail (with the fix to make), or not enough data.
- Slices 08 and 09 closed if their checks pass, using the close-out steps already written in slice 11.
- Slice 11's roadmap doc updated at the end to show which checks are done, their results, and which items were left out and where they went.

## Non-goals

- No new scripts, commands or report pages.
- No fixes inside this slice. A failing check leads to its own bug, brainstorm or PR.
- No paid Apify runs (`db:split-check` and the Indeed re-run stay out).

## Anti-goals

- Calling a check passed on too little data, or on the old code's ticks.
- Spending past the budget without the owner knowing about it.

## Constraints

- Claude reads `10xjobs-dev` only through the read-only `supabase-dev` MCP. It has no SSH access to the hosted engine, so the owner does the server side: worker logs, `.env`, and the Apify console.
- Results go in the slice 11 doc, and the numbers also go on the PRs they measure. The doc change goes through a docs branch and a PR.

## What is checked

1. **Before the next tick: budget, limit and the overnight gap.** The owner confirms the `COLLECTION_DAILY_BUDGET_USD` value for Tuesday (about $0.85 a tick on the new code; 13 ticks is about $11) and the Apify headroom. The owner also reads the worker log for 11-23 20:00 to 11-24 10:00 to find out why no schedules ran.
2. **Slice 08 (PR 99), rewritten for PR 125.** The searches keep no `experienceLevel = '1'` and no `mena`. "One run per search per tick" now means one run per merged place and work-type group, except halves. Plus full at 1,000 rows, splits, missing costs, capped runs, and failed runs grouped by error.
3. **Merged level searches (PR 125).** Per tick on the new code: the share of repeated rows (30% at 11-23 16:00, all of it cross-keyword), distinct jobs, qualified jobs per profile, and spend. These are compared like-for-like with 11-23 09:00 and 10:00 on the old code (1,864 rows, 556 distinct, $1.92 at 10:00).
4. **Paused searches (PR 124).** After about 14:04 UTC: which builders paused and for which users, the job-board spend after pausing against before, and (owner, in the UI) the Matches notice plus Resume waking the builders on the next tick.
5. **Slice 09 (PRs 101 to 106).** Checks 1 to 8 and queries Q-A to Q-G, as written in slice 11. The precondition already holds: 2,998 new extractions.
6. **Duplicate requirements (PR 77).** Processing errors containing `appears twice` or `same technology` since 11-16. Pass: close to zero.

## Left out, and where it goes

| Item                                                     | Why it is out                             | Where it goes                 |
| -------------------------------------------------------- | ----------------------------------------- | ----------------------------- |
| `db:place-coverage`                                      | Needs 3 to 5 weekdays on the new searches | Slice 11, "Later in the week" |
| `db:split-check` (paid)                                  | Paid, maintainer only, later in the week  | Slice 11, "Later in the week" |
| `db:spellings -- --days 7` (PR 113)                      | Needs 7 days                              | Around 2026-11-28             |
| Indeed actor re-run (PR 120)                             | Paid; planned for Wednesday               | Phase 5 slice 01              |
| Publish/edit and webhook UI checks (PRs 112, 114, 72–76) | Do not depend on a weekday                | Their own rollout notes       |
| Post search slices                                       | Run every day                             | Phase 4 rollouts              |

## Close-out (agreed with the owner)

When the checks are done and pass, the agent updates `docs/roadmap/phase-3-find-quality/11-monday-checks.md`:

- Mark each check done, with its date and result (numbers inline, or a link to the PR comment).
- List the left-out items above and where each went.
- Update the slice 11 row in the Phase 3 README, and the rows for slices 08 and 09 if they close.

A failing check is marked as failed with its follow-up, and its slice stays open.

## Left to the builder

- The exact SQL for checks 2 to 4 and 6. The paused-builder columns and the repeat-share definition come from PRs 124 and 125.
- How to word the PR comments.
