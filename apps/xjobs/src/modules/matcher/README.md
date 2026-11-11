# Matcher

The matcher is the fourth stage of the pipeline (Collect → Ingest → Process → **Match**). For each processed job it decides, for every published profile, whether the job is `qualified` or `rejected`, and stores every check it ran with the values it compared. No model is called: the profile and the extraction use the same codes from the same lists, so matching compares codes.

Design: `docs/superpowers/specs/2026-11-08-matching-design.md`.

## Flow

1. **Trigger.** When the processor finishes a job as `processed` with a current extraction (or reuses one), it enqueues the job on the `match` queue. A job finished with no extraction (a closed job) is not matched. The sweeper (every 60 s) is the safety net: it deletes the rows of jobs that left `status = 'active'`, then re-enqueues every matchable job that has a missing or stale row for some published profile. A newly published profile gets its rows the same way: the sweep backfills it gradually (200 jobs per minute, newest first), so it is not instant. Merged jobs' rows are deleted by the sweep; a job that is `closed` (the job's closed flag, distinct from `status`) keeps its rows.
2. **One job.** The worker calls `MatcherService.matchJob(jobId)`:

   | Step | Does                                                                                                                                     |
   | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
   | 1    | `loadMatchableJob`: the job and its current v2 extraction, or `not_matchable` (nothing stored).                                          |
   | 2    | `listPublishedProfiles`: the published profiles with skills; only those with a stale or missing row for this extraction, unless `force`. |
   | 3    | `decide` (pure): runs all four rules for each profile, with no early exit, so the whole picture is stored.                               |
   | 4    | `upsertMatches`: one row per `(profile, job)`. `decidedAt` moves only when the outcome changes.                                          |

## Code map

- `rules/`: pure functions, one per criterion (`position.ts`, `seniority.ts`, `location.ts` with `places.ts`, `stack.ts`) and `decide.ts`. They take everything as arguments, so they run with no database.
- `repositories/`: every read and write (`matcher.repository.ts`). `testing/memory-matcher.repository.ts` is the in-memory fake.
- `services/matcher.service.ts`: the entry point. It caches the place hierarchy and the `implies` map for 10 minutes (they change only through `db:vocab`).
- `config/matcher.config.ts`: `MATCHER_VERSION`, the years margin, the minimum stack score, the backfill window and the sweep settings.
- `controllers/`: the testing endpoints below (served by the API app only).
- The queue, worker and sweep live in `src/infrastructure/jobs/steps/match/`.

## Rules

The decision for one (profile, job): `rejected` when at least one check is `fail`; otherwise `qualified`. A qualified decision is `unverified` when at least one check is `unknown` or the extraction has `needsReview`. A fact the job does not state (`unstated`, `null`, no places) is `unknown`, never a rejection on its own.

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

Residence and work authorization are not checked.

**Tech stack.** A requirement is covered when its tag is one of the profile's skills, or is implied by one (`implies`); a requirement without a code is ignored and listed as not comparable. Requirements sharing a `group` are one unit, covered when at least `min` members are. The score over the `main` and `must` units is `sum(importance × mastery/10 if covered, else 0) / sum(importance)`; `nice` units are listed but not scored.

| Job                                         | Outcome                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| no `main` or `must` requirement with a code | `unknown`, score `null`                                                              |
| has `main` units and none is covered        | `fail`                                                                               |
| score below `MIN_STACK_SCORE` (0.4)         | `fail`, listing the uncovered units, or saying mastery is low when none is uncovered |
| otherwise                                   | `pass`                                                                               |

## Matchable jobs

One definition serves the worker, the sweep and `db:rematch`: the job is an active LinkedIn job board job (`status = 'active'`, `kind = 'job'`), `processingStatus = 'processed'`, not closed, `lastSeenAt` within `MATCH_BACKFILL_DAYS` (30), and its current extraction has `schemaVersion = 2`. Old v1 extractions are not matched; `db:reprocess` brings them to v2. Rows of closed jobs (the `closed` flag, distinct from `status`) and of jobs that age out of the window stay; rows of merged jobs (`status <> 'active'`) are deleted by the sweep.

## When it runs

- After processing: the processor hands the job to the `match` queue.
- Every 60 s: the sweep covers lost nudges, new extractions, new published profiles and a `MATCHER_VERSION` bump.
- By hand: `db:rematch`, or the testing endpoints.

## The `job_matches` table

One row per `(profileId, jobId)`, upserted (no history). Columns: `userId`, `profileId`, `jobId`, `extractionId` (the extraction the decision read), `matcherVersion`, `outcome` (`qualified` | `rejected`), `unverified`, `stackScore` (0 to 1, nullable), `checks` (jsonb, one entry per rule: `rule`, `outcome`, `jobValue`, `profileValue`, `reason`, `detail`), `decidedAt` (when `outcome` last changed), timestamps. The owner can `SELECT` their rows through RLS; only the engine writes.

## Running it

`WORKER_ROLE=match` (`npx nx worker-match xjobs`) runs the match worker and its sweep alone. `WORKER_ROLE=all` (`worker-all`) runs it too. It needs no API key.

## Testing endpoints

Served by the API (`npx nx serve xjobs`), local only, with `XJOBS_OPERATOR_ENDPOINTS=1`, and the engine key, under `/matcher`:

| Endpoint                        | Does                                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /matcher/jobs/:jobId/run` | Matches the job now, in the request, against every published profile (`force`). Returns the outcome plus `matches`; a job that is not matchable returns `{ status: 'not_matchable', matches: [] }`. |
| `GET /matcher/jobs/:jobId`      | `{ matches }`: the stored rows of the job.                                                                                                                                                          |

## Rematching

After a rule or threshold change, bump `MATCHER_VERSION` in `config/matcher.config.ts` first, so the sweep also treats every older row as stale and nothing is missed if the queue loses a message. Do the same, or run `db:rematch -- --all`, after vocabulary changes that affect matching (`region_countries`, cities, tech tag `implies`), because the matcher reads them but the rows do not notice. Then re-decide:

```sh
pnpm --filter @xjobs/xjobs db:rematch -- --all
pnpm --filter @xjobs/xjobs db:rematch -- --job <id> --job <id>
```

`--all` is every matchable job; `--job` can repeat. Each job is enqueued with `force`, so it is decided again against every published profile even where its row is current. The match worker must be running to do the work. With no selector the script exits 1 with its usage.

## Verification

```sh
npx vitest run --config apps/xjobs/vitest.config.mts src/modules/matcher
```

The PostgreSQL tests (`repositories/matcher.postgres.spec.ts`) need `PROCESSOR_TEST_DATABASE_URL`, with the same disposable `processor_test` database the processor README describes. They skip when it is absent.
