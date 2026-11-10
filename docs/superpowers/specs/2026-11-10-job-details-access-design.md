# Job details for matches (Phase 2, slice 03)

Roadmap: [docs/roadmap/phase-2-find/03-job-details-access.md](../../roadmap/phase-2-find/03-job-details-access.md)

## Intent

The matches view (slice 04) must show each matched job's details: what the user reads before deciding to apply. Today a user can read only their own `job_matches` rows; `normalized_jobs` and `job_extractions` are engine-only. This slice gives a signed-in user read access to the details of the jobs they're matched with, and nothing else of the shared job tables, in one call from `supabase-js`.

Display (layout, wording, ordering, the recent window's length) is slice 04's. This slice decides what the app can read and proves the limits.

## Goals

- One call returns a profile's matches with each job's details, the curated extraction facts with their source quotes, and the match itself.
- Users see only jobs that appear in their own `job_matches`. Unmatched jobs and other users' matches stay invisible.
- Processing internals stay hidden.
- The isolation harness proves it.

## Non-goals

- A generated job summary (the user wants one later; it's processor work with a reprocess cost, its own slice).
- Description HTML (see Decisions).
- The page itself, any user writes to jobs, rejected-view UI (slice 05; this slice's read serves it too).

## Anti-goals

- Leaking a job to a user who isn't matched with it, or another user's match.
- Exposing processing internals: raw items, `fieldSources`, model names, scores, confidence, verification, conflicts, junk flags, processing status/attempts/errors, cost.
- Unsafe markup reaching the page.

## Constraints

- The Prisma contract is the schema source, RLS included. Database functions follow the existing precedent: raw SQL in an app migration (see `libs/database/src/migrations/app/20261109T2238_create_profile_from_draft/migration.ts`).
- Reads go through `supabase-js` under the user's session.
- Shared tables keep RLS on with no user policies.

## Decisions

### Fields exposed (user)

All three tiers. Every extracted fact that carries a source sentence is exposed with that `quote`, so the view can show it beside the fact (user).

**Match** (from `job_matches`): `id`, `profileId`, `jobId`, `outcome`, `unverified`, `stackScore`, `checks`, `decidedAt`.

**Job** (from `normalized_jobs`): `kind` (job/post), `title`, `companyName`, `companyUrl`, `location` (the posting's text), `salaryText`, `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryPeriod`, `publishedAt`, `firstSeenAt`, `lastSeenAt`, `closed`, `postingUrl` (required; the "open on LinkedIn" button), `applyUrl`, `posterName`, `posterProfileUrl`, `posterType`, `descriptionText`.

**Source**: the channel(s) the job was collected from (LinkedIn job board, LinkedIn posts, Greenhouse, Ashby), via `normalized_job_sources` → `raw_items.channel`. Only the channel values, never raw item ids or contents.

**Extraction facts** (from the match's extraction, `job_matches.extractionId`, so the facts are the ones the match was decided on), each as value plus quote, without the fact envelope's `confidence`, `decidedBy`, `score`, `model` or `verification`:

- position: role kind and the extracted title
- seniority
- years of experience required (min/max)
- arrangement
- openings: per opening, arrangements, places (worldwide / region / country / city), place strictness, time zones (from/to UTC offset and label)
- contract type, engagement, contract length in months
- salary (min/max/currency/period)
- tech stack: requirements (technology, kind main/must/nice, importance, domain, years, group) and groups ("one of" with `min`)
- required languages (language, level)
- work authorization (requirement kinds and places, sponsorship)

Codes (role kind, seniority, arrangement, contract type, engagement, technologies, regions, countries) come with their display labels, joined server-side, so a code still in `proposed` status (which users can't read from the value lists) still shows a label. A code with no row falls back to the extracted text (technologies) or a null label. Languages are ISO 639-1 codes with no value list; the web app names them (`Intl.DisplayNames`).

Only v2 extraction documents need handling: the matcher decides only on `schemaVersion = 2` extractions, and the match points at the one it decided on.

Nested internals are dropped too: `confidence` and `decidedBy` on openings, `confidence` on tech-stack requirements (Claude's call).

**Hidden**: everything else, notably `fieldSources`, raw items, all `processing*` columns, `normalizerVersion`, `mergedIntoId`, `descriptionHtml`, the extraction's `data` envelope internals, `junkFlags`, `conflicts`, `unmatched`, `truncated`, `verification`, `models`, `costUsd`, `needsReview`, hashes and model names.

### Description: plain text only (Claude's call)

All 4,048 jobs on `10xjobs-dev` are LinkedIn job-board jobs with `descriptionText` and no `descriptionHtml`. Plain text rendered as text needs no sanitizing. HTML (with sanitizing) is added when Greenhouse/Ashby jobs reach users, as its own change. The view should keep the text's line breaks.

### Access mechanism: a security-definer function (Claude's call)

Table policies plus column grants can't hide parts of `job_extractions.data`, and a view over RLS-hidden tables would need definer rights anyway. So: one SQL function, callable via `supabase.rpc(...)`.

- `SECURITY DEFINER`, `SET search_path = ''`, fully qualified names.
- Starts from `public.job_matches` filtered by `"userId" = auth.uid()`; every job and extraction row is reached only through those matches. Returns nothing when `auth.uid()` is null.
- Parameters: the profile id (required), the outcome (default `qualified`; slice 05 passes `rejected`), and a `since` timestamp applied to the job's `lastSeenAt` (slice 04 picks the window). An optional job id narrows to one match, for opening a job directly. A null `since` means no window; when a job id is passed, `since` still applies if given, so slice 04 passes null to open an older job (Claude's call).
- Returns a set of rows (`RETURNS TABLE` / `SETOF`), so the client can `.order()` and `.range()` through results; the API's `max_rows = 1000` cap applies, and paging is slice 04's.
- Returns one row per match: the match, job and source fields as columns, the extraction facts as one curated `jsonb` column built field by field (never `data` passed through).
- Filters `normalized_jobs.status = 'active'`. The matcher deletes matches of merged jobs in a sweep (`deleteInactive`), so between merge and sweep a match could point at a merged job; the filter hides that gap.
- `REVOKE ALL ... FROM PUBLIC, anon`; `GRANT EXECUTE ... TO authenticated`.
- No new policies on `normalized_jobs` or `job_extractions`; they stay engine-only.

The builder names the function and its columns; the names go in the plan.

### Deleted, merged and closed jobs (Claude's call)

- Deleted job: `job_matches.jobId` cascades, so no rows remain. Nothing to do.
- Merged job: hidden by the `status = 'active'` filter, then removed by the matcher's sweep.
- Closed job: returned with `closed`; slice 04 decides whether to show it. None exist on dev yet.

### Speed (Claude's call)

The read for one profile: matches by `profileId` and `outcome`, joined to jobs filtered by `lastSeenAt >= since`. `job_matches` already has `@@index([profileId, outcome, decidedAt])`. The builder runs `EXPLAIN` on a realistic local dataset (a few thousand matches for one profile, older and recent) and adds an index only if the plan shows a need; any index goes in the contract. Dev has 3 qualified matches, so dev plans prove nothing.

### Isolation harness

New cases in `apps/db-tests` (alongside `isolation.db.spec.ts` and `engine-tables.db.spec.ts`), with two users and fixture jobs:

- User A gets their matched job's details; user B, calling with A's profile id or for A's job, gets no rows.
- A job nobody is matched with is returned to nobody.
- An anonymous caller can't execute the function.
- Users still can't `SELECT` `normalized_jobs`, `job_extractions`, `normalized_job_sources` or `raw_items` directly (extend the existing engine-table checks if not already covered).
- The returned row contains no hidden field (check the column set and the facts `jsonb` keys against an allowlist, so a later change that leaks a field fails the test).
- A match whose job is merged is not returned.

## Left to the builder

- Function and column names, and the exact `jsonb` shape of the facts (keep it close to the extraction document's shape, minus the envelope).
- Whether the facts `jsonb` is built in SQL or a helper SQL function.
- Generated TypeScript types for the web app, if the project's type generation covers `rpc` returns.

## Done when

As the signed-in user, the web app can list a profile's recent matches with each job's details in one call, and the isolation harness proves the limits above. CI is green.
