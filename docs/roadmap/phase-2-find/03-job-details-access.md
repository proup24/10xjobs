# 03: Job details for matches

## Goal

A signed-in user can read the details of the jobs they're matched with, and nothing else of the shared job tables, so the matches view can show the job without an engine call per page.

## What already exists (on `main`)

- `job_matches`, which a user can `SELECT` for their own rows only, with `checks`, `stackScore`, `unverified` and `decidedAt`.
- `normalized_jobs` (title, company, location, salary, `publishedAt`, description, `postingUrl`, `applyUrl`, poster) and `job_extractions` (arrangement, seniority, role kind, places, tech stack). Both are engine-only: RLS on, no user policies.

## In scope

- A way for a user to read the job fields and extraction facts the view needs, only for jobs that appear in their own `job_matches`. A policy that checks a matching `job_matches` row, a view, or a security-definer function; the spec decides, in the contract.
- Indexes that keep the matches list fast for one profile over the recent window.
- The new access in the two-user isolation harness: user B can't read a job only user A is matched with, and nobody can read unmatched jobs.

## Out of scope

- The page itself (slice 04).
- Any user writes to jobs.

## Locked

- The Prisma contract is the only schema source, RLS included.
- Shared tables stay hidden from users except through their own matches.

## For the slice spec

- Exactly which fields are exposed. Raw items, field sources and processing internals stay hidden.
- Whether description HTML is exposed, and how it's sanitized for display (the view is the reader; plain text exists too).
- Whether matches of a deleted or merged job need special handling (merged jobs' rows are already deleted by the matcher).

## Done when

The web app, as the signed-in user, can list their recent matches with each job's details in one query, and the isolation harness proves the limits above.
