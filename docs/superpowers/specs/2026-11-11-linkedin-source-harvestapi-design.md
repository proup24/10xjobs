# LinkedIn source: move to harvestapi (Phase 3, slice 01)

Date: 2026-11-11
Status: draft
Roadmap: [01-linkedin-source-data](../../roadmap/phase-3-find-quality/01-linkedin-source-data.md)

## Intent

The LinkedIn job board actor, `cheap_scraper/linkedin-job-scraper`, leaves out facts that matching depends on. In the dev data, 45 of 60 processed jobs have arrangement `unstated`, and 47 of 60 location checks are `unknown`, because the actor has no workplace type. It also has no employer apply link (0 of 4,048 jobs have one) and no HTML description, and it doesn't map company identity.

This slice replaces the actor with [`harvestapi/linkedin-job-search`](https://apify.com/harvestapi/linkedin-job-search) _(user)_. It maps every useful field the new actor returns, and stores company data once per company. The point is to have the facts at the source. This slice doesn't decide which value wins when LinkedIn and the processor disagree.

## Goals

- LinkedIn job board collection runs on `harvestapi/linkedin-job-search`.
- Every fact the actor gives that we have a use for is stored on the job as LinkedIn's value, starting with workplace type (see [Fields](#fields)).
- Companies are stored once per LinkedIn company id in a new `companies` table, and each job points to its company _(user)_.
- External jobs carry the employer's apply URL. Through the existing job-key rules, a LinkedIn job then merges with its Ashby or Greenhouse posting.
- Raw LinkedIn items keep the same identity (`id:<LinkedIn job id>`), so a job already collected under the old actor isn't collected again as new.

## Non-goals

- **The processor and the matcher.** The user is rebuilding them. The prompt, the extraction schema and the match rules don't change. The processor doesn't start reading the new fields in this slice _(user)_.
- **Choosing a source of truth.** LinkedIn's values and the processor's values are separate fields, and they may disagree. Which one wins is decided later, by the user _(user)_.
- **The shared-searches planner** (`docs/superpowers/specs/2026-11-09-shared-linkedin-searches-design.md`). It's revised in its own work after this slice lands (see [Shared searches](#shared-searches)).
- **Processor gaps** found while checking the data: no tech stack on 29 of 60 jobs, no salary on 60 of 60, and `needsReview` on 59 of 60. They aren't source-data problems.
- **Old raw items.** Items already collected from cheap*scraper are left as they are *(user)\_. They aren't re-mapped.
- **LinkedIn posts, Ashby, Greenhouse.**

## Anti-goals

- **Merging the two kinds of fact.** LinkedIn's value never overwrites the processor's value or stands in for it, and the reverse. They're always two fields _(user)_.
- **Missed jobs.** An actor swap that silently returns fewer jobs for the same search, or a time window left uncovered.
- **Duplicate jobs.** A job collected under both actors ending up as two jobs because its raw identity changed.
- **A runaway bill.** A run that isn't capped.

## The actor

What the actor's input schema and a live run on 2026-11-11 showed: two searches in France, 30 items, $0.032. The raw items are kept as fixtures (see [Tests](#tests)).

- **Price:** $0.001 per job plus a $0.001 start fee per search title (pay per event, no platform usage charge). A job returned by two searches in the same run is charged twice.
- **Input:** structured fields, not search URLs. `jobTitles` (boolean operators supported), `locations` (text) or `geoIds`, `workplaceType` (`remote`, `hybrid`, `office`), `experienceLevel` (`internship`, `entry`, `associate`, `mid-senior`, `director`, `executive`), `employmentType`, `postedLimit` (`1h`, `24h`, `week`, `month`), `sortBy` (`relevance`, `date`), `maxItems` (per title and location).
- **Output:** each item carries `query`, the search that found it, and `_meta.pagination.totalElements`, LinkedIn's total match count.
- **Coverage in the live run:**

  | Field                                           | Coverage                              |
  | ----------------------------------------------- | ------------------------------------- |
  | `workplaceType`                                 | 27 of 30                              |
  | Employer apply URL                              | 21 of 30 (the other 9 are Easy Apply) |
  | `company.website`, company id, size, industries | 30 of 30                              |
  | `experienceLevel`                               | 9 of 30                               |
  | `employmentType`                                | 29 of 30                              |
  | Structured salary                               | 1 of 30                               |
  | `descriptionHtml`                               | 30 of 30                              |
  | `location.parsed`                               | 30 of 30                              |

## Collection

One actor run per search, as today. A search is one builder's keyword, place, experience filter and work-type filter.

- **Input mapping.** This replaces `linkedinJobSearchUrl` and `toLinkedinJobBoardInput` in `collectors/providers/mappers/linkedin-job-board.mapper.ts`.
  - `jobTitles: [keyword]`.
  - `geoIds: [geoId]`, always. The geoId is the builder's own `geoId` when it has one, else the collector looks the location up in `LINKEDIN_GEO_IDS` at run time. `GLOBAL` and `worldwide` are `92000000`. A location with no geoId isn't sent as text: the search fails with an error that names the location _(user, after the parity check)_. See [Places](#places).
  - `experienceLevel` comes from the builder's `f_E` codes: 1 `internship`, 2 `entry`, 3 `associate`, 4 `mid-senior`, 5 `director`.
  - `workplaceType` comes from its `f_WT` code: 1 `office`, 2 `remote`, 3 `hybrid`.
  - `sortBy: 'date'`, and `maxItems` is today's 100.
- **Builders.** Their params stay in LinkedIn's `f_E` and `f_WT` codes, so stored builders and `db:regenerate` are untouched. Only the collector translates them _(my call)_.
- **Time window.** Every run sends `postedLimit: '1h'`, with no overlap and no catch-up _(user)_.
  - LinkedIn job board channel config (`infrastructure/jobs/steps/collect/config.ts`): window `{ initialHours: 1, overlapMinutes: 0, maximumHours: 1 }`. The collector always sends `1h`, whatever the segment's window.
  - Schedule: hourly from 09:00 to 21:00, Monday to Friday, no weekends _(user)_. That's the pattern `0 9-21 * * 1-5`, 13 ticks a day.
    - Timezone `Africa/Casablanca`. Today the schedule is in UTC, but the shared-searches spec already planned Morocco time _(my call)_.
    - Only the job board gets the new schedule. LinkedIn posts share the `hourly` config today and keep it unchanged _(my call: this slice doesn't touch posts)_.
  - Jobs posted overnight, at weekends, or during a missed tick aren't collected. That's accepted for now _(user)_.
  - Items aren't filtered by `postedDate`. Ingest already deduplicates jobs it has seen before.
- **Search identity.** `linkedinSearch()` today returns a URL query string that segments group builders by. It becomes a stable key built from the structured inputs: keyword, geoId or location, sorted experience levels, sorted workplace types. The form is the builder's call, for example canonical JSON, or a hash of it _(user: a hash, or something simpler)_. Two builders with the same key run the same search.
- **Truncation.** A search counts as cut off when the run returned `maxItems` items, or when `totalElements` is greater than what was returned. `searchTotals` comes from `_meta.pagination` on the first item, instead of the old `SEARCH_TOTALS` record.
- **Cost cap.** The charge cap stays at $0.25 per run. 100 jobs plus the start fee is about $0.10.
- **Rank.** The item's position in the dataset, as today.
- **Source key.** It must stay `id:<LinkedIn job id>`. harvestapi's `id` is already the first field `source-key.ts` reads, but the builder confirms this with the fixture.
- **Config.** `LinkedinJobBoardCollector.config.actor` becomes `harvestapi/linkedin-job-search`.

### Places

The parity check (2026-11-11) showed that harvestapi accepts only place names LinkedIn's location box recognises. `European Economic Area`, `EMEA`, `Middle East` and `Latin America` were rejected: the run succeeds with 0 items. `North Africa` was silently read as South Africa. Region geoIds work. So every search sends a geoId, never text _(user)_.

- **Lookup at run time.** `LINKEDIN_GEO_IDS` gains every place the dev builders use. The collector resolves a builder's geoId from it when the builder has none, so stored builders and `db:regenerate` stay untouched. The search key uses the resolved geoId, so a builder with a stored geoId and one without it share a search.
- **Verified values** (2026-11-11, LinkedIn's public jobs page, both ways: the geoId shows the name, and the name resolves to the geoId):

  | Location | geoId |
  | --- | --- |
  | `worldwide`, `GLOBAL` | `92000000` |
  | `europe` | `100506914` |
  | `european union` | `91000000` |
  | `european economic area` | `91000002` |
  | `emea` | `91000007` |
  | `middle east` | `91000001` |
  | `mena` | `91000008` |
  | `latin america` | `91000011` |
  | `africa`, `north africa` | `103537801` |
  | `morocco` | `102787409` |
  | `canada` | `101174742` |
  | `united states` | `103644278` |

- **North Africa.** LinkedIn has no North Africa region, and its own search falls back to Africa. `north africa` maps to Africa; the matcher keeps what fits _(my call: broader beats empty, and it's what LinkedIn does)_.
- **Unknown place.** A builder whose location has no geoId makes its search throw, naming the location, so the gap shows in the logs instead of as an empty run _(user: fail loudly)_.

## Fields

### Two kinds of fact

The data already keeps them apart. `normalized_jobs` holds what the source said, and `job_extractions` holds what the processor read from the description. This slice adds to `normalized_jobs` and the normalized record only. Every new field is LinkedIn's value, unchanged except where noted. Where both kinds of fact exist, they live in different tables and never share a field.

### New job fields

The normalized record (`ingest/normalize/record.ts`) gains these fields, and `normalized_jobs` gains a column for each. The names are the builder's call; these are suggestions.

| Field                     | From                          | Notes                                                                                                                                                                                                                                                                 |
| ------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workplaceType`           | `workplaceType`               | `remote`, `hybrid` or `onsite` (from `on_site`); null when missing.                                                                                                                                                                                                   |
| `remoteAllowed`           | `workRemoteAllowed`           | Boolean.                                                                                                                                                                                                                                                              |
| `employmentType`          | `employmentType`              | LinkedIn's snake case kept as given (`full_time`). `contractType` keeps its current meaning: the source's text, as today.                                                                                                                                             |
| `countryCode`             | `location.parsed.countryCode` | ISO alpha-2, upper case; null for a region such as EU.                                                                                                                                                                                                                |
| `regionCode`              | `location.parsed.regionCode`  | For example `EU`; null otherwise.                                                                                                                                                                                                                                     |
| `applicantTrackingSystem` | `applicantTrackingSystem`     | For example `Lever`; null when missing.                                                                                                                                                                                                                               |
| `applicantCount`          | `applicants`                  | Integer.                                                                                                                                                                                                                                                              |
| `expiresAt`               | `expireAt`                    | Timestamp.                                                                                                                                                                                                                                                            |
| `listingState`            | `jobState`                    | For example `LISTED`. Stored only. It doesn't set `closed`: `mergeSources` closes a job only from ATS sources, and that rule stays _(my call: closing jobs from LinkedIn is a matching decision, left to the user's rebuild; search results are listed jobs anyway)_. |
| `companyId`               | `company.id`                  | References `companies` (below).                                                                                                                                                                                                                                       |

Existing fields, now filled from the new actor:

| Field                       | From                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `experienceLevel`           | `experienceLevel` (LinkedIn's text, for example `Mid-Senior level`). Only about 30% of items carry it, against 100% under cheap_scraper; that's accepted.                                                                                                                                                                                         |
| `contractType`              | `employmentType` as LinkedIn's display text (`full_time` → `Full-time`, `part_time` → `Part-time`, `contract` → `Contract`, `temporary` → `Temporary`, `internship` → `Internship`, others title-cased). This is the text cheap*scraper gave, and the processor reads it as listing evidence *(my call: keeps the processor's input unchanged)\_. |
| `sector`                    | The first of `company.industries`, the same kind of value cheap*scraper gave (`Software Development`) *(my call)\_.                                                                                                                                                                                                                               |
| `descriptionHtml`           | `descriptionHtml`                                                                                                                                                                                                                                                                                                                                 |
| `descriptionText`           | `descriptionText`                                                                                                                                                                                                                                                                                                                                 |
| `applyUrl`                  | `applyMethod.companyApplyUrl` when it isn't a LinkedIn URL. This also covers some `ComplexOnsiteApply` items, which carry an outside URL.                                                                                                                                                                                                         |
| `salary`                    | `salary.text`, `min`, `max`, `currency`, `payPeriod`, read only when `text` or a bound is set.                                                                                                                                                                                                                                                    |
| `poster`                    | The first `hiringTeam` member.                                                                                                                                                                                                                                                                                                                    |
| `companyName`, `companyUrl` | `company.name`, `company.linkedinUrl`                                                                                                                                                                                                                                                                                                             |
| `location`                  | `location.linkedinText`                                                                                                                                                                                                                                                                                                                           |
| `publishedAt`               | `postedDate` (date part)                                                                                                                                                                                                                                                                                                                          |
| `postingUrl`                | From `id`, as today.                                                                                                                                                                                                                                                                                                                              |

Ashby and Greenhouse mappers fill the new fields with null, except where their payload states the same fact exactly. The builder decides whether any of them do. Merging follows `RECORD_FIELDS` order, as today. The ATS posting still wins on the fields it has.

**Not kept:** `views`, `benefits` (always empty), `jobFunctions`, `industries` on the job (the company carries them), logos, cover images, `followerCount`, `headerCaptionText`. The raw payload keeps everything, so any of these can be added later by re-mapping.

### Companies

A new engine-only table, `companies`. It's shared, not user-scoped, like the other ingest tables: RLS is on with no policies.

| Column                                   | From                                         |
| ---------------------------------------- | -------------------------------------------- |
| `id`                                     | Our uuid                                     |
| `linkedinId`                             | `company.id`, unique                         |
| `universalName`                          | `company.universalName`                      |
| `name`                                   | `company.name`                               |
| `linkedinUrl`                            | `company.linkedinUrl`                        |
| `website`                                | `company.website`                            |
| `employeeCount`                          | `company.employeeCount`                      |
| `employeeCountMin`, `employeeCountMax`   | `company.employeeCountRange`                 |
| `industries`                             | `company.industries` (text array)            |
| `specialities`                           | `company.specialities` (text array)          |
| `description`                            | `company.description`                        |
| `headquartersCountryCode`                | The headquarter entry of `company.locations` |
| `firstSeenAt`, `lastSeenAt`, `updatedAt` |                                              |

- **Writes.** It's upserted by `linkedinId` when ingest links a job. Each sighting overwrites the stored values with the latest item's, since LinkedIn holds the current company record _(my call)_.
- **Normalized records stay one job each.** The company fields travel in the normalized record as a nested `company` object. Ingest writes the table from it. That keeps renormalize deterministic, because a rebuild rewrites the same rows.
- **Not in this slice:** merging "ALTEN" and "ALTEN MAROC", or flagging staffing agencies. The table makes both possible, since `industries` contains `Staffing and Recruiting`, but each is a decision for a later slice.

### Versioning

Bump `NORMALIZER_VERSION`. `db:renormalize` isn't run for old cheap*scraper items *(user: leave them as they are)\_. When an old item is seen again, `linkJob` and `effectiveKey` normalize its earlier raw versions at the new version anyway. That's harmless: the cheap_scraper mapper is unchanged, so those records come out the same apart from the new null fields. Deleting old LinkedIn data isn't part of this slice. If the user wants it, it's a separate step, confirmed before it runs.

## Job identity

`jobKey` already prefers the ATS posting named by the apply URL, then the URL plus title, then the LinkedIn id. A job that had no apply URL under the old actor, now seen with an employer URL, gets a new key. The existing re-link code moves its source to the new job, and the old job is marked merged. The `effectiveKey` rule, which keeps a strong earlier key, already covers flapping.

The re-link loses work today. `linkJob` copies `processingStatus`, `processingReason` and `processingRequestedAt` to the new job through `processingColumns`, but not `currentExtractionId`. The new job is then `processed` with no extraction, so the processor never picks it up and the matcher never matches it. After the swap this hits most returning jobs: 21 of 30 live items had an employer URL, and none of the old ones did.

Fix: when a re-link moves a job's only source, the new job takes the old job's `currentExtractionId` along with the processing columns. The matcher's sweep then backfills its rows, because the job has missing rows for each published profile. The old job's match rows go when the sweep deletes rows of merged jobs, as today _(my call: same description, so the extraction still holds, and no processor spend)_. When the new job already exists with its own extraction (an ATS posting), it keeps its own.

Tests cover a cheap_scraper version followed by a harvestapi version of the same LinkedIn id, ending with one active job that has an extraction.

## Shared searches

That spec's planner assumed one LinkedIn search URL per run. It must be revised against this actor before its planner tasks are built _(user: "has to change")_:

- **Search identity** becomes this slice's structured key.
- **Experience and work type.** It merges `f_E` and `f_WT` codes into arrays; those become the `experienceLevel` and `workplaceType` arrays.
- **Keyword syntax.** OR'd keywords go in `jobTitles` as one boolean string.
- **Costs.** Its cost case changes. Start fees fall from about $0.02 to $0.001 per search, so 128 searches at 13 ticks is about $1.70 a day. Merging still saves the double charge for jobs returned by several searches.

This slice lands first, keeping one run per search _(my call: the actor swap is smaller and unblocks the data, and the planner's go/no-go test should run on the actor it will use)_.

## Tests

- **Parity check, first task, go/no-go.** Run three real builders' searches on both actors, same keyword, place and filters, posted in the last 24 hours, about $0.15 in all. Compare `totalElements` and the overlap of job ids. It confirms that `jobTitles` searches the way LinkedIn's `keywords` did, not by title only. If harvestapi finds clearly fewer jobs, stop and bring it back to the user _(my call, from the missed-jobs anti-goal)_. Result, 2026-11-11: on US remote, harvestapi found 66 jobs (11 mentioning Next.js) and cheap_scraper 36 (6), with no job ids in common, so the two see different slices of LinkedIn. Region text failed as described in [Places](#places). The user chose to switch, with geoIds first.
- Fixtures: the 30 live-run items are at `/tmp/claude-1000/-home-lab-apps-10xjobs/0f9b0e3c-21e3-4c36-bffc-8d7d1cfbd23e/scratchpad/harvest-run/items.json`, outside the repo. Copy a selection into `ingest/utils/fixtures/linkedin-job-harvest.json`. If that file is gone, re-run the actor with the parity check, using the user's Apify token from the environment, not from a file. Pick items that cover remote, hybrid, on-site, a missing workplace type, Easy Apply, an outside apply URL, a salary, a hiring team, and a region location.
- Mapper specs: each field in [Fields](#fields), the format detection order in `linkedin-job.mapper.ts` (harvestapi first), and that cheap_scraper and bebity items still map as before.
- Collector specs: input mapping (`f_E` and `f_WT` to the actor's values, `geoId` versus text location, `postedLimit` always `1h`), the search key, truncation from `maxItems` and `totalElements`, and the charge cap.
- Ingest specs: company upsert (insert, then a newer sighting updates it), the job's company link, and the re-key path in [Job identity](#job-identity).
- Source key: a harvestapi item keys as `id:<id>`.
- After deploy, one hourly tick on dev is checked by hand: field coverage on new jobs, and run cost.

## Left to the builder

- Column and field names, and whether `workplaceType` uses a database enum or checked text.
- The search key's exact form.
- How the `NORMALIZER_VERSION` bump treats old items (see [Versioning](#versioning)).
- Whether the actor's memory can be lowered.
