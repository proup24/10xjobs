# Matching (qualify) design

Phase 2, the stage after Process. Date: 2026-11-08.

## Intent

The pipeline is Collect → Ingest → Process → **Match**. Once the processor has fully processed a job, that job has to be checked against every published profile. The result is one decision per profile and job: **qualified** or **rejected**, with every rule that ran and the values it compared. That way, a wrong rejection can be found, explained and fixed.

The user chose four criteria:

1. **Location**: the job's arrangement and places against the places the profile wants for that arrangement.
2. **Seniority**: the job's seniority against the profile's seniorities.
3. **Position**: the job's role kind against the profile's position.
4. **Tech stack**: the job's requirements against the profile's stack.

The profile and the extraction already use the same codes from the same lists (`docs/superpowers/specs/2026-11-05-preferences-and-eligibility-design.md`), so matching compares codes. No LLM is called.

## Goals

- Every processed job with an extraction is matched against every published profile, with no manual step.
- A newly published profile is matched against recent processed jobs, so it doesn't start empty.
- When a job is reprocessed and gets a new extraction, it is matched again.
- Every decision stores its checks: the rule, the outcome (`pass`, `fail` or `unknown`), the job's value, the profile's value and a short reason, such as "job seniority `junior` is not in your seniorities [`senior`]".
- Qualified jobs carry a stack score, so they can be ranked.

## Non-goals

- **Other profile fields:** contract types, engagements, salary, currencies, languages, work authorization and residence. The checks list is open, so these can be added as new rules later. _(my call: the user named four criteria)_
- **LLM or semantic matching.**
- **The web UI** that shows matches. This spec only stores them.
- **Scope beyond the processor:** jobs the processor doesn't see (Ashby or Greenhouse only, LinkedIn posts) aren't matched, because they have no extraction.

## Anti-goals

- **Rejecting a job for a fact it doesn't state.** If the job leaves a fact out (`unstated`, `null`, no places), the check is `unknown`. An unknown never rejects on its own; it marks the decision `unverified`. _(my call, from the "missing the right jobs" anti-goal; the user didn't object)_
- **A rejection with no readable reason.**
- **A decision that can't be traced to the extraction it used.**

## The decision

For one (profile, job) pair, every rule runs; there is no early exit, so the full picture is stored.

- `rejected` when at least one check is `fail`.
- `qualified` otherwise.
- `unverified = true` when it's qualified and at least one check is `unknown`, or the extraction has `needsReview = true`.

### Position

Reads `position.value.roleKind` (typed column `roleKind`) and `Profile.position`.

Rows are read top to bottom; the first that applies decides.

| Job                                 | Outcome   |
| ----------------------------------- | --------- |
| `isSoftwareEngineeringRole = false` | `fail`    |
| same code as the profile            | `pass`    |
| `null` or `unstated`                | `unknown` |
| any other code                      | `fail`    |

Only an exact code counts in v1. A backend profile does not see `fullstack_engineer` jobs. _(my call; an adjacency map such as backend ↔ fullstack can be added later as one more input, with the stored reason saying it was used)_

### Seniority

Reads `seniority` and `Profile.seniorities` (codes `junior`, `mid`, `senior`, `staff`, `lead`, `principal`).

| Job                                        | Outcome        |
| ------------------------------------------ | -------------- |
| in the profile's set                       | `pass`         |
| not in the set                             | `fail`         |
| `null` or `unstated`, with `yearsRequired` | years fallback |
| `null` or `unstated`, no years             | `unknown`      |

**Years fallback** _(my call)_: if `yearsRequired.min` is more than `Profile.yearsOfExperience + 2`, the outcome is `fail` ("asks for 8+ years; you have 5"). Otherwise it's `unknown`. The fallback never produces a `pass`, because years alone don't establish seniority. The margin of 2 is configuration.

### Location

Reads `openings` from `data` and `Profile.locations` (`{ remote, hybrid, onsite }`, each a list of places).

Each opening is checked on its own, and the job's location outcome is the best of its openings: `pass` beats `unknown`, which beats `fail`.

For one opening:

1. **Arrangements.** The opening's arrangements, with `unstated` standing for all three. Keep only those whose list in the profile is non-empty. If none are left, the opening `fail`s ("job is onsite; you want only remote"). If `unstated` was the only arrangement, the opening's best outcome is `unknown`.
2. **Places.** For each kept arrangement, compare the opening's places with the profile's places for that arrangement:
   - No places (`placeStrictness = unstated`): `unknown`.
   - Some job place **overlaps** some profile place: `pass`.
   - Otherwise, with strictness `limit` or `label`: `fail`. With `mention`: `unknown`, because a mention doesn't tie the role to the place.
   - **Overlap** means that one place contains the other in the hierarchy worldwide ⊃ region ⊃ country ⊃ city. `region_countries` places a country in a region, and `cities.countryCode` places a city in a country. Two cities overlap only when they have the same id. A job city with no `cityId` is compared by its `countryCode` only, and the best outcome it can give is `unknown`.
3. **Time zones** (remote only; `hybrid` and `onsite` are tied to a place): if the opening lists time zones and none of them overlaps the profile's `[timezoneMin, timezoneMax]`, the remote arrangement `fail`s ("job requires UTC−8…−5; you accept −5…+5"). Profile offsets are in minutes and job offsets in hours, so convert. No time zones listed: no effect. _(my call: cheap to check, and it removes clearly wrong remote jobs)_

The opening's outcome is the best over its kept arrangements. For each opening, the stored check records which arrangement and places decided it.

Residence and work authorization (for example, "remote, US residents only" against a user who lives in Morocco) aren't checked here; they're a later rule. _(non-goal above)_

### Tech stack

Reads `techStack.value` from `data` (requirements and groups) and the profile's `profile_skills`.

- **Covered:** a requirement is covered when its `technology.code` is one of the profile's skill technologies. The skill's `domain` is ignored. A profile skill also covers the codes in its tech tag's `implies` list. _(my call)_ A requirement whose code is `null` is ignored and listed in the check as "not comparable".
- **Groups:** requirements that share a `group` are one unit. The unit is covered when at least `min` of its members are covered; its importance is the highest member importance, and its mastery is the best mastery among its covered members.
- **Score:** over the `main` and `must` units, `sum(importance × mastery/10 if covered, else 0) / sum(importance)`. The result is between 0 and 1. `nice` units don't count toward the score; covered ones are listed for display.
- **Outcome:**
  - The job has no `main` or `must` requirement with a code: `unknown`, score `null`.
  - The job has `main` units and none of them is covered: `fail` ("none of the main stack [react, nextjs] is in your stack").
  - The score is below `MATCH_MIN_STACK_SCORE` (default 0.4, configuration): `fail`, listing the uncovered units.
  - Otherwise: `pass`.
- The check stores the covered units, the uncovered units and the score.

The profile's skill `importance` doesn't affect pass or fail; it's stored for ranking in the UI later. _(my call)_

## When matching runs

- **Matchable jobs** _(my call)_. A job is matchable when all of these hold:
  - it's in the processor's scope and `status = 'active'`;
  - `processingStatus = 'processed'`, it isn't `closed`, and its `lastSeenAt` is within `MATCH_BACKFILL_DAYS` (default 30);
  - its `currentExtractionId` points at an extraction with `schemaVersion = 2`.

  The sweep, the publish backfill and `db:rematch` all use this one definition, so no path matches old or closed jobs.

- **Old v1 extractions** _(my call)_ aren't matched; their tech stack has no importance or kind. Run `db:reprocess` to bring them to v2, and they'll be matched after that.
- **After processing.** When `ProcessorService` finishes a job as `processed` with a `currentExtractionId`, it enqueues the job on a new `match` queue. A job finished with no extraction (a closed job) is not matched.
- **Source of truth** _(my call, mirrors the processor)_: the database, not the queue. A periodic sweep re-enqueues each matchable job that is missing a match row for some published profile, or whose row has a different `extractionId` or an older `matcherVersion`. That way a lost nudge or a crash heals itself. The builder chooses how to track this (a column on `normalized_jobs`, or an anti-join against `job_matches`).
- **On publish.** When a profile is published, it's matched against every matchable job.
- **Reprocessing.** A new extraction means the stored decision no longer matches `extractionId`, so the sweep picks the job up again. The new decision replaces the old one.
- **Rule changes.** A `MATCHER_VERSION` constant is bumped whenever a rule or threshold changes. A script, `db:rematch`, re-enqueues every matchable job, following the `db:reprocess` pattern.
- **Closed jobs and jobs that age out of the window.** Their existing decisions stay; they aren't deleted.
- **Merged jobs** _(my call)_. When a job leaves `status = 'active'` (merged into another), the sweep deletes its match rows, so the user never sees the same posting twice. The surviving job is matched through the normal path.
- **Worker:** `match` runs in `worker-all`, and also alone as `npx nx worker-match xjobs`. It needs no API key.

## Storage

A new table, `job_matches`, in `contract.prisma`:

| Column           | Shape                                                                                |
| ---------------- | ------------------------------------------------------------------------------------ |
| `id`             | uuid v7                                                                              |
| `userId`         | owner (the profile's user)                                                           |
| `profileId`      | profile, cascade on delete; composite FK `(profileId, userId)` like `profile_skills` |
| `jobId`          | `normalized_jobs.id`                                                                 |
| `extractionId`   | the `job_extractions.id` this decision read                                          |
| `matcherVersion` | int                                                                                  |
| `outcome`        | `qualified` \| `rejected`                                                            |
| `unverified`     | boolean                                                                              |
| `stackScore`     | numeric 0–1, nullable                                                                |
| `checks`         | jsonb: `[{ rule, outcome, jobValue, profileValue, reason, detail }]`                 |
| `decidedAt`      | when `outcome` last changed, including the first decision                            |
| timestamps       | `createdAt`, `updatedAt`                                                             |

- Unique on `(profileId, jobId)`; a new match is an upsert. History isn't kept. _(my call: a published profile is frozen and the extraction id is stored, so the inputs can be rebuilt)_
- `decidedAt` changes only when the outcome changes. If a rejected job becomes qualified after reprocessing, it shows up as new; re-deciding with the same outcome leaves it alone. _(my call)_
- Indexes on `(profileId, outcome, decidedAt)` for "new qualified jobs since I last looked", and on `jobId`.
- **RLS:** the owner can `SELECT` their own rows. No user writes; only the engine writes. Add the table to the two-user isolation harness.
- Profiles are frozen once published, so `profileId` is enough to know which preferences were used.

## Code layout

- `apps/xjobs/src/modules/matcher/` follows the processor's shape: `rules/` holds pure functions (one per criterion, plus `decide`), `repositories/` holds every read and write, `services/matcher.service.ts` is the entry point, plus a README.
- `apps/xjobs/src/infrastructure/jobs/steps/match/` holds the queue, the worker and the sweep, following `steps/process/`.
- The rules are pure and get everything they need as arguments: the extraction document, the profile with its skills, the place hierarchy and the tech tag `implies` map. That makes them unit-testable with no database.

## Testing

- Unit tests per rule cover every row of the tables above, including each `unknown` path.
- Fixtures: the user's example profile (backend engineer, senior, remote worldwide, hybrid and onsite in two cities, Python/NestJS/Go…) against a handful of golden extractions, with the expected outcome for each. Golden case 1288 (fullstack, seniority unstated, 3+ years, remote with no places) must come out `rejected` on position only, with seniority and location `unknown`.
- A PostgreSQL test covers four things:
  - a processed job leads to a `job_matches` row;
  - publishing a profile backfills matchable jobs only (no closed, merged, v1 or out-of-window jobs);
  - a new extraction re-matches the job, and `decidedAt` moves only when the outcome changes;
  - merging a job deletes its rows, and a second user can't read the first user's matches.

## Left to the builder

- How the sweep finds missing or stale matches.
- Batching of the publish backfill.
- How the place hierarchy and `implies` map are loaded and cached (they change only through `db:vocab`).
- The exact wording of reasons.
- The engine HTTP endpoints for testing (for example `GET /matcher/profiles/:id/matches`, `POST /matcher/jobs/:id/run`), following the processor controller.
