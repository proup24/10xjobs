# 03: Collect

## Goal

The hosted engine collects Indeed jobs for every published profile with Indeed on, through valig, the actor slice 01 picked, on a schedule and under a daily cap.

## What exists

- Channel plumbing: `Channel` enum (`contract.prisma`), `ACTIVE_CHANNELS`, search builders (`queries/channels/`), collectors and input mappers (`collectors/providers/`), segment claims and cursors, `saveBatch`, per-channel daily budgets (`CollectionService.dailyBudget`). See `modules/collectors/README.md`.
- Phase 3 slice 07 made "is a LinkedIn job-board channel" a predicate and listed every `switch` / `Record<Channel, …>` that must cover a new channel. The same list applies here.
- The query recipe (keyword spellings, role words, seniorities), built per profile for LinkedIn.

## In scope

- A new channel value, `INDEED`, built the slice 07 way so a second Indeed actor can be added as a trial channel later with only its channel value, input builder, output mapper and config.
- **Markets as data** _(my proposal)_: a table (or seeded list) of Indeed country sites with a flag for "main remote market". Starting main markets: US, Brazil, Poland, UK, Canada _(user)_. Adding one is a row plus `db:regenerate`.
- **Searches per profile:**
  - on-site and hybrid: each country the profile names that has an Indeed site (Morocco: ma.indeed.com);
  - remote: one remote search per main market, whatever regions the profile names;
  - regions are never expanded into countries;
  - shared between profiles with the same keyword, place and arrangement, like LinkedIn's.
- **Keyword:** what Indeed accepts (length, boolean operators, quoting) and how the LinkedIn recipe's spellings map onto it.
- **Cadence and window:** Indeed's newest filter is the last 24 hours (`fromage=1`), so ticks can't be hourly with a one-hour window. Pick a cadence (for example 3 weekday ticks in Morocco hours) and accept paid repeat rows, deduped at ingest.
- **Spend:** its own daily cap (env, default about $1 until the cost per tick is known), counted from Apify's final cost like the LinkedIn channels; the cap never shares harvestapi's.
- A worker command `npx nx worker-indeed xjobs`, schedules only with `XJOBS_RUN_SCHEDULES=1`.

## Out of scope

- Normalizing, processing and matching (slice 04).
- The full worldwide market list (slice 07).

## Open questions

- ~~Indeed's keyword limits and whether one search per profile group fits.~~ The LinkedIn merged boolean keyword works as is, up to 403 characters (slice 01). The longer limit is still unmeasured.
- Indeed's language per site: on ma.indeed.com, the recipe's French role words find French titles (slice 01). Portuguese and Polish are still open.
- ~~How remote is filtered per site.~~ Location `Remote` works on the US and UK sites. kaix's remote filter doesn't (rich mode). memo23's remote attribute isn't either (58% lost on the weekday re-run). valig, the pick, has only location `Remote`.
- Rows per search per tick. On Sunday no search passed one page (15 rows). On the weekday re-run, the US remote search filled the 100-row cap, while UK and Morocco stayed under 10. What cap the US needs, and what it costs (valig: about $0.0009 per start plus $0.09 per 1,000 rows), is open.
