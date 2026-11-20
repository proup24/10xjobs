# Seniority levels and paid repeats: design

Roadmap: slice 08, `docs/roadmap/phase-3-find-quality/08-seniority-levels.md`. Every number below was measured on `10xjobs-dev` on 2026-11-20, on harvestapi batches (`collection_batches.actor`), unless it says otherwise.

## Intent

The LinkedIn job board search pays for rows that bring nothing, and it searches some LinkedIn levels for the wrong seniorities. This slice fixes three things in collection:

1. The seniority-to-LinkedIn-level map (`f_E`), so each seniority searches the levels its jobs are actually tagged with.
2. Paying twice for the same rows within one tick: the 100-row first run and its 1,000-row rerun.
3. MENA, the one search place whose jobs the other places already find.

It also adds a read-only report, so later decisions about places come from numbers, not from how places overlap on paper.

Why: precision of spend without losing the right jobs. The project's anti-goal "missing the right jobs" bounds every change here: nothing is cut unless the numbers show it adds next to nothing.

## Goals

- Each seniority searches the LinkedIn levels its jobs are tagged with on LinkedIn (table below).
- Every LinkedIn job-board run asks for 1,000 rows from the start, with no second run in the same tick.
- A profile that picks MENA searches Middle East and Africa, not LinkedIn's MENA place.
- `db:place-coverage` shows, per search place, what it finds that no other place finds.

## Non-goals

- Changing the profile's seniority or location vocabulary. The matcher checks preferences (DACH must not qualify Spain; senior must not qualify mid), so preferences stay precise and only the search mapping changes _(user agreed: keep the engineer seniorities and the regions)_.
- Dropping any search place other than MENA, or any automatic "skip a country when its continent is searched" rule. Morocco remote found 11 jobs in 7 days that Africa missed, one of them qualified.
- Repeats across ticks (doc section 3): left for later; see "After rollout".
- Reposts as a matching-quality question (slice 07 records the user wants fresh jobs, not reposts). Its own roadmap item.
- Processor, matcher and web app changes.

## Anti-goals

- Missing the right jobs: a level or place is cut only when the numbers show it adds near zero.
- Silent losses: a run that comes back full at 1,000 rows must be logged.

## Decisions

### 1. Seniority to LinkedIn level (`EXPERIENCE_LEVELS` in `queries/channels/linkedin_board.builder.ts`)

LinkedIn codes: 1 internship, 2 entry, 3 associate, 4 mid-senior, 5 director.

| Seniority  | Today      | New                       |
| ---------- | ---------- | ------------------------- |
| junior     | 1, 2       | **2** (entry)             |
| mid        | 3, 4       | 3, 4                      |
| senior     | 4          | 4                         |
| staff      | 4, 5       | **4** (mid-senior)        |
| lead       | 4, 5       | 4, 5                      |
| principal  | 4, 5       | 4, 5                      |
| unstated   | none       | none                      |

Each level stays its own search, deduplicated across seniorities as today (`dedupeBySearch`).

Why this map _(user: "go with the data map")_: the user first said junior is entry and staff is director. The data agreed on junior and disagreed on staff. LinkedIn's level is a tag the poster picks. For jobs where the processor read the seniority from the description, the LinkedIn tag was:

| Read seniority | Mid-senior | Director | Associate | Not applicable |
| -------------- | ---------- | -------- | --------- | -------------- |
| lead (349)     | 62%        | 6%       | 8%        | 20%            |
| staff (126)    | 67%        | 1%       | 14%       | 17%            |
| principal (126)| 52%        | 14%      | 16%       | 17%            |
| senior (1,552) | 71%        | 1%       | 11%       | 15%            |

LinkedIn barely honours `f_E` outside mid-senior. Of returned jobs with a level, internship searches returned 2% internship jobs, director searches 14% director, mid-senior searches 96% mid-senior. Over 7 days, internship searches found 60 jobs no other level found, 1 qualified. The roadmap's question "measure how often a returned job's level matches the searched one" is answered by these numbers; nothing is built for it.

For the published dev profile (junior, mid, senior, staff), the only change is that the internship searches stop.

### 2. Start every run at 1,000 rows

Today a LinkedIn job-board run asks for 100 rows (`maxRowsPerSearch`). A run is "full" when it returns 100 rows or when LinkedIn's `totalElements` is above the rows returned. A full one-member segment is rerun at once at 1,000 rows (`maxRowsCeiling`); a full multi-member segment is halved, and the split is remembered (`linkedin_search_splits`).

What dev showed over 3 days: 884 searches ran once, and 66 ran twice.
- 21 were full at 100 rows. Their reruns returned 1,498 rows, with 1,030 jobs new to that tick. The largest was 461 rows, and none came near 1,000.
- 45 were full only by `totalElements`. Their reruns returned 246 rows, 24 came back empty, and 43 jobs were new for $0.27. None of those 43 was seen in a later tick; 1 qualified and 1 went to review. **The user accepts losing these.**
- Halving reruns the identical search: a segment's members all share one search (`oneSearchInput` enforces it), so halving only pays for the same rows again. No split happened in 3 days, and the splits table is empty.

The new behaviour, for every LinkedIn job-board actor (harvestapi, cheap_scraper, bebity) _(user: both trial actors follow the same rule, though both are off now and may be dropped)_:

- Each run asks for 1,000 rows. The run config keeps one row limit; `maxRowsCeiling` goes.
- A run is full only when it returns its row limit. The `totalElements` rule and its warning go. `searchTotals` is still stored.
- A full run is stored, moves its cursors like any other run, and logs a warning (as the ceiling warning does today: older postings in that hour are lost). No second run.
- The halving, the remembered splits (`LinkedinSearchSplitsRepository`, `splits.ts`, the group tallies in `collection.service.ts`) and the `linkedin_search_splits` table are removed. The table drop is a migration in the Prisma contract (advance the migration ref hash, or the migration silently never applies).
- The per-run charge cap covers 1,000 rows plus margin _(my call)_: harvestapi $1.10 (1,000 × $0.001 + $0.001 start), cheap_scraper and bebity $1.50 (bebity is $0.00125 per job). The cap only stops a runaway run; the daily budget bounds the day.
- **Runs with an unknown cost** _(my call)_. Today the daily budget counts a run with no reported cost at its charge cap. Raised to $1.10, that would let three failed runs use up the default $3 budget and stop collection for the day. On 2026-11-13, 1,560 harvestapi runs failed with no cost and no Apify run id (the free-plan block), and 12 more did on 2026-11-16. A run with no Apify run id never started on Apify and was charged nothing, so it counts as $0. A run with a run id but no cost yet still counts at the cap until `settleCosts` reads its real cost. Tests cover both cases.
- `db:actor-compare` counts a cell as capped by this single row limit (`ceilingRows` and its "a run held for splitting" comment change).

### 3. MENA searches Middle East and Africa

`LINKEDIN_SEARCH_MAP` (`queries/channels/linkedin_search_map.ts`) gains `mena: ['africa', 'middle east']`, as EMEA already maps to its continents. Over 7 days the MENA remote search found 85 jobs, 84 of which Middle East or Africa also found; the one left had no qualified or review outcome. A MENA-only profile now runs two searches instead of one, which is accepted.

Other regions already map to continents and cost nothing extra (EU, EEA, UK, DACH to Europe; EMEA to Africa, Europe, Middle East; North America to Canada and United States; North Africa to Africa). The MENA geoId stays in `LINKEDIN_GEO_IDS` _(my call: harmless, and scripts may use it)_.

### Recipe version

Decisions 1 and 3 change built searches: bump `QUERY_SEARCH_RECIPE_VERSION` (12 to 13) and run `db:regenerate` on dev once after deploy. Update the `dedupeBySearch` comment, which cites staff, lead and principal sharing `f_E` 4,5.

### 4. Report: `db:place-coverage`

`pnpm --filter @xjobs/xjobs db:place-coverage -- [--days <n>] [--actor <name>]`, read-only, default 7 days and harvestapi _(my call: its own command, since `db:actor-compare` is about actors)_. Credit goes by batch actor, as in `db:actor-compare`.

Per search place (`query_search_builder.location`) and work type, one row with:
- runs and cost in the window,
- distinct jobs returned,
- jobs found only by this place, meaning no other place's search by the same actor returned them in the window, at any level or work type,
- those jobs' outcomes (qualified, review, rejected; a job counts once at its best outcome across profiles).

A second table gives the same per place and level. Countries are places too, so a country searched beside its continent shows up with its own unique jobs. The 7-day query behind decision 3 is the reference for the numbers.

## Rollout on dev

1. Merge, let the Deploy engine workflow deploy, and the table-drop migration applies.
2. Run `db:regenerate` once.
3. Over the next weekday ticks, check:
   - No internship (`f_E` 1) and no MENA builders are active.
   - No LinkedIn search runs twice in the same tick.
   - Any "full at 1,000 rows" warning.
   - harvestapi spend per day against the 3-day baseline. Same-tick repeats were 1,966 of 7,428 paid rows (26%).
4. Run `db:place-coverage` after a few weekdays.

## After rollout

- Measure repeats across ticks again. Over 3 days there were about 650 rows, 9% of paid rows, $0.22 a day. About 560 were reposts (the job's posted time moved forward between two runs of the same search), about 90 were the edge of the hour (same posted time), and about 90 were another search finding the job in a later tick. harvestapi has no input to skip known ids and no repost filter (slice 07), and a shorter window would lose new jobs, so no fix is planned.
- Add the repost-quality question to the roadmap: a repost of a job never seen before arrives as a new job.

## Left to the builder

- Test shape and placement; how the collection service reads once the split code is gone.
- The report's output format, matching the other `db:*` reports.
- Whether `maxRunChargeUsd` stays a per-config number or becomes rows × price.
