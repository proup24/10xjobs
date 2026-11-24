# Indeed switch (Phase 5, slice 02)

Date: 2026-11-24
Status: draft, awaiting approval (builder check done)

Brief: `docs/roadmap/phase-5-indeed/02-indeed-switch.md`.

## Intent

Any user can turn Indeed on or off for each of their profiles, from that profile's page in preferences. There is no allow-list _(user)_. Every later Phase 5 slice builds Indeed searches only for profiles with Indeed on, so this switch decides who Indeed collection is paid for.

Post search already has a switch like this (Phase 4 slice 01). Phases 4 and 5 run side by side, so this slice turns that one-off into **one shared per-profile search switch**: one engine path, one endpoint shape and one web component that post search, Indeed and later channels all use _(user: brief)_.

With the code shared, **post search's allow-list goes too** _(user, 2026-11-24)_: `POST_SEARCH_USERS` is removed, and every switch is for every user. A switch is shown only once its channel gives something back _(user picked option A)_: Indeed's when slice 03 gives it searches, post search's when Phase 4 matches posts. Until then a switch that is already on keeps working; nobody can newly turn it on.

## Goals

- A per-profile "Search Indeed" switch, off by default, open to every user, on the profile page in preferences, right below "Search LinkedIn posts" _(user: option A)_.
- Post search runs on the same shared code. `POST_SEARCH_USERS`, `PostSearchAccess` and the 403 path are removed.
- A switch's channel is either **available** (shown to every user, can be turned on and off) or not (hidden, can't be changed). Profiles whose switch is already on keep their searches either way.
- Turning a switch on attaches that channel's searches to a published profile; turning it off detaches them. A draft gets them when it is published.
- Search sync, `db:regenerate` and `db:publish-drafts` keep the searches of every switch that is on, and none of a switch that is off.
- A switch changed during a search swap is never lost (the guard post search has today covers every switch).
- One user can't read or change another user's switches.

## Non-goals

- Indeed's searches themselves (slice 03): the keywords, places, actor and cadence.
- Making post search available: it waits until Phase 4 matches posts (slice 04), and is flipped by slice 04b together with fair budget sharing _(my call: 04b already owns the shared posts budget)_.
- Fair sharing of the posts budget (04b).
- Showing the switch in guided setup _(user: option A, preferences only)_.
- Per-user spend shares.

## Anti-goals

- **A switch that does nothing:** a user turns Indeed on, sees it on, and gets no searches. Hence the switch stays hidden until slice 03 gives Indeed searches.
- **Losing running searches:** the owner's profile (the only one with post search on, on dev, 2026-11-24) losing its post builders because the switch is hidden.
- **Lost switches:** a toggle that lands during a swap, a publish or a regenerate and is undone by it.

## Approaches

Three were considered _(user picked 2)_:

1. **Copy post search:** an `indeedSearch` column plus its own endpoints, component and `&& indeed` everywhere post search is handled. Smallest diff today, but each later channel copies it all again, and it isn't the shared switch the brief asks for.
2. **Shared switch code, one flag column per channel** (picked): `profiles.indeedSearch` next to `postSearch`, and one engine registry of switches that every path reads. A new channel costs a column and a registry entry. The migration is one `ADD COLUMN`.
3. **Shared switch code, a `profile_channels` table:** most general, but it moves live post search data, adds RLS and a join to the swap's transaction check, and a heavier migration (`prisma db migrate` already nears its heap limit, #124). It pays off only with many channels, and there are two.

## Design

### Storage

- New column `profiles.indeedSearch boolean NOT NULL DEFAULT false`, like `postSearch`: written only by the engine, with no user column grant. Users read it as they read `postSearch` today.
- **Switch columns don't count as profile edits** _(my call: as `postSearch` today)_. The `profiles` BEFORE UPDATE trigger bumps `matchVersion`, and on a published profile sets `users.searchesResumedAt`, for every column not on its exclusion list (latest definition in `20261123T1042_paused_searches`). `postSearch` is on that list. `indeedSearch` must be too: otherwise flipping Indeed would rematch every job against the profile and resume a paused user's paid searches.
- So the migration adds the column (in the shape of `20261120T0816_profile_post_search`) and replaces the trigger function with `indeedSearch` added to both exclusion arrays. Advance the ref hash in `app/refs/db.json` and regenerate `database.types.ts` (CI diffs it). If `prisma db migrate` hits its heap limit (#124), split the migration rather than drop either part.
- A comment next to the registry says a new switch column must also join the trigger's exclusion list.

### The switch registry (engine)

One module-level registry lists every per-profile search switch. Each entry has:

- `key`: the switch's name in URLs and views: `posts` and `indeed` _(my call: not the `Channel` enum, because `INDEED` joins that enum with its collector in slice 03, and adding it now breaks every exhaustive switch over channels)_.
- `column`: the profile flag (`postSearch`, `indeedSearch`).
- `channel`: the `Channel` its builders belong to, for detach. `LINKEDIN_POSTS` for posts; none for Indeed until slice 03.
- `recipes(input)`: the recipes the switch adds. Posts: `postRecipes`. Indeed: none until slice 03.
- `available`: whether the switch is shown and can be changed, for every user. Both **false** in this slice. Slice 03 sets Indeed's with its recipes, and Phase 4 slice 04b sets post search's, in code _(user: no env var)_.

A switch is **in effect** for a profile when its flag is on, whatever `available` says: availability gates only showing and changing the switch, so a hidden switch already on keeps its searches. Only switches in effect contribute recipes. Indeed's flag can't be on (its PUT is refused while unavailable, and it has no recipes yet).

### What changes in existing paths

- `QuerySearchService.recipesFor(input, options)` takes the set of switches in effect instead of `{ posts }`, and adds each one's recipes after the board recipes. `generate` follows.
- `attachPosts` becomes `attachSwitch(profileId, key, input)`; `detachChannel` stays and is called with the entry's channel (no channel, nothing to detach).
- **Swap check:** `QuerySearchReplaceExpected.postSearch` becomes `switches`, a record of every registry column with the value the caller read. The early short-cut and the final `UPDATE … WHERE` compare every column. The skip reason `post_search_changed` becomes `switch_changed` (check for log or metric readers of the old name first).
- **Publish:** `ProfilesRepository.publish`'s `CASE` compares every switch column with what the caller read, so a switch committed between the read and the publish leaves `searchesVersion` null and search sync rebuilds.
- **Search sync** (`ProfileSearchSync.applyPending`), **`regeneratePublished`** and **`db:publish-drafts`** build the switches in effect from the registry instead of `postSearch && allows`. Regenerate's `postsKept` / `postsDropped` become kept and dropped counts per switch key (the script prints them).
- **The allow-list goes:** `PostSearchAccess` and its spec, `POST_SEARCH_USERS` in `environment.validation.ts`, `postSearchEnvironmentSchema` and its reads in `db:regenerate` and `db:publish-drafts`, and the regenerate warning about owners missing from it. `ADMIN_USERS` reuses `postSearchShape.POST_SEARCH_USERS` today: keep its parsing as a shared user-id-list shape. `ErrorCode.POST_SEARCH_NOT_ALLOWED` goes once nothing returns it.

### Endpoints

- `GET /api/profiles/:profileId/searches`: every switch that is `available`, as `{ key, enabled, searches }[]`, where `searches` is how many searches the switch would add for this profile (posts: as today; for Indeed, from slice 03). In this slice the list is empty.
- `PUT /api/profiles/:profileId/searches/:key` with `{ enabled }`: sets the flag and returns that switch's view. On a published profile it attaches or detaches at once, and puts the flag back if that fails (today's post search behaviour, generalised).
  - Unknown key or unavailable switch: 404.
  - Not the user's profile: 404, as every profile route.
- The old `GET`/`PUT /api/profiles/:profileId/post-search` stay as thin wrappers over the shared path, so a web app deployed before or after the engine keeps working _(my call: the engine and web deploy separately)_. GET answers `allowed: false` while post search is unavailable, so an old web app hides the switch too; PUT is a 404. Slice 04b deletes them.
- `@xjobs/engine-client` gets `searchSwitches(profileId)` and `setSearchSwitch(profileId, key, enabled)`; `postSearchStatus` and `setPostSearch` stay until 04b.

### Web app

- `PostSearchSection` becomes `SearchSwitchesSection`: it loads `GET …/searches` once and renders one switch per entry (only available switches are listed). An engine error or an engine that is down renders nothing, as today. Still wrapped in `Suspense`.
- `PostSearchSwitch` becomes a generic `SearchSwitch` (same optimistic flip, revert and failure toast; the "not available for your account" toast goes), with each key's label and copy in the web app:
  - Posts: today's copy, unchanged.
  - Indeed: **"Search Indeed"**: "Searches Indeed for this profile's technologies in the countries it names, and for remote jobs in the US, Brazil, Poland, the UK and Canada." Slice 03 adds its zero-searches note and cadence wording if needed.
- `setPostSearchAction` becomes `setSearchSwitchAction(profileId, key, enabled)`, validating the key against the known keys.
- Built only from `components/ui` and theme tokens (`apps/web/DESIGN.md`).

In this slice both switches are unavailable, so the profile page shows no search switch at all, the owner's included. The owner's profile keeps its post searches running.

## Tests

- Registry: a switch is in effect whenever its flag is on, available or not; both switches are unavailable.
- Endpoints (with a test registry where a switch is available, since none is in this slice): another user's profile is a 404 on GET and PUT; an unknown or unavailable key is a 404; a PUT on a published profile attaches and detaches the builders; a failed attach puts the flag back; any user may change an available switch.
- The `/post-search` wrappers: GET answers `allowed: false`, PUT 404s.
- Trigger (Postgres spec): changing `indeedSearch` on a published profile leaves `matchVersion` and `users.searchesResumedAt` unchanged; changing a preference still bumps both.
- Swap (Postgres spec): a swap is skipped when any switch column changed since the read, including `indeedSearch`; publish leaves `searchesVersion` null when any switch moved.
- Search sync, regenerate and publish-drafts: posts kept for any user with it on (no env needed), none with it off; an Indeed flag set directly in the database adds nothing (no recipes yet).
- Web: the section renders one switch per allowed entry, nothing on an engine error; the switch flips, reverts and toasts as today.

## Rollout

- Migration applies on dev at deploy. No backfill: every profile starts with Indeed off.
- Nothing to run after merge: no regenerate, because no profile's searches change.
- Remove `POST_SEARCH_USERS` from the hosted engine's `.env` after the deploy (harmless if left: nothing reads it).
- Update `CLAUDE.md` (the `worker-linkedin-posts`, `db:regenerate` and `db:publish-drafts` lines), both `.env.example` files, `deploy/engine/README.md`'s LinkedIn posts section, Phase 4's 04b brief (the allow-list is gone; 04b makes post search available and shares its budget) and Phase 5's slice 02 status.
- Check on dev: the owner's profile page shows no search switch; its post builders are still attached and the posts worker still collects for it on the next hourly tick.

## Left to the builder

- File and type names, where the registry lives (`users` or `queries` module), and how the record of switch columns is typed.
- Whether the swap and publish SQL is built from the registry's columns or written out for the two columns (either is fine while there are two).
- PR split: one PR is expected (migration, engine, client, web).
