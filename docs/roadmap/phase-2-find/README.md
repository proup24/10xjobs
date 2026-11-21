# Phase 2: Find

Date: 2026-11-10
Status: draft. Slices 06 and 07 built (PRs #109 and #111, and the web-app PR).

## Intent

Phase 1 ends with users' profiles as drafts: the engine isn't deployed and no user gets jobs. (`10xjobs-dev` has one profile published earlier through the engine directly, which slice 01 can use to check the hosted pipeline before slice 06.) Phase 2 closes that loop. A user's profile goes live when they finish setting it up, the hosted engine collects, processes and matches jobs for it on a schedule, and the web app shows the matches in one organized view: every qualified job with the details the user checks before applying (role, title, company, place, the description and the original posting), plus why it matched.

The user's own words for how they use it: they expect the jobs the hub matches to be worth their time, but they still check the role, the title, the description and the original posting before applying. The view is built for that check.

Engine work for this phase (query generation, collection, ingest, the processor and the matcher) is already on `main`. These slices make it run hosted and reach the user.

## How this folder works

Same as Phase 1: each slice below is a short brief with its scope, the decisions already locked, and the questions its own spec must answer. When a slice's turn comes, it gets its own brainstorm and spec in `docs/superpowers/specs/`, then a plan and PRs. Locked decisions are not reopened in the slice spec unless something new comes up.

## Exit criteria

On the hosted app, with LinkedIn job-board jobs:

- Finishing setup, or adding a profile, publishes it without manual steps, and collection, processing and matching then run for it on a schedule.
- Editing a published profile takes effect: later collection runs search with the new preferences, and recent jobs are re-decided against them, in both directions.
- The web app shows the qualified jobs from the recent window, with their details, why they matched and a link to the original posting, and marks the ones that are new since the user last looked.
- Matching checks languages (required and the posting's own) and work authorization, as well as position, seniority, location and stack.
- Rejected jobs and the reason for each can be viewed.
- Phase 1's exit criteria pass on the hosted app too; Phase 1 closes with this phase's launch check _(user)_.
- One user can never read another user's matches or the jobs behind them, and tests prove it.

## Slices, in order

| #   | Slice                                                         | Depends on |
| --- | ------------------------------------------------------------- | ---------- |
| 01  | [Engine hosting](01-engine-hosting.md)                        | none       |
| 02  | [Web app to engine auth](02-engine-auth.md)                   | 01         |
| 03  | [Job details for matches](03-job-details-access.md)           | none       |
| 04  | [Matches view](04-matches-view.md)                            | 03         |
| 05  | [Rejected view](05-rejected-view.md)                          | 04         |
| 06  | [Publish on create](06-publish-on-create.md)                  | 02         |
| 07  | [Edit a published profile](07-edit-published.md)              | 06         |
| 08  | [Match on languages](08-match-languages.md)                   | none       |
| 09  | [Match on work authorization](09-match-work-authorization.md) | 07         |
| 10  | [Launch check](10-launch-check.md)                            | 01–09      |

The UI comes first _(user)_: job details, the matches view and the Rejected tab land before publishing and editing, so matches are visible sooner. Until slice 06 lands, slices 04 and 05 are built and checked against profiles published straight through the engine (the one already on `10xjobs-dev`, or more through slice 02's publish route). Slice 08 is engine work and can run alongside any of 03–07. Slice 09 follows 07 because eligibility edits re-match the same way profile edits do.

## Decisions locked for the whole phase

**Scope**

- **LinkedIn job board only, for now** _(user)_. The processor and the matcher see only LinkedIn job-board jobs, so only those can be matched and shown. Ashby-only and Greenhouse-only jobs and LinkedIn hiring posts keep being collected, and come in a later set of Phase 2 slices (see "Later in Phase 2"). The roadmap's "from all three sources" criterion moves there with them.
- **Recent jobs only** _(user)_. The web app shows only recent matches, never the full history, so the user isn't led to apply to a stale posting they missed. "Recent" is the matcher's window: `lastSeenAt` within `MATCH_BACKFILL_DAYS` (30 days, configuration). The page and the matcher use the same definition. _(the shared definition is my call)_

**Publishing and editing**

- **Published profiles are no longer frozen** _(user)_. This reverses the Phase 1 decision "Published profiles are frozen". A published profile stays editable, and saving a change applies it: the searches for later collection runs follow the new preferences, and recent jobs are re-decided against them. A job that only failed on the old preferences becomes qualified and appears in the list in its normal date order (not marked new or unread); a recent qualified job that no longer fits leaves the list. Older jobs are not re-decided.
- **No separate publish button** _(my call)_. Finishing guided setup, or finishing "add a profile", publishes. After that, saving is enough.
- **Editing does not re-collect the past.** A new search finds jobs from its next scheduled run on; it isn't replayed over old collection windows.
- **A decision must still be explainable after an edit.** Today `job_matches` relies on the profile being frozen to know which preferences a decision used. With editable profiles, each decision has to record which version of the profile it read. How (a profile version counter, a snapshot of the compared values in `checks`, or both) is slice 07's to settle.

**Hosting** _(my call; user asked for cheap and leaned to Hetzner)_

- **One Hetzner cloud server** (a small shared-CPU instance, about €5–10 a month) running Docker Compose: the engine's HTTP API behind Caddy for HTTPS, one `worker-all` process, and Redis in a container.
- **Postgres stays on Supabase Cloud.** Production is still deferred, so the hosted engine points at `10xjobs-dev`, the same project the hosted web app uses (see `docs/production.md`).
- **Deploys are automatic:** a GitHub Actions job builds the engine image and deploys it on merge to `main`. Nobody deploys by hand.
- **Secrets** (OpenRouter, Apify, the database URL, Redis) live only on the server and in GitHub secrets, never in git.
- Hetzner over Railway because the workers run all day: a flat monthly price beats usage billing for always-on processes and Redis.

**Engine access**

- The engine's address is public, because Vercel has to reach it, but it accepts only requests that carry a valid Supabase access token. The engine verifies the token against Supabase's JWKS and checks the user owns the profile, as Phase 1 planned. Basic auth goes away.
- The engine's temporary CRUD endpoints (users, contacts, profile create and update) are removed once the web app covers them, as Phase 1 planned. The engine keeps only side-effect actions: publish, apply a change to a published profile, and delete a published profile.
- The web app still reads and writes user data through `supabase-js` under RLS. It calls the engine only for those actions.

**Matching criteria** _(user)_

- Added in this phase, most important first: **languages** (the languages a posting requires, and the language it's written in) and **work authorization**.
- Not checked yet: salary, contract type and engagement. The matches view says so, so users don't assume they were. They can be added later as more rules.
- Every new rule follows the matching spec: an unstated fact is `unknown` and never rejects on its own, and every check stores a readable reason.

**The matches view** _(user chose the layout)_

- **List and detail side by side** _(user)_: the job list on the left, the selected job on the right. At phone width it falls back to the list, then a page per job. _(fallback is my call)_
- One profile at a time, with a profile switcher _(my call)_.
- Only qualified jobs on the main tab; rejected jobs on their own tab _(user wants rejected viewable in this phase; the tab is my call)_.

## Later in Phase 2

Raised in the brainstorm and deferred _(user)_. Each gets its own brief when its turn comes.

- **Other sources:** processing and matching for Ashby and Greenhouse jobs that have no LinkedIn job-board source, and for LinkedIn hiring posts (see `docs/roadmap/process-backlog.md`). Then the "all three sources" criterion.
- **Per-user usage limits.** Phase 1 put them in Phase 2. Invite-only stays the cost control for these slices _(my call)_.

## Out of these slices

- Applying, tailored resumes and emails (Phase 4).
- Notifications (email digests of new matches) _(my call; not raised)_.
- Marking matches as fit or reject to refine preferences (the feedback loop from Phase 1's brainstorm).
- Production Supabase and a production engine; `10xjobs-dev` only, until production is wanted.
