# Search precision and shared LinkedIn searches (Phase 3, slice 04)

Date: 2026-11-14
Status: built (PRs #66–#68 and the db:spellings PR)
Roadmap: [04-search-precision](../../roadmap/phase-3-find-quality/04-search-precision.md)
Builds on: [slice 01, harvestapi](2026-11-11-linkedin-source-harvestapi-design.md) (PR 52)
Revises and replaces the planner of: [shared LinkedIn searches](2026-11-09-shared-linkedin-searches-design.md). Its Tasks 1–3 (Worldwide and the star) are built; its Tasks 4–9 are replaced by this spec.
Evidence: [LinkedIn region test](../../actors/linkedin-region-test.md), live runs on 2026-11-14

## Intent

LinkedIn searches return many jobs nobody wants, and miss some that people do want.

- **Noise.** Between a third and a half of collected jobs aren't engineering roles: 31 of the first 59 processed jobs (53%), and by title about 33% of this week's harvestapi jobs. Every one is paid for at collection ($0.001) and then processed.
- **Missed jobs.** The dev profile searches only `nestjs` and `next js`. The top-2 limit was removed from the code on 2026-11-12, but the recipe version wasn't bumped, so published profiles never moved.
- **Cost if fixed naively.** Searching all 8 of the dev profile's technologies as things are built today would make 512 searches, each a separate Apify run every tick.

This slice changes how LinkedIn job board searches are built:

1. **Who searches what.** A planner turns all published profiles into the fewest searches that keep what each profile wants, sharing searches between users.
2. **Where.** A search map turns each preference place into the LinkedIn place or places that actually cover it. Preferences themselves don't change.
3. **The keyword.** Generated from each profile's position, languages and technologies: an engineering role word AND at least one technology, each technology in the spellings postings use.

The live tests showed that LinkedIn's regions don't nest the way ours do, that its results vary from run to run, and that a `functionIds` filter would drop about a third of real engineering jobs. Those findings drive the decisions below.

## Goals

- Every searchable technology of a profile is searched.
- A job is collected when it mentions at least one of the profile's technologies **and** an engineering role word in a language the profile speaks.
- A preference place is searched through the LinkedIn place or places that cover it. Overlapping preference places share one search when the search map says so.
- Searches are shared across users. The number of searches grows with the distinct places, work types and experience levels wanted, not with users × technologies.
- A search that comes back full is split, so merging never silently loses jobs.
- Collection spending has a daily cap.
- Search spellings and role words are reviewed lists in code, with a script that suggests additions from real data.

## Non-goals

- LinkedIn posts, Ashby and Greenhouse. They keep their current builders _(see [Other channels](#other-channels))_.
- A filter that skips jobs before the processor. It's kept as a fallback, decided after a week of real collection, with measured recall _(user agreed with the recommendation)_.
- Running a search twice per tick to catch LinkedIn's noise. A second copy added about 12% more jobs; that's not worth doubling the cost _(user)_.
- Several positions in one profile. A user wanting several roles creates several profiles, each with its own resume (up to 5, `MAX_PROFILES`) _(user)_.
- Changes to the matcher, the processor or ingest.

## Anti-goals

- **Missing the right jobs** through a fold LinkedIn doesn't honour, a role word list that drops a real role, a spelling that misses how postings write a technology, or a full search that drops its oldest postings.
- **Collecting the wrong jobs:** a search shape that pulls in far more jobs than anyone asked for.
- **A large bill:** paying several times for the same job, or a runaway plan.

## Decisions

| Question                              | Decision                                                                                                                                                                                                   | Whose                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Scope                                 | The shared-searches planner is revised and built in this slice, on harvestapi.                                                                                                                             | user                                                                                        |
| `functionIds` / `industryIds` filters | Not used. 117 of 325 engineering-titled jobs (36%) carried neither `ENG` nor `IT`.                                                                                                                         | user (agreed)                                                                               |
| Folding places into LinkedIn regions  | None, unless a pair is listed in the search map. The test showed EMEA behaves like Europe, MENA doesn't contain the Middle East, and LinkedIn's own noise (5–64% between identical runs) hides small gaps. | user                                                                                        |
| Preference places                     | Unchanged. The `regions` taxonomy stays as it is, because the processor and matcher depend on it (an EU-only user must still reject a UK job).                                                             | user                                                                                        |
| Search map                            | A fixed map in code from each preference place to the LinkedIn search place(s) that cover it. See [The search map](#the-search-map).                                                                       | user                                                                                        |
| Repeats                               | One run per search per tick.                                                                                                                                                                               | user                                                                                        |
| Keyword rule                          | `(role words) AND (technology spellings)`: at least one technology, not all.                                                                                                                               | user                                                                                        |
| Technologies                          | Every searchable technology of the profile. No subset, no star.                                                                                                                                            | user                                                                                        |
| Role words                            | From the profile's position and languages: English always, plus each profile language the table covers.                                                                                                    | user                                                                                        |
| Spellings                             | A reviewed list in code, 1–4 spellings per technology, separate from the matching aliases in `tech_tags`. A script suggests additions; a human approves them.                                              | my call (the user didn't choose; a bad spelling like bare `node` multiplies cost and noise) |
| Positions                             | One per profile; several profiles for several roles.                                                                                                                                                       | user                                                                                        |
| Merging dimensions                    | Technologies and role words merge within a search. Work type and experience level are **not** merged: each search has one work type and one experience level.                                              | my call (see [Why filters aren't merged](#why-filters-arent-merged))                        |
| Several places in one Apify run       | Allowed but optional. It gives no discount: one start fee per place.                                                                                                                                       | my call                                                                                     |
| Spend cap                             | $3 a day for LinkedIn job board collection, configurable, counted per Morocco calendar day.                                                                                                                | user (from the shared-searches spec)                                                        |
| Schedule                              | Unchanged: hourly 09:00–21:00 Morocco time, weekdays, one-hour window.                                                                                                                                     | my call (the harvestapi spec set it after the shared-searches spec)                         |
| Verification before the build         | A short live run (Task 1) confirms the extended role words, the spellings and the longest keyword. Its findings set the lists.                                                                             | my call                                                                                     |

## The search map

Each preference place (region, country or city, as stored in `profiles.locations`) maps to one or more **search places**: a LinkedIn geoId from `LINKEDIN_GEO_IDS`.

| Preference place                             | Search place(s)                                 | Evidence                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Europe, EU, EEA, UK, DACH                    | Europe                                          | Europe alone found 150 of the 185 distinct jobs the five European searches found. EU, EEA and UK into Europe missed 4–22%, near LinkedIn's own noise (5–18%). |
| EMEA                                         | Europe + Middle East + Africa                   | Our EMEA is 123 countries; LinkedIn's EMEA total (681) matched Europe's (687–730), and only 9 of 150 EMEA jobs were in Africa or the Middle East.             |
| North Africa                                 | Africa                                          | LinkedIn has no North Africa region; `LINKEDIN_GEO_IDS` already maps it to Africa.                                                                            |
| Middle East                                  | Middle East                                     | Neither it nor MENA contains the other.                                                                                                                       |
| MENA                                         | MENA                                            | Same.                                                                                                                                                         |
| GCC                                          | GCC's countries, or the Middle East             | The builder's call: no GCC geoId is pinned.                                                                                                                   |
| Africa, Latin America, United States, Canada | itself                                          |                                                                                                                                                               |
| A country                                    | itself                                          | A country search also returns jobs posted to a whole region that contains it (6 of Morocco's 10 jobs were posted to "EMEA").                                  |
| A city                                       | its country, unless the city has a pinned geoId | The builder's call; no city geoIds are pinned today.                                                                                                          |
| Worldwide                                    | none                                            | Already refused by setup and the engine.                                                                                                                      |

- The map lives in code next to `LINKEDIN_GEO_IDS`, with the date each mapping was checked and its evidence.
- **Unmapped places.** `regions` also holds North America, the Americas, APAC, Asia (excluding the GCC) and Sub-Saharan Africa, and about 30 of 250 countries have a pinned geoId _(found by the builder check)_.
  - Regions without their own geoId map to search places that cover them: North America becomes United States + Canada; the Americas become United States + Canada + Latin America; Sub-Saharan Africa becomes Africa.
  - APAC and Asia (excluding the GCC) get a geoId pinned by hand on linkedin.com before Task 1, or map to their main countries if LinkedIn has no such region. That's the builder's call, recorded with its evidence.
  - Countries get their geoId pinned when a published profile first uses them. A command lists the preference places in use that have no mapping.
  - Setup is unchanged: no place is refused there. A preference place with no mapping fails loudly for that place only, is logged, and is never searched blind; the profile's other places still run _(my call: refusing places in setup would miss the right jobs)_.
- Every search keeps the list of builders it covers, so per-profile collection progress and attribution keep working. The matcher still decides per profile, so a broader search never changes who qualifies.
- If real collection shows a mapping loses jobs, that preference place gets its own search again. Changing the map bumps the recipe version.

## The keyword

### Shape

```
(<role words>) AND (<technology spellings>)
```

for example, for the dev profile (a fullstack engineer speaking English and French):

```
(engineer OR developer OR architect OR engineering OR ingénieur OR développeur OR architecte OR "tech lead")
AND (typescript OR nodejs OR "node.js" OR "node js" OR react OR "react native" OR "next.js" OR "next js" OR nestjs OR aws OR postgresql)
```

Syntax confirmed by the live test:

- `OR` and `AND` in uppercase; lowercase `or` is read as a word.
- A multi-word term is quoted; unquoted, `nestjs OR next js` misparses (22 results instead of 179).
- `AND` and plain juxtaposition read the same way.
- Accents don't matter (`développeur` 1,303, `developpeur` 1,296), so each word is listed once.

Terms are lowercase, deduped and sorted, so the same wishes always give the same keyword and the same recipe hash.

### Role words

A table in code, next to `POSITION_TITLES`, keyed by position family and language. For example:

| Positions                                                                                             | en                                              | fr                           | es                       | de                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------- | ------------------------ | --------------------- |
| backend, frontend, fullstack, mobile, platform, cloud, data, ML, AI, QA, embedded, security engineers | engineer, developer, engineering                | ingénieur, développeur       | ingeniero, desarrollador | Entwickler, Ingenieur |
| DevOps, SRE                                                                                           | the above, plus `devops`, `sre`                 |                              |                          |                       |
| software architect                                                                                    | architect                                       | architecte                   | arquitecto               | Architekt             |
| tech lead                                                                                             | "tech lead", "technical lead", "lead developer" | "lead technique", "lead dev" | "líder técnico"          |                       |
| engineering manager                                                                                   | "engineering manager", "head of engineering"    |                              |                          |                       |

- A profile's role words are its position's row, in English plus each language in `profiles.languages` that has a column, whatever the proficiency level _(user: "English plus the languages in the profile"; ignoring proficiency is my call)_.
- A language with no column yet falls back to English only.
- The exact words are set by Task 1. The first test lost 16% of engineering-titled jobs in Europe (architects, engineering managers, directors) with a narrower list; `architect` and `engineering` are meant to recover them.

### Technology spellings

- A new list in code, `SEARCH_SPELLINGS`, gives 1–4 spellings per searchable technology. It replaces the single wording that `TECHNOLOGY_TERMS` and `LINKEDIN_TERMS` give for the LinkedIn job board. `TECHNOLOGY_TERMS` stays the source of truth for which technologies are searchable, and for the other channels.
- It's separate from `tech_tags.aliases`. Aliases recognise a technology in job text, and some would flood a search: `node`, `ts`, `remix`, `react router`.
- The test found:
  - bare single terms match loosely (`nestjs` returned "Legal Officer");
  - quoted terms match tightly (`"node js"` returned only 151 Europe jobs a week).

  So each technology's spellings cover how postings write it (`nodejs`, `"node.js"`, `"node js"`). Task 1 checks them.

- A technology with no entry falls back to its `TECHNOLOGY_TERMS` wording, quoted when it contains a space or symbol.

### Suggesting spellings and role words

A read-only script, in the style of `db:vocab`:

1. For each searched technology, it counts how collected job titles and descriptions write it, and suggests spellings above a share threshold (for example, `NodeJS` at 20%).
2. For each suggestion, it runs a 3-row LinkedIn search to read the total, so a spelling that floods is flagged before anyone approves it. Paid runs are behind a flag and a small cap.
3. It lists engineering-titled jobs whose title contains no role word of their profile's languages, as candidate role words.
4. It reports spellings that never brought a job no other spelling found, as candidates to remove.

A person approves a suggestion by editing the list in code. Any change to spellings or role words bumps the recipe version, and `db:regenerate` moves published profiles to it.

## The planner

The planner is a pure function, rebuilt every tick from the active LinkedIn job board builders: builders + search map + split state → searches. Segments are already rebuilt every tick, so publishing or deleting a profile reshapes the plan on the next tick.

### 1. Read each builder as a wish

A builder gives: search place (through the search map), work type, experience level, role words, technology spellings.

- **Builder granularity is the builder's call.** One builder per profile × preference place × work type × experience level is enough. Technologies no longer multiply builders.
- Builders need the structured place code (region, country or city), not only the place text, so the search map can be applied. How they carry it is the builder's call; the old plan's Task 4 `PlaceRef` is one way.

### 2. Group

Wishes are grouped by **search place × work type × experience level**.

- Experience: a seniority's LinkedIn codes are split into single levels (mid becomes `associate` and `mid-senior`). A wish joins every level it covers.
- A profile with no work type for a place (unstated) searches without the filter. That search overlaps the filtered ones; that's accepted.

### 3. Merge

Within a group:

- role words: the union of the members';
- technology spellings: the union of the members';
- the keyword: built as in [The keyword](#the-keyword).

Every item the run returns is attributed to every member, as today.

### Why filters aren't merged

A job has one workplace type and one experience level. So searches split by work type and level don't overlap, and splitting them costs only start fees ($0.001 per search). Merging them, as the shared-searches spec planned, would collect combinations nobody asked for: hybrid jobs for a user who wants onsite, junior jobs for a mid-to-senior user. Each of those is a paid, processed job.

Merging technologies and role words is different. Separate searches per technology would return the same job several times, and each duplicate is charged.

### 4. Size

- The starting row limit and charge cap are today's (100 rows, $0.25).
- harvestapi returns at most 1,000 jobs per search (40 pages of 25).

### 5. Split when full, in the same tick

A search is full when it returned its row limit, or when LinkedIn's `totalElements` is above what was returned (the existing `truncatedQueryIds` signal). Every search asks harvestapi for the past hour (`postedLimit: '1h'`), so a split on the next tick could never re-cover the hour that was cut. So a full search is split **at once, in the same tick**, and the halves rerun over the same past hour _(my call, from the builder check)_:

1. halve its member builders (sorted by hash, so the halves are stable) and run both halves;
2. if a single technology is still full, rerun it with a higher row limit, up to harvestapi's 1,000 ceiling, and log it for review.

The jobs the full run already returned are charged again when a half returns them. That cost counts against the spend cap. The split is also remembered for later ticks, so the same search doesn't fill and rerun every hour. Where split state lives, and when a split is undone, is the builder's call; it must never be undone on the tick right after the split.

### 6. Coverage

Builders are generated per **search place × work type × single experience level** (the search map and the level split are applied when the recipe is built). So each builder belongs to exactly one search, and the existing per-builder claims and cursors keep working unchanged. Same-tick split halves are disjoint sets of builders.

- A full run's batch is stored without advancing cursors; the halves that rerun advance them.
- A single builder still full at the 1,000-row ceiling advances its cursors and logs that older postings in that hour are lost. Every search asks only for the past hour, so holding the cursor back can't recover them.
- A re-plan must never move a cursor forward without a run that covered it.

### 7. Keyword length

The longest keyword LinkedIn accepts is set by Task 1. A keyword over that limit is pre-split by halving its spellings, the same way a full search is split.

## Spend cap

- Configurable, defaulting to $3 a day (for example `COLLECTION_DAILY_BUDGET_USD`), for the LinkedIn job board channel.
- Spend is the sum of `search_segment_runs.costMicroUsd` since the start of the current Morocco day (`Africa/Casablanca`, which observes a Ramadan time change).
- The cap is checked before each run. A run with no reported cost counts at its charge cap.
- When the cap is reached, collection skips runs until the next Morocco day and logs one line. A run that starts under the cap may overshoot it by at most its own charge cap.

## Other channels

LinkedIn posts, Ashby and Greenhouse are out of scope. They aren't active either: `ACTIVE_CHANNELS` lists only the LinkedIn job board, and builders are generated only for active channels. So the recipe bump in this slice regenerates LinkedIn job board builders alone.

Since the 2026-11-12 commit, `technologySets` returns every technology for every channel. Whether a channel keeps every technology or goes back to a cap is decided when that channel is re-enabled, not here _(my call: no builders exist for them today)_.

## Rollout on dev

1. Task 1: the live check. Its findings set the role words, spellings and keyword limit.
2. Build and merge the PRs.
3. Bump the recipe version. Run `db:regenerate` on `10xjobs-dev`. This also removes the stale Worldwide builders and the two-technology builders.
4. The hosted engine needs the new `APIFY_TOKEN` before schedules can run.
5. After a week of collection, run `db:analyze` and the spellings script. Report:
   - the share of processed jobs that aren't engineering roles (the target is under 15%, my call; it's 33–53% today);
   - which role words and spellings brought jobs;
   - daily spend against the cap;
   - how many searches came back full and were split.
6. Decide then whether a pre-processor title filter is needed.

## Tests

- **Search map:** every seeded region maps to at least one geoId. EMEA maps to Europe + Middle East + Africa, North America to United States + Canada. An unmapped country fails for that place only, and the profile's other places still run.
- **Keyword:**
  - the dev profile gives the expected keyword;
  - multi-word terms are quoted, operators are uppercase, the order is stable whatever the input order;
  - a Spanish speaker gets Spanish role words; a profile with an uncovered language gets English only.
- **Planner fixtures:**
  - the dev profile alone gives one search per search place × work type × level, with all 8 technologies in each;
  - adding user B (Python, remote Europe, senior) adds `python` to the Europe remote mid-senior search and nothing else;
  - adding user C (Java, onsite Casablanca, junior) adds its own Morocco onsite internship and entry searches;
  - an EU-only preference and a Europe preference share one Europe search;
  - the result is the same whatever the input order.
- **Splitting:** a full search halves its members and both halves run in the same tick; a single full technology reruns with a higher row limit; a split is remembered across ticks; a run still full at the ceiling moves cursors only to the oldest returned item's posted time.
- **Coverage:** an EMEA preference gives three builders, one per search place, each collected by its own search.
- **Spend cap:** at, under and over the cap, and across the Morocco day boundary.

## Task 1: the live check (first, a go/no-go)

It extends the existing spike `apps/xjobs/src/scripts/linkedin-region-test.ts` with a new section. The maintainer runs it, because it needs the Apify token. A new campaign cap of $1 replaces the spent $2 one _(my call; the user approves the amount before the run)_.

It checks, with real filters (Europe remote mid-senior; Morocco hybrid and onsite):

1. **Role words:** the extended list against the narrower one. Does it recover the architects and engineering managers the first run lost, and what does it add in non-engineering titles?
2. **Spellings:** each technology's candidate spellings, alone and OR'd. Does `nodejs OR "node.js" OR "node js"` find more than `"node js"`, and does any spelling flood?
3. **Keyword length:** the longest keyword that still returns results, using the dev profile's full keyword padded with more technologies.
4. **Real volume:** jobs per hour for the dev profile's actual searches, to confirm the $3 cap fits.

**Gate:** if `AND` with OR'd groups stops working under real filters, or the keyword limit is too short for one profile's keyword, stop and go back to design.

## Open questions

None. The builder check raised four. Three are settled above as my calls: same-tick splits, coverage per search, and unmapped places. The fourth, other channels, is moot while only the LinkedIn job board is active.

## Left to the builder

- Builder granularity and how builders carry the structured place code.
- The search map's format, and how the GCC and cities map.
- Where split state lives, and when a split is undone.
- How APAC and Asia (excluding the GCC) are covered.
- How the spend total is queried.
- The spellings script's name, thresholds and output.
- Whether several places share one Apify run.
- The PR split. Task 1 comes first and ends at the gate.
