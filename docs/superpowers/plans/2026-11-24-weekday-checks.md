# Slice 11 weekday checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan runs read-only checks. It writes no product code.

**Goal:** Run the one-time weekday checks for last week's builds on `10xjobs-dev`, record each result, and update slice 11 to show what is done and what was left out.

**Architecture:** Each task is one build's checks. Claude runs the SQL through the read-only `supabase-dev` MCP (`execute_sql`). The owner does anything on the server, in the Apify console or in the web UI. Results go into a working notes file during the day. The last task turns those notes into the slice 11 doc update and a docs PR.

**Tech Stack:** Postgres on Supabase (`10xjobs-dev`), the `supabase-dev` MCP, and `gh` for PR comments.

**Spec:** `docs/superpowers/specs/2026-11-24-weekday-checks-design.md`

## Global Constraints

- The judged day is **Tuesday 2026-11-24**, with ticks on the UTC hour from 09:00 to 21:00. If Tuesday is cut short, checks that need only the new code may use 2026-11-23 15:00 to 19:00 UTC. A check with too little data is recorded as "not enough data", never as a pass.
- Old-code baseline ticks: 2026-11-23 09:00 and 10:00 UTC. New code (PR 125) runs from 2026-11-23 15:00 UTC.
- The slice 09 cut-over is `'2026-11-20T14:50:00Z'` on `job_extractions."createdAt"`.
- Claude makes no paid Apify runs and makes no fixes inside this plan. A failing check gets a follow-up item (a bug, a brainstorm or a PR) and its slice stays open.
- Claude has no SSH access to the server. Server logs, `.env` and the Apify console belong to the owner. Ask for them and record the answer; never guess it.
- Work in the worktree `.worktrees/slice-11-checks` on branch `docs/slice-11-checks`, which already holds the spec commit.
- Working notes go in `.worktrees/slice-11-checks/tmp/weekday-checks-notes.md` (untracked). Each check gets one line: `<check> | <time UTC> | pass/fail/not enough data | <numbers>`.

## Review Focus

- **The tick is still running.** A tick's runs finish over several minutes. A check that counts runs for the current hour reads too low. Only judge ticks whose hour has ended, plus 10 minutes.
- **Join fan-out.** One raw item sighted for several merged member searches gives several `raw_item_sightings` rows but one billed row. Billed rows are `search_segment_runs.fetched`. Never count sightings as billed rows.
- **Budget stop.** A budget stop leaves no `search_segment_runs` rows at all. Missing hours mean skipped, not zero cost. Report the missing hours as missing.
- **Pausing lowers spend.** After about 14:04 UTC, PR 124 pauses builders, so Tuesday afternoon spend falls for reasons unrelated to PR 125. Judge PR 125's spend on ticks before 14:00 only.
- **Small samples.** For slice 09 rates, state the denominator next to each rate.

---

### Task 1: Before the 11:00 UTC tick: budget, Apify and the overnight gap

**Files:**

- Create: `tmp/weekday-checks-notes.md`

- [ ] **Step 1: Ask the owner three things in one message**
  1. The `COLLECTION_DAILY_BUDGET_USD` value on the server for today. At about $0.85 a tick, 13 ticks cost about $11. If it stays at $3, collection stops after about 3 ticks.
  2. The Apify usage left against the monthly limit on account `meeeha` (it needs about $11 plus posts).
  3. The worker log from 2026-11-23 20:00 to 2026-11-24 10:00 UTC: why no schedule ran (no job board at 20:00 or 21:00, no post search from 20:00 to 09:00, no 09:00 job-board tick).
- [ ] **Step 2: Record the answers** in the notes file. If the overnight gap has no explanation, it becomes a follow-up item: a bug on the hosted worker.
- [ ] **Step 3: Confirm today's ticks are running** after 11:10 UTC:

```sql
select date_trunc('hour', "startedAt") as tick, channel, count(*) runs, sum(fetched) rows,
  round(sum("costMicroUsd") / 1e6, 2) usd, count(*) filter (where status = 'failed') failed
from search_segment_runs where "startedAt" >= '2026-11-24' group by 1, 2 order by 1, 2;
```

Pass: a `LINKEDIN_JOB_BOARD` row for each ended hour from 10:00 on, and `LINKEDIN_POSTS` every hour. Any missing hour goes in the notes, with the reason if known (budget or engine).

### Task 2: Slice 08 checks (PR 99, read with PR 125)

Run after the 12:00 tick has ended, then again after 21:10 UTC.

- [ ] **Step 1: Searches.** No active builder on the old recipe.

```sql
select channel, count(*) from query_search_builder
where "isActive" and not "isDeleted" and channel::text like 'LINKEDIN_JOB_BOARD%'
  and (params->>'experienceLevel' = '1' or location = 'mena') group by 1;
```

Pass: no rows. Fail: an owner runs `db:regenerate` with `POST_SEARCH_USERS` set, then re-check.

- [ ] **Step 2: One run per group per tick.** Since PR 125, one segment is one place and work-type group, and halves are the only repeats.

```sql
select date_trunc('hour', "startedAt") tick, count(*) runs, count(distinct "segmentKey") segments
from search_segment_runs where channel = 'LINKEDIN_JOB_BOARD' and "startedAt" >= '2026-11-23T15:00Z'
group by 1 having count(*) <> count(distinct "segmentKey") order by 1;
```

Pass: no rows, or only ticks that have a `linkedin_search_splits` row (Step 4). Fail: list that segment's runs (`fetched`, `truncatedQueryIds`) and open a bug against `collectSegment`.

- [ ] **Step 3: Full, capped, missing cost, failed** (since 2026-11-23 15:00 UTC):

```sql
select count(*) filter (where fetched >= 1000) full_runs,
  count(*) filter (where capped) capped,
  count(*) filter (where "costMicroUsd" is null and "startedAt" < now() - interval '1 hour') null_cost_over_1h,
  count(*) filter (where status = 'failed') failed,
  string_agg(distinct left(error, 80), ' | ') filter (where status = 'failed') errors
from search_segment_runs where channel::text like 'LINKEDIN_JOB_BOARD%' and "startedAt" >= '2026-11-23T15:00Z';
```

Pass: `capped` 0, `null_cost_over_1h` 0, and `failed` 0 or only Apify limit refusals. `full_runs` 0 or rare, and each one followed by a split (Step 4). Fail routes are in slice 11's slice 08 table.

- [ ] **Step 4: Splits.** `select * from linkedin_search_splits order by "splitAt";` If there are rows, check that both halves have runs in the next tick, with `status = 'succeeded'`. This would be the first split on dev, so record the group key and time.
- [ ] **Step 5: Record** each result line in the notes.

### Task 3: Merged level searches (PR 125)

Run after 13:10 UTC (ticks 10:00 to 13:00), then after 21:10 UTC for the full day.

- [ ] **Step 1: Per tick: billed rows, distinct items, repeat share, distinct jobs, spend.** Billed rows come from `fetched`; distinct items come from the sightings, each counted once.

```sql
with runs as (
  select date_trunc('hour', "startedAt") tick, count(*) runs, sum(fetched) billed,
    round(sum("costMicroUsd") / 1e6, 2) usd
  from search_segment_runs where channel = 'LINKEDIN_JOB_BOARD' and "startedAt" >= '2026-11-23'
  group by 1
), items as (
  select date_trunc('hour', r."startedAt") tick, count(distinct s."rawItemId") items,
    count(distinct nj."jobId") jobs
  from search_segment_runs r join collection_batches b on b."segmentRunId" = r.id
  join raw_item_sightings s on s."batchId" = b.id
  left join normalized_job_sources nj on nj."rawItemId" = s."rawItemId"
  where r.channel = 'LINKEDIN_JOB_BOARD' and r."startedAt" >= '2026-11-23' group by 1
)
select r.*, i.items, i.jobs, round(100.0 * (1 - i.items::numeric / nullif(r.billed, 0)), 1) repeat_pct,
  round(r.usd / nullif(i.items, 0) * 1000, 2) usd_per_1000_items
from runs r left join items i using (tick) order by tick;
```

Known values (checked 2026-11-24): 2026-11-23 10:00 = 1,864 billed, 556 items, 70.2% repeat, $1.92; 16:00 = 826 billed, 570 items, 31.0%, $0.85; 2026-11-24 10:00 = 878 billed, 539 items, 38.6%, $0.67. If the query does not reproduce these, fix it before judging.

Pass, for Tuesday ticks from 10:00 to 13:00:

- the repeat share is under 40% on every tick (old code: 70%; new code on 2026-11-23 ran 30 to 39%, all cross-keyword overlap);
- distinct items per tick are not below the old-code ticks (556 at 10:00);
- spend per tick is below $1.92 and close to billed × $0.001.

- [ ] **Step 2: Qualified per profile per tick, old against new.** For jobs first seen in each tick:

```sql
select date_trunc('hour', j."firstSeenAt") tick, m."profileId", count(*) filter (where m.outcome = 'qualified') qualified, count(*) decided
from job_matches m join normalized_jobs j on j.id = m."jobId"
where j."firstSeenAt" >= '2026-11-23' and j.kind = 'job' and m."matcherVersion" = (select max("matcherVersion") from job_matches)
group by 1, 2 order by 1, 2;
```

Pass: the qualified count per profile per tick on new code is not below the 2026-11-23 09:00 to 10:00 rate (2, 2 and 15 per profile over those two ticks).

- [ ] **Step 3: Record**, then post the numbers as a comment on PR 125 with `gh pr comment 125 --body-file <file>`.

### Task 4: Paused searches (PR 124)

Run after 15:10 UTC (the first ticks after the grace ends at about 14:04), then after 21:10 UTC.

- [ ] **Step 1: Which builders are paused, and for whom.**

```sql
select b.channel, count(*) paused, min(b."pausedAt") first_paused,
  array_agg(distinct p."userId") users
from query_search_builder b
join profile_query_search_builders l on l."queryId" = b.id join profiles p on p.id = l."profileId"
where b."pausedAt" is not null and b."isActive" and not b."isDeleted" group by 1;
```

Pass: if there are rows, each user listed has had no activity for 24 hours and has a qualified match waiting more than 24 hours. Check this against the spec's rule (`docs/superpowers/specs/2026-11-23-paused-searches-design.md`, "Something has been left waiting"). Ask the owner which listed users were active today. No rows is also a valid result: nobody qualifies yet. Record it as that, not as a failure.

- [ ] **Step 2: Spend before and after pausing.** From Task 3 Step 1's output, compare the average `usd` per tick from 10:00 to 13:00 with the ticks from 15:00 on. Record both numbers. Fewer runs per tick after 15:00 should match the paused builders found in Step 1.
- [ ] **Step 3: Owner UI check.** Ask the owner, if one of their users is paused: does the Matches notice show, and does Resume bring the builders back on the next tick (`pausedAt` null again, runs back in the next hour)? Record the answer, or "not tested" if no owner account is paused.
- [ ] **Step 4: Record**, then comment on PR 124.

### Task 5: Slice 09 checks 1 to 8 (PRs 101, 103, 105, 106)

Run after 21:10 UTC. The queries are Q-A to Q-G in `docs/roadmap/phase-3-find-quality/11-monday-checks.md`, and the pass rules are in that table. Run them as written.

- [ ] **Step 1: Q-A precondition.** It was 2,998 at 2026-11-24 10:00. Pass: 100 or more.
- [ ] **Step 2: Checks 1 and 2 (Q-B old rows, Q-C).** These are wrong matches if they fail, so judge them first. Check 1 passes when old label-only residence fails are 56 or fewer. Check 2 passes when `hybrid-onsite-only` and `unstated` are both 0.
- [ ] **Step 3: Checks 3 to 6** (Q-D, Q-E, Q-B new rows with Q-F, Q-B review share, plus `db:match-shares -- --days 7` run by the owner, or skipped and recorded as skipped).
- [ ] **Step 4: Check 7** (Q-G): read the 10 reasons, and quote any vague ones in the notes.
- [ ] **Step 5: Check 8, processor health on new jobs:**

```sql
select count(*) jobs, count(*) filter (where j."processingError" is not null) errored,
  round(avg(a.cost)::numeric, 3) avg_cost_usd
from normalized_jobs j join job_extractions e on e.id = j."currentExtractionId"
left join lateral (select sum("costUsd") cost from processing_attempts pa where pa."extractionId" = e.id) a on true
where e."createdAt" >= '2026-11-20T14:50:00Z';
```

Pass: the error share is no higher than before the cut-over (run the same query with `<` for a baseline), and the average cost is about $0.044.

- [ ] **Step 6: If checks 1 to 6 pass,** follow slice 11's "After the checks". Post the numbers on PRs 105 and 106. Open the small PR carrying commit `a680c99` (the decide-level test from `feat/residence-limit-only`), cherry-picked onto a new branch from `main`, after running the engine tests with `CI=1`. Ask the owner before removing the five slice 09 worktrees and the progress ledger. If any check fails, the slice stays open: follow that row's "If it fails" and record the follow-up.

### Task 6: Duplicate requirements (PR 77)

- [ ] **Step 1: Run**

```sql
select date_trunc('day', "createdAt") day, count(*) from processing_attempts
where "createdAt" >= '2026-11-16' and (error ilike '%appears twice%' or error ilike '%same technology%')
group by 1 order by 1;
```

Pass: close to 0 a day since 2026-11-17 (it was 11 of 12 failures on 2026-11-16). If two-place duplicates (the message names both texts) still fail often, record that as a decision for the owner: merge them too, or not.

- [ ] **Step 2: Record** the result in the notes.

### Task 7: Update slice 11 and open the docs PR

**Files:**

- Modify: `docs/roadmap/phase-3-find-quality/11-monday-checks.md`
- Modify: `docs/roadmap/phase-3-find-quality/README.md` (rows 08, 09 and 11)

- [ ] **Step 1: Update the slice 11 doc from the notes file:**
  - Change the intro so the day is Tuesday 2026-11-24 and give the reason (Monday was cut short).
  - Add a "Done" column, or a result line under each table, to every check that ran: the date, pass/fail/not enough data, and the key numbers or a link to the PR comment.
  - Replace slice 08's "One run per search per tick" wording with the merged-group meaning from PR 125.
  - Add sections for PR 125, PR 124 and PR 77, in the same check / pass / if-it-fails shape, each with its result.
  - Add a "Left out" section with the spec's table: `db:place-coverage`, `db:split-check`, `db:spellings` (around 2026-11-28), the Indeed re-run, the publish/edit and webhook UI checks, and the post search slices, each with where it went.
  - List each failure's follow-up under the check that failed.
- [ ] **Step 2: Update the README rows.**
  - Row 11: `Done 2026-11-24 (weekday checks)`, or `Checks run 2026-11-24; <n> open` if any failed.
  - Row 08: `Done (PRs 99, 125)` if Tasks 2 and 3 passed, keeping "split-check later in the week".
  - Row 09: leave it as Done, adding "checks passed 2026-11-24", or note the open check.
- [ ] **Step 3: Run Prettier and check the diff:** `npx prettier --check docs/roadmap/phase-3-find-quality/*.md`. Expected: no warnings (the hook formats on write).
- [ ] **Step 4: Commit, push and open the PR.**

```bash
git add docs/roadmap/phase-3-find-quality/11-monday-checks.md docs/roadmap/phase-3-find-quality/README.md docs/superpowers/plans/2026-11-24-weekday-checks.md
git commit -m "docs(roadmap): slice 11 weekday check results, done and left-out items"
git push -u origin docs/slice-11-checks
gh pr create --base main --title "docs: slice 11 weekday check results" --body-file <body>
```

The PR body lists each check with its result, the follow-ups opened, and the left-out items. It ends with the Claude Code attribution line.
