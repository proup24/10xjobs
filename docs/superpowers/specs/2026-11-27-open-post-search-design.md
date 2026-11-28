# Phase 4 slice 04b: Open post search to every user

Date: 2026-11-27
Status: design, awaiting the owner's approval
Brief: [04b-open-post-search.md](../../roadmap/phase-4-social-posts/04b-open-post-search.md)

## Intent

Any user can turn LinkedIn post search on for a profile from its preferences and get post matches on the `/posts` page (slice 04a). Until now only the owner's profile has post search on. When the day's posts budget runs short, no profile's searches are always the ones skipped.

**Why:** posts find roles that never reach a job board. Slices 01 to 04a built and measured the pipeline on the owner's profile; this slice opens it to everyone.

## What exists (on `main`)

- **The allow-list is gone** (Phase 5 slice 02, PR #127). `POST_SEARCH_USERS`, its 403 and its regenerate handling no longer exist.
- **The switch is shared.** `SEARCH_SWITCHES` in `apps/xjobs/src/modules/queries/switches.ts` holds the posts switch with `available: false`. `GET /api/profiles/:profileId/searches` and `PUT /api/profiles/:profileId/searches/:key` read and set it. `apps/web/src/components/preferences/search-switch.tsx` renders it on each profile's preferences page (from `search-switches-section.tsx` in `preferences/profiles/[profileId]/layout.tsx`). It already has its copy, the "no post searches for this profile" line (`searches === 0`), and renders nothing while the engine is unreachable.
- **`profiles.postSearch` defaults to false** and only the engine writes it.
- **One posts budget:** `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS` (default $1.50, Morocco day), read by both the API and the workers (`collectionBudgetShape` in `environment.validation.ts`). `CollectionService` (`apps/xjobs/src/infrastructure/jobs/steps/collect/collection.service.ts`) checks it before each run. Once it is reached, every remaining segment of the tick is deferred, and so is every later tick that day.
- **Segment order:** `planSegments` (`apps/xjobs/src/modules/segments/services/segments.ts`) sorts segments by key, then members by hash, and the tick runs them in that order. So the keys that sort last are the ones skipped, every day.
- **Post segments are shared.** Builders with the same language, position and remote flag (`postSegmentKey`) are searched together, chunked to fit the keyword limits.
- **Catch-up:** a post search's window starts at its members' oldest `coveredUntil` and reaches at most 24 hours back (`linkedinPosts.window.maximumHours`). A skipped run, or a start Apify refused (`SearchNotStartedError`, counted $0), leaves cursors where they were. The next run covers the gap, up to 24 hours. A posts run asks for no row limit (`maxPosts: 0`), so LinkedIn's own ceiling of about 390 posts per search applies.
- **Measured cost on dev, owner's profile only (2 post segments):** $1.18 to $1.50 a day on full days (11-21 hit the $1.50 cap).

## Decided

- **Every user sees the switch** _(user)_: the posts switch becomes `available: true`.
- **Off by default for new profiles; turned on only from the profile's preferences** _(user)_. Profile creation does not change. The column default stays false.
- **One budget total, raised by hand** _(user, approach B)_. It stays the single env setting `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS`. The owner raises it and tops up Apify as users join. It starts at $3 a day _(user)_: the code default moves from 1.5 to 3.
- **Fair sharing: the search that waited longest runs first** _(user, approach A)_ (below).
- **Users see whether post search is on, not its keywords** _(my call: the keywords are long OR'd spelling lists that help nobody)_.
- **Users never see dollars** _(my call)_: they see a plain "paused until" state. Spend is shown only on an admin page.

## Approaches considered (fair sharing)

- **A. Longest-waiting search first (picked).** Each tick runs post segments oldest cursor first. It uses data the engine already keeps (`coveredUntil`), with no new table and no per-profile accounting. A skipped search is first in line next time, so none falls behind for long. A profile with more technology groups has more searches, so it gets a larger share in proportion to its breadth (this answers the brief's open question).
- **B. Equal share per profile.** Split the day's budget between profiles with post search on, split each run's cost between the profiles sharing it, and make over-share profiles wait. Rejected: new per-profile cost tracking, fiddly with shared segments, and broad profiles get fewer of their searches run.
- **C. Random order per tick.** Rejected: nothing stops the same search losing several times in a row.

Budget growth was decided separately: **B, one total raised by hand**, was picked over **A, an amount per profile times profiles on, with a hard ceiling**.

## Design

### 1. Run order for post segments

In `CollectionService`, for `LINKEDIN_POSTS` only, the tick sorts the planned segments before its loop:

1. A segment with any never-collected member (`coveredUntil` null) first.
2. Then by the segment's oldest member `coveredUntil`, ascending.
3. Ties keep today's order (key, then hash).

`planSegments` itself does not change: segment identity (`segmentHash`) and chunking stay as they are, and every other channel keeps its order: the job boards (each search covers only the last hour) and Indeed (its own budget; whether it adopts this order is for Indeed's slices).

What this gives:

- A tick that runs out of budget part way leaves the unrun segments with the oldest cursors, so they run first in the next tick that has budget, usually right after Morocco midnight.
- A search is lost only past 24 hours behind. With this order, that happens only when one day's budget can't run every post search once. That is the owner's signal to raise the budget (section 3 shows it).
- After an Apify outage and a top-up, every search is about equally behind. All of them run in the next tick, each over up to 24 hours, unless the budget runs out first.

### 2. The switch, for every user

- In `SEARCH_SWITCHES`, the posts switch gets `available: true`. Nothing else in the registry changes.
- `SearchSwitchView` (engine DTO and `libs/engine-client`) gains `pausedUntil: string | null`. The field is on every switch so Indeed (which has its own `COLLECTION_DAILY_BUDGET_USD_INDEED`) can fill it when its switch opens in its own slice; this slice sets it only for the posts switch, when it is on and the posts budget for the current Morocco day is reached: the ISO instant of the next Morocco midnight (`moroccoDayStart` of now plus one day, through the same tz data). Otherwise it is null. The API reads the day's spend the way `CollectionService.dailyBudget` does (same `spentMicroUsd` call, same null-cost rule, same env setting); share that read rather than copying it.
- `search-switch.tsx` shows one extra line while `pausedUntil` is set, e.g. "Post searches are paused until {time} because today's search budget is used up. They catch up on what they missed when they restart." The time is formatted in the viewer's locale and time zone. The existing copy ("Looks every hour for hiring posts that match this profile. English posts are searched for remote work only.") and the no-searches line stay.
- Turning the switch on while paused is allowed: the builders attach now and run at the next tick with budget.

### 3. Admin: posts budget page

A new admin page `/admin/posts-budget` (web) backed by `GET /api/admin/posts-budget` (engine), gated by `ADMIN_USERS` like `/admin/prepare` and `/admin/rescues`. Built from `components/ui` per `apps/web/DESIGN.md`. It shows:

- **Today:** spent and budget in dollars, and the time the budget was reached, or "not reached".
- **Last 7 Morocco days:** spend, and whether and when the budget was reached.
- **Post searches, most behind first:** the segment key, how many profiles share it, its oldest `coveredUntil`, and a flag when it is over 24 hours behind (posts are being lost). Built from today's active post builders less those paused for inactivity, as the tick's `runnableBuilders` reads them _(my call: a paused user's search falls behind on purpose and must not read as a reason to raise the budget)_. Paused builders are shown only as a count.
- **Full runs, last 7 days:** post runs whose result came back full (`truncatedQueryIds` not empty, i.e. LinkedIn's ~390 ceiling), per segment key _(my call: a long catch-up after the budget ran out can hit the ceiling well under 24 hours behind, so this is the other sign that posts are lost)_.

"Reached at" is the `finishedAt` of the run that took the day's running total to the budget or past it. A day stopped by the $0.01 minimum (`POSTS_MIN_LEFT_USD`) counts as reached at that run.

The engine's existing warning ("daily budget $X reached … collection resumes tomorrow") stays as it is.

### 4. The old `/post-search` routes go

`GET`/`PUT /api/profiles/:profileId/post-search` and their DTO, service methods (`postSearchStatus`, `setPostSearch`), `libs/engine-client` methods and tests are deleted, as their code comments say this slice does. The web app no longer calls them.

### 5. Budget default and docs

- `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS` defaults to 3 (`environment.validation.ts`, both `.env.example` files, `deploy/engine/README.md`).
- Roadmap: 04b brief marked built with a link to this spec; the Phase 4 README table updated.

## Deploy gate and rollout

- **Two PRs, because merging to `main` deploys dev** _(my call)_:
  - **PR A, mergeable now:** the run order, `pausedUntil`, the admin page, the old routes' removal. Nothing shows to users: the switch stays `available: false`.
  - **PR B, one small PR merged at the gate:** `available: true` for posts, the budget default moving to 3, and the roadmap marked built. The default waits too, in case the hosted env doesn't set the value and the $5 Apify account would be drained.
- **Merge PR B after slices 04 and 04a are live on dev.** Until then a user who turns post search on spends budget and gets no matches. Slice 04 itself waits on the capacity fix (Claude reading capacity); this slice inherits that gate and does not fix capacity.
- **Hosted budget:** the hosted env currently means to cap posts at $0.01 on the new $5 Apify account (and that cap was seen not in effect on 11-27). Setting `COLLECTION_DAILY_BUDGET_USD_LINKEDIN_POSTS=3` on the hosted engine is the owner's step, once the Apify credit covers it. At about $1.30 a day for the owner's profile alone, a $5 balance lasts a few days.
- **Checks after deploy:** a second user's profile shows the switch; turning it on attaches its post builders (`searches` > 0 for a profile with a remote place); the next tick's log shows post segments in oldest-cursor order; `/admin/posts-budget` matches `search_segment_runs` for today.

## Goals, non-goals, anti-goals

- **Goals:** any user can turn post search on; no search is starved by sort order; the owner sees when to raise the budget; users see when their post searches are paused.
- **Non-goals:** per-user billing or plans; per-profile budget accounting; changing search wording, merging or failure handling (slice 01); job board run order; Claude reading capacity; whether the switch is also consent for automatic emails (slice 05 decides, and changes the copy if so).
- **Anti-goals:** a new user's searches silently never run; dollar amounts shown to users; post search turned on for anyone who didn't choose it.

## Left to the builder

- Where the oldest-cursor sort lives (a small pure function next to `planSegments`, unit tested, is the obvious place) and how it reads segment members' `coveredUntil`.
- The exact pause copy, within the wording above and `DESIGN.md`.
- The shape of the admin endpoint's DTO and the page layout.
- Whether to link the new admin page from an existing admin nav, if one exists.
