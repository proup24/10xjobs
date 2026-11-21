# 07: Edit a published profile

Status: built (PRs #109, #111 and PR C). Spec: [publish and edit a published profile design](../../superpowers/specs/2026-11-21-publish-and-edit-published-design.md).

## Goal

A published profile stays editable, and saving a change takes effect. The user's example: they add Go to their stack. From the next collection runs, the profile searches for Go jobs too, and recent jobs that were rejected only because of Go become qualified and appear in the list in their normal date order. They are not marked new or unread: the list's "New" (posted in the last 12 hours) and viewed state stay as they were.

## What already exists (on `main`)

- Preferences pages (Phase 1 slice 08) that edit every setup answer, for drafts.
- RLS that lets a user update only draft profiles, plus `profile-freeze.db.spec.ts`, which proves published profiles are frozen.
- `regeneratePublished`, which moves published profiles to the current query recipe's builders. Its logic is close to what "apply a change" needs for searches.
- The matcher's upsert per `(profileId, jobId)`, `decidedAt` that moves only when the outcome changes, `db:rematch`, and the matchable-job definition (`lastSeenAt` within `MATCH_BACKFILL_DAYS`).

## In scope

- Lifting the freeze on published profiles, and replacing `profile-freeze.db.spec.ts` with tests for the new rules.
- Applying a saved change through the engine: re-attach the shared query search builders for the new preferences, release the ones no longer needed, and re-decide the profile's recent matchable jobs.
- Re-deciding in both directions: a recent job can move from rejected to qualified, and from qualified to rejected. Jobs outside the recent window keep their decisions and are never shown anyway.
- Each decision records which version of the profile it read, so a rejection can still be explained after the profile changes.
- The preferences pages work the same for published profiles, and tell the user a change applies to new searches and recent jobs.

## Out of scope

- Re-collecting past windows for new searches.
- Notifying the user about jobs that left their list.

## Locked

- Published profiles are editable; a save applies the change, with no separate step _(user)_.
- Only recent jobs are re-decided _(user)_.
- Only the engine attaches and releases shared searches.

## For the slice spec

- Whether the web app writes the change under RLS and then asks the engine to apply it, or sends the change to the engine to write and apply in one step. The first keeps one write path; the second avoids a saved-but-not-applied state. Either way, a failed apply must be visible and retryable, and the sweep should heal it.
- How the profile version is recorded on each decision (a counter on the profile, a snapshot of the compared values in `checks`, or both), and how the matcher's sweep spots decisions made against an older version.
- How changing a profile's resume (already allowed when published) fits in: it shouldn't trigger re-matching.
- From Phase 3 slice 02: each decision already stores `job_matches.profileUpdatedAt`. A row decided before the profile's `updatedAt` is stale. That only works while published profiles are frozen, because only the engine's ORM moves `profiles.updatedAt`. Web edits, `profile_skills` changes and `set_profile_resume` don't.
  - Before published profiles become editable, replace it with a profile version.
  - The version should be bumped by a trigger on the matching columns and on `profile_skills` changes, and not on the resume columns.
- Debouncing: several saves in a row on different preference pages shouldn't each trigger a full re-match.

## Done when

On the hosted app, adding a tech to a published profile adds its searches to the next collection run and requalifies recent jobs that only failed on it, removing a place drops recent jobs that only passed on it, and every decision can name the profile version it used.
