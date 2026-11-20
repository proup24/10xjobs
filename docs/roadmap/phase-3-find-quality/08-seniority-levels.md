# 08: Seniority to LinkedIn level, and paid repeats

## Decided

Spec: [seniority levels and paid repeats](../../superpowers/specs/2026-11-20-seniority-levels-and-paid-repeats-design.md), 2026-11-20.

- **Map:** junior searches entry; mid searches associate and mid-senior; senior and staff search mid-senior; lead and principal search mid-senior and director. This is the data map, not the user's first correction: the data agreed on junior and disagreed on staff _(user: "go with the data map")_.
- **Staff and mid-senior:** staff keeps mid-senior only, since 67% of staff jobs are tagged mid-senior and 1% director.
- **How much the search narrows:** only the internship search stops. Preferences stay precise in the matcher; only the search mapping changes. LinkedIn barely honours `f_E` outside mid-senior (internship searches returned 2% internship jobs), and nothing is built to measure it further.
- **Ceiling:** every LinkedIn job-board run starts at 1,000 rows. Halving stays, but only for a full group with more than one member. The `totalElements` "full" rule goes.
- **MENA:** a profile that picks MENA searches Middle East and Africa. Other places stay, and no "skip a country" rule is added.
- **Place checks:** `db:place-coverage` reports what each place finds alone. `db:split-check` is a paid one-off run by the maintainer that tests halving at a 95% coverage bar; under 95% reopens removing the split.
- **Repeats across ticks:** deferred. harvestapi has no skip-known-ids input and no repost filter, and a shorter window would lose new jobs.
- **Recipe:** version 12 to 13; run `db:regenerate` once after deploy.

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

## Also in this slice: paying for the same job twice

Added 2026-11-20 _(user: note these in slice 08)_. harvestapi charges $0.001 per run plus $0.001 per job returned. This is exact on every run with a final cost: 0 rows cost $0.001, 100 rows cost $0.101.

Over 3 days on dev, harvestapi returned 7,428 paid rows but only 4,843 distinct jobs. **35% of paid rows were jobs already seen:**

| Repeat           | Rows  | Share of paid rows |
| ---------------- | ----- | ------------------ |
| In the same tick | 1,966 | 26%                |
| In a later tick  | 619   | 8%                 |

### 1. Start each search at the ceiling, not at 100 rows

- **How it works today:**
  - A search asks for 100 rows (`maxRowsPerSearch`).
  - When the run comes back "full", the service runs the same single-builder search again at the 1,000-row ceiling (`collection.service.ts`).
  - That second run pays again for the first 100 rows. This accounts for most of the same-tick repeats.
- **A false "full" adds runs:** `linkedin-job-board.collector.ts:68` also counts a run as full when LinkedIn's `totalElements` is above the rows returned. That total runs ahead of what the 1-hour search actually returns. In the 13:00 UTC tick on 2026-11-19, follow-ups to runs of 2, 19, 35 and 52 rows all came back with 0. About 10 of the 60 runs in a tick are such follow-ups, and on 2026-11-19 follow-ups were about 20% of harvestapi's spend.
- **Proposal:** start at the ceiling. The actor charges for jobs returned, not jobs allowed, so a higher limit costs nothing unless the jobs exist, and jobs posted within the hour are ones we want. The follow-up run, and the `totalElements` rule, then mostly go away.
- **Trade-off:** one run can spend up to the ceiling's charge cap (about $1) instead of $0.10. The daily cap still bounds the total. Check how the same-tick splits and the trial actors' run caps behave at the new limit.

### 2. Search places that don't overlap

Searches for different places return the same jobs when the places overlap. Shared jobs, last 7 days on dev (harvestapi):

| Places                   | Shared jobs | Share of the smaller place's jobs |
| ------------------------ | ----------- | --------------------------------- |
| MENA and Middle East     | 74          | 86% (MENA 86, Middle East 128)    |
| Africa and MENA          | 23          | 30%                               |
| Africa and Middle East   | 14          | 18%                               |
| Canada and United States | 8           | 2%                                |
| Africa and Morocco       | 7           | 13% of Morocco's 55               |
| MENA and Morocco         | 4           | 7%                                |

Jobs only that place found, same 7 days: United States 2,785 of 2,793, Europe 1,745 of 1,745, Latin America 1,058 of 1,058, Canada 420 of 428, Middle East 52 of 128, Africa 48 of 76, Morocco 48 of 55, **MENA 1 of 86**.

- **Proposal:** test the place set on purpose rather than only dropping MENA _(user)_.
  - For each search place, measure what it finds that no other place finds, per work type and level, over a few weekdays.
  - Drop or narrow places that add almost nothing.
  - Consider a rule in the search map: skip a place when the profile also searches places that cover it (MENA when Middle East and Africa are searched; Morocco remote when Africa remote is searched?).
- **Constraint (anti-goal: missing the right jobs):** a place is dropped only when the numbers show its unique jobs are near zero, not because it overlaps on paper. Africa is small and still adds 48 jobs a week that no other search finds.
- **bebity:** it has no MENA place anyway (slice 07).

### 3. Repeats across ticks

619 rows over 3 days, 605 jobs, came back in a later tick: reposts, or the edge of the hourly window. Look at these only after 1 and 2.
