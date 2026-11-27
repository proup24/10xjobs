# Indeed ingest, process and match (Phase 5 slice 04)

Date: 2026-11-27
Status: draft, awaiting approval
Brief: [docs/roadmap/phase-5-indeed/04-ingest-process-match.md](../../roadmap/phase-5-indeed/04-ingest-process-match.md)

## Intent

Indeed jobs collected by valig (slice 03) go through the same pipeline as LinkedIn job-board jobs: normalized at ingest, read by the processor with `claude -p`, decided by the matcher with the same rules and reasons, and shown in the matches view with an Indeed label. Both of Indeed's keep-or-drop numbers (qualified jobs, applied jobs) depend on this slice. At the end of it, the "Search Indeed" switch opens to every user _(user: option A)_.

## Goals

- Every valig item becomes a normalized job, or is rejected at ingest with a stated reason.
- An Indeed job whose employer link is an Ashby or Greenhouse posting, or a URL with a posting id, gets the same `ats:` / `url:` key as harvestapi's job for that link, so it merges as one job on proof.
- Indeed jobs are processed and matched like LinkedIn listings, with the same reasons. Qualified ones show with an "Indeed" source label and filter entry. Rejected ones can be checked with their reasons.
- The Indeed switch in preferences is shown and changeable for every user.
- The 12 batches (128 rows) waiting on dev since 2026-11-27, and any collected before deploy, are ingested with no manual step.

## Non-goals

- Grouping likely duplicates (same company, title, country, no shared link): slice 05.
- Processor prompt or matcher rule changes (the listing wording below is text only). A new failure pattern on Indeed jobs becomes its own slice.
- A title or keyword pre-filter before Claude (see Decided).
- Sharing the Indeed daily cap fairly between profiles (see Constraints).
- Indeed-only fields in the record (skills attributes, occupations, benefits, employer ratings).

## Anti-goals

- An Indeed job is dropped or skipped before the processor on a guess. Unclear cases go to the processor.
- Indeed's own apply or redirect link merges two jobs. Only an employer link is proof.
- A job re-seen in a later tick is sent back to Claude only because volatile fields (ratings, image URLs) changed.

## Constraints

- One Indeed daily cap ($0.50 on the hosted engine today, on a $5 one-off Apify account), shared by every profile with Indeed on. With the switch open, several users' searches can use it up early in the day, and later ticks are refused (the owner's included). Accepted while only invited users exist; watched in the 2026-11-30 checks (slice 03a). A per-profile share of the cap is its own slice if it bites.
- Claude quota: LinkedIn brings about 1,800–2,900 new listings per weekday on dev (2026-11-20 to 11-25). Indeed's 2026-11-27 evening ticks returned 128 rows in two ticks, so a weekday adds a few hundred rows at most, many of them repeats: about 10% more processing. The processor's daily budget and weekly stop, and the existing prefilter (skips hybrid/on-site jobs in countries no profile wants), already apply.
- `NORMALIZER_VERSION` bumps to 11 (a mapper, the job key and the tracking parameters change). `db:renormalize` then `db:recheck-skips` run once on dev after deploy, because LinkedIn `url:` keys carrying the newly dropped parameters change (see Job key).

## Approaches

1. **An Indeed mapper in the existing per-actor pattern (picked).** A `mappers/indeed-job.mapper.ts` for valig fills the shared `NormalizedRecord`, and the `INDEED` placeholders in `normalize.ts`, `job-key.ts` and `source-key.ts` get real cases. A later Indeed trial actor (curious_coder) adds its own mapper beside it.
2. Indeed-only fields in the record (skills, occupations, benefits). Not taken: the processor reads all of that from the description, and the matcher reads only the shared fields.
3. Converting valig rows into LinkedIn-shaped payloads before ingest. Not taken: it hides which source stated a fact, and LinkedIn's helpers (company page, poster) don't apply.

## Design

### Source key (`ingest/utils/source-key.ts`)

`INDEED` → `{ key: 'jk:<key>' }` from valig's `key` (Indeed's job key, a 16-hex id), trimmed. Missing → `{ invalid: 'no Indeed job key' }`. _(my call: the `jk:` prefix, like LinkedIn's `id:`; `sourceId` in `job-key.ts` strips it the same way.)_

### Ingest config (`ingest/config/channels.ts`)

- `INDEED` leaves `INGEST_WAITING_CHANNELS` (the list becomes empty; keep the export so collection and the stale-batch sweep keep compiling, or remove it and its uses; builder's choice). The waiting batches are then picked up by the ingest sweep (`listStalePending`) with no manual step.
- `volatileKeys` for `INDEED`: `employer.ratingsCount`, `employer.ratingsValue`, `employer.logoUrl`, `employer.headerImageUrl`, `employer.ceoPhotoUrl` _(my call)_. They change between runs without the job changing, so ignoring them saves a new raw version per tick. (A new version alone never sends a job back to Claude: only a new or reopened job goes to Process, `nextProcessing`; checked by the builder review.) The builder should confirm against the stored batches whether other fields drift between ticks (compare the same `key` across the 18:00 and 21:00 batches of 2026-11-27) and add them.

### Mapper (`ingest/normalize/mappers/indeed-job.mapper.ts`)

The fields of a valig item read, all exact facts or null. Fixtures: the stored sample items (`tmp/indeed-sample/…/valig/items.json` in the main checkout, 267 rows) and the dev batches; tests use a trimmed fixture committed with the mapper (the existing `scripts/indeed-sample/fixtures/valig.json` is a start). All calls below are mine, agreed with the user as a set ("looks good").

| Record field                  | From valig                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`                        | `'job'`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `title`                       | `title`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `companyName`                 | `employer.name`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `companyUrl`                  | `employer.companyPageUrl` (Indeed's company page) when an http(s) URL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `location`                    | `city, admin1Code, countryName` joined, skipping blanks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `countryCode`                 | `location.countryCode`, uppercased, when two letters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `city`, `state`, `regionCode` | `location.city`; `location.admin1Code` into the same field(s) the LinkedIn mapper fills for a state, so `resolveListingPlace` reads it the same way (builder checks)                                                                                                                                                                                                                                                                                                                                                                                                     |
| `workplaceType`               | from **`employerAttributes`** only (what the employer set): `'remote'` when it has `DSQF7`; `'hybrid'` when it has `PAXZC`; both: `'remote'`; else **null, never `'onsite'`**. _(my call, after the builder check)_ `attributes` also holds tags Indeed seems to infer (skills such as "Java", "Senior level"), and a listing's tag enters the facts as `confidence: 'sure'`, so an inferred tag is not used. Indeed does not tag on-site jobs, so a missing tag is unknown, and the prefilter sends unknown to the processor, whose reading of the description decides. |
| `remoteAllowed`               | null                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `salary`                      | from `baseSalary` when `min` or `max` is a number: `min`, `max`, `currency` = `currencyCode`, `period` = `unitOfWork` mapped `YEAR→YEARLY`, `MONTH→MONTHLY`, `DAY→DAILY`, `HOUR→HOURLY` (others kept as text, so listing facts drop them), `providedByEmployer: true`, `text` null. Else null.                                                                                                                                                                                                                                                                           |
| `publishedAt`                 | date part of `datePublished`, else of `dateOnIndeed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `postedAt`                    | `datePublished`, else `dateOnIndeed`, as ISO                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `expiresAt`                   | `expirationDate` when a valid date                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `contractType`                | the first value of `jobTypes` ("Full-time", "Contract", …). French values ("Temps plein") pass through; listing facts ignore what they don't know.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `employmentType`              | null                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `experienceLevel`             | null (Indeed's "Senior level" / "Mid-level" don't line up with LinkedIn's levels; the processor reads seniority from the description)                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `descriptionHtml`             | `description.html`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `descriptionText`             | `description.text`, else `htmlToPlainText(description.html)`, cleaned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `applyUrl`                    | `jobUrl` when an http(s) URL whose host is not an Indeed site (`indeed.com` or `*.indeed.com`); else null                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `postingUrl`                  | `url` (`https://www.indeed.com/viewjob?jk=…` or the country site's), upgraded to https; when missing, built as `https://www.indeed.com/viewjob?jk=<key>`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `closed`                      | false (`expired: true` is not treated as closed: `closed` counts only for ATS sources; the expired decision reads `expiresAt`)                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| everything else               | null                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Measured on the 267 sample rows (260 distinct jobs): `DSQF7` in `attributes` on 211 jobs, in `employerAttributes` on 136; of the 75 with only Indeed's tag, 69 descriptions mention remote, so the processor still finds them. `PAXZC` 6 in `attributes`, 2 in `employerAttributes`; `jobUrl` on an employer host 93% (10 on Greenhouse/Ashby), on an Indeed host 7%; `baseSalary` object on every row (units YEAR, MONTH, DAY, HOUR, or none).

`providedByEmployer: true` is a call to check: valig appears to return only the employer's stated pay, not Indeed's estimates, but this hasn't been checked on Indeed's pages. The builder spot-checks five salaried sample rows against their Indeed pages, and if any is an estimate, sets `providedByEmployer` to null instead (listing facts then ignore Indeed salaries).

If a source-URL check rejects Indeed hosts (`canonicalSource` in `ingest/utils/identity.ts` throws `Unsupported source URL` for anything but ATS and LinkedIn), it gets an `INDEED` case accepting `indeed.com` hosts and keyed by `jk`.

### Job key (`ingest/normalize/job-key.ts`)

`INDEED`: `applyUrlKey(record.applyUrl)` (`ats:` or `url:` with an identifier), else `indeed-job:<jk>`. Indeed's own link is never an `applyUrl`, so it can never be a proof key. `isStrongJobKey` is unchanged.

### Tracking parameters (`ingest/config/normalize.ts`) _(user: option A)_

Employer links carry the board's own marker, so the same Workday or Lever posting seen through LinkedIn and through Indeed would get two `url:` keys and never merge. `source` and `src` are already dropped. Add `lever-source`, `iis`, `iisn`, `indeed-apply-token` and `postedDate` to `trackingParams`. Measured on the samples: `source=Indeed` on about 12% of Indeed's employer links, `indeed-apply-token`/`iis`/`iisn` on 13 rows, `postedDate` on 3, `lever-source` on 6. On dev, about 261 LinkedIn apply URLs carry `lever-source` (256 in `url:` keys) and 177 carry one of the others, so their keys change: hence `db:renormalize` and `db:recheck-skips` in the rollout. Two LinkedIn copies of one posting that differed only by one of these merge, which is correct. The builder checks the samples and dev apply URLs for other board markers (a value naming the board: `indeed`, `linkedin`) and adds them only when the parameter is never the posting's id.

### Listing wording (`facts/rules/combine.ts`, `apps/web/src/lib/matches/facts.ts`) _(user: option A)_

A listing's facts are quoted as "LinkedIn: remote, Paris, France" and conflicts shown as "LinkedIn says X", whatever the source. Both become neutral for every job: "Listing: remote, Paris, France" (and "Listing" where today it says "LinkedIn listing"), and "The listing says X". Text only: the stored `'linkedin'` fact-source value stays as it is (it means "the listing"), no `MATCHER_VERSION` bump, no rematch. Decisions written before keep their old text. Specs and any golden text that assert the old wording are updated.

### Merge (`ingest/normalize/merge.ts`)

Keep `INDEED` at 2.5: below Ashby/Greenhouse (1) and harvestapi (2), above posts (3). It sits below the LinkedIn trial actors (2.2, 2.4) where the brief proposed above, but a trial actor always keys by LinkedIn id and never shares a job with Indeed, so the order between them can't matter. Update the comment to say so.

### Processor and match hand-off

- `PROCESSOR_CHANNELS` (`processor/config/processor.config.ts`) adds `Channel.INDEED`.
- The ingest worker's `onPending` (`infrastructure/jobs/steps/ingest/processor.ts`) nudges `INDEED` batches' pending jobs at listing priority, like the job boards.
- Every other `switch` / `Record<Channel, …>` / `isLinkedinJobBoard` gate the processor, prefilter, facts and matcher go through is checked for Indeed (the slice 07 list). `isLinkedinJobBoard` stays LinkedIn-only: Indeed is not a LinkedIn board (no LinkedIn-id lock, no trial rules).
- Processor and matcher docs (`processor/README.md` scope section, `modules/collectors/README.md` "batches wait" line) are updated.
- Slice 09's leak rules need no code: they read `workplaceType` from the normalized row, and the description's stated arrangement already wins over the tag.

### Web (`apps/web/src/lib/matches/sources.ts`)

- `CHANNEL_LABELS.INDEED = 'Indeed'`. The filter's source options pick it up from the jobs present.
- No actor label beside it for now _(my call)_; when a second Indeed actor arrives as a trial, it gets one the way LinkedIn's actors do.

### Switch (`queries/switches.ts`)

Indeed's switch: `available: true` _(user: option A)_. The preferences copy already describes it ("Searches Indeed for this profile's technologies in the countries it names, and for remote jobs in the US, Brazil, Poland, the UK and Canada.").

### `db:archive-actor`

It credits jobs by batch actor, so it should work unchanged with `--actor valig/indeed-jobs-scraper` (the stored `collection_batches.actor`). The builder confirms with a `--dry-run` on a local DB holding Indeed batches, and the CLAUDE.md line names Indeed if it works.

## Rollout on dev (in the PR body)

1. Merge and deploy. The waiting Indeed batches ingest through the sweep. Then run `db:renormalize` and `db:recheck-skips` once on dev (`XJOBS_ALLOW_REMOTE_DB=1`), and check that the count of LinkedIn jobs whose key changed is about the expected 256 plus the others' share, and that any merges it made are true twins.
2. Check: every waiting batch `ingested`; Indeed raw items and normalized jobs exist; invalid items, if any, listed with reasons.
3. Check: Indeed jobs reach the processor and get extractions; then match decisions with reasons for the owner's profile.
4. Check: proven merges (an Indeed source on a job that also has a harvestapi or ATS source) counted; Indeed-only jobs counted.
5. Check: the matches view shows the Indeed label and filter; the preferences switch shows for a non-owner profile.
6. Check a re-seen job (same `jk` in two ticks) is not sent back to the processor.

## Left to the builder

- Exact helper reuse (`cleanText`, `datePart`, `htmlToPlainText`, `httpUrl`) and where the Indeed host test lives.
- Whether `INGEST_WAITING_CHANNELS` stays as an empty list or goes.
- Further volatile keys found by comparing repeat rows.
- Test layout, following the existing mapper and job-key specs.
