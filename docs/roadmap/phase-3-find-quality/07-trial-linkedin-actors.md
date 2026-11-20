# 07: Trial LinkedIn job-board actors

Found 2026-11-18, from a review of two days of LinkedIn job-board collection on `10xjobs-dev`. The trial intake is designed below, ready for a plan. Actors after cheap_scraper still need their own small decisions.

## Intent

The user isn't satisfied with what `harvestapi/linkedin-job-search` brings in. They want to run other LinkedIn job-board actors beside it, on the same searches, and compare them on real outcomes:

- how many jobs each one finds, and how many only it finds
- what each one costs
- how many of each one's jobs qualify
- how many of each one's jobs the user marks applied

The last one matters most. Raw stats alone won't decide which actor stays.

harvestapi stays on and stays the source of truth. A trial actor only adds jobs harvestapi didn't find, and records where it overlapped with harvestapi.

The first trial actor is `cheap_scraper/linkedin-job-scraper`. It was our actor until 2026-11-11 ([slice 01](01-linkedin-source-data.md)). Later trials: `curious_coder/linkedin-jobs-search-scraper`, then `bebity/linkedin-jobs-scraper` _(user)_.

## What the review showed (2026-11-16 12:00 to 2026-11-17 17:00 UTC)

- 19 hourly ticks over 50 searches, which all share one 276-character keyword. $2.33 spent.
- 4,156 rows came back, which is 2,236 distinct jobs. 114 qualified.
- The last cheap_scraper vs harvestapi check (2026-11-11, US remote, 24 hours) found **0 shared job ids**: cheap 36 jobs, harvest 66. The two actors see different slices of LinkedIn. That check used text places, so this trial is the first comparison at scale with geoIds.

## Goals

- A second LinkedIn job-board intake, with cheap_scraper as its first actor. It runs the same 50 searches, on the same schedule (hourly 09:00–21:00 Africa/Casablanca, weekdays) and the same one-hour window as harvestapi _(user)_.
- Full pipeline: trial jobs are processed, matched and shown in the user's matches _(user)_.
- One job per LinkedIn job id across harvestapi and the trial. harvestapi's data wins _(user)_.
- Every sighting is recorded with its actor and time _(user)_.
- A read-only comparison report. For each actor it gives volume, cost, overlap, who saw a shared job first, processing and match outcomes, and the user's decisions (applied, not for me) _(user)_.
- Adding the next actor needs only:
  - its channel value
  - its input adapter
  - its output mapper
  - a line in the precedence order
  - its config

## Non-goals

- **Changing harvestapi's collection.** Its searches, schedule, window, splits and cap stay as they are. Its daily cap stays at $3.
- **Changing the searches.** The keyword and the seniority-to-level map ([slice 08](08-seniority-levels.md)) change in their own slices. When they do, both intakes follow, because they build from the same profile.
- **Enriching trial jobs** through a lookup by LinkedIn job id. No actor checked so far returns an employer apply link (see [Later](#later)).
- **Changing the processor or the matcher's rules.** Why non-remote jobs pass is [slice 09](09-non-remote-leak.md).
- **Ending the trial.** It runs until the user turns it off _(user)_.

## Anti-goals

- **Harvestapi gets worse.** A harvest job ends up with a trial actor's field values, or with fewer facts than it would have alone.
- **Duplicate jobs.** One LinkedIn job shows as two jobs, or the user's applied mark is lost when two copies are joined.
- **A runaway bill.** A trial run without a cap, or a trial whose spend counts against harvestapi's cap.
- **Wrong credit.** A shared job counted for the wrong actor, or never counted.

## Approaches

The user picked **A**.

- **A. One channel per trial actor.** Searches, raw identity, merge ranking, spend and schedule are already per channel. The cost is roughly 49 places across the engine and the web app that test or key on `LINKEDIN_JOB_BOARD`, `PROCESSOR_CHANNEL` or `linkedInJobIds`, plus a channel value (a small migration) per actor. A winning actor is already a real channel.
- **B. One channel, with the actor as a new dimension.** Nothing downstream changes. But it reworks raw-item identity and the claim and cursor on every search, too deep a change for a trial.
- **C. A standalone trial worker.** harvestapi's path isn't touched. But it duplicates scheduling, splits, caps and ingest, and a winning actor would have to be rebuilt as a channel.

## Decisions

### Channels

- One new channel value per trial actor, starting with cheap_scraper. Names are the builder's call, for example `LINKEDIN_JOB_BOARD_CHEAP`.
- **"Is a LinkedIn job-board channel"** replaces the equality checks wherever the shared behaviour applies. These include:
  - search building and the search map
  - segment grouping
  - same-tick splits
  - the tick time limit
  - source keys
  - ingest config
  - the job key
  - the processor and matcher job filter (`PROCESSOR_CHANNEL`, `linkedInJobIds`)
  - the processor hand-off at ingest (`infrastructure/jobs/steps/ingest/processor.ts`)
  - the scripts that use it
- Every `switch` or `Record<Channel, …>` must cover the new channel, or it quietly returns undefined. Examples: `source-key.ts`, `job-key.ts`, `normalize.ts`, `merge.ts`, `ingest/config/channels.ts`, `queries/channels/index.ts`.
- Things that are really harvestapi's stay tied to harvestapi's channel. Examples: its `maxRowsCeiling`, its spend cap and its run config.
- **On and off.** Each trial channel needs a runtime switch, separate from search building.
  - Today `ACTIVE_CHANNELS` is a constant. It drives both collection (`collect/config.ts`) and which channels get searches built (`queries/steps/combinations.ts`). So a trial in that list starts collecting the moment it deploys, and one outside it gets no searches from `db:regenerate`.
  - Required: the trial's searches can be built while its collection is off. Turning it off stops collection only. Its searches are not retired, and its jobs stay _(my call)_.
- **Actor badge in the web app** _(user)_. Matches show a badge with the actor's name, so the user sees which actor found a job.
  - A job seen by several actors shows a badge for each one, harvestapi's first _(my call)_.
  - The match views get their channels from database functions (for example `20261116T2230_job_decision_reads`). They feed the match detail ("X and Y"), the match and decision rows, and the source filter (`group.ts`), so the actor has to reach those reads, not just `sources.ts`.
  - The source filter keeps one "LinkedIn" entry, not one per actor _(my call)_.
  - Built from `components/ui` and theme tokens, per `apps/web/DESIGN.md`.

### Searches

- Trial channels use the LinkedIn job-board builder, so each one gets its own copy of the profile's searches. Each copy has its own claim and cursor, so nothing collides with harvestapi's.
- `db:regenerate` creates them for published profiles.
- Same keyword, place (geoId), level and work-type filters as harvestapi _(user)_.

### Collection (cheap_scraper)

- **Input.** One search URL per run, from the existing `linkedinJobSearchUrl` (`collectors/providers/mappers/cheap-scraper-input.ts`):
  - `keywords` and `geoId`, plus `f_E` and `f_WT` from the builder's codes
  - `sortBy=DD` and `f_TPR=r3600`
  - `maxItems` as harvestapi's, and `saveOnlyUniqueItems: false`
- **`enrichCompanyData`: off** _(my call)_. It costs nothing extra, but it slows every run. Neither processing nor matching reads company details.
- **Schedule and window:** harvestapi's: `0 9-21 * * 1-5` Africa/Casablanca, one hour back, no catch-up _(user)_.
- **Cut-off searches.** cheap_scraper reports no search total, so a search counts as cut off only when it returned `maxItems`. Same-tick splits work as for harvestapi.
- **Spend.** Total LinkedIn collection goes from $3 to $6 a day _(user)_. It's split per channel: harvestapi keeps its $3, and each trial channel gets its own $3 _(user)_.
  - Today one setting, `COLLECTION_DAILY_BUDGET_USD`, applies to each channel separately. It becomes settable per channel.
- **LinkedIn's AI search.** Both cheap_scraper's and curious_coder's docs say LinkedIn now often serves an AI search that ignores `f_WT` and `f_E`. cheap_scraper then prefixes words like "Remote" or "Mid-Senior level" onto the keyword. Our boolean keyword may not survive that. This is accepted: measure it in the report, don't design around it _(user: noted)_.

### Storage and identity

- **Raw items** are unique per channel and source key, so trial rows (`id:<LinkedIn job id>`) never become versions of harvestapi's raw items. No change is needed.
- **Normalizing.** Normalizing a trial item uses its actor's mapper. cheap_scraper's (`cheap-scraper-job.mapper.ts`) already exists.
- **Place from location text** _(user)_. cheap_scraper gives location as text only. The place lookup (`facts/places/resolver.ts`) reads only country, region, city and geoId, so today a cheap job would get no listing place. On harvestapi jobs since 11-16, the listing place filled the place on 940 of 2,174 jobs (43%).
  - Parse the text into the same structured fields, deterministically, not with an LLM _(my call; the user asked whether an LLM could)_.
  - The formats in 4,083 old cheap rows:

    | Format                                                                      | Share                                                             |
    | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
    | "City, Region, Country"                                                     | 64%                                                               |
    | One part, such as "Austria", "Amsterdam Area" or "Agadir Metropolitan Area" | 26%                                                               |
    | "Region, Country"                                                           | 10%                                                               |
    | US "City, ST"                                                               | Expected; it's the form harvestapi shows in its own location text |

  - Anything the parser can't resolve gives no place, and `db:places` lists it, as it does today.
  - The parser must stay deterministic, because normalized jobs are rebuilt from raw storage.

### One job per LinkedIn id

- **The two job keys never meet.** harvestapi's external jobs are keyed by the employer's apply link (`ats:` or `url:`). cheap_scraper has no apply link, so its jobs fall back to `linkedin-job:<id>`. Left alone, the same job becomes two jobs.
- **The rule:** a trial item joins the job that holds a LinkedIn job-board item with the same LinkedIn job id. Both orders must work:
  - **harvestapi first:** the trial item attaches to harvestapi's job as a sighting only.
  - **Trial first:** the trial item makes its own job. When harvestapi later sees the same id, the trial job joins harvestapi's job.
    - Decisions (applied, not for me) and viewed marks move to the surviving job. Slice 06 already does this when a job merges away (`moveDecisions` and `moveViews` in `ingest/repositories/jobs.writer.ts`). Check whether review choices move too.
    - The facts are rebuilt and the job is matched again. Claude runs again only if the description text changed: the processor reuses an extraction for an input it has seen _(user: yes to reprocessing, narrowed to this)_.
- **A trial actor only adds new jobs** _(user)_. When a harvestapi item is behind a job, trial items contribute no field values, not even to fill fields harvestapi leaves empty. They count as sightings only.
  - That also covers the job's own times _(my call, from the same rule)_. A trial sighting on a harvestapi job doesn't change its `postedAt`, `firstSeenAt` or `lastSeenAt`, and doesn't reopen it for processing. `remerge` and the next-processing rule must skip trial sources when a harvestapi source exists.

### Precedence

- When only trial actors found a job, its fields come from the best one present: **harvestapi, then curious_coder, then bebity, then cheap_scraper** _(user)_.
- Ashby and Greenhouse postings still rank above all LinkedIn sources, and LinkedIn posts below them.
- This lives in the merge order (`ingest/normalize/merge.ts`).

### Processing and matching

- Trial jobs go through the processor and the matcher like harvestapi's.
- The processor reads only the title and description, and cheap_scraper has both. So cheap jobs lose nothing at extraction.
- **What cheap jobs lose at the listing-facts step** (`facts/rules/listing.ts`):

  | Missing           | Fills on harvestapi jobs   | On cheap jobs                           |
  | ----------------- | -------------------------- | --------------------------------------- |
  | Workplace type    | Arrangement on 22% of jobs | Lost: no way around it _(user)_         |
  | Structured place  | Place on 43%               | Mostly recovered by the location parser |
  | Structured salary | Salary on 5%               | Lost                                    |
  | Expiry date       | Closed (none closed yet)   | Lost                                    |

- **Accepted consequence:** a missing arrangement or place gives "unknown", and unknown never rejects. So cheap jobs will qualify wrongly more often than harvestapi jobs. The report should show it, and [slice 09](09-non-remote-leak.md) addresses the cause.

### Attribution and the report

- **Who counts as harvestapi** _(my call)_. Credit goes by the batch's actor (`collection_batches.actor`), not by channel. The `LINKEDIN_JOB_BOARD` channel also holds 4,083 cheap_scraper rows from before 2026-11-11; 4,042 of those jobs are archived.
  - The report counts only sightings from the trial's start onward, so those old rows count for neither actor.
  - If a trial sighting brings an old archived job back, that's treated as a live job seen again. Its old cheap row ranks with the harvestapi channel. This is rare, because the trial searches only the last hour, and it's accepted.
- **Sightings** already record batch, rank and time. The batch records the actor, so attribution needs no new storage, unless the builder finds a gap.
- **A read-only script** (`db:actor-compare` or similar). Per actor, per day and in total:
  - rows, distinct jobs, cost, cost per qualified job
  - overlap: harvestapi only, trial only, both
    - for shared jobs: who saw them first, and the median lead
  - processed, qualified, review and rejected, with the first failing rule
  - the user's decisions: applied and not for me, per group
  - field coverage: workplace type, place, salary, apply link
  - the AI-search effect: for harvestapi, how many returned jobs carry a workplace tag that contradicts the search's filter. cheap_scraper returns no workplace tag, so for it, use its `searchString` echo to count runs where the keyword came back rewritten.
- A job found by both counts in "both", whoever saw it first.

### Rollout

1. Merge, apply the migration, then deploy with the trial's collection **off**. The migration ref hash must advance, or the migration silently never applies.
2. Run `db:regenerate` on dev so the trial channel gets its searches.
3. Set the trial's cap.
4. Turn the trial's collection on for the hosted engine.
5. **First tick: check** that cheap_scraper runs with geoIds and `f_TPR=r3600`, that every returned job was posted within the hour, and that a shared id joined harvestapi's job.
6. **After the first weekday:** run the report. After a week, look at applied counts.

## Left to the builder

- Channel names, and the "LinkedIn job-board channel" predicate's name and home.
- How the trial-first job joins harvestapi's job (at ingest, or in merge), as long as both orders end in one job with the user's decisions kept.
- Where the location parser lives: the normalizer, or a shared place helper. Also where its country-name table comes from.
- The report's name and layout.
- The badge's look.

## Later

- **curious_coder/linkedin-jobs-search-scraper.** It needs the user's LinkedIn cookies, so it runs as a logged-in account, and that account could be restricted. Decide whose account before building. It returns workplace type and can filter on it, at $0.75 per 1,000.
- **bebity/linkedin-jobs-scraper.** Our first actor; its mapper still exists. $1.25 per 1,000; takes search URLs.
- **Enrichment by job id.** Only for trial jobs that qualify or go to review, because a missing fact can only let a wrong job through, never reject a right one.
  - Checked 2026-11-18: `apimaestro/linkedin-job-detail` takes ids (100 per batch, $5 per 1,000), but documents only remote yes/no and no apply link.
  - `curious_coder/linkedin-jobs-scraper` and harvestapi take searches only.
  - Revisit if an actor with an apply link turns up.
- **Reposts.** The user wants only fresh jobs, not reposts. Neither harvestapi nor cheap_scraper documents a repost filter or field (checked 2026-11-18). If LinkedIn has a URL parameter for it, cheap_scraper would pass it through; test that with one run.
  - Matching quality: a repost of a job we have never seen arrives as a new job. Slice 08 found about 560 reposted rows in 3 days (the posted time moved forward between two runs of the same search); a repost of a known job is still counted as seen. Decide how to tell a repost from a fresh job, or whether to drop it.
