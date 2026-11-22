# 04b: Open post search to every user

## Goal

Any user can turn post search on for their profiles from their preferences, and be matched with jobs found in LinkedIn posts. The allow-list goes away, and the posts budget is shared fairly between everyone who turned it on.

## Why after slices 04 and 04a

Until slice 04, collected posts are stored raw and never matched, and until slice 04a there is no page to see post matches on, so turning post search on gives a user nothing back while it costs credit. Slices 01 to 04a run on the owner's profile only, which also measures the cost per profile before the switch opens.

## What already exists (on `main`, from slice 01)

- `profiles.postSearch`, off by default, written only by the engine (no user column grant).
- `GET`/`PUT /api/profiles/:profileId/post-search`, which attach or detach the profile's post builders.
- `POST_SEARCH_USERS`, the allow-list: only listed users can turn the switch on (403 otherwise), see it in the web app, or keep post builders through `db:regenerate`.
- The switch on the profile page (`apps/web/src/components/preferences/post-search-switch.tsx`), shown only to listed users.
- One daily budget for the posts channel, `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS` (default $1.50). Segments run in sorted key order each tick, so when the budget runs out, the keys that sort last are skipped (the known limit in the slice 01 spec).

## Shared with Phase 5

Phase 5 (Indeed) runs alongside this phase _(user, 2026-11-22)_ and needs the same kind of per-profile switch without an allow-list ([Phase 5 slice 02](../phase-5-indeed/02-indeed-switch.md)). Build the switch here as a shared per-profile channel switch (one component, endpoint shape and builder attach/detach path for posts, Indeed and later channels). Whichever slice lands first builds the shared part, and the other adopts it.

## In scope

- **Remove the allow-list** _(user, 2026-11-20)_: `POST_SEARCH_USERS`, the 403 path, `allowed` in the engine's post search view and the web client, and the regenerate script's allow-list handling. Builders are attached whenever a profile's post search is on.
- **The switch in preferences, for every user** _(user: this needs UI work)_: where it lives (each profile, the preferences overview, and/or profile creation), what it says it does and that English posts are searched for remote work only, the "no post searches for this profile" case, and the state while the engine is unreachable.
- **Fair budget sharing** _(user: include it)_: no profile's searches are always the ones skipped when the day's budget runs low, e.g. rotating which segments run first each tick, or a share of the day per profile. Segments are shared between profiles, so a share has to be counted per segment, not per user.
- **Budget sizing:** the default daily budget for many profiles, and what happens on the hosted engine when it is reached (warning, metric, or a visible state for users).

## Out of scope

- Search wording, merging and failure detection (slice 01; unchanged).
- Whether turning post search on is also consent for automatic emails (slice 05 decides; if it is, the switch's copy must say so).
- Paid plans or per-user billing.

## Open questions

- Is the switch on by default for new profiles, or always opt-in?
- Should users see what is searched for them (the post search keywords), or only that it's on?
- Rotation or per-profile share, and does a profile with many technology groups (more searches) get a larger share?
- What's the cost per profile after a few weeks of the owner's collection, and what daily budget does that imply?
- Does the hosted Apify account need its own posts limit, apart from the job board's?
