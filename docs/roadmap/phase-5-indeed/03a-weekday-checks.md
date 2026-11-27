# 03a: Indeed weekday checks

Status: Planned for Monday 2026-11-30, the first full weekday of Indeed runs. Source slice: [03 Collect](03-collect.md), whose spec's "Rollout check on dev" lists steps 4 and 5 below.

## Goal

Prove on `10xjobs-dev` that Indeed collection works for a whole weekday before slice 04 ingests its batches: every tick runs, no search hits the row cap, spend fits the cap, and each search returns real rows. Each check says what to look at, what passing looks like, and what to do in either case. Results are written under each section, dated.

## Setup

- **Schedule:** every 3 hours from 09:00 to 21:00 Morocco time, Monday to Friday (`0 9-21/3 * * 1-5`, PR 153). That's 5 ticks a weekday: 09, 12, 15, 18 and 21. Morocco is on UTC+0 since 2026-09-20, so ticks fall on the UTC hour, and the Morocco day of 2026-11-30 is `2026-11-30T00:00Z` to `2026-12-01T00:00Z`.
- **Searches:** 6 per tick, all from the owner's profile `9074f82b`: `INDEED|br|Remote`, `INDEED|ca|Remote`, `INDEED|pl|Remote`, `INDEED|uk|Remote`, `INDEED|us|Remote`, and `INDEED|ma|` (Morocco, whole site).
- **Budget:** a new Apify account with a one-off $5, from 2026-11-27 _(user)_. Agreed hosted caps: `COLLECTION_DAILY_BUDGET_USD_INDEED=0.5`, `COLLECTION_DAILY_BUDGET_USD=0.01`, `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS=0.01`, no trial channels. Expected Indeed spend is about $0.06 a weekday (5 ticks at about $0.012).
- **Access:** read-only SQL against `10xjobs-dev` (for Claude, through the `supabase-dev` MCP). Batch files are in the `collection-batches` storage bucket. Their contents can't be read through SQL, only their size from `storage.objects`.
- **Timing:** run after the 21:00 tick has finished (about 21:05). Check 1 can also be run after the first tick.

## Before the first tick (by 09:00)

| Check                                                                                    | Pass                                                                                                                                    | If it fails                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apify usage left.** In the new account's console: usage so far and the $5 usage limit. | About $4 or more left, and the limit set to $5.                                                                                         | Set the limit before the first tick. With less than $1 left, run Monday anyway: it needs about $0.06.                                                                              |
| **Posts cap.** Sum of `LINKEDIN_POSTS` `costMicroUsd` over Sunday's Morocco day.         | At most about $0.01 a day. On 2026-11-27 posts spent $0.157 in 5 hours, so the $0.01 cap wasn't in effect.                              | Fix `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS` in the hosted `.env` and run `$C up -d`, or turn post search off on the profile. Otherwise posts eat the $5 at about $0.75 a day. |
| **Job board.** `LINKEDIN_JOB_BOARD` runs and their `error`.                              | `failed` at $0 with "requires full access to your account", while harvestapi stays unapproved. That keeps the job board off at no cost. | If it's approved and running, it spends up to $1.10 a run under the $0.01 cap. Note the spend here.                                                                                |

**Result:** _not yet run._

## Tick checks

```sql
-- Runs per tick and search on the day.
select date_trunc('hour', "startedAt") as tick, "segmentKey", status, fetched,
       capped, "costMicroUsd", "costFinalAt" is not null as final, left(error, 120) as error
from search_segment_runs
where channel = 'INDEED'
  and "startedAt" >= '2026-11-30T00:00Z' and "startedAt" < '2026-12-01T00:00Z'
order by 1, 2;
```

| #   | Check                                                                                                                          | Pass                                                                                                               | If it fails                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **A run on every tick.** One row per tick and search.                                                                          | 30 runs: 5 ticks × 6 searches, all `succeeded`, none outside 09, 12, 15, 18 and 21.                                | A missing tick: check whether the worker was stopped by hand (see the 2026-11-24 note in Phase 3 slice 11) before calling it a bug. A run at another hour: the old hourly scheduler survived the deploy; open a bug on `upsertJobScheduler`. A `failed` run: read `error`; an Apify refusal is the account, anything else is a bug. |
| 2   | **Rows per search, and the row cap.** `fetched` per search and tick, and `capped`.                                             | No run at 1,000 rows, none `capped`. Every Remote search returns some rows on at least one tick.                   | A run at 1,000 rows: that search is broken or far too broad. Look at its keyword before the next weekday. A Remote search with 0 rows all day: step 5 of the spec. Fix its `indeed_markets.remoteLocation` row and run `db:regenerate`.                                                                                             |
| 3   | **Spend against the cap.** Sum of `costMicroUsd` after costs settle (`costFinalAt` set; reread the next morning if not).       | Under $0.5, close to the expected $0.06. No run with a null cost after an hour.                                    | Over $0.1: compare rows to cost (about $0.0009 a start plus $0.0001 a row). A price change is a new question for the cadence.                                                                                                                                                                                                       |
| 4   | **Batches stored and pending.** Query below.                                                                                   | 30 `INDEED` batches, all `pending`, each with a storage object whose size is above 1 KB when its run fetched rows. | A missing batch or object: the run's rows are lost. Open a bug on `saveBatch`. A batch not `pending`: something ingested Indeed before slice 04.                                                                                                                                                                                    |
| 5   | **US supply.** `INDEED                                                                                                         | us                                                                                                                 | Remote` rows per tick.                                                                                                                                                                                                                                                                                                              | Comparable to slice 01's weekday count (81 relevant, 145 rows on 2026-11-25). | Still near Friday's 18: the merged 293-character keyword may find less than slice 01's keyword. Compare the two before slice 04 decides on volume. |
| 6   | **New rows per tick.** Batch file size per search across ticks (query below), as a proxy until slice 04 ingests these batches. | Not a pass or fail: it feeds the cadence decision (PR 153) and slice 04's pre-filter question.                     | Exact counts come from slice 04's sightings once it ingests the backlog: new jobs per batch, per tick. Record them here then.                                                                                                                                                                                                       |

```sql
-- Batches, their status and their stored file size.
select date_trunc('hour', r."startedAt") as tick, r."segmentKey", r.fetched,
       b.status, b."itemCount", (o.metadata->>'size')::int as bytes
from search_segment_runs r
join collection_batches b on b."segmentRunId" = r.id
left join storage.objects o on o.bucket_id = 'collection-batches' and o.name = b."storageKey"
where r.channel = 'INDEED'
  and r."startedAt" >= '2026-11-30T00:00Z' and r."startedAt" < '2026-12-01T00:00Z'
order by 2, 1;
```

A search whose file size is the same on two ticks returned the same rows, so nothing new came in between them.

**Result:** _not yet run._

## Friday 2026-11-27 baseline

The worker came back on the new Apify account during the afternoon, so only the 18:00 and 21:00 ticks ran, after PR 153 was deployed.

- **Runs:** 12 of 12 `succeeded`. 15:00 was missed because the worker started after it.
- **Rows:** br 21, us 18, ca 12, pl 7, uk 6, ma 0, the same on both ticks. Every batch file was byte-identical between the two ticks, so nothing new came in between 18:00 and 21:00.
- **Remote:** br, pl and ca all return rows with `Remote` (spec step 5). No `remoteLocation` change is needed, but the rows' relevance is unchecked until slice 04.
- **Spend:** $0.012 a tick, final for 18:00. None capped, none near 1,000 rows.
- **Batches:** 12 stored, 128 items, all `pending`.
- **Other channels:** posts spent $0.157 from 17:00 to 22:00 UTC (over the agreed $0.01 cap). The job board failed at $0 on every run because harvestapi needs approval on the new account.

## Out of scope

- The content and relevance of Indeed rows: that's slice 04's mapper, processor and matcher.
- Comparing Indeed with LinkedIn: slice 06.
