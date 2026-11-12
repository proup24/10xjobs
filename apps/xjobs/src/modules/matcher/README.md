# Matcher

The matcher is the fourth stage of the pipeline (Collect → Ingest → Process → **Match**). For each processed job it decides, for every published profile, whether the job is `qualified`, `rejected` or sent to `review`, and stores every check it ran with the values it compared. No model is called: the matcher reads the job's combined facts (`job_facts`, built by `src/modules/facts` from the extraction and the LinkedIn listing), which use the same codes as the profile, so matching compares codes.

Design: `docs/superpowers/specs/2026-11-08-matching-design.md`.

## Flow

1. **Trigger.** When the processor finishes a job as `processed` with a current extraction (or reuses one), it enqueues the job on the `match` queue. A job finished with no extraction (a closed job) is not matched. The sweeper (every 60 s) is the safety net: it deletes the rows of jobs that left `status = 'active'`, then re-enqueues every matchable job whose facts are stale (missing, from another extraction, an older `FACTS_VERSION`, older than the job row, or open past `expiresAt`) or whose open facts have a missing or stale row for some published profile. A newly published profile gets its rows the same way: the sweep backfills it gradually (200 jobs per minute, newest first), so it is not instant. Merged jobs' rows are deleted by the sweep; a job that is `closed` (the job's closed flag, distinct from `status`) keeps its rows, and so does a job whose facts are closed (its LinkedIn `expiresAt` passed): it is not decided again.
2. **One job.** The worker calls `MatcherService.matchJob(jobId)`:

   | Step | Does                                                                                                                                           |
   | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
   | 1    | `loadCandidate`: the matchable job's current extraction and its `needsReview`, or `not_matchable` (nothing stored).                            |
   | 2    | `FactsService.build`: builds and stores the job's facts; a non-v3 extraction is `not_matchable`, and closed facts return `closed` (rows kept). |
   | 3    | `listPublishedProfiles`: the published profiles with skills; only those with a row missing or decided on other facts, unless `force`.          |
   | 4    | `decide` (pure): runs every check for each profile, with no early exit, so the whole picture is stored (the checks are listed under Rules).    |
   | 5    | `upsertMatches`: one row per `(profile, job)`, with the `factsHash` it read. `decidedAt` moves only when the outcome changes.                  |

## Code map

- `rules/`: pure functions, one per criterion (`position.ts`, `seniority.ts`, `location.ts` with `places.ts`, `stack.ts`, `salary.ts` with `convert.ts`, `contract.ts`, `languages.ts`, `work-authorization.ts`) and `decide.ts`. They take everything as arguments, so they run with no database.
- `repositories/`: every read and write (`matcher.repository.ts`). `testing/memory-matcher.repository.ts` is the in-memory fake.
- `services/matcher.service.ts`: the entry point. It caches the place hierarchy and the `implies` map for 10 minutes (they change only through `db:vocab`).
- `config/matcher.config.ts`: `MATCHER_VERSION`, the years margin, the minimum stack score, the backfill window and the sweep settings.
- `controllers/`: the testing endpoints below (served by the API app only).
- The queue, worker and sweep live in `src/infrastructure/jobs/steps/match/`.

## Rules

The checks, in order: `position`, `seniority`, `location`, `stack`, `salary`, `currency`, `contractType`, `languages`, `workAuthorization`.

The decision for one (profile, job): `rejected` when at least one check fails on a sure value; otherwise `review` when a check fails only on an unsure value (the first such check, in rule order, is recorded as `reviewRule` and `reviewField`); otherwise `qualified`. A qualified decision is `unverified` when at least one check is `unknown` or rests on an unsure value, or the extraction has `needsReview`. Each check carries `unsure` (and `unsureField`): position on `position` or `isSoftwareEngineeringRole`, seniority on `seniority` or, through the years fallback, `yearsRequired`, location on `openings` (a failing opening is unsure when the part that decided it, its arrangement, places or time zones, came from the description and the opening is unsure; a part from LinkedIn is sure; any unsure failing opening makes the failure unsure, since that opening might fit), stack on `techStack` (the fact is unsure, or a main or must unit that decided the failure has an unsure requirement), salary and currency on `salary`, contract type on `contractType`, languages on `requiredLanguages`, and work authorization on `workAuthorization` (its requirements and sponsorship share one confidence, so an unsure fact makes both a failure and a pass unsure). The "neither the role nor the stack" failure is sure. An unsure value never rejects. A fact the job does not state (`unstated`, `null`, no places) is `unknown`, never a rejection on its own.

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

**Contract type**: `pass` when the job's contract type is in the profile's `contractTypes`, `fail` when not, `unknown` when `null` or `unstated`.

**Required languages**: `pass` when the profile holds every required language at or above its level (`working` < `fluent` < `native`), `fail` when one is missing or held lower, `unknown` when none is required.

**Work authorization** reads the user's eligibility (`work_authorizations`, `users.residenceCountry`, `users.acceptsSponsorship`), the same for each of their profiles. Each requirement the job states is met by:

| Requirement   | Met by                                        |
| ------------- | --------------------------------------------- |
| `citizenship` | citizenship                                   |
| `work-permit` | work permit or citizenship                    |
| `residency`   | residency, citizenship, or `residenceCountry` |
| `clearance`   | clearance                                     |

for a place that covers the required one (codes compared upper-cased): a `GLOBAL` or `WORLDWIDE` requirement is covered by any place; the same code; a required country inside the held place; or a required region that shares a country with the held place (a posting naming a region asks for one of its countries, so `FR` or `EU` meets an `EEA` requirement). A two-letter code that is a known region (`EU`) is a region. A required region the index doesn't know can't be compared, so that requirement is `unknown` unless an authorization names the same code.

| Job                                                                                                   | Outcome   |
| ----------------------------------------------------------------------------------------------------- | --------- |
| no requirement                                                                                        | `unknown` |
| every requirement met                                                                                 | `pass`    |
| unmet ones are all `work-permit` or `residency`, `sponsorship: yes`, and the user accepts sponsorship | `pass`    |
| any other unmet requirement (silent sponsorship and `acceptsSponsorship` null count as no)            | `fail`    |
| otherwise (a requirement can't be compared)                                                           | `unknown` |

## Matchable jobs

One definition serves the worker, the sweep and `db:rematch`: the job is an active LinkedIn job board job (`status = 'active'`, `kind = 'job'`), `processingStatus = 'processed'`, not closed, `lastSeenAt` within `MATCH_BACKFILL_DAYS` (30), and its current extraction has `schemaVersion` 3. Older extractions are not matched; `db:reprocess` brings them to the current version. Rows of closed jobs (the `closed` flag, distinct from `status`) and of jobs that age out of the window stay; rows of merged jobs (`status <> 'active'`) are deleted by the sweep.

## When it runs

- After processing: the processor hands the job to the `match` queue.
- Every 60 s: the sweep covers lost nudges, stale facts (new extractions, listing changes, expiry, a `FACTS_VERSION` bump), new published profiles and a `MATCHER_VERSION` bump.
- By hand: `db:rematch`, or the testing endpoints.

## The `job_matches` table

One row per `(profileId, jobId)`, upserted (no history). Columns: `userId`, `profileId`, `jobId`, `extractionId` (the extraction the facts were built from), `factsHash` (the facts the decision read; a row is stale when it differs from `job_facts.factsHash`, or its `extractionId` is not the job's current extraction, whose `needsReview` the decision reads), `matcherVersion`, `outcome` (`qualified` | `rejected` | `review`), `unverified` (only on `qualified`), `reviewRule` and `reviewField` (set exactly on `review`), `stackScore` (0 to 1, nullable), `checks` (jsonb, one entry per rule: `rule`, `outcome`, `jobValue`, `profileValue`, `reason`, `unsure`, `unsureField`, `detail`), `decidedAt` (when `outcome` last changed), timestamps. The owner can `SELECT` their rows through RLS; only the engine writes.

## Running it

`WORKER_ROLE=match` (`npx nx worker-match xjobs`) runs the match worker and its sweep alone. `WORKER_ROLE=all` (`worker-all`) runs it too. It needs no API key.

## Testing endpoints

Served by the API (`npx nx serve xjobs`), local only, with `XJOBS_OPERATOR_ENDPOINTS=1`, and the engine key, under `/matcher`:

| Endpoint                        | Does                                                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /matcher/jobs/:jobId/run` | Matches the job now, in the request, against every published profile (`force`). Returns the outcome plus `matches`; a job that is not matchable returns `{ status: 'not_matchable', matches: [] }`, and an expired one `{ status: 'closed', matches }` with its kept rows. |
| `GET /matcher/jobs/:jobId`      | `{ matches }`: the stored rows of the job.                                                                                                                                                                                                                                 |

## Rematching

After a rule or threshold change, bump `MATCHER_VERSION` in `config/matcher.config.ts` first, so the sweep also treats every older row as stale and nothing is missed if the queue loses a message. Do the same, or run `db:rematch -- --all`, after vocabulary changes that affect matching (`region_countries`, cities, tech tag `implies`), because the matcher reads them but the rows do not notice. Then re-decide:

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
