# 11: Monday checks

Checks run on Tuesday 2026-11-24 on `10xjobs-dev`. They were planned for Monday 2026-11-23, but Monday was cut short: the daily budget stopped collection after the 10:00 tick, and the new code only ran from 15:00 to 19:00. Tuesday is the first weekday with enough ticks on the new code. Each check says what to look at, what passing looks like, and what to do in either case. One section per source slice; checks from other slices are added below. Results are written under each section, dated 2026-11-24. Numbers are also on PRs [125](https://github.com/proup24/10xjobs/pull/125#issuecomment-7144546752), [124](https://github.com/proup24/10xjobs/pull/124#issuecomment-7144547358) and [106](https://github.com/proup24/10xjobs/pull/106#issuecomment-7144547950).

**Summary of 2026-11-24:**

- Slice 08: passed. Split-check is later in the week.
- PR 125: passed.
- PR 124: passed as specified. The UI check was not tested. Follow-up: [slice 12](12-activity-signals.md).
- Slice 09: checks 2, 3 and 7 failed, the rest passed. The slice stays open.
- PR 77: passed.

The worker was stopped by hand by the owner from 2026-11-23 20:00 to 2026-11-24 10:00 and from 13:00 to 18:00 on 11-24. These gaps are not outages. Tuesday is judged on the ticks at 10:00 to 12:00 (before pausing) and 19:00 to 20:00 (after pausing).

LinkedIn job-board collection runs hourly from 09:00 to 21:00 Morocco time, Monday to Friday (`0 9-21 * * 1-5`). Morocco is on UTC+0 since 2026-09-20, so ticks are on the UTC hour. Read-only checks run against `10xjobs-dev` (for Claude, through the `supabase-dev` MCP).

## Before the first tick (by 09:00)

These decide whether Monday produces any data at all.

| Check                                                                                                                                                                                | Pass                                                | If it fails                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apify monthly limit.** On 2026-11-20 Apify refused every start from 10:00 to 13:00 UTC ("monthly usage limit of $19.00"). Check the limit and the usage left in the Apify console. | Headroom for a full day: about $1 a tick, 13 ticks. | Raise the limit or add credit, or accept a short day and note it. Refused starts are stored at $0 as `failed` runs with that error, so the day's numbers will show them.                                       |
| **Daily budget.** `COLLECTION_DAILY_BUDGET_USD` defaults to $3. On 2026-11-20 it was reached at the 14:00 tick, and nothing ran after it.                                            | A deliberate value for the day, written down here.  | Keep $3 and expect Monday to stop after a few ticks, or raise it on the server's `.env` for one full day of data. A run with no recorded cost counts at its $1.10 cap until its cost is read, so leave margin. |

**Result, 2026-11-24.**

- **Apify limit:** about $5 left at 20:20 UTC, which covers the rest of Tuesday (only the 21:00 tick remained). Flag for Wednesday: $5 is less than one weekday (about $9.5 for the job board's day alone; posts have their own cap).
- **Daily budget:** `COLLECTION_DAILY_BUDGET_USD=10`, per channel, counted over the Morocco day (from 23:00 UTC). Posts have their own cap. Job-board spend for the day ended at $3.08 of $10.

## Slice 08: 1,000-row runs, levels, MENA

Spec: [seniority levels and paid repeats](../../superpowers/specs/2026-11-20-seniority-levels-and-paid-repeats-design.md). Merged in PR 99 and deployed 2026-11-20; `db:regenerate` was run the same day (50 to 27 active searches per LinkedIn job-board channel). Only two ticks ran on the new code that day, both clean, too few to judge spend.

Run after the first 2 to 3 ticks, then again at the end of the day.

| Check                                                                                                                                                                                                                                             | Pass                                                                               | If it fails                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Searches.** Active `LINKEDIN_JOB_BOARD*` builders with `params->>'experienceLevel' = '1'` or `location = 'mena'`.                                                                                                                               | None.                                                                              | A profile was published or regenerated on the old recipe. Run `db:regenerate` again (it now needs `POST_SEARCH_USERS` set where it runs), then re-check.                                                                                                               |
| **One run per chunk per tick.** Per tick, each search is run once. Since PR 125 a place and work-type group is split into keyword-unit chunks, so 19 runs over 9 groups is correct. Compare runs against distinct `segmentKey` and `segmentHash`. | Every chunk unique each tick, and every search run once, except halves of a split. | A search is being rerun. Look at that segment's runs (`fetched`, `truncatedQueryIds`) and open a bug against slice 08's `collectSegment`.                                                                                                                              |
| **Full at 1,000 rows.** Runs with `fetched >= 1000`; on the server, worker log lines `full at 1000 rows`.                                                                                                                                         | None, or rare. On 2026-11-20 the largest run was 175 rows.                         | Multi-member group: a split should follow (a `linkedin_search_splits` row, two half runs). One member: that hour's older postings were lost. If the same search is full on several ticks, take it to [slice 10](10-search-yield.md) (narrow the keyword or the place). |
| **Splits.** Rows in `linkedin_search_splits`; worker log lines `cut into ... parts`.                                                                                                                                                              | Any split has both halves stored and moved cursors.                                | A half that keeps failing holds the group's cursors, so the hour is retried. Read the half's `error`. Splits have never fired on dev, so record the first one here.                                                                                                    |
| **Missing costs.** Runs with `costMicroUsd IS NULL`.                                                                                                                                                                                              | None, or each filled in by the next tick's cost settling.                          | Each counts at $1.10 against the day. If one stays null after an hour, read its `apifyRunId` in the Apify console and open a bug on `settleCosts`.                                                                                                                     |
| **Capped runs.** Runs with `capped = true`.                                                                                                                                                                                                       | None. The $1.10 cap is above 1,000 rows' cost.                                     | A runaway run or a price change. Check the actor's pricing; raise `maxRunChargeUsd` only if the price changed.                                                                                                                                                         |
| **Spend.** harvestapi cost and rows per tick, against the same hours on 2026-11-17 to 2026-11-19 (same-tick repeats were 26% of paid rows).                                                                                                       | No repeated rows inside a tick; cost close to rows × $0.001.                       | Spend per tick well above the baseline with no repeats points at job volume, not the change. Note the bulk posters ([slice 10](10-search-yield.md)) before drawing a conclusion.                                                                                       |
| **Refused or failed runs.** `status = 'failed'` per tick, grouped by `error`.                                                                                                                                                                     | Only refusals already explained above, or none.                                    | A new error: read it before the next tick. Apify refusals are the limit; anything else is a bug.                                                                                                                                                                       |

**Result, 2026-11-24: passed.**

- **Searches:** 0 old-recipe builders.
- **One run per chunk:** passed. Each tick ran 19 runs over 9 `segmentKey` groups, every (`segmentKey`, `segmentHash`) unique, and each of the 63 searches ran once (63 queries in 63 slots; 27 in 27 after pausing). No repeated runs.
- **Full at 1,000 rows, capped, missing costs, failed:** since 11-23 15:00, 167 runs, none full, none capped, none with a missing cost after an hour, none failed. The largest run fetched 225 rows.
- **Splits:** `linkedin_search_splits` is empty. No run came near 1,000 rows, so none was needed.
- **Spend:** $0.75 to $0.90 a tick on the new code, about $0.00103 per billed row, against $1.92 at 10:00 on 11-23. Each search runs once per tick (63 searches in 63 slots), so the remaining 30 to 39% repeat share is rows found by more than one search in the same tick (see PR 125 below).

### Later in the week

| Check                                                                                                            | Pass                                                                              | If it fails                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`db:place-coverage`** after 3 to 5 weekdays on the new searches.                                               | A table per place; the places that find almost nothing alone are listed.          | Not a pass or fail: it feeds the next place decision. A place with near-zero jobs of its own and no qualified ones is a candidate to drop, decided with the user.                          |
| **`db:split-check -- --dry-run`**, then the paid run (maintainer only, at most $0.48). Check Apify credit first. | Coverage of 95% or more: halving keeps the merged search's jobs. Slice 08 closes. | Under 95%: halving loses jobs. Reopen option B (no halving) with a brainstorm. Inconclusive (a run full, capped, empty or not succeeded): pick another group with `--group` and run again. |

## Slice 09: non-remote leak

Spec: [non-remote leak](../../superpowers/specs/2026-11-20-non-remote-leak-design.md). Merged and deployed on 2026-11-20:

- PR 101: a mentioned office binds hybrid and onsite openings; an opening with no stated arrangement is checked as office-based.
- PR 103: the LinkedIn place fills every opening without a place.
- PR 105: the new processor prompt (arrangement needs words or office evidence; limits bind the person; authorization lines give no place).
- PR 106: residence binds only on `limit` places, for extractions from the cut-over on.

**Cut-over:** 2026-11-20 14:50 UTC, when PR 105's prompt went live. The owner decided not to reprocess old jobs, so PRs 105 and 106 apply only to jobs extracted after it. Each facts document carries `limitsBindPerson` (true from the cut-over on).

**Measured:**

- PRs 101 and 103 on 2026-11-20. Non-remote leaks outside Morocco went from 37 to 0, review went from 220 to 199, and remote-only qualified jobs held at 184. Numbers are on PRs 101 and 103.
- PR 106's rebuild on 2026-11-21. All 6,713 old decisions are unchanged: 211 qualified, 202 review, 56 label-only residence fails.
- No job had gone through the new prompt by 2026-11-21, so checks 2 to 8 below are the first test of PRs 105 and 106.

Run check 1 at any time. Run checks 2 to 8 at the end of the day, or once the precondition holds. The queries are below the table. "New" means extraction `createdAt >= '2026-11-20T14:50:00Z'`, and "old" means before it.

| Check                                                                                                                                                        | Pass                                                                                                                                                                                                                                                                                                                                               | If it passes                | If it fails                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Precondition: new jobs.** Q-A, the count of new extractions.                                                                                               | 100 or more. Fewer makes the rates below noise.                                                                                                                                                                                                                                                                                                    | Run checks 2 to 8.          | 0: no collection (see "Before the first tick"). Under 100: run checks 2 to 8 anyway as a smoke test, and repeat them later in the week before closing the slice.                                                                                                                                                                                 |
| **1. Old jobs untouched (PR 106).** Q-B, old-job label-only residence fails, qualified and review.                                                           | Label-only residence fails are 56 or fewer (they fall only as jobs close). No old decision changed outcome under `MATCHER_VERSION` 11.                                                                                                                                                                                                             | Nothing to do.              | Old jobs moved, so the cut-over gate leaks. Check that old facts have `limitsBindPerson = false` (Q-F) and that `residenceApplies` is called with it. Fix before more new jobs pile up.                                                                                                                                                          |
| **2. No non-remote leaks on new jobs (PRs 101, 103).** Q-C, new qualified matches outside Morocco, by bucket.                                                | 0 `hybrid-onsite-only` and 0 `unstated`.                                                                                                                                                                                                                                                                                                           | Nothing to do.              | Read each leaking job's location `detail` and `reason`. A placeless opening points at the PR 103 fill. A `mention` that passed hybrid or onsite points at PR 101's `checkArrangement`. Open a bug with the job id.                                                                                                                               |
| **3. Arrangement read strictly (PR 105).** Q-D, arrangement conflicts per 100 jobs, new against old, and the conflicts whose quote has no arrangement words. | New conflicts per 100 jobs below old (old: 4.1, 286 of 6,901 open jobs on 2026-11-21). New conflicts with no arrangement words near 0 (old: 107).                                                                                                                                                                                                  | Post the numbers on PR 105. | Read the quotes. A place, residence or permit line read as hybrid or onsite means the prompt rule isn't followed: add the line as a golden case, fix the prompt, run `processor:eval`. Each prompt fix applies only to jobs extracted after it.                                                                                                  |
| **4. Authorization lines give no place (PR 105).** Q-E, new openings with a place whose quote is an authorization line.                                      | 0.                                                                                                                                                                                                                                                                                                                                                 | Nothing to do.              | Same route as check 3 (golden case, prompt fix, eval). Known edge case: "legally eligible to work from France, Belgium or Spain" (golden case 7824) is still read as a `limit`; the owner decides on that one.                                                                                                                                   |
| **5. A `label` no longer binds residence on new jobs (PR 106).** Q-B on new jobs, and Q-F.                                                                   | New label-only residence fails are 0, while a `limit` still fails residence for non-residents (count above 0, if any new job has one). Q-F: every new facts document has `limitsBindPerson = true`, every old one `false`. Old facts showing `null` are facts not rebuilt since PR 106 (jobs with no match, 125 on 2026-11-21) and can be ignored. | Post the numbers on PR 106. | `limitsBindPerson` is false on new facts: check `loadInputs` returns the extraction's `createdAt`. Labels still bind: check `decide` passes the flag (the decide-level test for it is missing from `main`, see "after the checks").                                                                                                              |
| **6. Review does not grow.** Q-B, review share, new against old, and `db:match-shares -- --days 7` (review share per rule).                                  | New review share at or under old (202 of 6,713, about 3.0%).                                                                                                                                                                                                                                                                                       | Nothing to do.              | Find the rule with `db:match-shares`. Location: look for an unsure `["hybrid","remote"]` opening that fails on a mentioned office and unsure time zones (accepted in PR 101), or an unsure office opening whose place now comes from LinkedIn (accepted in PR 103). If either is more than a handful, make that failure sure in `openingUnsure`. |
| **7. Rejections name their cause.** Read about 10 new location rejections (Q-G).                                                                             | Each `reason` names its cause. Examples: an office that doesn't fit, "no source states the arrangement, so it is checked as office-based", "requires living there" (only for `limit` places), or an authorization failure.                                                                                                                         | Nothing to do.              | A rejection with a vague reason breaks the "decisions record a reason" convention. Fix its wording in `checkLocation`.                                                                                                                                                                                                                           |
| **8. Processor health.** Processing errors on new jobs, and cost per job.                                                                                    | No spike in `processingError`; cost about $0.044 a job (the eval's rate).                                                                                                                                                                                                                                                                          | Nothing to do.              | Read the errors. A prompt-related validation error means the prompt broke an output rule. Revert PR 105's last commit or fix it, then run `processor:eval`.                                                                                                                                                                                      |

**Result, 2026-11-24: checks 2, 3 and 7 failed; the others passed. Slice 09 stays open.** Numbers for checks 1 and 5 are also on [PR 106](https://github.com/proup24/10xjobs/pull/106#issuecomment-7144547950). Precondition: 4,851 new extractions (2,998 at 10:00).

| Check                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Old jobs untouched          | Passed, on a ruling. Label-only residence fails on old jobs are 57 against the bar of 56. Profile 9074f82b is still exactly 56. The extra one is profile 789aad57 (published 11-21) deciding an old job for the first time under the old rule, on 11-21 16:47. No old decision changed, and the matcher version is still 11.                                                                                                                                              |
| 2. No non-remote leaks         | **Failed.** New qualified matches outside Morocco: remote-only 82, remote plus other 9, hybrid or onsite only 1, unstated 0. The leak is job 01a207aa-350c-7612-80b2-9e694d3e6a25, "Artificial Intelligence Consultant" (country DK, LinkedIn arrangement hybrid). The place EMEA was taken as a `mention` from "deliver ... solutions across EMEA", and the job qualified for profile 789aad57 ("hybrid in EMEA fits"). A sales-area mention stood in for the DK office. |
| 3. Arrangement read strictly   | **Failed.** Conflicts per 100 open jobs: new 4.8 (235 of 4,851), old 4.2 (287 of 6,894). Conflicts with no arrangement words: new 76, old 107, where the bar is near 0.                                                                                                                                                                                                                                                                                                   |
| 4. Authorization lines         | Passed, on a ruling. Q-E returned 6 rows. All six quotes also state a place ("based in Canada" once, "work from the European Union region and a work permit" four times, "reside and are authorized to work within the United States" once). No place came from an authorization-only line, so the regex matches are false positives.                                                                                                                                     |
| 5. A `label` no longer binds   | Passed. New label-only residence fails: 0. New `limit` residence fails: 345. Q-F: new facts `true` 3,886, old `false` 6,706, old `null` 125 (ignored).                                                                                                                                                                                                                                                                                                                    |
| 6. Review does not grow        | Passed. Review share new 0.4% (41 of 11,658), old 1.7% (340 of 20,101; baseline 3.0%). `db:match-shares` was not run (owner command).                                                                                                                                                                                                                                                                                                                                     |
| 7. Rejections name their cause | **Failed.** Of the 10 newest location rejections, 6 read "job location (hybrid in Dublin) does not fit your wanted arrangements (remote, hybrid, onsite)" (and the same for remote in GB and hybrid in Lisbon). The named arrangement is in the wanted list, so the reason hides the real cause, which is the place. The other 4 were good.                                                                                                                               |
| 8. Processor health            | Passed. `processingError`: new 0 of 4,851, old 0 of 6,894. Average cost new $0.036, old $0.042 (bar about $0.044).                                                                                                                                                                                                                                                                                                                                                        |

**Follow-ups for the failures:**

- **Check 2:** open a bug for job 01a207aa-350c-7612-80b2-9e694d3e6a25, where an EMEA mention stood in for the DK office. Look at PR 101's `checkArrangement` (a mention passed hybrid) and at a description mention outranking the LinkedIn place.
- **Check 3:** read the quotes, add golden cases, fix the prompt, run `processor:eval`. This is a brainstorm.
- **Check 7:** fix the wording in `checkLocation`, so the reason names the place and not the arrangement.

The "After the checks" steps below were not run, because checks 2 and 3 failed: the `a680c99` PR was not opened and the worktrees were not removed.

**After the checks.**

- **If checks 1 to 6 pass** (with 100 or more new jobs):
  1. Post the numbers on PRs 105 and 106.
  2. Open the small PR with the missing decide-level test. It was in commit `a680c99` on `feat/residence-limit-only`, which missed PR 106's merge.
  3. Remove the slice 09 worktrees (`.worktrees/slice-09-non-remote`, `non-remote-matcher`, `listing-place-fill`, `arrangement-evidence-prompt`, `residence-limit-only`) and the progress ledger.
  4. Slice 09 is closed. The roadmap row already reads Done.
- **If any of checks 1 to 6 fails:** the slice stays open. Follow that row's "If it fails" first. Checks 1 and 2 come before anything else, because they are wrong matches.

Parked follow-ups, not blocking:

- a default between hybrid and onsite for office evidence alone;
- the office-based reason on jobs that mix a stated opening with one that has no arrangement;
- two older golden place labels on time-zone lines (cases 129 and 1207);
- reading the arrangement from the ATS posting.

### Slice 09 queries

Q-A, new extractions:

```sql
select count(*) from job_extractions where "createdAt" >= '2026-11-20T14:50:00Z';
```

Q-B, outcomes and label-only residence fails, new against old (location is the only failing rule, failing on residence through a `label`):

```sql
with m as (
  select e."createdAt" >= '2026-11-20T14:50:00Z' as new_prompt, m.outcome, m.checks
  from job_matches m join normalized_jobs n on n.id = m."jobId"
  join job_extractions e on e.id = n."currentExtractionId"
  where m."matcherVersion" = 11
), f as (
  select *, exists (
      select 1 from jsonb_array_elements(checks) c, jsonb_array_elements(c->'detail') d
      where c->>'rule' = 'location' and c->>'outcome' = 'fail'
        and (d->'residence'->>'decided')::boolean and d->>'placeStrictness' = 'label') as label_res,
    exists (
      select 1 from jsonb_array_elements(checks) c, jsonb_array_elements(c->'detail') d
      where c->>'rule' = 'location' and c->>'outcome' = 'fail'
        and (d->'residence'->>'decided')::boolean and d->>'placeStrictness' = 'limit') as limit_res,
    (select count(*) from jsonb_array_elements(checks) c where c->>'outcome' = 'fail') as fails
  from m
)
select case when new_prompt then 'new' else 'old' end as jobs, count(*) as decisions,
  count(*) filter (where outcome = 'qualified') as qualified,
  count(*) filter (where outcome = 'review') as review,
  round(100.0 * count(*) filter (where outcome = 'review') / count(*), 1) as review_pct,
  count(*) filter (where label_res and fails = 1) as label_only_residence_fails,
  count(*) filter (where limit_res) as limit_residence_fails
from f group by new_prompt;
```

Q-C, new qualified matches outside Morocco, by arrangement bucket:

```sql
with q as (
  select m."jobId", f.facts from job_matches m
  join job_facts f on f."jobId" = m."jobId"
  join normalized_jobs j on j.id = m."jobId"
  join job_extractions e on e.id = j."currentExtractionId"
  where m.outcome = 'qualified' and e."createdAt" >= '2026-11-20T14:50:00Z'
    and f.facts::text !~ '"(countryCode|code)": "MA"' and coalesce(j."countryCode", '') <> 'MA'
), b as (
  select "jobId",
    bool_and(o->'arrangements' = '["remote"]'::jsonb) as remote_only,
    bool_or(o->'arrangements' ? 'remote') as any_remote,
    bool_and(not (o->'arrangements' ?| array['remote','hybrid','onsite'])) as all_unstated
  from q, jsonb_array_elements(q.facts->'openings') o group by 1
)
select case when remote_only then 'remote-only' when any_remote then 'remote+other'
            when all_unstated then 'unstated' else 'hybrid-onsite-only' end as bucket,
  count(*) from b group by 1 order by 1;
```

Q-D, arrangement conflicts, new against old:

```sql
with j as (
  select n.id, e."createdAt" >= '2026-11-20T14:50:00Z' as new_prompt
  from normalized_jobs n join job_extractions e on e.id = n."currentExtractionId" where not n.closed
), c as (
  select c."jobId", c.quote ~* '(remote|hybrid|on-?site|office|telework|teletrabaj|home|commut|in person|in-person|relocat|büro|bureau|oficina|presencial|mobil)' as words
  from job_fact_conflicts c join normalized_jobs n on n.id = c."jobId" and c."extractionId" = n."currentExtractionId"
  where c.field = 'arrangement'
)
select case when j.new_prompt then 'new' else 'old' end as jobs, count(distinct j.id) as jobs_n,
  count(distinct c."jobId") as conflicts,
  round(100.0 * count(distinct c."jobId") / count(distinct j.id), 1) as per_100,
  count(distinct c."jobId") filter (where not c.words) as conflicts_without_words
from j left join c on c."jobId" = j.id group by j.new_prompt;
```

Q-E, new openings with a place taken from an authorization line:

```sql
select n.id, n.title, o->>'quote' as quote, o->'places' as places
from normalized_jobs n
join job_extractions e on e.id = n."currentExtractionId"
join job_facts f on f."jobId" = n.id, jsonb_array_elements(f.facts->'openings') o
where e."createdAt" >= '2026-11-20T14:50:00Z'
  and o->>'placesSource' = 'description' and jsonb_array_length(o->'places') > 0
  and o->>'quote' ~* '(authori[sz]ed to work|eligible to work in|work permit|citizen|clearance)';
```

Q-F, `limitsBindPerson` against the extraction's age:

```sql
select e."createdAt" >= '2026-11-20T14:50:00Z' as new_prompt,
  f.facts->>'limitsBindPerson' as limits_bind_person, count(*)
from job_facts f join normalized_jobs n on n.id = f."jobId"
join job_extractions e on e.id = n."currentExtractionId"
group by 1, 2 order by 1, 2;
```

Q-G, ten new location rejections and their reasons:

```sql
select n.id, left(n.title, 50) as title, c->>'reason' as reason
from job_matches m join normalized_jobs n on n.id = m."jobId"
join job_extractions e on e.id = n."currentExtractionId", jsonb_array_elements(m.checks) c
where m.outcome = 'rejected' and c->>'rule' = 'location' and c->>'outcome' = 'fail'
  and e."createdAt" >= '2026-11-20T14:50:00Z'
order by m."updatedAt" desc limit 10;
```

## Other checks

Checks from other slices go here, one section per slice, in the same shape: check, pass, if it fails.

### PR 125: merged level searches

Merged 2026-11-23 (cc5aead2). Searches for a place and work type are chunked by keyword unit. The simulation said 54 to 19 runs a tick.

| Check                                                                                                          | Pass                                                        | If it fails                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Repeat share.** Rows billed more than once in a tick, on ticks run on the new code.                          | Under 40% (70% on the old code).                            | Look at which searches overlap. Overlap inside one tick that is not cross-keyword points at the chunking. |
| **Distinct items.** Distinct items and jobs per tick, against 11-23 09:00 and 10:00 on the old code.           | Within the old range (390 to 556 items; 492 jobs at 10:00). | Yield dropped: chunks are losing jobs. Compare per search before blaming the places.                      |
| **Spend.** Cost per tick.                                                                                      | Well under the old $1.92 at 10:00.                          | Look at runs per tick and rows per run.                                                                   |
| **Qualified per profile.** Qualified matches per tick, counting jobs first seen in each tick, old against new. | Not lower in total. Small profiles are noise.               | Check the matcher before the searches. Fewer qualified with the same items points at the decisions.       |

**Result, 2026-11-24: passed.** Details on [PR 125](https://github.com/proup24/10xjobs/pull/125#issuecomment-7144546752).

- **Repeat share:** 30.0% to 38.6% on every new tick (old: 70%).
- **Distinct items:** 505 to 571 across the new ticks, average 530 against 473 on the old code. Distinct jobs at 10:00: 515 against 492.
- **Spend:** $0.75 to $0.90 a tick, against $1.92.
- **Qualified:** 8 a tick across all profiles on the old code and 11 on the new. Per profile, 0.71, 0.43 and 9.9 a tick against 1, 1 and 6. The two small profiles get 0 to 3 a tick, which is too few to judge per profile.
- The 13:00 to 18:00 ticks on 11-24 did not run (worker stopped by hand), so this check is judged on ticks up to 12:00.

### PR 124: paused searches

Merged 2026-11-23. A user with no activity signal for 24 hours has their LinkedIn job-board builders paused. The first pause could come about 14:04 UTC on 11-24.

| Check                                                                                               | Pass                                                                            | If it fails                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Which builders paused.** Paused builders and their users, against the activity signals.           | Only users with no decision, delivered webhook, resume or publish for 24 hours. | Read the pause rule in `activity.sql.ts` against that user's rows. |
| **Spend after pausing.** Job-board spend per tick before and after.                                 | Lower after, with the paused searches gone from the plan.                       | Check that the plan really skips the paused builders.              |
| **Matches notice and Resume (UI).** The owner opens Matches on a paused account and presses Resume. | The notice shows, and Resume wakes the builders on the next tick.               | Open a bug on the web app.                                         |

**Result, 2026-11-24: passed as specified.** Details on [PR 124](https://github.com/proup24/10xjobs/pull/124#issuecomment-7144547358).

- **Paused:** 36 job-board builders at the 19:00 tick, all for one user (52545557, profiles 37323281 and 789aad57). Their last signal was the deploy-day reset (`searchesResumedAt` 11-23 14:05). They have no decisions, no webhooks and 41 undecided qualified matches (the oldest from 11-21). The first tick past the 24-hour grace that ran was 19:00.
- **Spend:** before (10:00 to 12:00) $0.82 a tick, 19 runs, 63 searches. After (19:00 to 20:00) $0.42, then $0.20 (average $0.31), 9 runs, 27 searches. The repeat share fell to 0.2%.
- **UI check: not tested.** None of the owner's accounts are paused.
- **Webhook signal: untested on dev.** No webhook has ever existed there (0 inserts since 2026-11-03).
- **Follow-up:** [slice 12](12-activity-signals.md). The paused user had opened 8 jobs' post or apply links (`job_views`), 3 in the 24 hours before the pause and the last at 12:28 UTC. The owner decided that viewing jobs counts as activity, so this pause should not have happened. Slice 12 adds `job_views` as a signal.

### PR 77: duplicate requirements

Merged 2026-11-16. The processor sometimes returned two requirements for the same technology, which failed validation and cost a retry.

| Check                                                                                                      | Pass                                                         | If it fails                                                           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| **Duplicate failures.** Processing attempts per day that failed with "appears twice" or "same technology". | Far below the 42 of 11-16, and every one recovered on retry. | Read the failing jobs. A new pattern needs a prompt or schema change. |

**Result, 2026-11-24: passed.** Failures per day: 11-16 42, 11-17 4, 11-18 3, 11-19 4, 11-20 1, 11-23 8, 11-24 2 (of 2,185 and 1,776 attempts). All 10 since 11-21 are two-place duplicates, one in a group and one on its own (Vue and Vue 3, Apex and Salesforce platform three times, Power Platform and Copilot Studio, React and Remix, Elixir and Elixir-Phoenix). Since 11-17 there were 22 failed attempts on 19 distinct extractions. All 19 extractions succeeded on a later attempt and are now processed with no error, at about $0.04 per attempt. The owner decided not to merge two-place duplicates. If it recurs, widen the vocabulary with `db:vocab` (Copilot Studio and Power Automate to `power_platform`, Remix to `react`).

## Left out

These were in the spec and did not run on 2026-11-24.

| Item                                                     | Why it is out                                             | Where it went                 |
| -------------------------------------------------------- | --------------------------------------------------------- | ----------------------------- |
| `db:place-coverage`                                      | Needs 3 to 5 weekdays on the new searches                 | Slice 11, "Later in the week" |
| `db:split-check` (paid)                                  | Paid, maintainer only, later in the week                  | Slice 11, "Later in the week" |
| `db:spellings -- --days 7` (PR 113)                      | Needs 7 days                                              | Around 2026-11-28             |
| Indeed actor re-run (PR 120)                             | Paid; planned for Wednesday                               | Phase 5 slice 01              |
| Publish/edit and webhook UI checks (PRs 112, 114, 72-76) | Do not depend on a weekday                                | Their own rollout notes       |
| Webhook end-to-end check                                 | No webhook has ever existed on dev, so nothing to observe | Their own rollout notes       |
| Post search slices                                       | Run every day                                             | Phase 4 rollouts              |
