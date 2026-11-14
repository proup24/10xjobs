# Shared LinkedIn searches (Phase 2, collection)

Date: 2026-11-09
Status: Tasks 1–3 built. Tasks 4–9 superseded by [the 2026-11-14 search precision spec](2026-11-14-search-precision-design.md).

## Intent

Publishing one profile on `10xjobs-dev` attached 128 LinkedIn job board builders. That's 2 keywords × 4 experience levels × 16 places. Today every distinct search is its own Apify run, so that one profile would start 128 runs every hourly tick. That's about 1,920 runs a day and around $38 a day in start fees (up to $0.02 a run on `cheap_scraper/linkedin-job-scraper` at its default 4 GB). The jobs themselves are cheap ($0.70 per 1,000). Most of those searches overlap: the four experience filters cover each other, and most of the places sit inside EMEA.

This spec replaces the one-run-per-builder model with a **planner**. The planner looks at the LinkedIn job board builders of every published profile together and turns them into the fewest LinkedIn searches that still find every job any of them would find. Overlaps between users become shared searches, and only real differences get searches of their own. The plan follows the pool of users: a new user's wishes fold into the searches that already cover them.

It also fixes two problems found while checking the 128:

- **Only two techs are searched, chosen alphabetically.** The engine searches the top 2 techs by importance, then mastery, then name. The setup star was meant to choose them, but it's optional. Your profile has no stars and six techs rated 5/5, so `nestjs` and `nextjs` won on alphabetical order.
- **Worldwide** as a profile place produces a huge, noisy search.

## Goals

- Every job a profile's builders would find today is still found. A broader search never changes who qualifies, because the matcher still decides per profile.
- The number of Apify runs per tick tracks the number of distinct places wanted, not the number of combinations.
- Every searchable tech in a profile's stack is searched, not just the top 2.
- A search that comes back full is split, so a merged search doesn't silently lose jobs.
- Collection spending has a daily cap.
- Collection runs every hour from 08:00 to 23:00 Morocco time, every day.

Worked example, the one profile on dev today, once Worldwide is removed and assuming the folds are approved (see [Folding](#2-fold-places)):

| Search | Place         | Work types      | Keywords                                 |
| ------ | ------------- | --------------- | ---------------------------------------- |
| S1     | EMEA          | remote          | every searchable tech in the stack, OR'd |
| S2     | United States | remote          | same                                     |
| S3     | Canada        | remote          | same                                     |
| S4     | LATAM         | remote          | same                                     |
| S5     | Morocco       | hybrid + onsite | same                                     |

That's 128 searches down to 5. At 16 ticks a day that's 80 runs, at most about $1.60 a day, or about $0.40 at 1 GB.

## Non-goals

- LinkedIn posts, Ashby and Greenhouse. They search differently (post text, Google) and stay as they are _(user)_.
- Changes to the matcher's rules, the processor or ingest.
- Showing jobs in the web app.
- Deploying the engine.
- Per-user spending limits. The cap here is one platform-wide cap on collection.

## Anti-goals

Both of these count as failure, and neither is traded for the other _(user)_:

- **A large bill.** That means runs paid for jobs another run already returns, or a runaway plan.
- **A missed job.** That means a fold LinkedIn doesn't actually honour, a merged search that fills its result limit with nothing reacting, or a time window skipped when the plan changes.

## Decisions

| Question                      | Decision                                                                                                                                                                                                                                            | Whose                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Schedule                      | Every hour 08:00–23:00 `Africa/Casablanca`, every day (16 ticks). Today it's `0 8-22 * * 1-5` UTC. Applies to the LinkedIn job board. Posts keep their schedule.                                                                                    | user                                         |
| Worldwide                     | Dropped as a profile place: setup no longer offers it and the engine refuses it. Jobs can still be extracted as worldwide; the matcher keeps handling that.                                                                                         | user                                         |
| Unit of planning              | All published profiles' LinkedIn job board builders together, rebuilt on every tick. Segments are already rebuilt from the active builders each tick, so publishing or deleting a profile reshapes the plan on the next tick with no extra trigger. | user (rebuilding on every tick is my call)   |
| Folding                       | A place folds into a broader place only along an **approved pair** (see [Folding](#2-fold-places)), only into a place some builder wants with the same work type, and never into a place nobody asked for.                                          | user                                         |
| Keywords                      | Every searchable tech in the stack becomes a keyword, OR'd into the search. The top-2 rule goes.                                                                                                                                                    | user                                         |
| Star                          | The "Search for this" star leaves setup: there's nothing left to choose. This supersedes line 71 of the guided setup spec.                                                                                                                          | user                                         |
| Spend cap                     | $3 a day for LinkedIn job board collection, configurable, counted per Morocco calendar day. When it's reached, collection skips ticks until the next Morocco day and logs it.                                                                       | user                                         |
| Channels                      | LinkedIn job board only.                                                                                                                                                                                                                            | user                                         |
| Full searches                 | A search that returns as many items as its row limit is split before the next tick. It's never split before that.                                                                                                                                   | user                                         |
| Filters that cover everything | When the merged values of a filter cover every option the engine uses, or a member has no filter for it (unstated), the filter is dropped. A dropped filter also catches jobs that don't state the field.                                           | user (adopted from the alternative approach) |
| A test before the build       | Run a short live test before building (see [The test](#the-test-first-task)). The planner may only use what the test confirmed.                                                                                                                     | my call                                      |

## The plan, step by step

The input is the active LinkedIn job board builders. The output is a list of **searches**, each with its member builders. A search is one Apify run with one start URL, as today.

### 1. Read each builder as a wish

Each builder gives: keyword (one tech), place, work type, experience filter. Domain plays no part in a LinkedIn job board search, so it leaves the grouping key _(my call)_.

### 2. Fold places

- Our nesting: place A is inside place B when every country of A is a country of B (`region_countries`; a country is inside every region that lists it; a city is inside its country). This is the same data the matcher's `places.ts` uses.
- LinkedIn's nesting can differ: most places are sent as free text, and only some have a verified `geoId` (`linkedin_geo.ts`). So folding uses only **approved pairs**: child → ancestor pairs that the test confirmed on LinkedIn, kept in code next to `LINKEDIN_GEO_IDS` with the date they were checked _(user)_.
- A pair is approved only when it was tested directly. Approval doesn't carry through chains: Morocco → North Africa plus North Africa → EMEA doesn't give Morocco → EMEA _(my call: LinkedIn's geography isn't guaranteed to nest the way ours does)_.
- A builder's place becomes the broadest ancestor that is (a) an approved pair for its place, and (b) wanted by some active builder with the same work type. If two such ancestors don't contain each other, take the one with more countries. Ties go to the alphabetically first code _(my call: deterministic)_.
- Unapproved pairs simply don't fold. That's safe, it just costs more runs.

### 3. Group and merge

- Group the folded builders by place.
- In each group, the search is:
  - **keywords:** every distinct LinkedIn term of the members, OR'd;
  - **experience:** the union of the members' `f_E` codes, dropped when it covers 1–5 or a member has none;
  - **work type:** the union of `f_WT` codes, dropped when it covers 1–3 or a member has none.
- Every item the run returns is attributed to every member, as today. Attribution doesn't decide anything: the matcher matches every processed job against every published profile.

### 4. Size it

- The starting row limit and charge cap are today's values (100 rows, $0.25) multiplied by the number of distinct searches the group replaces, up to the ceiling the test finds (LinkedIn stops paging somewhere, possibly around 1,000).
- Memory drops to 1 GB if the test shows the actor is reliable at 1 GB.

### 5. Split when full

- After a run, a search counts as full when it returned as many items as its row limit (the existing `truncatedQueryIds` signal).
- A full search is split before the next tick, in this order:
  1. halve its keyword set (sorted, so the halves are stable);
  2. if a single keyword is still full, split experience;
  3. then split work type;
  4. if a single keyword with a single experience and work type is still full, raise its row limit to the ceiling and log it for review.
- The split must be remembered across ticks, because segments are rebuilt each tick. When and how a split is undone (for example, after N ticks under the limit) is the builder's call. It must never undo a split on the tick right after the split.

### 5a. Cursors after a full run

A full run has dropped its oldest postings (newest first, `sortBy=DD`). Today it still moves every member's `coveredUntil` to `until` (only a charge-capped run holds cursors back), so those postings would be lost for good. Instead, after a full run, members' `coveredUntil` moves only to the posted time of the **oldest item returned**, so the split searches on the next tick re-cover exactly the part that was cut. If the items carry no usable posted time, the cursors don't move. _(my call, from the "missed job" anti-goal; the extra runs count toward the cap)_

### 6. Collection progress

A search's window already starts from its members' oldest cursor (`segmentWindow`), so a search that gains a member which has never been collected looks back as far as that member needs. No progress is carried on the search itself; it stays on the builders, as today. A re-plan must not move a builder's `coveredUntil` forward without a run that covered it.

## Keyword syntax

Today a keyword is a plain term, and multi-word terms are sent unquoted (`next js`). With OR, a multi-word term must be grouped so that `nestjs OR next js` doesn't read as `nestjs OR next` AND `js`. The test settles the exact form (quotes or parentheses) and any length limit. Past that limit, the keyword set is pre-split into searches that fit, the same way a full search is split.

## Builder generation changes

- The LinkedIn job board recipe uses every searchable tech, not the top 2. Bump the recipe version so `db:regenerate` moves published profiles to it.
- Whether a builder stays one tech × one experience × one place × one work type, or carries sets, is the builder's call. The requirements: the planner can compute steps 1–3, and per-builder progress and claims keep working.
- Builders on the other channels keep today's rule. They aren't covered by this spec, so their top-2 rule stays.

## Worldwide

- Setup: remove the Worldwide option from the place picker (`place-rows.tsx`, the setup schema in `answers.ts`, the mapping and the review).
- Engine: the profile DTO validators (`users/dto`) refuse a `worldwide` place. If the contract has a database check on `profiles.locations` place kinds, it refuses it too.
- The one published profile on dev has remote Worldwide. A one-off step removes `worldwide` entries from existing profiles' `locations`, then runs `db:regenerate`, so nobody has to set up again _(my call)_. Production has no profiles yet.

## Star

Remove the star toggle, `MAX_STARRED`, its validation and the ", searched" note in the review. Setup writes every tech at the default importance. `importance` stays in the schema.

## Spend cap

- Configurable, defaulting to $3 a day (for example, `COLLECTION_DAILY_BUDGET_USD`), for the LinkedIn job board channel.
- Spend is the sum of `search_segment_runs.costMicroUsd` since the start of the current Morocco day.
- At or over the cap, a tick skips all runs and logs one line.
- A run that starts under the cap may overshoot it by at most its own charge cap.

## The test (first task, a go/no-go gate)

The maintainer runs it, because it needs the Apify token from `.env`. The builder writes a small script that makes paid Apify runs (capped at about $1 in total) and prints its results, plus a note template. The maintainer runs the script, and the builder reads the output and fills in the note and the approved pairs _(user)_.

**Gate:** if OR keywords don't work, or EMEA can't be pinned and approved as a parent, stop after this task and go back to design. Don't build a reduced planner _(user)_. A low row ceiling isn't a stop: it lowers the starting limits, and splitting covers the rest.

What the test checks, all recorded in a committed note:

1. **OR keywords:** the exact syntax that works, multi-word terms included, and the longest keyword LinkedIn accepts.
2. **Place ids:** pin LinkedIn `geoId`s for every region and country in the worked example (EMEA, LATAM, United States, Canada, Morocco, and the regions your profile lists).
3. **Containment:** for each candidate pair, search the child and the parent once each over the same window, and check that the child's jobs appear among the parent's. Pairs that pass become approved pairs.
4. **Row ceiling:** the most rows one search returns before LinkedIn stops paging.
5. **Memory:** whether the actor runs reliably at 1 GB.

## Tests

- **The planner is a pure function:** active builders + approved pairs + split state → searches.
- **Fixtures:**
  - your profile alone gives the 5 searches above;
  - adding user B (Python, remote Europe, onsite Paris) folds B's remote into EMEA and adds a Paris onsite search;
  - adding user C (Java, onsite Casablanca), with Casablanca → Morocco approved, folds into S5;
  - an unapproved pair doesn't fold;
  - filters are dropped when covered;
  - the order is stable whatever the input order.
- **Splitting:** a full search splits in the stated order, and a split is remembered across ticks. After a full run, cursors move only to the oldest returned item's posted time.
- **Window:** a new member's window looks back far enough, and no cursor moves without a covering run.
- **Spend cap:** at, under and over the cap, and across the Morocco day boundary.
- **Setup:** no Worldwide option and no star. The engine refuses a worldwide place.

## Left to the builder

- Builder granularity (above).
- Where split state lives, and when a split is undone.
- The approved-pairs format.
- The test note's location.
- How the spend total is queried. Check the cap before each run, not only at the start of a tick, and count a run with no reported cost at its charge cap.
- How builders carry the structured place code the fold needs (they store only text today).
- The PR split. The test task comes first and ends at the gate.
