# Trial LinkedIn job-board actors: design

Roadmap: `docs/roadmap/phase-3-find-quality/07-trial-linkedin-actors.md` (branch `docs/linkedin-pipeline-roadmap`). This spec builds the first trial actor, `cheap_scraper/linkedin-job-scraper`, and makes the next one cheap to add.

## Intent

The user isn't satisfied with what `harvestapi/linkedin-job-search` brings in. They want other LinkedIn job-board actors to run beside it on the same searches, and to compare them on real outcomes: how many jobs each finds (and how many only it finds), what each costs, how many of its jobs qualify, and above all how many the user marks applied. Raw stats alone won't decide which actor stays.

harvestapi stays on and stays the source of truth. A trial actor only adds jobs harvestapi didn't find, and records where it overlapped.

## Goals

- A second LinkedIn job-board intake, channel `LINKEDIN_JOB_BOARD_CHEAP`, running cheap_scraper on the same searches, the same schedule (`0 9-21 * * 1-5` Africa/Casablanca) and the same one-hour window as harvestapi.
- Full pipeline: trial jobs are processed, matched and shown in the user's matches.
- One job per LinkedIn job id across harvestapi and the trial, in either order. harvestapi's data wins.
- Every sighting is recorded with its actor and time (already true: sightings carry their batch, and the batch its actor).
- An actor badge on matches.
- A read-only comparison report, `db:actor-compare`.
- Adding the next actor needs only: its channel value, its input adapter, its output mapper, a line in the precedence order, and its config.

## Non-goals

- Changing harvestapi's collection: searches, schedule, window, splits, row limits, $3 cap.
- Changing the searches (keyword, seniority map). Both intakes build from the same profile, so they follow those slices.
- Enriching trial jobs by LinkedIn job id.
- Changing the processor's prompt or the matcher's rules.
- Ending the trial. It runs until the user turns it off.
- curious_coder and bebity. They come later, each with its own small decisions.

## Anti-goals

- **harvestapi gets worse.** A harvestapi job ends up with a trial actor's field values or seen times, or with fewer facts than it would have alone.
- **Duplicate jobs.** One LinkedIn job shows as two, or the user's applied mark is lost when two copies are joined.
- **A runaway bill.** A trial run without a cap, or trial spend counted against harvestapi's cap.
- **Wrong credit.** A shared job counted for the wrong actor, or never counted.
- **The two intakes disturb each other.** One channel's tick erasing the other's remembered splits, claims or cursors.

## Approaches

The user picked **A** in the roadmap.

- **A. One channel per trial actor.** Searches, raw identity, merge ranking, spend and schedule are already per channel. Costs about 49 places that test or key on `LINKEDIN_JOB_BOARD`, `PROCESSOR_CHANNEL` or `linkedInJobIds`, plus one migration per actor. A winning actor is already a real channel.
- **B. One channel, the actor as a new dimension.** Nothing downstream changes, but raw-item identity and the claim and cursor on every search must be reworked. Too deep for a trial.
- **C. A standalone trial worker.** Doesn't touch harvestapi's path, but duplicates scheduling, splits, caps and ingest, and a winner would be rebuilt as a channel.

## How it works today (what this builds on)

- `Channel` enum: `libs/database/src/enums/channel.enum.ts` and the contract (`contract.prisma`, `enum Channel`, stored as text). `ACTIVE_CHANNELS` drives both which channels get searches (`queries/steps/combinations.ts`) and which collect (`infrastructure/jobs/steps/collect/config.ts`).
- Normalizing a LinkedIn job-board item picks its mapper by the payload's shape (`ingest/normalize/mappers/linkedin-job.mapper.ts`), not by channel. cheap_scraper's mapper (`cheap-scraper-job.mapper.ts`) and its search-URL input builder (`collectors/providers/mappers/cheap-scraper-input.ts`) already exist.
- Raw items are unique per `(channel, sourceKey)`. A LinkedIn job's source key is `id:<LinkedIn job id>`.
- A job's key (`ingest/normalize/job-key.ts`): a LinkedIn job with an employer apply link keys as `ats:` or `url:`, otherwise `linkedin-job:<id>`. cheap_scraper has no employer apply link, so its jobs key `linkedin-job:<id>`. About half of harvestapi's jobs key `ats:`/`url:`; for those, the same posting would become two jobs if left alone.
- `linkJob` (`ingest/repositories/jobs.writer.ts`) links an item to its key's job. When an item leaves a job and the job has no sources left, the job becomes `merged` into the new one, and `moveDecisions` and `moveViews` move every user's decisions and viewed marks.
- `mergeSources` (`ingest/normalize/merge.ts`) builds each field from the best-ranked source that states it, falling through to lower ones for empty fields. `remerge` sets `firstSeenAt`/`lastSeenAt` from all sources.
- The processor reuses an earlier extraction when title and description hash the same (`processor/rules/input.ts`, `ExtractionStore.reuse`, `copyExtraction`).
- The match reads (`job_decision_reads`, `job_postings`, match details) already return each job's distinct source channels. The web labels them (`apps/web/src/lib/matches/sources.ts`), and the source filter offers one entry per channel (`group.ts`).
- Spend: `CollectionService.dailyBudget` caps only `LINKEDIN_JOB_BOARD`, at `COLLECTION_DAILY_BUDGET_USD` (default 3), summing that channel's `search_segment_runs` since the Morocco day started.
- Remembered splits (`linkedin_search_splits`) are keyed by group key, which starts with the channel. But `pruneSplits` deletes every row not built in the current tick, whatever its channel.

## Decisions

### Channel and the shared predicate

- New value `LINKEDIN_JOB_BOARD_CHEAP` in the contract enum and `Channel`, with a migration. The migration ref hash in `libs/database/src/migrations/app/refs/db.json` must advance, or the migration silently never applies.
- One helper, `isLinkedinJobBoard(channel)`, beside `Channel` in `libs/database/src/enums/channel.enum.ts` (re-exported through `src/common/enums`). It is true for `LINKEDIN_JOB_BOARD` and every trial channel. It replaces the equality checks wherever both intakes behave alike:
  - search building: `combinations.ts`, `technology.ts`, the builder registry (`queries/channels/index.ts`: a `LinkedinJobBoardBuilder` per job-board channel, with the builder's `channel` taken from a constructor argument)
  - segment grouping (`segments.ts`)
  - same-tick splits, remembered splits and the tick time limit (`collection.service.ts`)
  - source keys (`source-key.ts`) and LinkedIn URL identity (`identity.ts`)
  - ingest config (`ingest/config/channels.ts`): trial channels get the same `volatileKeys`
  - the job key (`job-key.ts`)
  - the processor and matcher scope (`linkedInJobIds`, which today tests `r.channel = PROCESSOR_CHANNEL`) and the hand-off at ingest (`infrastructure/jobs/steps/ingest/processor.ts`)
  - the scripts that use them (`spellings.ts`, `places-recheck.ts`)
- Every `switch` or `Record<Channel, …>` covers the new value. TypeScript enforces the `Record`s; the switches need a case each (`source-key.ts`, `job-key.ts`, `normalize.ts`, `merge.ts`, `collection.service.ts` `fetch`).
- Things that are really harvestapi's stay tied to `LINKEDIN_JOB_BOARD`: its run config, row limits, ceiling and spend cap.

### On and off

- Searches are built for every LinkedIn job-board channel. `ACTIVE_CHANNELS` becomes the channels that get searches: `[LINKEDIN_JOB_BOARD, LINKEDIN_JOB_BOARD_CHEAP]`.
- Whether a channel collects is decided separately:
  - harvestapi collects whenever it's in `ACTIVE_CHANNELS`, as today.
  - A trial channel collects only when listed in a new env setting, `COLLECTION_TRIAL_CHANNELS`: comma-separated channel values, default empty, validated against the trial channels in `environment.validation.ts`.
- **To turn it on or off:** edit `~/engine/.env` on the server, then `$C up -d worker`. Add this to `deploy/engine/README.md` and `deploy/engine/.env.example`. Turning it off stops collection only. Its searches stay active, and its jobs stay.
- A disabled channel's worker removes its schedule and exits, as today (`CollectionWorkerService.start`). `worker-all` starts a collection worker for every channel in `channelJobsConfig`, so the trial's entry makes it start (and stop) with the rest. Add an nx target `worker-linkedin-job-board-cheap` beside the others for local runs. Update CLAUDE.md's command list with it and with `db:actor-compare`.

### Searches

- Trial channels use the LinkedIn job-board builder, so each gets its own copy of the profile's searches with its own claim and cursor. A builder's hash includes its channel, so the copies never collide with harvestapi's.
- Same keyword, place (geoId), level and work-type filters as harvestapi.
- `db:regenerate` creates them for published profiles. It always regenerates every published profile, so no recipe version bump is needed. harvestapi's builders must come out with identical hashes, so their cursors and splits carry over.

### Collection (cheap_scraper)

- A new collector, `LinkedinJobBoardCheapCollector` (`collectors/providers/linkedin-job-board-cheap.collector.ts`), channel `LINKEDIN_JOB_BOARD_CHEAP`. It follows `LinkedinJobBoardCollector`: one run per segment, one search per run, every returned item belongs to every member.
- **Input.** `toLinkedinJobBoardInput(linkedinJobSearchUrl(mergedLinkedinKeyword(queries), first.params, 3600), rows)`:
  - `keywords`, the `geoId` (resolved by `linkedinGeoId`, so a place with no geoId throws `SearchNotStartedError`, as for harvestapi), `f_E` and `f_WT` from the builder's codes
  - `sortBy=DD`, `f_TPR=r3600`
  - `maxItems` = rows, `saveOnlyUniqueItems: false`, `enrichCompanyData: false`
  - The `linkedinJobSearchUrl` location parameter: when a geoId is set, send only `geoId` (no text `location`), so the search runs on the same place as harvestapi's.
  - Remove the "old actor, used only by scripts" note from `cheap-scraper-input.ts`; it is live again.
- **Run config** (`LinkedinJobBoardRunConfig` shape, its own values): `actor: 'cheap_scraper/linkedin-job-scraper'`, `maxRowsPerSearch: 100`, `maxRowsCeiling: 1000`, `maxRunChargeUsd: 0.15` per 100 rows _(my call: dev history shows $0.95 per 1,000 rows and at most $0.088 for a 100-row run)_.
- **Schedule and window:** harvestapi's (`linkedinJobBoard` in `collect/config.ts`): `0 9-21 * * 1-5` Africa/Casablanca, one hour back, no catch-up. Its own queue: `collect-linkedin-job-board-cheap`.
- **Cut-off searches.** cheap_scraper reports no search total, so a search counts as cut off only when it returned `maxItems` rows. `searchTotals` is null. Same-tick splits work as for harvestapi, using the channel's own `maxRowsPerSearch` and `maxRowsCeiling` (today `collectSegment`, `rememberSplits` and `chargeCapMicroUsd` read `LINKEDIN_JOB_BOARD`'s config; they read the running channel's).
- **Remembered splits per channel.** `pruneSplits` deletes only rows whose group key starts with the running channel's prefix (`<channel>|`). Without this, each intake's tick erases the other's splits.
- **Spend.** Each LinkedIn job-board channel has its own daily cap, counted from its own runs only (`spentMicroUsd` already filters by channel).
  - harvestapi: `COLLECTION_DAILY_BUDGET_USD`, default 3, unchanged.
  - cheap_scraper: `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP`, default 3.
  - A run with no recorded cost counts at that channel's own charge cap.
- **LinkedIn's AI search.** LinkedIn may serve an AI search that ignores `f_WT` and `f_E` and rewrites the keyword. Accepted: measured in the report, not designed around.

### Storage and identity

- Raw items stay unique per channel and source key, so trial rows never become versions of harvestapi's. No change.
- Normalizing a trial item uses its shape's mapper, as today. `NORMALIZER_VERSION` bumps only if a mapper's output changes (the plan decides; nothing here requires it).

### One job per LinkedIn id

The rule: a trial item joins the job that holds a `LINKEDIN_JOB_BOARD` item with the same LinkedIn job id. Both orders end in one job.

- **Trial item's key.** In `linkJob`, after `effectiveKey`: when the item is on a trial channel and a `LINKEDIN_JOB_BOARD` raw item exists with the same `sourceKey` and is linked to a job, the trial item's key is that job's key. Otherwise it keys by its own rule (`linkedin-job:<id>`). This reads stored rows only, so a rebuild (`db:renormalize`) gives the same answer, as long as harvestapi's items are linked before trial items. The rebuild orders them that way.
- **harvestapi first.** The trial item links to harvestapi's job as a source that contributes nothing (see below). One job.
- **Trial first.** The trial item makes its own `linkedin-job:<id>` job. What happens when harvestapi sees the same id depends on harvestapi's key. On dev since 2026-11-11, harvestapi's jobs keyed `linkedin-job:` 1,028 times (no employer apply link), `url:` 942 times and `ats:` 169 times, so both cases are common:
  - **Same key** (harvestapi keys `linkedin-job:<id>` too). harvestapi's item links straight onto the trial's job as a second source. No merge happens. The job is now a harvestapi job: `remerge` takes its fields from harvestapi alone (rule below), and the job is joined (see "Processing a joined job").
  - **Different key** (`ats:` or `url:`). `linkJob` re-links every trial-channel raw item with that source key, in the same transaction. Each moves to harvestapi's job through the existing "key changed" path. The trial job, left with no sources, becomes `merged` into harvestapi's job:
    - Decisions (applied, not for me) and viewed marks move (`moveDecisions`, `moveViews`).
    - Review choices (`match_reviews`) stay on the old match and don't move _(my call: they are tied to that match's rule and field, and the new job is matched afresh; a review between the trial seeing a job and harvestapi seeing it within the hour is rare)_.
    - Fact reports stay on the old job (they are a log and change nothing).
- **When harvestapi's item later changes key, or its job is renamed,** the trial sources with its LinkedIn id follow it. `renamed()` treats a trial source's key as its harvestapi twin's key, so a rename isn't refused because of a trial source, and no trial-only twin is left behind.
- **Concurrency.** Both channels tick at the same minute, and ingest runs two batches at once. The trial-key lookup and the re-link of trial items take a transaction-scoped advisory lock on the LinkedIn id (`pg_advisory_xact_lock` on a hash of `id:<LinkedIn id>`), taken for every LinkedIn job-board item before it links. Two items with the same id then link one after the other, and the second sees the first's rows.
- **Rebuild order.** `db:renormalize` links `LINKEDIN_JOB_BOARD` items before trial-channel items (today it orders by id), so a rebuild ends in the same jobs.
- **Processing a joined job: no second Claude call** _(user)_. The same LinkedIn id is the same posting, so the trial's extraction is reused, and harvestapi's listing facts still apply:
  - A job is **joined** when its first `LINKEDIN_JOB_BOARD` source links and, before that link, it had only trial sources (same key) or a trial-only job merged into it (different key).
  - A joined job goes to processing with a new reason, `joined` (`ProcessingReason` and the `normalized_jobs_processing_reason` check gain it). This covers both cases. In the different-key case the job may be new (`new`); it becomes `joined` in the same transaction. In the same-key case it isn't new or reopened, so without this it would never be processed again and would keep facts built from the trial's listing. That is the "harvestapi gets worse" anti-goal.
  - For a `joined` job, `findReusable` gains a fallback. When no extraction matches the input hash, the newest extraction of this job, or of a job whose `mergedIntoId` is this job, with the same schema version, prompt hash and extraction model, is reused (copied with `copyExtraction` when it belongs to the merged job). The fallback applies only to `joined`: a `new` or `reopened` job whose text really changed still runs Claude.
  - The facts are then rebuilt from harvestapi's listing fields (workplace type, structured place, salary, expiry) and that extraction, and the job is matched again, all through the existing reuse path.
  - If no such extraction exists (the trial job was never processed, or was processed with another prompt, schema or model), Claude runs once on harvestapi's text, as for any new job.
  - If the trial job's processing is still running when harvestapi arrives, the joined state supersedes it, as a reopen does today. The joined run doesn't wait. If the earlier run hasn't saved its extraction yet, Claude runs once more _(my call: the window is a few minutes, so this is rare)_.
- **Trial sources contribute nothing when harvestapi is there** _(user)_. When a job has a `LINKEDIN_JOB_BOARD` source:
  - `mergeSources` ignores trial sources for every field, even fields harvestapi leaves empty.
  - `remerge` takes `firstSeenAt` and `lastSeenAt` from non-trial sources only.
  - A trial sighting doesn't reopen the job or send it to processing: `nextProcessing` keeps the current state when the linking item is on a trial channel and the job has a `LINKEDIN_JOB_BOARD` source. This includes an archived job.
- **Old cheap_scraper rows on `LINKEDIN_JOB_BOARD`** (4,083 rows from before 2026-11-11, almost all archived) rank as harvestapi's channel. A trial sighting of one attaches as a sighting and doesn't revive it _(my call: this follows the rule above, and it's rare because the trial searches only the last hour)_. This replaces the roadmap's "brings it back".
- **Two trial actors, no harvestapi.** Both key `linkedin-job:<id>` and meet on their own. A future actor that returns an employer apply link would key differently; its slice handles that.

### Precedence

- When no `LINKEDIN_JOB_BOARD` source is present, trial sources rank in the merge order: harvestapi, then curious_coder, then bebity, then cheap_scraper. Only cheap_scraper exists now. The order lives in `merge.ts`'s `precedence` as fractional ranks below harvestapi's 2 (for example cheap_scraper 2.3), with a comment naming the planned order.
- Ashby and Greenhouse still rank above every LinkedIn source, and LinkedIn posts below.

### Place from location text

cheap_scraper gives location as text only, so today a cheap job would get no listing place. On harvestapi jobs since 11-16 the listing place filled the place on 43% of jobs.

- **Where:** in the listing-facts step, inside `resolveListingPlace` (`facts/places/resolver.ts`), as a last step used only when `countryCode`, `regionCode`, `city` and `geoId` are all empty and the location text is not _(my call: it uses the countries, aliases and cities already in the database, so aliases added with `db:vocab` apply, and no new country table is needed. Facts are rebuilt at every processing, from stored rows only, so it stays deterministic)_.
- `ListingLocation` gains `location: string | null`. The vocabulary gains country labels and aliases (`countries.label`, `countries.aliases`) and a fold of city names to their countries, for the one-part form.
- **Formats** (from 4,083 old cheap rows), comma-separated, parts trimmed:

  | Form                        | Example                                                 | Resolves to                                                                                                                                              |
  | --------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | City, Region, Country (64%) | "Casablanca, Casablanca-Settat, Morocco"                | the city in that country, else the country                                                                                                               |
  | Region, Country (10%)       | "Île-de-France, France"                                 | the country                                                                                                                                              |
  | One part (26%)              | "Austria", "Amsterdam Area", "Agadir Metropolitan Area" | a country by label or alias; else a city, after removing "Greater " and " Metropolitan Area" / " Area", when exactly one country has a city by that name |
  | US City, ST                 | "Austin, TX"                                            | the city in US, else US, when ST is a US state code                                                                                                      |

- The last part names the country by label or alias, folded with `foldPlaceName`. Anything else gives no place, and `fellBack` is true, so `db:places` lists it as today.
- On dev, none of the 2,139 active harvestapi jobs since 11-11 has every structured place field empty, so in practice this fallback changes only trial jobs.

### Processing and matching

- Trial jobs go through the processor and matcher like harvestapi's. The processor reads only title and description, which cheap_scraper has.
- What cheap jobs lose at listing facts: workplace type (lost), structured place (mostly recovered by the parser above), structured salary (lost), expiry (lost). A missing arrangement or place gives "unknown", and unknown never rejects, so cheap jobs will qualify wrongly more often. Accepted; the report shows it, and slice 09 addresses the cause.

### Actor badge (web)

- `apps/web/src/lib/matches/sources.ts` gains, per channel, a source label and an actor label:
  - `LINKEDIN_JOB_BOARD`: source "LinkedIn", actor "harvestapi"
  - `LINKEDIN_JOB_BOARD_CHEAP`: source "LinkedIn", actor "cheap_scraper"
- Matches (the row and the detail), decision rows, and the job page's postings show one badge per LinkedIn actor that saw the job, harvestapi's first. Built from `components/ui` (`Badge`) and theme tokens, per `apps/web/DESIGN.md`. The look is the builder's call.
- The source filter keeps one "LinkedIn" entry that matches both channels. The match detail's "X and Y" source text names each source once ("LinkedIn", not "LinkedIn and LinkedIn").
- No database function change: the reads already return the channels.

### Attribution and the report

- **Credit goes by the batch's actor** (`collection_batches.actor`), not by channel. Only sightings from the trial's start count: the report takes `--since <ISO time>`, defaulting to the first batch of a trial actor. So the old cheap rows count for neither actor.
- No new storage: sightings already record batch, rank and time.
- **`pnpm --filter @xjobs/xjobs db:actor-compare -- [--since <iso>] [--days <n>]`**, read-only, in `apps/xjobs/src/scripts/actor-compare.ts`. Per actor, per Morocco day and in total:
  - rows returned, distinct jobs, cost (`search_segment_runs.costMicroUsd` of its batches), cost per qualified job
  - overlap: harvestapi only, trial only, both. A job seen by both counts in "both", whoever saw it first. For shared jobs: who saw it first, and the median lead time.
  - joined jobs (processing reason `joined`, same key or merged), and how many of those reused an extraction (no Claude call) versus ran Claude
  - processed, qualified, review and rejected (matches at the current matcher version), with the first failing rule for rejections
  - the user's decisions: applied and not for me, per group (harvestapi only, trial only, both)
  - field coverage of each group's jobs: workplace type, listing place, salary, apply link
  - the AI-search effect: for harvestapi, jobs whose workplace tag contradicts the search's `f_WT`; for cheap_scraper, runs whose `searchString` echo no longer contains the keyword that was sent.
- Plain text tables, the same style as `db:match-shares` and `db:analyze`.

## Rollout

1. Merge, apply the migration, then deploy with `COLLECTION_TRIAL_CHANNELS` unset (trial collection off).
2. Run `db:regenerate` on dev so the trial channel gets its searches.
3. Add `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_JOB_BOARD_CHEAP=3` and `COLLECTION_TRIAL_CHANNELS=LINKEDIN_JOB_BOARD_CHEAP` to the server `.env`, then `$C up -d worker`.
4. **First tick, check:** cheap_scraper ran with geoIds and `f_TPR=r3600`; every returned job was posted within the hour; harvestapi's split rows are still there; a shared id joined harvestapi's job.
5. **After the first weekday:** run `db:actor-compare`. After a week, look at applied counts.

## Left to the builder

- The badge's look.
- The report's exact layout.
- Whether the trial-key lookup and the re-link of trial items live in `linkJob` or a helper it calls, as long as both orders end in one job in one transaction.
