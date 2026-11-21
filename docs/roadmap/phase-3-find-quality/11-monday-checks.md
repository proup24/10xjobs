# 11: Monday checks

Checks to run on Monday 2026-11-23 on `10xjobs-dev`. This is the first full weekday after several changes went live. Each check says what to look at, what passing looks like, and what to do in either case. One section per source slice; checks from other slices are added below.

LinkedIn job-board collection runs hourly from 09:00 to 21:00 Morocco time, Monday to Friday (`0 9-21 * * 1-5`). Morocco is on UTC+0 since 2026-09-20, so ticks are on the UTC hour. Read-only checks run against `10xjobs-dev` (for Claude, through the `supabase-dev` MCP).

## Before the first tick (by 09:00)

These decide whether Monday produces any data at all.

| Check                                                                                                                                                                                | Pass                                                | If it fails                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apify monthly limit.** On 2026-11-20 Apify refused every start from 10:00 to 13:00 UTC ("monthly usage limit of $19.00"). Check the limit and the usage left in the Apify console. | Headroom for a full day: about $1 a tick, 13 ticks. | Raise the limit or add credit, or accept a short day and note it. Refused starts are stored at $0 as `failed` runs with that error, so the day's numbers will show them.                                       |
| **Daily budget.** `COLLECTION_DAILY_BUDGET_USD` defaults to $3. On 2026-11-20 it was reached at the 14:00 tick, and nothing ran after it.                                            | A deliberate value for the day, written down here.  | Keep $3 and expect Monday to stop after a few ticks, or raise it on the server's `.env` for one full day of data. A run with no recorded cost counts at its $1.10 cap until its cost is read, so leave margin. |

## Slice 08: 1,000-row runs, levels, MENA

Spec: [seniority levels and paid repeats](../../superpowers/specs/2026-11-20-seniority-levels-and-paid-repeats-design.md). Merged in PR 99 and deployed 2026-11-20; `db:regenerate` was run the same day (50 to 27 active searches per LinkedIn job-board channel). Only two ticks ran on the new code that day, both clean, too few to judge spend.

Run after the first 2 to 3 ticks, then again at the end of the day.

| Check                                                                                                                                       | Pass                                                         | If it fails                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Searches.** Active `LINKEDIN_JOB_BOARD*` builders with `params->>'experienceLevel' = '1'` or `location = 'mena'`.                         | None.                                                        | A profile was published or regenerated on the old recipe. Run `db:regenerate` again (it now needs `POST_SEARCH_USERS` set where it runs), then re-check.                                                                                                               |
| **One run per search per tick.** Per tick, `search_segment_runs` count against distinct `segmentKey` for harvestapi batches.                | Equal, except halves of a split.                             | A search is being rerun. Look at that segment's runs (`fetched`, `truncatedQueryIds`) and open a bug against slice 08's `collectSegment`.                                                                                                                              |
| **Full at 1,000 rows.** Runs with `fetched >= 1000`; on the server, worker log lines `full at 1000 rows`.                                   | None, or rare. On 2026-11-20 the largest run was 175 rows.   | Multi-member group: a split should follow (a `linkedin_search_splits` row, two half runs). One member: that hour's older postings were lost. If the same search is full on several ticks, take it to [slice 10](10-search-yield.md) (narrow the keyword or the place). |
| **Splits.** Rows in `linkedin_search_splits`; worker log lines `cut into ... parts`.                                                        | Any split has both halves stored and moved cursors.          | A half that keeps failing holds the group's cursors, so the hour is retried. Read the half's `error`. Splits have never fired on dev, so record the first one here.                                                                                                    |
| **Missing costs.** Runs with `costMicroUsd IS NULL`.                                                                                        | None, or each filled in by the next tick's cost settling.    | Each counts at $1.10 against the day. If one stays null after an hour, read its `apifyRunId` in the Apify console and open a bug on `settleCosts`.                                                                                                                     |
| **Capped runs.** Runs with `capped = true`.                                                                                                 | None. The $1.10 cap is above 1,000 rows' cost.               | A runaway run or a price change. Check the actor's pricing; raise `maxRunChargeUsd` only if the price changed.                                                                                                                                                         |
| **Spend.** harvestapi cost and rows per tick, against the same hours on 2026-11-17 to 2026-11-19 (same-tick repeats were 26% of paid rows). | No repeated rows inside a tick; cost close to rows × $0.001. | Spend per tick well above the baseline with no repeats points at job volume, not the change. Note the bulk posters ([slice 10](10-search-yield.md)) before drawing a conclusion.                                                                                       |
| **Refused or failed runs.** `status = 'failed'` per tick, grouped by `error`.                                                               | Only refusals already explained above, or none.              | A new error: read it before the next tick. Apify refusals are the limit; anything else is a bug.                                                                                                                                                                       |

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
