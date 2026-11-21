# Publish on create, and edit a published profile

Date: 2026-11-21
Status: approved 2026-11-21
Covers: roadmap Phase 2 slices [06](../../roadmap/phase-2-find/06-publish-on-create.md) and [07](../../roadmap/phase-2-find/07-edit-published.md), built together _(user)_
Builds on: [matching](2026-11-08-matching-design.md), [edit preferences](2026-11-09-edit-preferences-design.md), [shared LinkedIn searches](2026-11-09-shared-linkedin-searches-design.md), [engine auth](2026-11-10-engine-auth-design.md)

## Intent

Today no user gets jobs without a manual step: the web app never calls the engine's publish, so every profile it creates stays a draft. And once a profile is published (through the engine directly), it is frozen: changing anything means deleting it and starting again.

This closes both gaps. A profile goes live when the user finishes setting it up, with no publish button. After that it stays editable from the same preferences pages, and a save takes effect with no separate step _(user)_: later collection runs search for the new preferences, and recent jobs are re-decided against them in both directions. The user's example: they add Go to their stack. The next runs search for Go jobs too, and recent jobs that were rejected only because of Go become qualified.

## Goals

**Publish (slice 06)**

- Finishing guided setup, or finishing "add a profile", publishes the profile through the engine (`publishProfile` in `@xjobs/engine-client`). Where each flow publishes:
  - **Guided setup:** on the Review page's "Finish" (`components/setup/review.tsx`, today a plain link to `/`) _(user, option a)_. The Review page stays; uploading a resume no longer ends setup on its own.
  - **Add a profile:** on its resume step's "Finish" (`NewProfileResumeStep`). A copy goes through that step too, with its copied resume already there _(my call)_.
- After publishing, the user lands on the matches view for the new profile, in its "no matches yet" state.
- If publishing fails (engine unreachable, or it refuses, e.g. incomplete), the profile stays a draft, the publishing step shows the error plainly, and pressing the step's button again retries. Nothing publishes on its own: no sweep auto-publishes drafts, so a copy still being edited never goes live by accident _(my call)_.
- Preferences show which profiles are live: a draft gets a "Not live" mark with a "Finish setup" link to `/preferences/new/<id>/resume`, whose "Finish" publishes any draft of the user's (guided setup's Review "Finish" publishes too) _(my call)_. The app doesn't guess whether a draft's publish failed or was never tried; either way the user finishes from that step _(user, option a)_. The matches view's draft state says the same instead of "not live yet".
- Deleting a **published** profile from preferences goes through a new engine route, which releases its shared searches. Drafts keep being deleted directly. The existing rules stay: never the last profile, never the only one with a resume.

**Edit (slice 07)**

- The preferences pages (job, terms, resume) work the same for published profiles as for drafts. On the job and terms pages of a published profile, a short line says a change applies to the next searches and to jobs from the last 30 days _(my call on wording)_.
- A save of a published profile:
  - moves its shared query search builders to what the new preferences need, attaching new ones and releasing ones no longer needed;
  - re-decides its matchable jobs (`lastSeenAt` within `MATCH_BACKFILL_DAYS`, 30 days), both from rejected to qualified and from qualified to rejected.
- Every decision records the profile version it read, so a rejection can still be explained after the profile changes.
- An edit clears the user's review choices on that profile _(user, option a)_. A Move to Matches or Reject on a job flagged for review counts only on the profile version it was made on. After any edit, those jobs show in Review again if the matcher still flags them. This holds even when the edit was unrelated (for example salary); review is meant to stay rare, so re-asking is cheap, and an old reject must never hide a job the edit now covers.
- Changing only the resume (already allowed on published profiles) does not re-decide anything or touch searches.
- Several saves in a row (job page, then terms page) don't each trigger a full re-match.
- A newly qualified job sends a match webhook like any new match, under the existing rules (only jobs first seen after the profile was published, one delivery per job per profile) _(my call)_.

## Non-goals

- Unpublishing without deleting _(my call, the roadmap's default)_.
- Re-collecting past windows for the new searches.
- Telling the user about jobs that left their list.
- Marking jobs that an edit requalified as new or unread _(user, option 2)_. They appear in the list in their normal date order, with whatever "New" (posted in the last 12 hours) and viewed state they already have. This means the "shows up as new" wording in the 07 roadmap goal doesn't hold; update the roadmap file.
- Re-deciding jobs outside the 30-day window. They keep their old decisions and are never shown anyway.
- Fixing builder counts when a whole user account is deleted (the cascade bypasses the engine). Noted as a known gap, not handled here.

## Anti-goals

- A save that looks applied but never is: searches or decisions silently left on the old preferences.
- A shared search's profile count or active flag going wrong (a builder collected for nobody, or a needed one switched off). Migration `20261107T0531_builder_recount` exists because a direct delete did exactly that once.
- A user setting `state` or `publishedAt` themselves. Only the engine publishes.
- A resume change causing a full re-match.

## Approaches

**A. Save under RLS, the engine catches up _(user's pick)_.** The web app keeps writing profiles and skills straight to Supabase, now for published profiles too. A trigger bumps a version on the profile when anything the matcher or searches read changes. The existing match sweep already re-decides rows decided on an older version; a new engine sweep moves searches when they were attached for an older version. One write path; the sweeps also give retry, healing and debouncing for free. The cost: for up to a minute (searches) or longer (re-deciding), a save is stored but not yet applied.

**B. The engine writes published profiles.** Published edits go to an engine route that validates, writes and applies in one step, so there's no saved-but-not-applied state. Rejected: two write paths (drafts through RLS, published through the engine), validation in two places, and each save reruns the search swap, so debouncing needs its own work.

For publishing, both use the same shape: a direct engine call right after the final save. It stays that way.

## Design

### Profile version (replaces `job_matches.profileUpdatedAt`)

`job_matches.profileUpdatedAt` works only while published profiles are frozen: only the engine's ORM moves `profiles.updatedAt`, and web edits, skill changes and `set_profile_resume` don't. Replace it, copying the existing `users.eligibilityVersion` pattern (migration `20261112T1603_rematch_triggers`):

- `profiles.matchVersion int NOT NULL DEFAULT 0`.
- A `BEFORE UPDATE` trigger on `profiles` bumps it when any column changes **other than** `resumeKey`, `resumeFilename`, `resumeSizeBytes`, `resumeSha256`, `resumeUploadedAt`, `state`, `publishedAt`, `matchVersion`, `searchesVersion`, `postSearch`, `createdAt`, `updatedAt` (`postSearch` only moves post builders, which the engine's switch already does at once; the two version columns must be excluded, or the search sweep's write would bump the version and loop forever), with a `WHEN ... IS DISTINCT FROM` guard so a no-op save doesn't bump. Listing the excluded columns rather than the matching ones means a future matching column bumps by default _(my call)_.
- An `AFTER INSERT OR UPDATE OR DELETE` trigger on `profile_skills` bumps the owning profile (both, if a row moved).
- `job_matches.profileVersion int`, written by the matcher from the profile it read. Migration backfills every existing row with its profile's version (0): published profiles were frozen, so every existing row is current. Then `profileUpdatedAt` is dropped _(my call)_.
- `ON_CURRENT_PROFILE` in `matcher.repository.ts` compares `m."profileVersion" >= p."matchVersion"` instead of the timestamps.

Drafts get bumped too; that's harmless, since nothing reads a draft's version until publish.

### Re-deciding

No new mechanism. Once a profile's version moves, every one of its rows is stale by `STALE_ROW`, `listStaleJobs` returns those jobs, and the match sweep (`MATCH_SWEEP`, every 60 s, 200 jobs) re-decides them through `matchJob`, which only decides the profiles whose row is stale. `decidedAt` moves only when the outcome changes, as today. Saves within the same minute collapse into one re-decide; a save in the middle of one just makes the rest of it decide on the newer version.

Volume: on dev, one published profile has about 6,700 rows in the window, so a full re-decide takes about 35 minutes at today's sweep rate. `listStaleJobs` already takes the most recently seen jobs first (`lastSeenAt DESC`), so the jobs the user actually looks at are re-decided within minutes. Raising the sweep limit is left to the builder.

### Review choices

Today `match_details` applies the user's latest `match_reviews` choice while the match is still in review on the same rule and field, and only if the choice was made after `decidedAt`. Add `match_reviews.profileVersion`: the `profileVersion` of the match the choice was made on, set by a `BEFORE INSERT` trigger, never by the client. `match_details` applies a choice only when it equals the match's current `profileVersion`. The choice thus stops counting once the match is re-decided on a newer profile version, without joining `profiles`. Existing choices are backfilled from their match (0) _(my call)_. The `match-reviews.db.spec.ts` tests grow a case: a choice stops applying after an edit, and a new choice on the new version applies.

### Searches

A profile records which version its searches were attached for: `profiles.searchesVersion int` (null on drafts).

- **Publish** sets it to the `matchVersion` it attached for.
- A new **search sweep** in the engine (every 60 s, in the match worker or its own scheduled job, the builder decides) finds published profiles with `searchesVersion < matchVersion` and, for each, in **one transaction** with the profile row locked: reads the profile and its skills, builds the recipes (`toQuerySearchInput` → `generate`'s recipe step), diffs them against the current links, attaches the new builders, releases the ones no longer needed (each count moves under its row lock, as today), and sets `searchesVersion` to the version it read. If the version moved in the meantime, the swap still records the version it read, so the next tick picks it up again.
- The swap is a diff, not detach-then-attach: a builder the profile keeps never drops to 0 associations, so a collection run that reads `listActive` mid-swap never loses a search. `regeneratePublished` (`db:regenerate`) should use the same swap and also set `searchesVersion`.
- Only the engine attaches and releases searches _(locked)_.

While a published profile's `searchesVersion` is null or below its `matchVersion`, its job and terms pages say "Your last change is being applied to the searches." A stuck sync stays visible this way without a timestamp column _(my call)_. The sweep is the retry. The engine logs each failed swap with the profile id.

### RLS and database functions

- `profiles` update: the owner can update their profile in either state. They can never change `state`, `publishedAt` or `userId`; the existing column grants already keep users from writing `state` and `publishedAt`, and the tests must prove that still holds for published rows. The insert and delete policies stay draft-only: published profiles are deleted through the engine.
- `profile_skills` insert, update and delete: allowed when the profile is the owner's, in either state.
- `replace_profile_skills` accepts the owner's published profiles, not just drafts.
- `profile-freeze.db.spec.ts` is replaced by tests for the new rules: owner edits of a published profile and its skills succeed and bump `matchVersion`; resume changes don't; a user can't set `state` or `publishedAt`, or delete a published profile; other users still can't touch any of it.
- Remember the `app/refs/db.json` hash and `database.types.ts` regeneration.

### Engine routes

- `POST /profiles/:id/publish`: unchanged except it sets `searchesVersion`.
- New `DELETE /profiles/:id` for a published profile: releases its searches and deletes the row in one transaction. A draft is refused (the web app deletes drafts directly). The web app removes the resume files the same way `deleteDraftProfile` does today, in the same order.
- The engine's `PROFILE_PUBLISHED` conflict ("delete it and create a new one") no longer applies to edits; keep it only where publish needs it.
- `@xjobs/engine-client` gets `deleteProfile`.

### Web app

- `saveProfileJob` and `saveProfileTerms` stop requiring a draft (they work through the widened RLS). No engine call after a save.
- Setup's Review "Finish" becomes an action that calls `publishProfile`, then lands on the matches view. "Add a profile"'s final step does the same after its save succeeds. On failure: the profile stays a draft and the step shows the error; pressing the button again retries. The setup guard (`app/(flow)/setup/guard.ts`) must keep a user whose profile is still a draft able to reach Review.
- The delete button calls the engine for published profiles, and deletes drafts directly as today.
- UI work follows `apps/web/DESIGN.md`.

### Existing data on `10xjobs-dev`

Dev has one user with 2 drafts (both with resumes) and 1 published profile. A one-off script publishes the drafts through the engine's publish; the published profile is kept: its `searchesVersion` starts null, so the search sync's first tick moves it to the current recipe _(my call)_. No in-app prompt.

## Done when

On the hosted app:

- Finishing setup publishes the profile, its searches join the next collection run, and recent matchable jobs get decisions for it. Deleting it releases its searches.
- Adding a technology to a published profile adds its searches to the next collection run and requalifies recent jobs that failed only on it. Removing a place drops recent jobs that passed only on it.
- Every decision names the profile version it used.

## Left to the builder

- Where the search sweep runs, and the sweep limits.
- The exact wording and placement of the notices, within `DESIGN.md`.
- How the dev script is run (a `db:*` script or a one-off).
- How the PRs are split.
