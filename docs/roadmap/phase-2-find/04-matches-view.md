# 04: Matches view

## Goal

One organized page with every recent qualified job for a profile, and everything the user checks before applying: the role, the title, the company, the place, the description and the original posting, plus why it matched. It replaces the placeholder home page.

## What already exists (on `main`)

- The signed-in home page shows only "Signed in as …".
- The design system (`apps/web/DESIGN.md`, `components/ui`), the vertical nav and profile labels used by preferences.
- After slice 03, the user can read their matches with job details.
- No publish flow in the app yet (slice 06 comes after). Matches exist for profiles published straight through the engine: the one already on `10xjobs-dev`, or test profiles published through slice 02's publish route.

## In scope

- **Layout** _(user chose it)_: the job list on the left, the selected job on the right. At phone width, the list, then a page per job.
- **The list:** qualified jobs whose `lastSeenAt` is within the recent window, for one profile, newest first by default. Each row: title, company, place and arrangement, stack score, age, source, a "new" marker and an "unverified" marker.
- **The detail:** title, company, places with arrangement and time zones, seniority, salary when stated, posted date, links to the original posting and the apply link, **why it matched** (each check and its reason, stack covered and missing), and the full description.
- **What wasn't checked:** the detail says plainly which preferences the matcher doesn't check yet (salary, contract type, engagement), so the user doesn't assume they were.
- **Profile switcher** when the user has more than one published profile.
- **"New since you last looked":** the app records when the user last viewed each profile's matches, and marks jobs whose `decidedAt` is later.
- **Empty and early states:** a just-published profile with no matches yet, and a draft profile. Until publish on create (slice 06) lands, a draft says plainly that the profile isn't live yet; slice 06 turns that into a prompt to finish setup.

## Out of scope

- Rejected jobs (slice 05).
- Marking jobs as applied, saved or hidden, and any feedback (later phases).
- Other sources (later in Phase 2).
- Notifications.

## Locked

- Recent only, never the full history _(user)_.
- Built only from `components/ui` and theme tokens.
- Reads go through `supabase-js` under RLS.

## For the slice spec

- Sorting and filtering beyond newest first (by stack score, arrangement), if any.
- Whether the selected job lives in the URL (so a job can be reopened and the back button works). Likely yes.
- Where "last looked" is stored (a per-profile timestamp table the user owns) and when it moves: on opening the page, or per job opened.
- How "why it matched" turns `checks` into readable lines, with the stored reasons as the source.
- Pagination or virtualization for long lists.

## Done when

On the hosted app, a user with a published profile sees its recent qualified jobs in the side-by-side view, can read each job's details, why it matched and the original posting, and sees which ones are new since their last visit.
