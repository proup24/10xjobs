# 04: Matches view

Spec: [2026-11-11-matches-view-design.md](../../superpowers/specs/2026-11-11-matches-view-design.md). This entry describes the slice as built.

## Goal

One organized page with every recent qualified job, and everything the user checks before applying: the role, the title, the company, the place, the description and the original posting, plus why it matched. It replaces the placeholder home page.

## What already exists (on `main`)

- The signed-in home page shows only "Signed in as …".
- The design system (`apps/web/DESIGN.md`, `components/ui`), the vertical nav and profile labels used by preferences.
- After slice 03, the user can read their matches with job details (`match_details`).
- No publish flow in the app yet (slice 06 comes after). Matches exist for profiles published straight through the engine: the one already on `10xjobs-dev`, or test profiles published through slice 02's publish route.

## In scope

- **Layout** _(user chose it)_: the job list on the left, the selected job on the right. At phone width, the list, then a page per job with a link back to the list.
- **Two tabs** _(user)_: "Last 24 hours" (the default) and "Last 7 days", each with its count. "Last 24 hours" is by posted time; "Last 7 days" is jobs whose `lastSeenAt` is within 7 days. Both sort by posted time, newest first. Closed jobs are hidden.
- **Posted time** _(user: in this slice)_: an engine change. Normalized jobs gain `postedAt`. For the LinkedIn job board it is the scrape time minus the item's `postedTime` ("8 hours ago"), kept within the published day; Greenhouse and Ashby keep their exact timestamps; a merged job takes its earliest source's. With nothing usable it is null and the page falls back to `publishedAt`'s day at 00:00 UTC, so an undated job is never fresher than it is. `NORMALIZER_VERSION` is bumped; existing jobs get it from `db:renormalize`.
- **The list:** each row has the title, company, place and arrangement, source badge(s), profile badge(s) in "All profiles", stack score ("n/a" when there was nothing to compare), "Unverified", and the age ("3 h ago", or the date when only a date is known).
- **"New"** _(user)_: posted 12 hours ago or less, by posted time only. A job with only a date is never "New".
- **"Viewed"** _(user)_: replaces "New" once the user has clicked "Open post" or "Apply" on the job. Stored in `job_views` (one row per user and job, RLS: own rows, and only for a job the user is matched with), so it shows on every device.
- **Profile switcher and "All profiles"** _(user)_: shown with more than one profile; drafts are listed and marked "Draft". "All profiles" (published profiles only) is offered with two or more published profiles and is then the default. A job several profiles matched is one row with a badge per profile; the detail switches between their reasons.
- **Source filter** _(user)_: All sources, then each channel with jobs in the view. A job from several channels passes for any of them.
- **The detail:** title, company, place, "posted ~3 hours ago on LinkedIn"; "Open post" and "Apply"; key facts (role, seniority and years, arrangement, places with time zones, contract type and engagement, salary), each "Not stated" when the job doesn't say; tech stack covered, missing and not compared; **why it matched**, one line per check worded from its stored reason; then the full description.
- **What wasn't checked:** the detail lists the preferences the matcher doesn't check yet (salary, contract type, engagement, required languages, work authorization, residence), from one constant beside the check wording, so slices 08 and 09 update it in one place.
- **URL state:** profile, source, tab and selected job are in the query, so the back button works and a job can be reopened; a job outside the window still opens by URL.
- **Empty and early states:** no matches in a tab (the 24-hour tab offers "Last 7 days"), a filter with no results ("Clear filters"), a draft profile ("isn't live yet"; slice 06 turns this into a prompt to finish setup), a job that isn't in the user's matches. A user with no profile is sent to setup by the app layout before the page loads.
- **Reading matches:** `match_details` takes a null profile for all the caller's profiles, returns `postedAt` and the caller's `viewedAt`, and has a `p_details` switch. The list reads light rows (`p_details: false`: no checks or description, only the arrangement of the facts) and the selected job is read in full; with 400 matches in the window the full read cost ~0.5 ms a row and 2.3 MB. `auth.uid()` is read once per call.

## Dropped

- **"New since you last looked"** _(user)_: the planned per-profile "last looked" record is not built. "New" by posted time and the "Viewed" marker replace it.

## Out of scope

- Rejected jobs (slice 05).
- Marking jobs as applied, saved or hidden, and any feedback (later phases).
- Other sources (later in Phase 2). The page shows them when they arrive.
- Notifications.
- Sorting other than newest first, and filters other than profile, source and the two tabs.
- Paging. The 7-day window bounds the list; on a seeded dataset of 400 matches in the window the default page loads in under a second on a production build.

## Locked

- Recent only, never the full history _(user)_. The page's widest window is 7 days of `lastSeenAt`, inside the matcher's 30-day window.
- Built only from `components/ui` and theme tokens.
- Reads and writes go through `supabase-js` under RLS.

## Done when

On the hosted app, a user with a published profile opens the home page and sees their recent qualified jobs side by side, newest by posted time first, with "Last 24 hours" and "Last 7 days" tabs, "New" on jobs posted in the last 12 hours, and a source badge. They can switch profiles or pick "All profiles", filter by source, read a job's facts, why it matched and its description, and open the original post, after which the job shows "Viewed". Existing jobs on dev have posted times after the renormalize run (a hand-off step after deploy), and the isolation harness proves the new limits.
