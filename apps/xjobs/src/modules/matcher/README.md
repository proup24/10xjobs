# Matcher

The matcher is the fourth stage of the pipeline (Collect → Ingest → Process → **Match**). For each processed job (a LinkedIn listing, or a role read from a LinkedIn hiring post) it decides, for every published profile (only those with post search on, for a role), whether the job is `qualified`, `rejected` or sent to `review`, and stores every check it ran with the values it compared. No model is called: the matcher reads the job's combined facts (`job_facts`, built by `src/modules/facts` from the extraction and the LinkedIn listing), which use the same codes as the profile, so matching compares codes.

Design: `docs/superpowers/specs/2026-11-08-matching-design.md`; post roles: `docs/superpowers/specs/2026-11-25-posts-qualify-design.md`.

## Flow

1. **Trigger.** When the processor finishes a job as `processed` with a current extraction (or reuses one), it enqueues the job on the `match` queue; after a post is processed, it enqueues the post's processed active role jobs. A job finished with no extraction (a closed job) is not matched. The sweeper (every 60 s) is the safety net: it deletes the rows of jobs that left `status = 'active'` or are `archived`, and the role-job rows of profiles with post search off, then re-enqueues every matchable job whose facts are stale (missing, from another extraction, an older `FACTS_VERSION`, older than the job row, or open past `expiresAt`) or whose open facts have a missing or stale row for some published profile that takes part (any published profile for a listing, one with `postSearch` for a role). A newly published profile, or a profile whose post search is turned on (for role jobs), gets its rows the same way: the sweep backfills it gradually (200 jobs per minute, newest first), so it is not instant. Merged jobs' rows are deleted by the sweep; a job that is `closed` (the job's closed flag, distinct from `status`) keeps its rows, and so does a job whose facts are closed (its LinkedIn `expiresAt` passed): it is not decided again.
2. **One job.** The worker calls `MatcherService.matchJob(jobId)`:

   | Step | Does                                                                                                                                            |
   | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
   | 1    | `loadCandidate`: the matchable job's current extraction and kind, and for a role its post (below), or `not_matchable`.                          |
   | 2    | `FactsService.build`: builds and stores the job's facts; a non-v3 extraction is `not_matchable`, and closed facts return `closed` (rows kept).  |
   | 3    | `listPublishedProfiles`: the published profiles with skills; only those with a row missing or stale, unless `force`. A role keeps `postSearch`. |
   | 4    | `decide` (pure): runs every check for each profile, with no early exit, so the whole picture is stored (the checks are listed under Rules).     |
   | 5    | `upsertMatches`: one row per `(profile, job)`, with the `factsHash` it read. `decidedAt` moves only when the outcome changes.                   |

For a role job, `loadCandidate` also reads its post: the verdict confidence of the parent post job's current `post` extraction (a null one counts as `unsure`), the authors of the parent's `postSources` (each source's `author` and each share's `original.author`, deduplicated by their lowercased key; an author with no key is left out) and the role job's `postedAt` (the original post's date, set by the processor). `matchJob` turns `postedAt` into `ageDays` on the matcher clock at decision time (null when `postedAt` is). `listPublishedProfiles` loads each profile's `postSearch` and its user's `blocked_authors` keys (lowercased).

## Code map

- `rules/`: pure functions, one per criterion (`position.ts`, `seniority.ts`, `location.ts` with `places.ts`, `stack.ts`, `salary.ts` with `convert.ts`, `contract.ts`, `languages.ts`, `posting-language.ts`, `work-authorization.ts`, and `post.ts` for the post role checks) and `decide.ts`. They take everything as arguments, so they run with no database.
- `repositories/`: every read and write (`matcher.repository.ts`). `testing/memory-matcher.repository.ts` is the in-memory fake.
- `services/matcher.service.ts`: the entry point. It caches the place hierarchy and the `implies` map for 10 minutes (they change only through `db:vocab`).
- `config/matcher.config.ts`: `MATCHER_VERSION`, `POST_MAX_AGE_DAYS`, the years margin, the minimum stack score, the backfill window and the sweep settings.
- `controllers/`: the testing endpoints below (served by the API app only).
- The queue, worker and sweep live in `src/infrastructure/jobs/steps/match/`.

## Rules

The checks, in order: `position`, `seniority`, `location`, `stack`, `salary`, `currency`, `contractType`, `languages`, `postingLanguage`, `workAuthorization`. A post role job (`kind = 'post_role'`) adds three, after these: `hiringVerdict`, `blockedAuthor`, `postAge` (thirteen in all; a listing keeps its ten). A role's facts are built from its role extraction alone: it has no LinkedIn listing, so every listing input (places, workplace type, `expiresAt`, listing salary) is the listing not stating it, and posting language reads the `descriptionText` the processor copied from the post.

The decision for one (profile, job): `rejected` when at least one check fails on a sure value; otherwise `review` when a check fails only on an unsure value (the first such check, in rule order, is recorded as `reviewRule` and `reviewField`); otherwise `qualified`. A qualified decision is `unverified` when at least one check is `unknown` or rests on an unsure value. Each check carries `unsure` (and `unsureField`): position on `position` or `isSoftwareEngineeringRole`, seniority on `seniority` or, through the years fallback, `yearsRequired`, location on `openings` (a failing opening is unsure when the part that decided it, its arrangement, places or time zones, came from the description and the opening is unsure; a part from LinkedIn is sure; any unsure failing opening makes the failure unsure, since that opening might fit), stack on `techStack` (the fact is unsure, or a main or must unit that decided the failure has an unsure requirement), salary and currency on `salary`, contract type on `contractType`, languages on `requiredLanguages`, posting language never (the detector's doubt is `unknown`), and work authorization on `workAuthorization` (its requirements and sponsorship share one confidence, so an unsure fact makes both a failure and a pass unsure). The "neither the role nor the stack" failure is sure. An unsure value never rejects. A fact the job does not state (`unstated`, `null`, no places) is `unknown`, never a rejection on its own, except where there is nothing to check: no salary minimum on the profile, no currency stated, no language required, no work authorization requirement (a no-sponsorship job with a place to check has one, derived below). Those are a `pass` with that reason, never review or a reject (user decision, 2026-11-12); `unknown` is kept for real doubts. No minimum is always sure; the other three rest on their fact's confidence, so on an unsure fact the pass is unsure and the match unverified.

**Position** (first row that applies decides):

| Job                                 | Outcome   |
| ----------------------------------- | --------- |
| `isSoftwareEngineeringRole = false` | `fail`    |
| same role kind as the profile       | `pass`    |
| `null` or `unstated`                | `unknown` |
| any other code                      | `fail`    |

Only an exact code counts: a backend profile does not see `fullstack_engineer` jobs.

**Seniority**:

| Job                                        | Outcome        |
| ------------------------------------------ | -------------- |
| in the profile's set                       | `pass`         |
| not in the set                             | `fail`         |
| `null` or `unstated`, with `yearsRequired` | years fallback |
| `null` or `unstated`, no years             | `unknown`      |

Years fallback: `fail` when `yearsRequired.min` is more than the profile's years of experience plus `SENIORITY_YEARS_MARGIN` (2); otherwise `unknown`. It never produces a `pass`.

**Location.** Each opening is checked on its own; the job's outcome is the best of its openings (`pass` beats `unknown` beats `fail`).

1. Arrangements: keep those the profile has a non-empty place list for (`unstated` stands for all three). None left: the opening `fail`s. Only `unstated`: at best `unknown`.
2. Places, per kept arrangement: no job places is `unknown`; some job place overlaps some profile place is `pass`; otherwise `fail` for strictness `limit` or `label`, `unknown` for `mention`. Overlap means one place contains the other in worldwide ⊃ region ⊃ country ⊃ city; two cities overlap only on the same id; a job city without a `cityId` is compared by country and gives at best `unknown`.
3. Time zones (remote only): if the opening lists time zones and none overlaps the profile's `[timezoneMin, timezoneMax]`, the remote arrangement `fail`s.

Residence and work authorization are the work authorization rule's (below), not location's.

**Tech stack.** A requirement is covered when its tag is one of the profile's skills, or is implied by one (`implies`); a requirement without a code is ignored and listed as not comparable. Requirements sharing a `group` are one unit, covered when at least `min` members are. The score over the `main` and `must` units is `sum(importance × mastery/10 if covered, else 0) / sum(importance)`; `nice` units are listed but not scored.

| Job                                         | Outcome                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| no `main` or `must` requirement with a code | `unknown`, score `null`                                                              |
| has `main` units and none is covered        | `fail`                                                                               |
| score below `MIN_STACK_SCORE` (0.4)         | `fail`, listing the uncovered units, or saying mastery is low when none is uncovered |
| otherwise                                   | `pass`                                                                               |

**Salary** compares the job's best pay (`max`, else `min`), converted to the profile's currency and period with the daily rates, to `salaryMin`: `pass` at or above it, `fail` more than `SALARY_MARGIN` (10%) below it, `unknown` within the margin. It is `pass` when the profile sets no minimum (nothing to check), and `unknown` when the job states no salary or no amount, when the pay can't be converted (no rate, or amounts without a currency), and when the best pay is 0 or less.

**Currency**: `pass` when the profile accepts any currency (never unsure) or the job's currency is one it accepts, `fail` when not, and `pass` when the job states no currency (nothing to check; amounts without a currency leave the salary check `unknown`).

**Contract type**: `pass` when the job's contract type is in the profile's `contractTypes`, `fail` when not, `unknown` when `null` or `unstated`.

**Required languages**: `pass` when the profile holds every required language at or above its level (`working` < `fluent` < `native`), `fail` when one is missing or held lower, and `pass` when none is required (nothing to check).

**Posting language** reads `postingLanguages`, detected from the description text by code with `franc` (pinned; bump `FACTS_VERSION` on any upgrade or threshold change). Each paragraph (a line of 50+ characters, or a run of shorter lines) counts only when franc's runner-up scores at least 0.06 below its winner, so a paragraph mixing languages counts for none; Galician is not detected (franc mistakes European Portuguese for it). A language is kept when its paragraphs hold at least 25% of the recognised characters. The check is `pass` when the profile speaks one of the posting's languages, at any level (`no`, `nb` and `nn` count as one language, as do `hr`, `sr` and `bs`), `fail` when it speaks none, and `unknown` when the detection is not confident: the text, or the part of it recognised with confidence, is under 200 characters. It is never unsure.

**Work authorization** reads the user's eligibility (`work_authorizations`, `users.residenceCountry`, `users.acceptsSponsorship`), the same for each of their profiles. Each requirement the job states is met by:

| Requirement   | Met by                                        |
| ------------- | --------------------------------------------- |
| `citizenship` | citizenship                                   |
| `work-permit` | work permit or citizenship                    |
| `residency`   | residency, citizenship, or `residenceCountry` |
| `clearance`   | clearance                                     |

for a place that covers the required one (codes compared upper-cased): a `GLOBAL` or `WORLDWIDE` requirement is covered by any place; the same code; a required country inside the held place; or a required region that shares a country with the held place (a posting naming a region asks for one of its countries, so `FR` or `EU` meets an `EEA` requirement). A two-letter code that is a known region (`EU`) is a region; one is a country only when it is an approved country, so a non-ISO code (`UK`) can't be compared. A required region the index doesn't know can't be compared, so that requirement is `unknown` unless an authorization names the same code.

| Job                                                                                                   | Outcome   |
| ----------------------------------------------------------------------------------------------------- | --------- |
| no requirement (nothing to check)                                                                     | `pass`    |
| every requirement met                                                                                 | `pass`    |
| unmet ones are all `work-permit` or `residency`, `sponsorship: yes`, and the user accepts sponsorship | `pass`    |
| any other unmet requirement (silent sponsorship and `acceptsSponsorship` null count as no)            | `fail`    |
| otherwise (a requirement can't be compared)                                                           | `unknown` |

When the job offers no sponsorship and states no requirement, the facts derive `work-permit` requirements for the description's non-mention places, else the LinkedIn place. These are alternatives: any one met is enough, a work permit, citizenship or residency authorization for the place meets one, and neither residence alone nor sponsorship acceptance ever does. Reasons: `you meet work-permit US (the job offers no sponsorship)`, `you don't meet work-permit US (the job offers no sponsorship)`, `you don't meet work-permit in any of US, CA (the job offers no sponsorship)`; a no-sponsorship job with no place to derive passes with `the job offers no sponsorship but names no place to check`. A place the index cannot place is `unknown`.

**Hiring verdict** (post roles): `pass` when the parent post's verdict is `sure`, `fail` on an unsure value (`unsure` on `verdict`) otherwise, so an unsure post is at best `review` (rule `hiringVerdict`, field `verdict`) and never `qualified`.

**Blocked author** (post roles): `fail`, sure, when any author of the post (each sharer or poster in `postSources`, and each share's original author) is in the user's `blocked_authors`; the reason is `you blocked <name>`. Otherwise `pass`. Keys compare lowercased (`profile:<publicIdentifier>` or `company:<universalName>`).

**Post age** (post roles): `fail`, sure, when the original post is more than `POST_MAX_AGE_DAYS` (30) days old at decision time, on the raw age (30.0 days passes, 30.01 fails; a negative age from clock skew counts as 0); the reason is `posted <n> days ago`, with n the whole days. `unknown` when the role has no `postedAt`. Ageing needs no new observation: a role row is stale once its original is 30 days old (`j."postedAt" + 30 days <= now()`) if the row was written before that mark plus `POST_AGE_STALE_MARGIN_MINUTES` (5), so the sweep re-decides it and it comes out `rejected`; a row written after mark + margin is current, so it is re-decided once.

## Matchable jobs

One definition serves the worker, the sweep and `db:rematch`: the job is active (`status = 'active'`) and either a LinkedIn job board job (`kind = 'job'` with a LinkedIn job board source) or a LinkedIn post role (`kind = 'post_role'`); `processingStatus = 'processed'` (so an `archived` role is never matchable), not closed, `lastSeenAt` within `MATCH_BACKFILL_DAYS` (30), and its current extraction has `schemaVersion` 3. Older extractions are not matched; `db:reprocess` brings them to the current version. Rows of closed jobs (the `closed` flag, distinct from `status`) and of jobs that age out of the window stay; rows of merged jobs (`status <> 'active'`) and of `archived` jobs are deleted by the sweep, and so are a role job's rows for a profile whose post search is off. A `post` job itself is never matched: its roles are. A role job is decided only for published profiles with `postSearch`; listings for every published profile.

## When it runs

- After processing: the processor hands the job to the `match` queue.
- Every 60 s: the sweep covers lost nudges, stale facts (new extractions, listing changes, expiry, a `FACTS_VERSION` bump, a city change through `db:vocab`), new published profiles, profile edits, eligibility changes (including blocked author changes), post search turned on or off, a role's original turning `POST_MAX_AGE_DAYS` old, and a `MATCHER_VERSION` bump.
- By hand: `db:rematch`, or the testing endpoints.

## The `job_matches` table

One row per `(profileId, jobId)`, upserted (no history). Columns: `userId`, `profileId`, `jobId`, `extractionId` (the extraction the facts were built from), `factsHash` (the facts the decision read; a row is stale when it differs from `job_facts.factsHash`, or its `extractionId` is not the job's current extraction), `matcherVersion`, `profileVersion` and `eligibilityVersion` (the profile's `profiles.matchVersion` and the user's `users.eligibilityVersion` the decision read; a row is current when `profileVersion >= matchVersion` and its `eligibilityVersion` is not older than the user's, and a null `profileVersion` or `eligibilityVersion` is stale), `outcome` (`qualified` | `rejected` | `review`), `unverified` (only on `qualified`), `reviewRule` and `reviewField` (set exactly on `review`), `stackScore` (0 to 1, nullable), `checks` (jsonb, one entry per rule: `rule`, `outcome`, `jobValue`, `profileValue`, `reason`, `unsure`, `unsureField`, `detail`), `decidedAt` (when `outcome` last changed), timestamps. The owner can `SELECT` their rows through RLS; only the engine writes.

Triggers bump `users.eligibilityVersion` on any insert, update or delete of the user's `work_authorizations`, and on a change of `residenceCountry` or `acceptsSponsorship`; users cannot write the version themselves (they may update only `name`, `residenceCountry` and `acceptsSponsorship`). `profiles.matchVersion` is bumped by a BEFORE UPDATE trigger on `profiles` and by an AFTER INSERT/UPDATE/DELETE trigger on `profile_skills`. The profiles trigger uses an exclude-list, so a new column bumps by default; only the resume columns, `state`, `publishedAt`, the two version columns (`matchVersion`, `searchesVersion`), `postSearch` and the timestamps leave it alone. Owners can edit published profiles and their skills. `match_reviews.profileVersion` is set from its match when the review is inserted, and `match_details` applies a review choice only when it equals the match's `profileVersion`, so a choice counts only on the profile version it was made on.

## The `blocked_authors` table

One row per `(userId, authorKey)`: the LinkedIn post authors a user never wants roles from, across all their profiles. `authorKey` is `profile:<publicIdentifier>` or `company:<universalName>` (lowercased, the key Prepare writes on `postSources` authors), with an optional `name` and the `profileUrl` the user gave. Owners select, insert and delete their rows through RLS; the engine reads them all. Any insert or delete bumps `users.eligibilityVersion` (trigger), so the sweep re-decides that user's rows, listings included (they pass the check and keep their outcome).

## Running it

`WORKER_ROLE=match` (`npx nx worker-match xjobs`) runs the match worker and its sweep alone. `WORKER_ROLE=all` (`worker-all`) runs it too. It needs no API key.

## Testing endpoints

Served by the API (`npx nx serve xjobs`), local only, with `XJOBS_OPERATOR_ENDPOINTS=1`, and the engine key, under `/matcher`:

| Endpoint                        | Does                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /matcher/jobs/:jobId/run` | Matches the job now, in the request, against every published profile (`force`). Returns the outcome plus `matches`; a job that is not matchable returns `{ status: 'not_matchable', matches: [] }`, and an expired one `{ status: 'closed', matches }` with its kept rows. |
| `GET /matcher/jobs/:jobId`      | `{ matches }`: the stored rows of the job.                                                                                                                                                                                                                                 |

## Rematching

After a rule or threshold change, bump `MATCHER_VERSION` in `config/matcher.config.ts` first, so the sweep also treats every older row as stale and nothing is missed if the queue loses a message. Do the same, or run `db:rematch -- --all`, after vocabulary changes that affect matching (`region_countries`, tech tag `implies`), because the matcher reads them but the rows do not notice. A city approve, reject or alias through `db:vocab` needs neither: it marks stale the facts of the jobs listed in the city's country or whose openings name it, and the sweep rebuilds them and re-decides the jobs whose facts changed. Then re-decide:

```sh
pnpm --filter @xjobs/xjobs db:rematch -- --all
pnpm --filter @xjobs/xjobs db:rematch -- --job <id> --job <id>
```

`--all` is every matchable job; `--job` can repeat. Each job is enqueued with `force` (BullMQ id `<jobId>-force`, so a waiting unforced run doesn't swallow it), so it is decided again against every published profile even where its row is current. The match worker must be running to do the work. With no selector the script exits 1 with its usage.

## Verification

```sh
npx vitest run --config apps/xjobs/vitest.config.mts src/modules/matcher
```

The PostgreSQL tests (`repositories/matcher.postgres.spec.ts`) need `PROCESSOR_TEST_DATABASE_URL`, with the same disposable `processor_test` database the processor README describes. They skip when it is absent.
