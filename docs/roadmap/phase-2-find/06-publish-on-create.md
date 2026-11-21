# 06: Publish on create

Status: built (PRs #109 and #111, and the web-app PR). Spec: [publish and edit a published profile design](../../superpowers/specs/2026-11-21-publish-and-edit-published-design.md).

## Goal

A profile goes live as soon as the user finishes setting it up, with no publish button: finishing guided setup or finishing "add a profile" publishes it, the matcher backfills recent jobs for it, and the next collection runs search for it.

## What already exists (on `main`)

- Guided setup (Phase 1 slice 07) ends with a complete draft that has everything publishing needs.
- "Add a profile, blank or copied" and deleting a draft from preferences.
- The engine's publish: it checks the profile is complete, attaches the shared query search builders, and the matcher backfills matchable jobs on publish.
- Nothing yet deletes a published profile and releases its shared searches. This slice adds `DELETE /profiles/:id` on the engine, which releases them through `QuerySearchService.releaseAndDelete`.

## In scope

- Publishing at the end of setup and of "add a profile", through the engine (slice 02's client).
- Deleting a **published** profile from preferences through the engine, so its shared searches are released. Drafts keep being deleted directly.
- What the user sees right after publishing: they land on the matches view (slice 04) for the new profile, in its "no matches yet" state; matches appear as jobs are collected and matched. The first matches come from the backfill of recent jobs other profiles' searches already found.
- The matches view's draft state changes from "not live yet" to a prompt to finish setup.
- Failure states: the engine is unreachable or refuses (for example an incomplete profile). The profile stays a draft, the user is told plainly, and they can retry.
- Existing profiles on `10xjobs-dev` from before this slice: how drafts get published (a one-off prompt in the app, or a script), and whether the one profile already published through the engine is kept (moved to the current query recipe with `db:regenerate`) or reset. The spec decides.

## Out of scope

- Changing a published profile (slice 07).
- The matches page itself (slice 04, already built).

## Locked

- No publish button; finishing setup or "add a profile" publishes _(phase decision)_.
- Only the engine sets `state` to published; RLS keeps users from setting it.

## For the slice spec

- Whether publishing happens inside the final save or right after it, and what happens when the save succeeds and the publish fails.
- How the app shows a profile's live or draft state in preferences.
- Whether a user can unpublish without deleting. Default going in: no.

## Done when

On the hosted app, finishing setup publishes the profile, its searches join the next collection run, recent matchable jobs get decisions for it, and deleting it releases its searches.
