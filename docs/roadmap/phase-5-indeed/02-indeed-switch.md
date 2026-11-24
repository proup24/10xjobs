# 02: Indeed switch

Status: Built (spec). Spec: [Indeed switch design](../../superpowers/specs/2026-11-24-indeed-switch-design.md). The switch is shared with post search and hidden until slice 03 makes Indeed available.

## Goal

Any user can turn Indeed on or off for each profile from preferences. Turning it on attaches the profile's Indeed searches; turning it off detaches them. There is no allow-list _(user)_.

## Why first

Every later slice builds searches only for profiles with Indeed on, so the switch decides who pays for collection.

The switch is visible to every user from the start, unlike Phase 4's post search, which kept its allow-list until 04b _(user: no allow-list env var)_. While only invited users exist, they share Indeed's one daily cap; the slice 06 report counts applied jobs per user, so the owner's numbers stay readable _(my call)_.

## What exists

- Phase 4's post search switch: `profiles.postSearch` (engine-written, no user column grant), `GET`/`PUT /api/profiles/:profileId/post-search`, builder attach and detach in `users/services/profile-search-sync.ts`, the switch component `apps/web/src/components/preferences/post-search-switch.tsx`.
- Its allow-list `POST_SEARCH_USERS` and `post-search-access.ts`: **not** copied here.
- `db:regenerate` and `db:publish-drafts` already respect post search; both must also respect Indeed.

## In scope

- **A shared per-profile channel switch** _(user: Phases 4 and 5 run alongside each other)_: one component, one endpoint shape and one attach/detach path for post search, Indeed and later channels. Phase 4's slice 04b reuses it to drop `POST_SEARCH_USERS`; if 04b lands first, this slice adopts its version instead.
- A per-profile flag, off by default _(my proposal)_, and the engine endpoints to read and set it.
- The switch in preferences, following `apps/web/DESIGN.md`, with copy saying what it does (searches Indeed for this profile's stack in its named countries and in the main remote markets).
- Attaching and detaching Indeed builders, and keeping them through `db:regenerate` and publish.
- Tests that one user can't read or change another's switch.

## Out of scope

- The Indeed builders' content (slice 03). Until slice 03 lands, the switch can store the flag with nothing to attach; the slice's spec decides whether to ship it hidden until then.
- Per-user spend shares.

## Open questions

- Shown on profile creation (guided setup), in preferences only, or both?
- What the shared switch's storage looks like (a flag per channel on the profile, or a profile-channel table).
