# Paused searches for inactive users

Date: 2026-11-23
Status: draft, awaiting approval (builder check done)

## Intent

Collection is paid per Apify run and per item, and most of a job's value is in being new. A user who has stopped working their list doesn't act on new jobs, so the searches that exist only for them are money spent for nothing _(user)_.

So a user's searches run only while that user is **active**. Once they've been inactive for 24 hours, the searches that only they need **pause**. Searches they share with an active user keep running. They are still matched against every job collected through anyone else's searches. On the first tick after they become active again, their searches run again _(user)_.

Worked example _(user)_: A wants TypeScript and React; B wants TypeScript and Python; same places, work types and seniorities. While both are active, the merged search covers TypeScript, React and Python. When B is inactive for 24 hours, Python drops out of the search and TypeScript stays (A still needs it). B keeps getting matched to the TypeScript jobs A's search brings in. When B marks a job, Python is back on the next tick.

## Goals

- A search builder runs only while at least one of its owners is active.
- Activity comes from things users already do, plus one explicit **Resume** action.
- A returning user's searches start from now. They don't backfill the paused span _(user)_.
- Every channel follows the same rule _(user)_.
- A paused user can always see that they're paused and resume in one click _(user)_.
- The change takes effect by the next tick, in both directions.

## Non-goals

- Changing the matcher. Paused users' published profiles are matched as today, and their webhooks still fire.
- Per-user spending limits or quotas. The platform-wide daily caps stay as they are.
- A warning before the pause. The notice appears only once the user is paused _(user)_.
- Email or other notifications outside the app.
- Backfilling what a paused user's own searches would have found _(user)_.
- A receiver calling back into 10xjobs to report applications _(user: delivery success is the middle ground)_.

## Anti-goals

- **Missing the right jobs for an engaged user**: freezing someone who is working their list, including through a webhook, or leaving a user stuck paused with no way out.
- **Paying for nobody**: a builder that keeps running because of a stale or fake activity signal.
- **Widening anyone else's search**: a returning user's searches must not make a shared search look further back.

## Decisions

### Who is active _(user, except where marked)_

A user is **paused** at time `t` only when both hold:

1. **Something has been left waiting.** They have at least one undecided match that has waited more than 24 hours: a job shown in their Matches list (qualified, inside the list's 7-day window, no `job_decisions` row) that appeared there more than 24 hours before `t` _(user, after the builder check: an empty or fully cleared list never pauses anyone, so the weekday-only job board schedule doesn't pause everyone by Monday, and a user whose searches bring nothing in can't deadlock)_. Review items don't count, because review is its own list and meant to stay the exception _(my call)_. "Appeared" is when the match became qualified and visible; the builder picks the column that tracks this.
2. **No activity signal in the 24 hours before `t`**, from this table:

| Signal                     | Source                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A decision on a job        | `job_decisions.decidedAt`, any status: `applied`, `dismissed` (Not for me) or `expired` _(including `expired` is my call: marking a dead listing is working the list)_                                                                                                                                                                                                               |
| A successful match webhook | `webhook_deliveries` with `kind = 'match'`, `status = 'delivered'`, `deliveredAt` in the span: the receiver answered 2xx. Failures, timeouts and test sends don't count _(user: 2xx only; excluding tests is my call)_                                                                                                                                                               |
| Resume                     | the new `users.searchesResumedAt` (below)                                                                                                                                                                                                                                                                                                                                            |
| Publishing or editing      | publishing a profile, or saving an edit the matcher reads, writes `users.searchesResumedAt` too _(my call)_. Publish goes through the engine and writes it there. Edits are saved by the web app straight to `profiles` under RLS, so the existing `bump_profile_match_version` trigger also sets `users.searchesResumedAt = now()`. A notes-only or resume-only save doesn't count. |

- The 24 hours is a setting (`SEARCH_PAUSE_AFTER_HOURS`, default 24), read by the engine _(my call)_.
- Activity is per user, not per profile, because decisions are per user and per job.
- A user with no published profile owns no active builders, so the rule doesn't apply to them.
- Otherwise the user is **active**.
- **Deploy day** _(my call)_: the migration sets `searchesResumedAt = now()` for every user with a published profile, so nobody pauses the moment this ships. The first pauses can come 24 hours after the deploy.

### What pauses

- Builders are shared rows: one `query_search_builder` row can be linked to several users' profiles (`profile_query_search_builder`, counted by `associatedProfiles`). A builder is **runnable** when it's active and not deleted, as today, **and** at least one user owning a linked published profile is active. It's **paused** otherwise.
- `isActive` keeps its meaning ("some published profile uses it"). Paused is a separate state, worked out per tick, not a change to `isActive`.
- This covers every channel with builders: LinkedIn job board (harvestapi and the trial actors), LinkedIn posts, Greenhouse, Ashby _(user)_.
- Because the planner merges runnable builders' words, places, work types and seniorities, a keyword, place or filter only paused users wanted drops out of the plan by itself. Nothing else in planning changes.

### Approach _(user picked 1)_

1. **Decide at planning time, every tick (picked).** At the start of each collection tick, one query finds the active users from the signals above. `listActive` (or a sibling the collection step uses) returns only runnable builders. Paused builders aren't planned or claimed. There are no new background jobs, and a decision takes effect on the next tick by construction. The cost is one more query per tick.
2. A `lastActiveAt` column on users, kept by triggers on decisions, deliveries and Resume. It's faster to read, but there are more moving parts (three triggers plus a backfill) for no real gain at this scale.
3. An hourly sweep that turns `isActive` off and on. This blurs paused with unlinked, and it races the collection tick, so a returning user could miss the next tick.

### Start fresh on return _(user)_

Each builder records when it was last left out for being paused (for example `query_search_builder.pausedAt`, set on the tick that leaves it out and kept until it runs again). The first time a paused builder is runnable again, its `coveredUntil` is moved forward to `until − one normal window` before planning, so its window is a normal one-tick window. This applies to every channel, within that channel's existing `minimumHours` and `maximumHours`: Greenhouse and Ashby keep their 72-hour minimum, so returning changes little there. A returning builder must never make a shared segment look back further than its other members would.

What this means per channel today:

- LinkedIn job board: the window is already capped at 1 hour (`maximumHours: 1`), so no shared search can widen. Moving the cursor keeps the books honest.
- LinkedIn posts: the cap is 24 hours, so without the reset a returning builder would pull a merged post search back a full day. Here the reset matters.
- Greenhouse / Ashby: the minimum is 72 hours and the maximum 168, so the reset only trims any look-back beyond 72 hours.

### Resume and the notice _(user)_

- New column `users.searchesResumedAt` (nullable timestamptz). It's written by a new engine endpoint (for example `POST /api/me/searches/resume`) and by publish and edit of a published profile. The user has no direct column grant on it, so it can't be set into the future _(my call: server time, engine-written)_.
- The engine API exposes the user's state for the web app: `{ paused: boolean, lastActiveAt: Date | null }`. Here `paused` is true only when the user is paused by the rule above **and** at least one builder linked to their published profiles is paused (no other owner active) _(my call, after the builder check: a user whose searches are all shared with active users isn't told their searches stopped, because they didn't)_.
- On Matches, once the user is paused, a notice above the list (built from `components/ui` per `apps/web/DESIGN.md`):

  ```
  ┌──────────────────────────────────────────────────────────┐
  │ Searches only you need are paused: no activity since     │
  │ Nov 21. Mark a job, or resume now.    [ Resume searches ]│
  └──────────────────────────────────────────────────────────┘
  ```

  The date is the last signal, or the publish time. Pressing Resume calls the endpoint and hides the notice. Marking a job also clears it on the next load. No notice before the pause.

### Observability _(my call)_

- Each tick logs, per channel: active users, runnable builders, paused builders, and builders reset on return.
- The collection summary gains `buildersPaused`.
- `db:match-shares` and `db:analyze` don't change. A small read-only addition to an existing report, or a new `db:paused` script, can show paused users and builders over a period; the builder picks which.

## Constraints

- The Prisma contract is the only schema source. The new columns go there with their migration, the `app/refs/db.json` hash advances, and `database.types.ts` is regenerated.
- `query_search_builder` is an engine-only table, so `pausedAt` needs no policy. `users.searchesResumedAt` is read by its owner (existing select policy) and written only by the engine.
- The waiting-match check reads `job_matches` and `job_decisions` per user each tick, with the same visibility rules as the Matches list (shared code or one SQL definition, so the two can't drift).
- The activity query must be cheap at the tick: there are indexes on `job_decisions ("userId", "decidedAt")` and on `webhook_deliveries ("userId", "deliveredAt")` where `status = 'delivered'`, if they aren't already there.
- Claims, splits and spend caps keep working unchanged. A group's remembered split may now apply to a smaller set of members; that's fine, since splits are keyed by group.

## Left to the builder

- Exact names of the endpoint, setting, columns and log lines.
- Whether runnable filtering lives in `listActive` or a new repository method, and whether the cursor reset happens in the same statement.
- Tests: the A/B example as a planner scenario; an empty or fully decided list never pausing; a match waiting 23h vs 25h; each signal's edges (exactly 24h, a failed delivery, a test delivery, an `expired` decision); a shared builder with one active and one paused owner; a returning builder's window; the notice and Resume in the web app.

## Amendment (2026-11-25)

Two more signals count as activity, as part 1 of the [activity signals spec](2026-11-24-activity-signals-design.md):

- A job view: `job_views."viewedAt"`, the first time the user opens a job's post or apply link. Repeat views write nothing and do not count. Opening the detail panel does not count.
- A review choice: `match_reviews."createdAt"`, when the user picks qualified or rejected on a review.

Both are read by `pausedUsersCte` with the same 24-hour window as the other signals. Part 2 of that spec changes the webhook signal: signed callbacks (`webhook_callbacks."receivedAt"`) replace delivered webhooks as the signal, reversing the last non-goal. The partial index `webhook_deliveries_user_delivered`, which only the old rule read, was dropped in the `webhook_callbacks` migration.
