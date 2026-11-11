# Matches view (Phase 2, slice 04)

Roadmap: [docs/roadmap/phase-2-find/04-matches-view.md](../../roadmap/phase-2-find/04-matches-view.md)

## Intent

The signed-in home page becomes the place the user works through their matches. Their habit (user): start with the freshest jobs, usually only those posted in the last day, scan the title and the source, open a job to read the company, arrangement, contract type, location, salary, tech stack and why it matched, then open the original post. The page is built around that: freshness comes first, the facts that decide whether to apply come next, and the original post is one click away.

This replaces the placeholder home page ("Signed in as …").

## Goals

- A side-by-side view: the job list on the left, the selected job on the right (user, from the roadmap). At phone width, the list on one page and each job on a page of its own.
- Freshness by real posted time, so "posted 3 hours ago" means what LinkedIn says (user).
- A "Last 24 hours" tab and a "Last 7 days" tab.
- A "New" marker for jobs posted 12 hours ago or less (user).
- A "Viewed" marker once the user has opened a job's post or apply link (user).
- A profile switcher with an "All profiles" choice, and a source filter (user).
- Every fact the user checks before applying, plus why the job matched and what the matcher didn't check.

## Non-goals

- Rejected jobs (slice 05).
- Saved, applied or hidden jobs, and any feedback (later phases).
- Other sources being collected (later in Phase 2). The page shows them when they arrive; it doesn't add them.
- Notifications.
- Sorting other than newest first, and filters other than profile, source and the two tabs.
- A "seen since your last visit" record. The roadmap planned one; the user dropped it for the 12-hour "New" rule and the "Viewed" marker.

## Anti-goals

- Showing the full match history. The page is recent only (user, locked in the roadmap).
- Making the user think a preference was checked when it wasn't (salary, contract type, engagement, languages, work authorization, residence).
- Showing a job as fresh when it isn't, for example a weeks-old LinkedIn job counted as posted on the day we first saw it.
- Leaking another user's matches or views, or letting a user learn about jobs they aren't matched with.

## Constraints

- Built only from `components/ui` and theme tokens, following `apps/web/DESIGN.md`.
- Reads and writes go through `supabase-js` under RLS.
- The Prisma contract is the only schema source, RLS included. Database functions follow slice 03's precedent: raw SQL in an app migration (`libs/database/src/migrations/app/20261110T2146_match_details/migration.ts`).
- The engine change follows the normalizer's rebuild path: bump `NORMALIZER_VERSION` (`apps/xjobs/src/modules/ingest/normalize/record.ts`) and run `db:renormalize`.

## Decisions

### Posted time (user: in this slice)

LinkedIn's job board gives only a posted date (`publishedAt`, midnight UTC, stored as `2026-11-10`). Every LinkedIn job-board item also carries `postedTime`, such as `"8 hours ago"`, relative to when the actor scraped it. All 4,048 jobs on dev have a date and none has a time.

- Add a posted timestamp to normalized jobs (name left to the builder, for example `postedAt`, nullable `timestamptz`), alongside the existing `publishedAt` date.
- **LinkedIn job board:** posted time ≈ the raw version's scrape time minus `postedTime`. `postedTime` is a volatile key, left out of the content hash, so a version keeps the value from the scrape that first saw that content. The scrape time to use is that version's first sighting (its `firstSeenAt` or its first batch's time; the builder picks whichever is the actual scrape time). Parse "N minutes / hours / days / weeks / months ago" and their singular forms. The estimate is about as precise as the unit: hours for recent jobs, days or worse further back.
- **Bounds:** the posted time is kept within `publishedAt`'s day and never after the scrape time. LinkedIn rounds hours down, so on dev about 1% of estimates land up to ~30 minutes after the end of the published day ("20 hours ago" scraped 2026-11-10 20:32 with date 2026-11-09). These clamp to the **end** of the published day (capped at the scrape time), not its start, so a fresh job isn't pushed a day back and out of "Last 24 hours". An estimate before the day's start clamps to the start (Claude's call; none on dev).
- **LinkedIn posts** (`postedAt.postedAgoText` / `postedAgoShort` in that channel's payload): the same rule, if the mapper has the field (builder checks).
- **Greenhouse and Ashby:** their exact published timestamps, kept in full in place of only the date.
- **Nothing usable:** the posted time is null. The view then falls back to `publishedAt`'s day at 00:00 UTC, the conservative reading, so an undated job is never counted as fresher than it is (Claude's call).
- **Merged jobs** (one job, several raw items): the earliest posted time among its sources (Claude's call).
- Bump `NORMALIZER_VERSION`. Running `db:renormalize` on dev after deploy is a hand-off step for the human (Claude has no dev credentials or engine access); the plan ends with it and the PR says so.

### Reading matches (extends slice 03's `match_details`)

`match_details(p_profile_id, p_outcome, p_since, p_job_id)` exists on `main`. This slice changes it:

- `p_profile_id` null means all the caller's profiles. Still starts from `job_matches` filtered by `auth.uid()`, so "all" is only ever the caller's own.
- Returns the new posted time.
- Returns whether the caller has viewed the job (a boolean or the view time), from the views table below.
- Still returns one row per match. The client groups the "All profiles" rows by job.
- The isolation harness gains: a null profile id returns only the caller's matches; the view flag reflects only the caller's views; the allowlist test covers the new columns.

### The two tabs

- **Last 24 hours:** jobs whose posted time (or its fallback) is in the last 24 hours. This is the default tab (Claude's call, from the user's habit).
- **Last 7 days:** jobs whose `lastSeenAt` is within 7 days, passed as slice 03's `since` (the roadmap's recent window; 7 days is Claude's call). A job collected this week but posted earlier still shows here, at its posted place in the order.
- Both tabs sort by posted time, newest first (user). Each tab shows its count.
- Closed jobs are hidden (Claude's call). None exist on dev yet.

### Markers

- **New:** posted 12 hours ago or less (user), from the posted time only. A job with only a date is never "New".
- **Viewed:** the user clicked "Open post" or "Apply" on this job (user). It replaces "New" on the row. It applies to the job, not to a profile.
- **Unverified:** from `job_matches.unverified`, as today.

### Views table (Claude's call)

The "Viewed" mark lives in the database, so it shows on every device.

- A table the user owns: `userId`, `jobId`, first viewed time; one row per user and job; `jobId` cascades on job delete.
- RLS: a user reads and inserts only their own rows, and may insert only for a job they have a match for, so the table can't be used to probe job ids.
- Written with `supabase-js` (an insert that ignores the existing row) when either link is clicked. The link opens in a new tab at once; a failed write doesn't block it.

### Profile switcher and "All profiles" (user)

- Shown when the user has more than one profile of any state, with each profile's label (the one Preferences uses); drafts are listed and marked "Draft". "All profiles" is offered when two or more profiles are published, and covers published profiles only. Default: "All profiles" when offered, otherwise the published profile, otherwise the draft (Claude's calls).
- In "All profiles", a job matched by several profiles is one row, with a small badge per matching profile. The row's stack score is the highest of its matches (Claude's call).
- In the detail, "Why it matched" names the profile. When several profiles matched, a switch (tabs) picks which profile's reasons and stack coverage to show.

### Source filter (user)

- A select: All, then one entry per channel that has jobs in the current view (LinkedIn job board, LinkedIn posts, Greenhouse, Ashby, with display labels). Today it lists only LinkedIn.
- Each row shows a source badge. A job collected from several channels shows a badge per channel and passes the filter for any of them.

### The list row

Title with the New / Viewed marker; company · place · arrangement; source badge(s), profile badge(s) in "All profiles", stack score (or "n/a" when the matcher had nothing to compare), "Unverified", and age ("3 h ago", from the posted time; the date when there's only a date).

### The detail

In this order (the user approved the mockup):

1. Title; company (linked when `companyUrl` exists); location; "posted ~3 hours ago on LinkedIn".
2. **Open post** (the main button, opens `postingUrl` in a new tab) and **Apply** (when `applyUrl` exists, new tab). Both mark the job viewed.
3. Key facts: role, seniority (and years required), arrangement, places with time zones, contract type and engagement, salary. Each one shows "Not stated" when the job doesn't say. On dev most LinkedIn facts are unstated, so the layout must look right with most rows reading "Not stated".
4. Tech stack: covered ("You have"), uncovered ("You don't"), and mentioned but not compared, with the coverage percentage.
5. Why it matched: one line per check (position, seniority, location, stack) with ✓ pass or ? unknown, worded from the stored `reason` and the check's values, with codes shown as their labels (not `fullstack_engineer`). The exact wording is left to the builder; the stored reasons are the source.
6. A plain note listing the preferences the matcher doesn't check yet. Today that's salary, contract type, engagement, required languages, work authorization and residence (the matcher README says residence and work authorization aren't checked; slices 08 and 09 add languages and work authorization). The list comes from one constant beside the list of rules the matcher runs, so slices 08 and 09 update it in one place (Claude's call).
7. The full description as plain text with its line breaks.

Source quotes for facts (slice 03 returns them) may be shown on hover or expand; that's left to the builder.

### URL state (Claude's call)

The profile, source, tab and selected job are in the URL's query, so the back button works and a job can be reopened. Opening a job by URL that isn't in the current tab's window still loads it (slice 03's `p_job_id` with a null `since`).

### Phone width

The list is a page; choosing a job opens its detail as its own page with a back link to the list (same URL state).

### Empty and early states

- A published profile with no matches in the tab: matches appear as new jobs are collected. On the 24-hour tab, offer to switch to "Last 7 days".
- A draft profile (selected through the switcher, or the user's only profile): says plainly the profile isn't live yet. Slice 06 later turns this into a prompt to finish setup.
- A user with no profile: points to setup.
- A filter with no results: says so and offers to clear the filter.

### Size (Claude's call)

No paging at first: the 7-day window bounds the list, and the API's 1,000-row cap applies. The builder seeds a realistic local dataset (a few hundred matches in 7 days across two profiles) and checks the page stays fast. If it doesn't, add paging or a virtualized list and record why.

### Navigation

The home route shows the matches view, and the sidebar's first entry is "Matches" (`NAV_ITEMS` in `components/layout/app-nav.tsx`).

### Roadmap

Update `docs/roadmap/phase-2-find/04-matches-view.md` in the same PR: "New" by posted time, the "Viewed" marker, the all-profiles and source choices, the posted-time engine change, and the dropped "last looked" record.

## Left to the builder

- Names of the posted-time column, the views table and any new function parameters.
- How the posted time is parsed and tested (including odd `postedTime` strings), and where in the normalizer the scrape time comes from.
- Whether the "Viewed" write is a direct insert or a small function.
- Component breakdown, the exact wording of the check lines, and whether fact quotes are shown.
- Indexes, if `EXPLAIN` on the realistic dataset shows a need.

## Done when

On the hosted app, a user with a published profile opens the home page and sees their recent qualified jobs side by side, newest by posted time first, with "Last 24 hours" and "Last 7 days" tabs, "New" on jobs posted in the last 12 hours, and a source badge. They can switch profiles or pick "All profiles", filter by source, read a job's facts, why it matched and its description, and open the original post, after which the job shows "Viewed". Existing jobs on dev have posted times after the renormalize run, and the isolation harness proves the new limits. CI is green.

Verification: locally against a seeded dataset that covers every state (fresh, older, multiple profiles, several sources, viewed). On dev, after the human runs `db:renormalize`, existing jobs carry posted times. The hosted "Last 24 hours" tab and "New" marker are checked once scheduled collection brings fresh qualified jobs (dev's 3 matches are from 2026-11-09); that check isn't blocked by this slice (Claude's call).
