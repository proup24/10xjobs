# 10: Launch check

## Goal

The exit criteria of Phase 1 and of this phase are checked end to end on the hosted app and the hosted engine, against `10xjobs-dev`. Phase 1 is closed by this check rather than its own _(user)_: its slice 09 launch check assumed a production project, and production is deferred.

## In scope

- **Phase 1's exit criteria:** an invited user signs up on the hosted app, creates and edits profiles (preferences, eligibility and resume), and a second user can't read or change the first user's data.
- A written check, run by hand once: invite a test user, finish setup, confirm the profile is published, wait for a scheduled collection run, and see qualified jobs with details and reasons, plus the Rejected tab.
- A job requiring a language the user doesn't speak, or an authorization they lack, is rejected with a readable reason.
- Edit the published profile (add a tech, remove a place) and the user's eligibility and confirm the next run's searches and the recent re-decisions follow.
- A second user can't see the first user's matches or the jobs behind them, from the app or the engine.
- CI's isolation harness covers every new table and access path from this phase.
- The roadmap README, the Phase 1 folder and this folder updated to "done", with anything learned that the "Later in Phase 2" slices need.

## Out of scope

- Production; `10xjobs-dev` only.

## Done when

Every exit criterion in the [phase README](README.md) and the [Phase 1 README](../phase-1-accounts-and-preferences/README.md) passes on the hosted app, and the result is recorded in this brief.
