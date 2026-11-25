# Indeed collect (Phase 5, slice 03)

Date: 2026-11-25
Status: draft
Brief: `docs/roadmap/phase-5-indeed/03-collect.md`. Actor evidence: `docs/actors/indeed-actor-sample.md`.

## Intent

The hosted engine collects Indeed jobs for every published profile with Indeed on, through valig (`valig/indeed-jobs-scraper`, picked in slice 01), hourly on weekdays, under its own daily cap. The point of Indeed is the right jobs LinkedIn doesn't bring (Phase 5 README). Collection has to be fresh, because the user wants Indeed jobs about as fast as LinkedIn's hourly runs _(user)_, and cheap enough to keep running until slice 06 decides keep or drop.

## Goals

- A new channel, `INDEED`, built the Phase 3 slice 07 way, so a later trial actor (curious_coder is the candidate) needs only its channel value, input mapper, collector config and ingest mapper.
- Searches built per profile from the same recipe as LinkedIn (role words, spellings), for profiles with the Indeed switch on:
  - remote: one search per **main market** (US, Brazil, Poland, UK, Canada _(user)_), whatever regions the profile names;
  - each country the profile names, for remote, hybrid or on-site, that has an Indeed site (Morocco: `ma`): one search of that whole site _(user)_.
- Indeed's sites as data: a table the engine reads. Adding a market is a row plus `db:regenerate`.
- Hourly collection, weekdays 09:00–21:00 Morocco time, each run looking back 24 hours, a fixed cap of 1,000 rows per search _(user)_.
- A daily cap of its own, `COLLECTION_DAILY_BUDGET_USD_INDEED`, counted from Apify's final cost, never shared with harvestapi's.
- `npx nx worker-indeed xjobs`, which registers its schedule only with `XJOBS_RUN_SCHEDULES=1`.

## Non-goals

- Normalizing, processing, matching and showing Indeed jobs (slice 04).
- Cross-source duplicates (slice 05) and the channel compare report (slice 06).
- The worldwide market list (slice 07).
- A dynamic row cap per search. Deferred: see Follow-ups.
- Sorting by date. valig doesn't offer it.

## Anti-goals

- **Missing the right jobs.** valig ranks by relevance, so a run that stops at its row cap silently drops the tail, and every later run drops the same jobs. The cap is set far above the measured supply, and hitting it is recorded, never silent.
- **Spend that grows unseen.** Every run counts toward the Indeed daily cap, and the cap stops collection before it is passed.
- **Searching places the profile didn't ask for.** Regions are never expanded into countries. Remote main-market searches are the one deliberate exception, decided in the Phase 5 brainstorm.
- **Missing local remote jobs.** A country the profile names for remote gets its own site's search, not only the main markets.

## Evidence this rests on

- **Indeed's date filter is whole days only** (`fromage`: 1, 3, 7, 14). Every Indeed actor checked has the same limit. valig's whole input is `country`, `title`, `location`, `limit` (1–1,000) and `datePosted` (`''`, `1`, `3`, `7`, `14`), with no sort, from its build 0.0.18 schema (2026-11-25).
- **The 24-hour window is honoured.** A valig US remote run on 2026-11-25 at 13:09 UTC (window Tuesday 13:09 to Wednesday 13:09) returned 145 jobs, none of them among the 100 of the 2026-11-24 10:25 run. 145 is under the cap, so it is that day's whole supply for the owner's keyword. The 2026-11-24 run hit its 100-row cap.
- **Cost:** about $0.0009 per run start plus about $0.0001 per row. The 145-row run cost $0.01395. UK remote returned 3 rows and Morocco on-site 7 on 2026-11-24. Brazil, Poland and Canada are unmeasured.
- **Remote is the location `Remote`.** It works on the US and UK sites. valig has no remote filter. An empty location searches the whole country site (Morocco: 7 rows).
- **The merged boolean keyword works** on Indeed at up to 403 characters, and French role words find French titles on `ma.indeed.com`.

### Expected spend and volume

Per profile with Indeed on, at the measured supply:

| Search                     | Per run | Per day (13 runs) |
| -------------------------- | ------- | ----------------- |
| US remote, about 145 rows  | $0.014  | $0.18             |
| 5 other searches, few rows | $0.006  | $0.08             |

The table assumes one named country (Morocco). Each further named country adds about $0.002 a run.
| **Total** | $0.02 | **about $0.26** |

Three profiles: about $0.80 a day. Repeat rows cost Apify money only: ingest drops a job it already has by its Indeed job key, so processing sees about one day's unique jobs, about 160 per profile per day.

## Approaches

**Cadence** (asked of the user, who wants freshness close to LinkedIn's hourly runs):

1. **valig, hourly, 24-hour window, high row cap** _(picked, user)_. Every run returns the whole day so far, and ingest keeps only new jobs. It costs about the day's rows times the runs, which is cheap at the measured supply.
2. An actor that sorts by date (kaix, memo23, borderline), taking only the newest rows each hour. It's cheaper per run, but none is proven: kaix returned 5 rows where valig returned 100, memo23 failed the gate on cost, and borderline was never sampled. It would reopen slice 01.
3. valig two or three times a day. It's cheap, but jobs arrive hours late.

**Row cap** _(user)_:

1. **One fixed cap of 1,000 rows (valig's maximum) for every search** _(picked)_. valig bills rows returned, not rows allowed, so the cap costs nothing on a normal day. Its only risk is a broken search returning 1,000 wrong rows an hour. That costs at most about $0.10 a run, and the daily cap stops it.
2. A dynamic cap per search (say three times the week's most rows, between 100 and 1,000). It protects only against the broken-search case and needs state per search. Deferred.

**Markets:** a table, as the Phase 5 brief decided, rather than a constant in code, so slice 07 adds markets without a release.

## Design

### Channel

- `INDEED` joins the `Channel` enum (`contract.prisma`) and every `switch` and `Record<Channel, …>` listed in `docs/superpowers/specs/2026-11-18-trial-linkedin-actors-design.md` (`source-key.ts`, `job-key.ts`, `normalize.ts`, `merge.ts`, `collection.service.ts` `fetch`, and the Records TypeScript enforces).
- **It does not join `ACTIVE_CHANNELS`.** That list is the channels board recipes are built for on every profile (`queries/steps/combinations.ts`). Indeed is switch-only, like `LINKEDIN_POSTS`: its recipes come only through `SEARCH_SWITCHES`, and its collection config sets `enabled: true` directly.
- It isn't a LinkedIn job-board channel and isn't a trial channel.
- **Until slice 04, Indeed batches are collected and stored but not ingested.** Ingest must leave an `INDEED` batch pending, without failing it or logging an error on every sweep, so slice 04 ingests the stored batches when it lands. The ingest `switch` cases this slice must add do only that.
- The Indeed switch (`SEARCH_SWITCHES`, `key: 'indeed'`) gets `channel: Channel.INDEED` and `recipes: indeedRecipes`. **`available` stays `false` in this slice.** Slice 04 sets it to `true` once Indeed jobs reach the matches view, so no user turns on a switch that shows nothing. For the dev rollout, the owner's profile gets `indeedSearch = true` set directly (see Rollout).

### Markets table

An engine-only table (RLS on, no policies), say `indeed_markets`, in the Prisma contract:

| Column           | Meaning                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| `site`           | valig's `country` code, primary key (`us`, `uk`, `br`, `pl`, `ca`, `ma`, …)     |
| `country`        | the country as the profile's place vocabulary names it, to match on-site places |
| `mainRemote`     | true for a market every profile with Indeed on searches remote                  |
| `remoteLocation` | the location text that means remote on that site, default `Remote`              |

- Seeded with every site valig's schema lists (62), `mainRemote` true for `us`, `br`, `pl`, `uk`, `ca`.
- `remoteLocation` is data because only the US and UK sites were checked. Brazil, Poland and Canada are checked in the rollout, and a row update fixes a wrong one.
- Turning a market on or off is a row update plus `db:regenerate`.

### Searches (recipes)

`indeedRecipes(input)` builds one recipe per search place, for the profile's position and ranked skills, through a new `INDEED` builder in `CHANNEL_QUERY_BUILDERS`:

- **Remote:** one recipe per `mainRemote` market, with `type: remote`, location the market's `remoteLocation`, and params `{ site, location }`. It's built whenever the profile wants remote at all (`locations.remote` not empty), whatever the regions.
- **Named countries** _(user)_: each country the profile names for remote, hybrid or on-site that resolves to a market row gets **one** search of its whole site, with an empty location and `type` left to the matcher. valig has no arrangement filter, so one search covers every arrangement, and the matcher decides. Morocco returned 7 rows (about $0.002 a run). One exception: a country named only for remote that is also a main market (the US, Canada) adds nothing, because its main-market remote search covers it.
- **Named cities** (on-site or hybrid): the city text on its country's site, unless that country already has a whole-site search.
- **Regions** (`Europe`, `Africa`): no Indeed search of their own. Their remote side is covered by the main markets.
- **No seniority filter and no seniority word:** valig has none, and the profile's levels stay with the matcher.
- **Keyword:** the LinkedIn recipe's role words and spellings, merged the LinkedIn way (`mergedLinkedinKeyword`, `linkedinMemberWords`): builders that share a site and location are grouped, and their words merge into the fewest keywords that fit. That includes builders from different profiles, so profiles share runs like LinkedIn's. The LinkedIn limits (319 characters, 25 terms) are kept as the packing limit _(my call: they're known to work, and Indeed took 403)_.
- Recipes join the query recipe version. Shipping this bumps `QUERY_SEARCH_RECIPE_VERSION`, and the rollout runs `db:regenerate`.

### Role words for Portuguese and Polish

The role words already follow each profile's languages (English, plus each listed language that has a column). Add `pt` and `pl` columns to `ROLE_WORDS` _(my call)_:

- `pt`: `engenheiro`, `desenvolvedor`, `programador`, `arquiteto`; tech lead `líder técnico`.
- `pl`: `programista`, `inżynier`, `architekt`; developer is usually written in English in Polish titles.

They apply only to a profile that lists Portuguese or Polish, on LinkedIn as well as Indeed. No current profile does. The spellings aren't measured. `db:spellings` reports missed titles once such a profile exists.

### Collector and input mapper

- `IndeedCollector` in `collectors/providers/indeed.collector.ts`, with its actor id and config. The input lives in `providers/mappers/indeed-input.ts`.
- One Apify run per segment, and a segment is one merged search: `{ country: site, title: keyword, location, limit: 1000, datePosted }`.
- **`datePosted`** is the smallest of Indeed's day filters (`1`, `3`, `7`) that covers the segment's window. A normal hourly run covers one hour and asks for `1`. The first run after a gap (Monday 09:00 after Friday 21:00, or a stopped worker) covers up to 72 hours and asks for `3`, so weekend jobs aren't lost.
- Items are attributed to their search through `segment-result.ts` like the other Apify channels.

### Cadence, window and budget

- `channelJobsConfig[Channel.INDEED]`: queue `collect-indeed`, schedule `0 9-21 * * 1-5` in `Africa/Casablanca` (the LinkedIn job board's hours), concurrency 1, attempts 1.
- Window: one hour, cursors moving the LinkedIn way, `maximumHours: 72` so a gap widens to Indeed's 3-day filter and no further. The exact `WindowConfig` and `resumeHours` values are left to the builder, with these two outcomes required.
- **Daily cap:** `COLLECTION_DAILY_BUDGET_USD_INDEED`, default `1`, through `CollectionService.dailyBudget`'s per-channel env lookup. It's counted from Apify's final cost, like the LinkedIn channels. Each run's charge limit is the smaller of what's left of the day's cap and what 1,000 rows plus a start cost.
- **Row cap reached:** a run that returns 1,000 rows is recorded as having reached its row cap, next to the existing charge-cap flag, and logged as a warning. It still counts as covering its window, since the next run looks back 24 hours anyway.
- **Rows per run** are kept on the run record, so the real supply per market can be read once Brazil, Poland and Canada run.
- A failed or capped run follows the existing failure rules (`modules/collectors/README.md`).

### Worker

`npx nx worker-indeed xjobs`, a new `worker-indeed` target in `apps/xjobs/project.json`, also run by `worker-all`. It registers its schedule only with `XJOBS_RUN_SCHEDULES=1`. The root `CLAUDE.md` command list and the collectors README name it.

## Tests

- Recipes: one remote search per main market; one whole-site search per named country, whatever its arrangements; nothing extra for a main market named only for remote; a city searches its city unless its country has a whole-site search; a region gets nothing; a country without a market row gets nothing; no seniority word; Portuguese and Polish words only when the profile lists them.
- The switch: on attaches Indeed builders, off detaches them, and `db:regenerate` and `db:publish-drafts` respect it (slice 02's paths with the real channel).
- Input mapper: `datePosted` is `1` for a one-hour window, `3` for 60 hours, `limit` 1,000, `location` from the recipe.
- Collection: the per-channel budget env, the row-cap flag at exactly 1,000 rows, and that an `INDEED` batch is stored and left pending by ingest.
- Postgres spec for the markets table seed and its RLS (on, no policies).

## Rollout check on dev

1. Merge and deploy. Migrations apply on dev at deploy. Run `db:regenerate`.
2. Set `indeedSearch = true` on the owner's profile directly (the switch stays hidden). Confirm its Indeed builders follow the rules above: the 5 main-market remote searches, plus one whole-site search per named country that isn't covered (Morocco).
3. Add `worker-indeed` to the hosted engine, with `COLLECTION_DAILY_BUDGET_USD_INDEED=1`.
4. After the first weekday: runs on every hourly tick, rows per search, the row-cap flag never set, spend against the cap, and batches stored and pending.
5. Brazil, Poland and Canada: rows returned with `Remote`. If a site returns nothing or ignores it, fix its `remoteLocation` row (Portuguese `Remoto` is the first guess for Brazil) and rerun `db:regenerate`.

## Left to the builder

- The table's exact name and how a profile place resolves to a market row (through the place vocabulary LinkedIn already uses).
- The `WindowConfig` values that give one-hour cursors with a 72-hour catch-up.
- How ingest leaves `INDEED` batches pending until slice 04.
- Migration bookkeeping: advance `app/refs/db.json`'s hash and regenerate `database.types.ts`.

## Follow-ups

- **Dynamic row cap per search**, once many users have Indeed on and one broken search could eat a shared budget.
- **curious_coder as a trial channel**, once slice 04 has ingested valig's jobs.
- **Measured Portuguese and Polish role words**, when a profile lists those languages.
