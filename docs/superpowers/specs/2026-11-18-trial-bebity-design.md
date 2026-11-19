# Trial actor bebity: design

Roadmap: slice 07, `docs/roadmap/phase-3-find-quality/07-trial-linkedin-actors.md`. This is the second trial actor. It follows `2026-11-18-trial-linkedin-actors-design.md` (the "trial spec") everywhere this document doesn't say otherwise; read that spec's Decisions first. It builds on `2026-11-18-cheap-scraper-1gb-design.md` (PR #95, `ActorRunConfig.memoryMbytes`), so this branch starts from that one and targets `main`.

## Intent

The trial is a test. It should show which actors overlap with which, and which one brings the most qualified jobs and the most jobs the user applies to. harvestapi stays on and stays the source of truth. bebity (`bebity/linkedin-jobs-scraper`) joins as the second trial actor beside cheap*scraper. Its volume, overlap and cost are unknown until it runs, and measuring them is the point *(user)\_.

For the result to mean anything, the comparison must be fair. A job that one actor never had the chance to find, because it never ran that search in that tick (a cap stopped it, or it can't run that search), must not count against it.

## What the test runs showed (2026-11-18, 17 runs of 3–25 rows)

- **URL mode drops `f_WT`.** Every search URL with `f_WT` (remote `2` or on-site `1`) returned 0 jobs, in the US and the EU. The same URLs returned jobs from cheap_scraper. Without `f_WT`, URLs work. 40 of our 50 searches use `f_WT=2`.
- **Its own fields work.** `titles: [<our boolean keyword>]`, `locations: ['United States']`, `workTypes: ['2']`, `experienceLevels: ['2']`, `publishedAt: 'r86400'` returned 11 jobs; cheap_scraper on the same search returned 20; 4 job ids were shared.
- **Places are text.** `locations` names resolved as: Morocco → Morocco; United States → US cities; Europe → London; Middle East → United Arab Emirates; Latin America → Rio de Janeiro, Santiago; Africa → South Africa; Canada → Canadian cities; **MENA → United States** (wrong).
- **Fields without enrichment** (`companyProfile: false`, `enrichCompany: false`): `id`, `title`, `jobUrl`, `companyName`, `companyUrl`, `companyId`, `companyLogo`, `location` (text), `publishedAt` (`YYYY-MM-DD`), `postedTime` (relative, "46 minutes ago"), `description`, `descriptionHtml`, `contractType`, `experienceLevel`, `jobFunction`, `sector`, `salary`, `benefits`, `applicationsCount`, `applyType`, `applyUrl`, `posterFullName`, `posterProfileUrl`, `scrapingInfo`, `workType`.
  - `workType` is empty, and `applyUrl` is empty for `EXTERNAL` jobs (an `EASY_APPLY` job's `applyUrl` is its LinkedIn URL). bebity's log says enrichment adds the exact post date, structured location and job status, at a premium price per job.
- **Deterministic.** The same search run twice returned the same 16 jobs, so differences between actors reflect the actors, not run-to-run noise.
- **Several levels in one run are not "any of these".** `experienceLevels: ['3','4']` returned 17 jobs: none of level 3's 11, and 5 of level 4's 16. Every live builder uses a single level code today (1–5), so this doesn't bite yet.
- **Price** (the hosted engine's account `meeeha`, STARTER, Bronze tier): $0.00125 per job, $0.00005 per GB per run start. A 1 GB run takes 5–25 s.
- **Late charges.** Apify adds some per-job charges after a run finishes. The engine reads `usageTotalUsd` when the run ends, so it records 3–10% less than the final charge (cheap_scraper run `PvWdtbzfaZHKL2BMe`: $0.1472 recorded, $0.1514 final; `XYoFVgibI1KloWpgr`: $0.1064 recorded, $0.1172 final). This applies to every channel.

## Goals

- A third LinkedIn job-board intake, channel `LINKEDIN_JOB_BOARD_BEBITY`, running bebity on the same searches (except MENA), the same schedule (`0 9-21 * * 1-5` Africa/Casablanca) and the same one-hour window as harvestapi.
- Full pipeline, as for cheap_scraper: processed, matched, shown with an actor badge.
- One job per LinkedIn job id across all three actors, in any order. harvestapi's data wins; between trial actors, bebity's wins over cheap_scraper's.
- A fair `db:actor-compare`: overlap per pair of actors, counted only on searches both ran in the same tick.
- Spend caps that count what Apify finally charged.

## Non-goals

- Changing harvestapi's collection, the searches, the processor or the matcher's rules.
- Enrichment (`enrichCompany`, `companyProfile`). It costs extra per job; revisit after the trial if bebity wins.
- Fixing MENA for bebity (no single place name means the same as harvestapi's MENA geoId).
- curious_coder.

## Anti-goals

All of the trial spec's, plus:

- **An unfair comparison.** A job counted "harvestapi only" (or "cheap only") for a search bebity never ran in that tick, or the reverse.
- **A cap that isn't real.** A channel spending past its daily cap because late charges were never counted.
- **Two jobs for one LinkedIn id** when only trial actors saw it.

## Approaches

The trial spec's approach A (one channel per trial actor) holds; the user picked it, and it was built to make this actor cheap to add. Within it, the input had two options:

- **bebity's own search fields** (picked). They honour the work type and level filters and our boolean keyword. Places are text, not geoIds, so a search may land on a slightly different place than harvestapi's.
- **Search URLs, as for cheap_scraper.** Same geoId as harvestapi, but 40 of 50 searches return nothing, since URL mode drops every `f_WT` search. Ruled out.

## Decisions

### Channel

- New value `LINKEDIN_JOB_BOARD_BEBITY` in the contract enum and `Channel`, added to `TRIAL_CHANNELS`, with a generated migration; advance `"hash"` in `libs/database/src/migrations/app/refs/db.json` to the migration's `to`, or it silently never applies.
- Every `switch` and `Record<Channel, …>` gets a case: `source-key.ts` (bebity's items carry `id`; the existing bebity source-key rule applies), `job-key.ts`, `normalize.ts`, `merge.ts`, `collection.service.ts` (`fetch`, `boardRun`'s cast), `ingest/config/channels.ts` (the shared `linkedinJobBoardIngest`; its volatile keys already cover `scrapingInfo`, `postedTime`, `applicationsCount`, `companyLogo`), `queries/channels/index.ts`, `collect/config.ts`.
- Also: `ACTIVE_CHANNELS` (or `db:regenerate` builds no twins), `CHANNEL_LABELS` and `ACTOR_LABELS` in `apps/web/src/lib/matches/sources.ts`, and the channel names in `scripts/actor-compare/queries.ts`.
- On and off: `COLLECTION_TRIAL_CHANNELS` lists it, as for cheap_scraper.

### Collection

- A collector, `LinkedinJobBoardBebityCollector` (`collectors/providers/linkedin-job-board-bebity.collector.ts`), modelled on `LinkedinJobBoardCheapCollector`, using `oneSearchInput` and `runChargeCapUsd` from `collectors/utils/linkedin-board-run.ts`. One run per segment, one search per run, every returned item belongs to every member.
- **Input** (`collectors/providers/mappers/bebity-input.ts`), from the segment's first builder:
  - `titles: [mergedLinkedinKeyword(queries)]`
  - `locations: [<place name>]`, keyed by the builder's geoId (`linkedinGeoId(params)`, which segments already group by, so every member of a segment shares it), through a fixed map: `102787409` → `Morocco`, `103644278` → `United States`, `100506914` → `Europe`, `91000001` → `Middle East`, `91000011` → `Latin America`, `103537801` → `Africa`, `101174742` → `Canada` _(my call: text spellings vary, e.g. `north africa` shares Africa's geoId)_. A geoId not in the map (today MENA's `91000008`) throws `SearchNotStartedError`, as a place without a geoId does for harvestapi. The run isn't started and costs nothing.
  - `workTypes: [params.workType]` when set (LinkedIn's codes: `1` on-site, `2` remote, `3` hybrid).
  - `experienceLevels`: the builder's `experienceLevel` codes, split on commas. Every live builder holds one code. If a builder ever holds several, send them all and accept bebity's behaviour (not "any of", see the test runs); the report shows it _(my call)_.
  - `publishedAt: 'r3600'`, `rows`, `companyProfile: false`, `enrichCompany: false`.
- **Run config:** `actor: 'bebity/linkedin-jobs-scraper'`, `maxRowsPerSearch: 100`, `maxRowsCeiling: 1000`, `maxRunChargeUsd: 0.15` per 100 rows (100 × $0.00125 = $0.125 plus the start fee), `memoryMbytes: 1024`.
- **Schedule and window:** harvestapi's, own queue `collect-linkedin-job-board-bebity`, nx target `worker-linkedin-job-board-bebity`.
- **Cut-off searches:** no totals; a run is cut off when it returned `rows`. Same-tick and remembered splits work per channel, as for cheap_scraper.
- **Spend:** `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_BEBITY`, default **1** _(user)_, counted from its own runs.
- Before going live, `docs` and config follow cheap_scraper's: `deploy/engine/.env.example`, `deploy/engine/README.md` §8a, CLAUDE.md's command list.

### Final run cost (all channels)

- **Run id on the run row.** `search_segment_runs` gains `apifyRunId` (nullable text). Today only `collection_batches` has it, and only for runs that succeeded. It is set for every run Apify started: succeeded, and failed or aborted after starting. The Apify provider's errors for a started run carry the run id as a property (today it is only in the message), and the collection service stores it.
- **Re-read.** At the start of each LinkedIn job-board channel's tick, before the daily budget is read, the channel's runs with an `apifyRunId`, no `costFinalAt`, and `finishedAt` within the last 24 hours have their cost read again from Apify (the run's `usageTotalUsd`) and stored. The 24 hours cover the previous day's last tick (21:00) at the next morning's first tick.
- **Final.** A run's cost is final once it was read at least 5 minutes after the run finished. A new nullable column, `search_segment_runs.costFinalAt`, records when.
- The re-read stores Apify's value as it is, even when it is below what the run was counted at (a run with no recorded cost counts at its charge cap; its real cost replaces that) _(my call: it's the true spend)_.
- A failed re-read leaves the stored cost; the next tick tries again. Runs without an `apifyRunId` (not started, or failed before Apify returned an id) stay as they are.
- Applies to harvestapi too: its cap becomes real as well. Its collection is otherwise unchanged.

### Job key: trial actors key by LinkedIn id

- In `jobKey`, a trial channel's item always keys `linkedin-job:<id>`, whatever its apply URL. harvestapi keeps its current rule.
- Today no trial actor's apply URL produces another key (cheap_scraper has none; bebity's is empty for external jobs and a LinkedIn URL for Easy Apply), so existing keys don't change and no `NORMALIZER_VERSION` bump is needed for this. The rule makes trial–trial joins hold if bebity ever returns an employer link (with enrichment, say).
- So two trial actors meet on one job by key, and harvestapi joins either through the trial spec's existing rules (same key, or re-link of every trial-channel raw item with that source key). Those rules already use `isTrialChannel`/`TRIAL_CHANNELS` (`jobs.writer.ts`, `merge.ts` `boardSources`, `renormalize.service.ts`), so adding bebity to `TRIAL_CHANNELS` covers them; tests must show it with two trial channels.

### Mapper

- Update `bebity-job.mapper.ts` to the current output:
  - `postedAt`: `postedAtFromAgo(postedTime, ctx.scrapedAt, datePart(publishedAt))`, as cheap_scraper's mapper does; null when `postedTime` is absent (old raw rows), so rows already stored map as before.
  - `applyUrl`: unchanged (`externalApplyUrl(applyType, applyUrl)`), which already drops an empty or LinkedIn URL.
  - Remove the "no longer collected from" note.
- The shape check stays as it is: harvestapi first, then cheap_scraper (`jobTitle`/`jobDescription`/`searchString`), then bebity (`title`/`description`/`descriptionHtml`/`scrapingInfo`). The new fields don't collide.
- A fixture from a real bebity item (from the test runs; no personal data beyond what's public on the posting) in `ingest/utils/fixtures/`.
- Whether this needs a `NORMALIZER_VERSION` bump: no for stored rows (they have no `postedTime`). The plan checks with the existing renormalize spec.

### Precedence

- `merge.ts`: bebity `2.2`, between harvestapi's `2` and cheap_scraper's `2.4`. The comment's planned order stays.

### Actor badge

- `ACTOR_LABELS` in `apps/web/src/lib/matches/sources.ts`: `LINKEDIN_JOB_BOARD_BEBITY` → source "LinkedIn", actor "bebity". Badges in the order harvestapi, bebity, cheap_scraper.

### Report: a fair comparison

`db:actor-compare` changes from "harvestapi vs the trial" to every pair of actors.

- **Actors** are credited by batch actor, as today: harvestapi, cheap_scraper, bebity.
- **The unit is a search group in a tick** _(my call)_. Collection groups builders by place (geoId), level and work type, merges their keywords, and credits every returned item to every member, so a single builder can't say which of its group's jobs it found. A **group** is that key without its channel prefix (the `segmentKey` after `<channel>|`), so twins on every channel share it. Splits and keyword cuts subdivide a group into several runs; together they still cover the group.
- **A tick** is the Morocco-time hour in which the run started (`startedAt`), since every channel's cron fires at the same `:00`. Same-tick splits started later in that hour belong to it.
- **Ran:** an actor ran a group in a tick when every one of its builders in that group is in some run of that channel, in that tick, that succeeded and wasn't stopped at its charge cap. The group's jobs for that actor are the jobs of those runs.
- **Not run** is inferred, no new storage: the actor has builders in the group, another actor ran the group in that tick, and this one didn't. The reason comes from what is stored: no run row → skipped (daily cap or tick limit); a failed row with cost 0 → not started (e.g. MENA for bebity); another failed row → failed; a capped row → capped.
- **Overlap per pair** (harvestapi–cheap, harvestapi–bebity, cheap–bebity): for each (group, tick) both actors ran, the jobs each found are "A only", "B only" or "both" (by job, after joins). Totals per Morocco day and overall, plus who saw a shared job first and the median lead time, as today.
- **Per actor:** rows, distinct jobs, cost (final cost where known), cost per qualified job, searches run and not run (with the reason: cap, not started, failed), processed / qualified / review / rejected with the first failing rule, and the user's decisions (applied, not for me).
- **All three:** jobs found by exactly one actor, by two, by all three, on (group, tick) pairs that all three ran.
- The rest stays: joined jobs and extraction reuse, field coverage per group, the AI-search effect (bebity has no `searchString`; its AI-search row is "n/a").
- `--since` defaults to the first batch of any trial actor, as today.

## Rollout

1. Merge after PR #95. Apply the migration, deploy with `COLLECTION_TRIAL_CHANNELS` unchanged (bebity off).
2. Run `db:regenerate` on dev: bebity gets its twins of the 50 searches. harvestapi's and cheap_scraper's builder hashes must come out unchanged.
3. The user raises the Apify monthly limit on `meeeha` (about $40 for the cycle ending 2026-12-14; $9.49 was left on 2026-11-18, and harvestapi alone needs about $23).
4. Set `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_BEBITY=1` and add `LINKEDIN_JOB_BOARD_BEBITY` to `COLLECTION_TRIAL_CHANNELS` in the server `.env`, then `$C up -d worker`. Whether cheap_scraper is listed too is the user's call.
5. **First tick, check:** bebity ran its 45 non-MENA searches until its cap, with `workTypes`/`experienceLevels`/`publishedAt: r3600`; the 5 MENA searches show as not started at $0; returned jobs were posted within the hour (`postedAt`); a shared id is one job; after the next tick, the previous tick's runs have `costFinalAt` set and their cost matches Apify's.
6. After a weekday, `db:actor-compare`. After a week, applied counts.

## Left to the builder

- Where the cost re-read lives (the collection service or a helper it calls), as long as it runs before the daily budget is read and only touches that channel's runs.
- The report's layout.
- Whether the bebity place map lives in the input mapper or beside the geoId map.
